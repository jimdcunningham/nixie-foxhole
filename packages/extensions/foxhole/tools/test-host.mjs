import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const studio = resolve(process.env.NIXIE_HOST_ROOT || process.env.NIXIE_STUDIO_ROOT || (basename(root) === 'nixie-foxhole' ? resolve(root, '../nixie') : root));
const extension = resolve(root, 'packages/extensions/foxhole');
process.env.NIXIE_HOST_ROOT = studio;
// SDK host pressure tests consume the same immutable catalog as the release.
// Cache only this small verified input; original sprite/model fixtures remain separate.
const { prepareCatalogInput, readCatalogPin } = await import(pathToFileURL(resolve(root, 'extensions/foxhole-planner/build/prepare-catalog-input.mjs')).href);
const pin = await readCatalogPin();
const catalogFile = process.env.NIXIE_FOXHOLE_CATALOG_FILE || resolve(studio, '.tmp/foxhole-host-inputs', pin.catalog.sha256, 'catalog.v1.json');
await prepareCatalogInput({ pin, output: catalogFile });
process.env.NIXIE_FOXHOLE_CATALOG_FILE = catalogFile;
const result = spawnSync(process.execPath, ['--experimental-transform-types', '--import', pathToFileURL(resolve(extension, 'tests/host-hooks.mjs')).href, '--import', pathToFileURL(resolve(studio, 'packages/nixie/tests/nixie/node-test-hooks.mjs')).href, '--test', '--test-concurrency=2', ...process.argv.slice(2).length ? process.argv.slice(2) : [resolve(extension, 'tests/host/*.test.ts')]], { cwd: extension, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
