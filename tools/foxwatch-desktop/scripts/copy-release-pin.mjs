import {build} from 'vite';
import {fileURLToPath} from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const pin = JSON.parse(
  await readFile(
    new URL(
      '../../../extensions/foxhole-planner/src/catalog-release-pin.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
await mkdir(new URL('../dist-electron/shared/', import.meta.url), {
  recursive: true,
});
await writeFile(
  new URL('../dist-electron/shared/release-pin.json', import.meta.url),
  JSON.stringify(pin),
);

// Bundle the canonical reader for the isolated inspector app; do not ship source-repo paths.
await build({configFile: false, build: {lib: {entry: fileURLToPath(new URL('../../../extensions/foxhole-planner/src/catalog-library.mjs', import.meta.url)), formats: ['es'], fileName: () => 'catalog-library.mjs'},
    outDir: fileURLToPath(new URL('../dist-electron/shared/', import.meta.url)), emptyOutDir: false, minify: false}});
