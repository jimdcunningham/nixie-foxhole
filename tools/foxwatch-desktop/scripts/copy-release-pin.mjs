import { mkdir, readFile, writeFile } from 'node:fs/promises';
const pin = JSON.parse(
  await readFile(
    new URL(
      '../../../extensions/foxhole-planner/src/asset-release-pin.json',
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
  JSON.stringify({ publication: pin.publication }),
);
