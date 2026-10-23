import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  rmdir,
  utimes,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { createBrotliDecompress } from 'node:zlib';
import type { AssetDirectory } from './asset-directory.js';
import type {
  AssetEntry,
  AssetDetails,
  AssetChange,
  ReviewSummary,
} from '../shared/contracts.js';

interface SnapshotFile extends AssetEntry {
  sha256: string;
  bytes: number;
  modifiedAt: string;
}
interface Baseline {
  schemaVersion: 1;
  identity: string;
  approvedAt: string;
  files: Record<string, SnapshotFile>;
}
export type ReviewProgress = (
  phase: string,
  completed: number,
  total: number,
) => void;
const validPath = (value: string) =>
  !!value &&
  !/[\\:\0]/.test(value) &&
  !value.startsWith('/') &&
  value.split('/').every((part) => !!part && part !== '.' && part !== '..');

async function fingerprint(file: string, logical: string) {
  const hash = createHash('sha256');
  const input = createReadStream(file);
  // Compare decoded world content, so HTTP recompression is not an asset change.
  const stream = logical.startsWith('world/content/br/')
    ? input.pipe(createBrotliDecompress())
    : input;
  if (stream !== input) input.on('error', (error) => stream.destroy(error));
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > 512 * 1024 ** 2) {
      stream.destroy();
      input.destroy();
      throw new Error('An asset exceeds the 512 MB comparison limit.');
    }
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export class AssetReview {
  private baseline: Baseline | null = null;
  private changes = new Map<string, AssetChange>();
  private comparedAt: string | null = null;
  private unchanged = 0;
  private source: AssetDirectory;
  readonly storage: string;
  private identity: string;
  private constructor(
    source: AssetDirectory,
    storage: string,
    identity: string,
  ) {
    this.source = source;
    this.storage = storage;
    this.identity = identity;
  }

  static async open(
    source: AssetDirectory,
    store: string,
    identity = source.root.path,
  ) {
    const key = createHash('sha256').update(identity).digest('hex');
    const review = new AssetReview(source, path.join(store, key), identity);
    try {
      const file = path.join(review.storage, 'approved.json');
      if ((await stat(file)).size > 64 * 1024 ** 2)
        throw new Error('The approved baseline index is too large.');
      const baseline: Baseline = JSON.parse(await readFile(file, 'utf8'));
      if (
        baseline.schemaVersion !== 1 ||
        baseline.identity !== identity ||
        !Number.isFinite(Date.parse(baseline.approvedAt)) ||
        !baseline.files ||
        Object.entries(baseline.files).some(
          ([logical, row]) =>
            !validPath(logical) ||
            row.path !== logical ||
            !/^[a-f0-9]{64}$/.test(row.sha256) ||
            !Number.isSafeInteger(row.bytes) ||
            row.bytes < 0 ||
            typeof row.label !== 'string' ||
            typeof row.modifiedAt !== 'string',
        )
      )
        throw new Error('The approved baseline index is invalid.');
      baseline.files = Object.assign(Object.create(null), baseline.files);
      review.baseline = baseline;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return review;
  }

  summary(): ReviewSummary {
    const counts = {
      added: 0,
      modified: 0,
      deleted: 0,
      unchanged: this.unchanged,
    };
    for (const status of this.changes.values()) counts[status]++;
    return {
      approvedAt: this.baseline?.approvedAt ?? null,
      comparedAt: this.comparedAt,
      ...counts,
    };
  }
  private objectFile(row: SnapshotFile) {
    return path.join(
      this.storage,
      'objects',
      row.sha256,
      path.posix.basename(row.path),
    );
  }
  private async scan(
    onProgress: ReviewProgress,
  ): Promise<Record<string, SnapshotFile>> {
    const entries: AssetEntry[] = [];
    const visit = async (parent: string) => {
      for (const entry of await this.source.list(parent)) {
        if (entry.directory) await visit(entry.path);
        else {
          if (!validPath(entry.path))
            throw new Error('An asset path is not portable: ' + entry.path);
          entries.push(entry);
        }
        if (entries.length > 100000)
          throw new Error(
            'The asset directory exceeds the comparison file limit.',
          );
      }
    };
    await visit('');
    const files: Record<string, SnapshotFile> = Object.create(null);
    let cursor = 0,
      completed = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, entries.length) }, async () => {
        while (cursor < entries.length) {
          const entry = entries[cursor++]!;
          const file = await this.source.resolve(entry.path),
            before = await stat(file);
          const sha256 = await fingerprint(file, entry.path),
            after = await stat(file);
          if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
            throw new Error(
              'An asset changed during comparison. Refresh and try again.',
            );
          files[entry.path] = {
            ...entry,
            sha256,
            bytes: after.size,
            modifiedAt: after.mtime.toISOString(),
          };
          onProgress('Comparing Assets', ++completed, entries.length);
        }
      }),
    );
    return files;
  }
  async compare(onProgress: ReviewProgress = () => {}) {
    if (!this.baseline)
      throw new Error('Approve a baseline before comparing assets.');
    return this.updateComparison(await this.scan(onProgress));
  }
  private updateComparison(files: Record<string, SnapshotFile>) {
    if (!this.baseline) throw new Error('No approved baseline.');
    const changes = new Map<string, AssetChange>();
    let unchanged = 0;
    for (const [logical, row] of Object.entries(files)) {
      const previous = this.baseline.files[logical];
      if (!previous) changes.set(logical, 'added');
      else if (previous.sha256 !== row.sha256) changes.set(logical, 'modified');
      else unchanged++;
    }
    for (const logical of Object.keys(this.baseline.files))
      if (!files[logical]) changes.set(logical, 'deleted');
    this.changes = changes;
    this.unchanged = unchanged;
    this.comparedAt = new Date().toISOString();
    return this.summary();
  }
  /** A fresh, immutable plan is prepared before the confirmation is shown. */
  async prepareDiscard(onProgress: ReviewProgress = () => {}) {
    if (!this.baseline) throw new Error('Approve a baseline before discarding changes.');
    await this.assertWritableRoot();
    const files = await this.scan(onProgress);
    const summary = this.updateComparison(files);
    return {
      baseline: this.baseline,
      files,
      changes: new Map(this.changes),
      summary,
    };
  }

  private async assertWritableRoot() {
    const root = this.source.root.path;
    if (root === path.parse(root).root)
      throw new Error('Choose an assets directory, not a filesystem root.');
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root)
      throw new Error('The assets directory moved or became a link. Reopen it before restoring.');
  }

  /** Missing parents are allowed, but no path component may redirect a write. */
  private async restoreTarget(logical: string, createParents = false) {
    if (!validPath(logical) || logical.split('/').some(part => part.startsWith('.')))
      throw new Error('Invalid baseline asset path: ' + logical);
    const root = this.source.root.path;
    await this.assertWritableRoot();
    const parts = logical.split('/');
    let target = root;
    for (const [index, part] of parts.entries()) {
      target = path.join(target, part);
      const relative = path.relative(root, target);
      if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
        throw new Error('Restore target is outside the assets directory.');
      let info;
      try { info = await lstat(target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const parent = index < parts.length - 1;
      if (parent && !info && createParents) {
        await mkdir(target).catch(error => { if (error.code !== 'EEXIST') throw error; });
        info = await lstat(target);
      }
      if (info && (info.isSymbolicLink() || (parent ? !info.isDirectory() : !info.isFile())))
        throw new Error('Restore blocked by a link or changed file type: ' + logical);
    }
    return target;
  }

  private async approvedSource(row: SnapshotFile) {
    const file = this.objectFile(row), canonical = await realpath(file), root = await realpath(this.storage);
    if (!canonical.startsWith(root + path.sep) || (await lstat(file)).isSymbolicLink())
      throw new Error('Invalid approved file: ' + row.path);
    return canonical;
  }

  async discard(plan: Awaited<ReturnType<AssetReview['prepareDiscard']>>, onProgress: ReviewProgress = () => {}) {
    if (plan.baseline !== this.baseline)
      throw new Error('The approved baseline changed. Confirm the discard again.');
    await this.assertWritableRoot();
    const latest = await this.scan(onProgress);
    if (Object.keys(latest).length !== Object.keys(plan.files).length || Object.entries(latest).some(([key,row]) => {
      const expected = plan.files[key];
      return !expected || row.sha256 !== expected.sha256 || row.bytes !== expected.bytes || row.modifiedAt !== expected.modifiedAt;
    })) throw new Error('Working files changed after confirmation. Review and confirm again.');
    if (!plan.changes.size) return this.updateComparison(latest);
    const rows = [...plan.changes].map(([logical,change], index) => ({logical,change,index}));
    // Resolve every destination before moving any working file. A replaced parent
    // directory or a broken baseline therefore cannot cause a partial discard.
    for (const row of rows) await this.restoreTarget(row.logical);
    const root = this.source.root.path;
    const staging = await mkdtemp(path.join(root, '.foxwatch-restore-'));
    let mutated = false;
    const clean = async () => {
      if (path.dirname(staging) !== root || !path.basename(staging).startsWith('.foxwatch-restore-') || (await lstat(staging)).isSymbolicLink())
        throw new Error('Invalid restore staging directory.');
      await rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    };
    try {
      await mkdir(path.join(staging, 'approved'));
      await mkdir(path.join(staging, 'discarded'));
      let prepared = 0;
      for (const row of rows) {
        if (row.change !== 'added') {
          const approved = plan.baseline.files[row.logical]!;
          const payload = path.join(staging, 'approved', String(row.index));
          await copyFile(await this.approvedSource(approved), payload, constants.COPYFILE_FICLONE);
          if (await fingerprint(payload, row.logical) !== approved.sha256)
            throw new Error('The approved file is missing or corrupt: ' + row.logical);
          const date = new Date(approved.modifiedAt);
          if (!Number.isFinite(date.getTime())) throw new Error('Invalid approved modification time.');
          await utimes(payload, date, date);
        }
        onProgress('Verifying Approved Files', ++prepared, rows.length);
      }
      await writeFile(path.join(staging, 'restore.json'), JSON.stringify({
        schemaVersion: 1, root, approvedAt: plan.baseline.approvedAt,
        files: rows.map(row => ({...row, workingFile: plan.files[row.logical] ?? null})),
      }, null, 2));
      let completed = 0;
      for (const row of rows) {
        const target = await this.restoreTarget(row.logical, row.change !== 'added');
        const working = plan.files[row.logical];
        if (working) {
          if (await fingerprint(target, row.logical) !== working.sha256)
            throw new Error('A working file changed while restoring: ' + row.logical);
          await rename(target, path.join(staging, 'discarded', String(row.index)));
          mutated = true;
        } else {
          try { await lstat(target); throw new Error('A file appeared while restoring: ' + row.logical); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        if (row.change !== 'added') {
          mutated = true;
          await rename(path.join(staging, 'approved', String(row.index)), target);
        }
        onProgress('Returning to Baseline', ++completed, rows.length);
      }
      // Remove only empty parents of added files, preserving approved directories
      // and any hidden files or other content that was never part of the review.
      const approvedDirs = new Set<string>();
      for (const logical of Object.keys(plan.baseline.files)) {
        let parent = path.posix.dirname(logical);
        while (parent !== '.') { approvedDirs.add(parent); parent = path.posix.dirname(parent); }
      }
      const removable = new Set<string>();
      for (const row of rows) if (row.change === 'added') {
        let parent = path.posix.dirname(row.logical);
        while (parent !== '.' && !approvedDirs.has(parent)) { removable.add(parent); parent = path.posix.dirname(parent); }
      }
      for (const logical of [...removable].sort((a,b) => b.split('/').length-a.split('/').length)) {
        // Validating a synthetic child checks the complete directory ancestry.
        const target = path.dirname(await this.restoreTarget(logical + '/restore-check'));
        await rmdir(target).catch(error => { if (!['ENOENT','ENOTEMPTY','EEXIST'].includes(error.code)) throw error; });
      }
      const result = await this.compare(onProgress);
      if (result.added || result.modified || result.deleted)
        throw new Error('Working files changed during the restore. Review the remaining changes.');
      await clean();
      return result;
    } catch (cause) {
      if (!mutated) { await clean(); throw cause; }
      throw new Error((cause instanceof Error ? cause.message : String(cause)) +
        '\nRestore stopped. The approved baseline is unchanged. Recoverable working files and a restore journal are retained at: ' + staging);
    }
  }

  async approve(onProgress: ReviewProgress = () => {}) {
    const files = await this.scan(onProgress);
    let completed = 0;
    const total = Object.keys(files).length;
    for (const row of Object.values(files)) {
      const destination = this.objectFile(row);
      await mkdir(path.dirname(destination), { recursive: true });
      let exists = false;
      try {
        exists = (await fingerprint(destination, row.path)) === row.sha256;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (!exists) {
        const temporary = destination + '.' + randomUUID() + '.tmp';
        try {
          await copyFile(
            await this.source.resolve(row.path),
            temporary,
            constants.COPYFILE_FICLONE,
          );
          if ((await fingerprint(temporary, row.path)) !== row.sha256)
            throw new Error(
              'An asset changed while saving the baseline. Try again.',
            );
          await rename(temporary, destination);
        } finally {
          await unlink(temporary).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          });
        }
      }
      onProgress('Saving Approved Baseline', ++completed, total);
    }
    const baseline: Baseline = {
      schemaVersion: 1,
      identity: this.identity,
      approvedAt: new Date().toISOString(),
      files,
    };
    await mkdir(this.storage, { recursive: true });
    const temporary = path.join(this.storage, randomUUID() + '.tmp');
    try {
      await writeFile(temporary, JSON.stringify(baseline), { flag: 'wx' });
      await rename(temporary, path.join(this.storage, 'approved.json'));
    } finally {
      await unlink(temporary).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    this.baseline = baseline;
    this.changes.clear();
    this.unchanged = Object.keys(files).length;
    this.comparedAt = baseline.approvedAt;
    return this.summary();
  }
  private status(logical: string, directory: boolean): AssetChange | undefined {
    if (!directory) return this.changes.get(logical);
    const statuses = new Set(
      [...this.changes]
        .filter(([key]) => key.startsWith(logical + '/'))
        .map(([, value]) => value),
    );
    return statuses.size === 1
      ? [...statuses][0]
      : statuses.size
        ? 'modified'
        : undefined;
  }
  async list(relative: string): Promise<AssetEntry[]> {
    const entries = new Map<string, AssetEntry>();
    try {
      for (const row of await this.source.list(relative))
        entries.set(row.path, row);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
        ![...this.changes].some(
          ([key, value]) =>
            value === 'deleted' && key.startsWith(relative + '/'),
        )
      )
        throw error;
    }
    const prefix = relative ? relative + '/' : '';
    for (const [logical, change] of this.changes) {
      if (change !== 'deleted' || !logical.startsWith(prefix)) continue;
      const suffix = logical.slice(prefix.length),
        name = suffix.split('/')[0]!,
        immediate = prefix + name;
      if (!entries.has(immediate)) {
        const row = this.baseline!.files[logical]!;
        entries.set(
          immediate,
          suffix.includes('/')
            ? {
                path: immediate,
                name,
                label: name,
                directory: true,
                kind: 'file',
                fromBaseline: true,
              }
            : { ...row, fromBaseline: true },
        );
      }
    }
    return [...entries.values()]
      .map((row) => ({ ...row, change: this.status(row.path, row.directory) }))
      .sort(
        (a, b) =>
          Number(b.directory) - Number(a.directory) ||
          a.label.localeCompare(b.label, undefined, {
            numeric: true,
            sensitivity: 'base',
          }),
      );
  }
  async resolve(relative: string): Promise<string> {
    if (!validPath(relative) && relative !== '')
      throw new Error('Invalid asset path.');
    if (this.changes.get(relative) !== 'deleted')
      return this.source.resolve(relative);
    const row = this.baseline?.files[relative];
    if (!row) throw new Error('The approved asset is unavailable.');
    const file = this.objectFile(row),
      canonical = await realpath(file),
      root = await realpath(this.storage);
    if (
      !canonical.startsWith(root + path.sep) ||
      (await lstat(file)).isSymbolicLink()
    )
      throw new Error('Invalid baseline file.');
    return canonical;
  }
  async comparison(relative: string) {
    if (!validPath(relative)) throw new Error('Invalid asset path.');
    const baseline = this.baseline;
    const row = baseline?.files[relative];
    let before: AssetDetails | null = null;
    if (row) {
      const file = this.objectFile(row), canonical = await realpath(file), root = await realpath(this.storage);
      if (!canonical.startsWith(root + path.sep) || (await lstat(file)).isSymbolicLink()) throw new Error('Invalid baseline file.');
      before = { ...row, directory: false, absolutePath: canonical, bytes: (await stat(canonical)).size,
        extension: path.extname(relative).slice(1).toUpperCase() || 'FILE', fromBaseline: true };
    }
    let after: AssetDetails | null = null;
    try { after = await this.source.inspect(relative); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (!before && !after) throw new Error('This asset is unavailable in both versions.');
    return { approvedAt: baseline?.approvedAt ?? null, before, after };
  }
  async inspect(relative: string): Promise<AssetDetails> {
    if (this.changes.get(relative) !== 'deleted')
      return {
        ...(await this.source.inspect(relative)),
        change: this.changes.get(relative),
      };
    const row = this.baseline!.files[relative]!;
    const absolutePath = await this.resolve(relative);
    return {
      ...row,
      bytes: (await stat(absolutePath)).size,
      directory: false,
      absolutePath,
      extension: path.extname(relative).slice(1).toUpperCase() || 'FILE',
      change: 'deleted',
      fromBaseline: true,
    };
  }
}
