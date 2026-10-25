import { build, Platform, Arch } from 'electron-builder';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(project, '../../artifacts/foxwatch-desktop');
const stage = await mkdtemp(path.join(os.tmpdir(), 'foxwatch-package-'));
try {
  const manifest = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
  await mkdir(stage, { recursive: true });
  // Stage only compiled app files. Never bundle the checkout, credentials, or generated game assets.
  for (const name of ['dist', 'dist-electron']) {
    await cp(path.join(project, name), path.join(stage, name), { recursive: true });
  }
  await writeFile(path.join(stage, 'package.json'), JSON.stringify({
    name: manifest.name, productName: manifest.productName, version: manifest.version,
    description: 'FoxWatch asset generation, monitoring, and inspection',
    author: 'Nixie', type: 'module', main: manifest.main, dependencies: {},
  }, null, 2));
  // An empty lockfile keeps packaging isolated from the monorepo's dependency graph.
  await writeFile(path.join(stage, 'package-lock.json'), JSON.stringify({
    name: manifest.name, version: manifest.version, lockfileVersion: 3,
    packages: { '': { name: manifest.name, version: manifest.version } },
  }));
  await mkdir(path.join(stage, 'node_modules'), { recursive: true });
  const config = JSON.parse(await readFile(path.join(project, 'electron-builder.json'), 'utf8'));
  delete config.$schema;
  await build({ projectDir: stage, targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never',
    config: { ...config, npmRebuild: false, electronVersion: manifest.devDependencies.electron,
      directories: { output, buildResources: path.join(project, 'build') },
      nsis: { ...config.nsis, include: path.join(project, 'build/installer.nsh') },
      win: { ...config.win, icon: path.join(project, 'build/icon.ico') } },
  });
} finally {
  if (path.dirname(stage) !== path.resolve(os.tmpdir()) || !path.basename(stage).startsWith('foxwatch-package-')) {
    throw new Error('Unexpected installer staging directory: ' + stage);
  }
  await rm(stage, { recursive: true, force: true });
}
