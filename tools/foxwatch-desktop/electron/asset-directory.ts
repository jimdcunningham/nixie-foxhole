import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AssetDetails,
  AssetEntry,
  AssetKind,
  AssetRoot,
} from '../shared/contracts.js';

export function assetKind(name: string): AssetKind {
  const extension = path.extname(name).toLowerCase();
  if (
    [
      '.png',
      '.webp',
      '.jpg',
      '.jpeg',
      '.gif',
      '.svg',
      '.dds',
      '.tga',
      '.ktx',
      '.ktx2',
    ].includes(extension)
  )
    return 'image';
  if (['.glb', '.gltf', '.fbx', '.obj', '.blend'].includes(extension))
    return 'model';
  if (['.json', '.bin', '.dat'].includes(extension)) return 'data';
  if (['.md', '.txt', '.csv', '.yaml', '.yml'].includes(extension))
    return 'text';
  if (['.wav', '.ogg', '.mp3'].includes(extension)) return 'audio';
  return 'file';
}

export function readableName(name: string, directory: boolean): string {
  if (/^[a-f0-9]{32,64}$/i.test(path.parse(name).name)) {
    return `${directory ? 'Shared Content' : 'Shared Asset'} · ${name.slice(0, 8)}${directory ? '' : path.extname(name)}`;
  }
  return name;
}

export class AssetDirectory {
  readonly root: AssetRoot;
  private aliases = new Map<string, string>();
  private constructor(canonicalPath: string) {
    this.root = {
      id: randomUUID(),
      name: path.basename(canonicalPath) || canonicalPath,
      path: canonicalPath,
    };
  }
  static async open(directory: string): Promise<AssetDirectory> {
    const canonical = await realpath(directory);
    if (!(await stat(canonical)).isDirectory())
      throw new Error('Choose an assets directory.');
    const source = new AssetDirectory(canonical);
    await source.loadNames();
    return source;
  }
  async resolve(relative: string): Promise<string> {
    if (
      typeof relative !== 'string' ||
      relative.includes('\0') ||
      path.isAbsolute(relative) ||
      path.win32.isAbsolute(relative) ||
      relative.split(/[/\\]/).includes('..')
    )
      throw new Error('Invalid asset path.');
    const candidate = path.resolve(this.root.path, relative);
    const canonical = await realpath(candidate);
    const fromRoot = path.relative(this.root.path, canonical);
    if (
      fromRoot === '..' ||
      fromRoot.startsWith('..' + path.sep) ||
      path.isAbsolute(fromRoot)
    )
      throw new Error('Asset is outside the open directory.');
    if ((await lstat(candidate)).isSymbolicLink())
      throw new Error('Linked entries are not inspected.');
    return canonical;
  }
  async list(relative: string): Promise<AssetEntry[]> {
    const directory = await this.resolve(relative);
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          !entry.name.startsWith('.') &&
          !entry.isSymbolicLink() &&
          (entry.isDirectory() || entry.isFile()),
      )
      .map((entry) => {
        const logical = path.posix.join(
          relative.replaceAll('\\', '/'),
          entry.name,
        );
        const directory = entry.isDirectory();
        return {
          path: logical,
          name: entry.name,
          label:
            this.aliases.get(logical) ?? readableName(entry.name, directory),
          directory,
          kind: assetKind(entry.name),
        };
      })
      .sort(
        (a, b) =>
          Number(b.directory) - Number(a.directory) ||
          a.label.localeCompare(b.label, undefined, {
            numeric: true,
            sensitivity: 'base',
          }),
      );
  }
  async inspect(relative: string): Promise<AssetDetails> {
    const absolutePath = await this.resolve(relative);
    const info = await stat(absolutePath);
    if (!info.isFile()) throw new Error('Select a file to inspect.');
    const name = path.basename(absolutePath);
    return {
      path: relative,
      name,
      label: this.aliases.get(relative) ?? readableName(name, false),
      directory: false,
      kind: assetKind(name),
      absolutePath,
      bytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      extension: path.extname(name).slice(1).toUpperCase() || 'FILE',
    };
  }
  private async readMetadata(
    relative: string,
  ): Promise<Record<string, any> | null> {
    try {
      const file = await this.resolve(relative);
      if ((await stat(file)).size > 32 * 1024 * 1024) return null;
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return null;
    } // Ordinary folders work without FoxWatch metadata.
  }
  private async loadNames(): Promise<void> {
    const models = await this.readMetadata('models/manifest.v1.json');
    const shared = new Map<string, string>();
    for (const model of Object.values(models?.sharedParts ?? {}) as any[]) {
      if (
        typeof model?.resourceId === 'string' &&
        typeof model?.path === 'string'
      )
        shared.set(model.resourceId, model.path);
    }
    for (const model of [
      ...Object.values(models?.assets ?? {}),
      ...Object.values(models?.resources ?? {}),
    ] as any[]) {
      if (
        typeof model?.codeName !== 'string' ||
        !Array.isArray(model.modelParts?.parts)
      )
        continue;
      for (const [index, part] of model.modelParts.parts.entries()) {
        const file = shared.get(part?.resourceId);
        if (file && !this.aliases.has(file))
          this.aliases.set(
            file,
            `${model.codeName} · Shared Part ${index + 1}${path.extname(file)}`,
          );
      }
    }
    const world = await this.readMetadata('world/index.json');
    for (const [key, region] of Object.entries(world?.regions ?? {}) as [
      string,
      any,
    ][]) {
      if (typeof region?.manifest?.path !== 'string') continue;
      const file = path.posix.join('world', region.manifest.path);
      const label = String(region.name ?? region.id ?? key).replace(
        /([a-z])([A-Z])/g,
        '$1 $2',
      );
      this.aliases.set(
        path.posix.dirname(file),
        `${label.charAt(0).toUpperCase()}${label.slice(1)} · Region`,
      );
      this.aliases.set(file, `${label} · Region Manifest.json`);
    }
  }
}
