import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {parseNixieExperimentalProductCatalogV1} from '@nixiejs/extension-sdk/experimental/scene-v2';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const catalogPinPath = () => path.resolve(process.env.NIXIE_FOXHOLE_CATALOG_PIN_FILE?.trim() || fileURLToPath(new URL('../src/catalog-release-pin.json', import.meta.url)));
export const readCatalogPin = async () => JSON.parse(await fs.readFile(catalogPinPath(), 'utf8'));
export async function readCatalogReceipt(receipt, fetcher = fetch, maxBytes = 16 * 1024 ** 2) {
    const url = new URL(receipt.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.href !== receipt.url
        || !/^[a-f0-9]{64}$/.test(receipt.sha256) || !Number.isSafeInteger(receipt.byteLength) || receipt.byteLength < 1 || receipt.byteLength > maxBytes) throw Error('Invalid catalog input receipt');
    const response = await fetcher(url.href, {credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(60000)});
    if (!response.ok || !response.body) throw Error('Catalog input unavailable (' + response.status + ')');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > receipt.byteLength) throw Error('Catalog input exceeds receipt'); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks);
    verifyCatalogInput(bytes, receipt);
    return bytes;
}
export function verifyCatalogInput(bytes, receipt) {
    if (bytes.length !== receipt.byteLength || hash(bytes) !== receipt.sha256) throw Error('Catalog input integrity mismatch');
}
export async function prepareCatalogInput({pin, output, localFile, fetcher = fetch}) {
    const existing = await fs.readFile(output).catch(error => {if (error.code === 'ENOENT') return null; throw error;});
    const bytes = existing ?? (localFile ? await fs.readFile(localFile) : await readCatalogReceipt(pin.catalog, fetcher));
    verifyCatalogInput(bytes, pin.catalog);
    const catalog = parseNixieExperimentalProductCatalogV1(JSON.parse(bytes));
    const base = new URL(pin.baseUrl), location = new URL(pin.catalog.url);
    if (location.origin !== base.origin || !location.pathname.startsWith(base.pathname)) throw Error('Catalog input is outside its pinned origin/namespace');
    if (catalog.releaseRoot && new URL(catalog.releaseRoot + 'catalog.v1.json', base).href !== location.href) throw Error('Catalog input does not belong to its pinned release');
    if (!existing) {
        await fs.mkdir(path.dirname(output), {recursive: true});
        const temporary = output + '.' + randomUUID() + '.tmp';
        try {await fs.writeFile(temporary, bytes, {flag: 'wx'}); await fs.rename(temporary, output);}
        finally {await fs.rm(temporary, {force: true});}
    }
    return {catalog, bytes, reused: Boolean(existing)};
}
async function run() {
    const {values} = parseArgs({options: {output: {type: 'string'}, local: {type: 'string'}, 'identity-only': {type: 'boolean'}}});
    const extension = path.resolve(import.meta.dirname, '..');
    const pin = await readCatalogPin();
    if (values['identity-only']) {console.log(JSON.stringify({catalog: pin.catalog})); return;}
    const output = path.resolve(values.output ?? path.join(extension, '../../packages/extensions/foxhole/public/foxhole/assets/catalog.v1.json'));
    const result = await prepareCatalogInput({pin, output, localFile: values.local});
    console.log(JSON.stringify({output, catalogBytes: result.bytes.length, reused: result.reused}));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
