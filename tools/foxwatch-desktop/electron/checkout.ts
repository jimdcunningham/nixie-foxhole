import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function isToolsCheckout(directory: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    return manifest.name === 'nixie-foxhole' &&
      (await stat(path.join(directory, 'tools/foxwatch/run-foxwatch.mjs'))).isFile();
  } catch { return false; }
}

/** Installed binaries keep writable tools and game data in the user's existing checkout. */
export async function resolveToolsCheckout(options: {
  profile: string;
  developmentRoot?: string;
  explicitRoot?: string;
  pickDirectory: () => Promise<string | undefined>;
}): Promise<string | undefined> {
  const settingsFile = path.join(options.profile, 'tools-checkout.json');
  const remember = async (directory: string) => {
    const checkout = await realpath(directory);
    await mkdir(options.profile, { recursive: true });
    await writeFile(settingsFile + '.tmp', JSON.stringify({ checkout }) + '\n');
    await rename(settingsFile + '.tmp', settingsFile);
    return checkout;
  };
  for (const specified of [options.explicitRoot, options.developmentRoot]) {
    if (!specified) continue;
    if (!await isToolsCheckout(specified)) throw new Error('The FoxWatch tools checkout is unavailable: ' + specified);
    return remember(specified);
  }
  try {
    const saved = JSON.parse(await readFile(settingsFile, 'utf8')).checkout;
    if (typeof saved === 'string' && await isToolsCheckout(saved)) return remember(saved);
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  // Existing inspector users may have saved an assets folder inside their checkout.
  try {
    const saved = JSON.parse(await readFile(path.join(options.profile, 'inspector.json'), 'utf8')).assetsDirectory;
    if (typeof saved === 'string') {
      let candidate = path.resolve(saved);
      while (true) {
        if (await isToolsCheckout(candidate)) return remember(candidate);
        const parent = path.dirname(candidate);
        if (parent === candidate) break;
        candidate = parent;
      }
    }
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  while (true) {
    const selected = await options.pickDirectory();
    if (!selected) return undefined;
    if (await isToolsCheckout(selected)) return remember(selected);
  }
}
