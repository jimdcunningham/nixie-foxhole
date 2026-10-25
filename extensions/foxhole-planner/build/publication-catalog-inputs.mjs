import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {prepareCatalogInput, readCatalogReceipt, verifyCatalogInput} from './prepare-catalog-input.mjs';
import {resolveNixieExperimentalProductCatalogResourcesV1} from '@nixiejs/extension-sdk/experimental/scene-v2';
const INPUTS = ['manifest.v1.json','models/manifest.v1.json','maps/map-data.v1.json', ...['de','fr','pt','ru','zh'].map(locale => 'localizations/' + locale + '.json')];

/** Source/geometry fixtures are CI-only and never participate in client initialization. */
export async function preparePublicationCatalogInputs({pin, output, fetcher = fetch, localFile}) {
    const {catalog} = await prepareCatalogInput({pin, output: path.join(output, 'catalog.v1.json'), localFile, fetcher});
    const completion = JSON.parse(await readCatalogReceipt(pin.completion, fetcher));
    if (completion.schemaVersion !== 1 || completion.format !== 'foxwatch-product-catalog-release-v1' || completion.assetRelease !== catalog.assetRelease
        || !['url','sha256','byteLength'].every(key => completion.catalog?.[key] === pin.catalog[key])) throw Error('Catalog completion receipt differs from pin');
    let downloadedBytes = 0, reusedBytes = 0;
    for (const name of INPUTS) {
        const row = completion.buildInputs?.[name];
        if (!row || (catalog.releaseRoot ? row.path !== 'source/' + name : (!/^foxhole-planner\/[a-z0-9._/-]+$/.test(row.path) || row.path.split('/').some(part => !part || part === '.' || part === '..')))) throw Error('Missing catalog test input: ' + name);
        const destination = path.join(output, name);
        const receipt = {url: new URL((catalog.releaseRoot ?? '') + row.path, pin.baseUrl).href, sha256: row.sha256, byteLength: row.byteLength};
        const local = await fs.readFile(destination).catch(error => {if (error.code === 'ENOENT') return null; throw error;});
        if (local) {verifyCatalogInput(local, receipt); reusedBytes += local.length;}
        else {
            const bytes = await readCatalogReceipt(receipt, fetcher); JSON.parse(bytes);
            await fs.mkdir(path.dirname(destination), {recursive: true});
            const temporary = destination + '.' + randomUUID() + '.tmp';
            try {await fs.writeFile(temporary, bytes, {flag: 'wx'}); await fs.rename(temporary, destination);}
            finally {await fs.rm(temporary, {force: true});}
            downloadedBytes += bytes.length;
        }
    }
    const index = resolveNixieExperimentalProductCatalogResourcesV1(catalog), byPath = new Map(index.assets.map(row => [row.path,row]));
    const models = new Map();
    for (const product of catalog.products) for (const row of product.resources.model ?? []) {
        const variant = row.variant ?? catalog.resourceDefaults.model.variant;
        const id = variant === 'base' ? product.id : product.id + '.' + variant;
        const entry = byPath.get('models/' + product.id + '.' + variant + '.glb');
        models.set(id, entry);
    }
    for (const row of catalog.sharedResources.filter(row => row.id.startsWith('shared.') && row.mediaType === 'model/gltf-binary')) models.set(row.id, byPath.get(row.path));
    const modelManifest = JSON.parse(await fs.readFile(path.join(output,'models/manifest.v1.json')));
    const files = new Map();
    for (const [id, model] of Object.entries({...modelManifest.assets, ...modelManifest.resources, ...modelManifest.sharedParts})) {
        const entry = models.get(id);
        if (!entry) throw Error('Test model is absent from the generated catalog: ' + id);
        files.set(model.path, {entry, url: new URL((catalog.releaseRoot ?? '') + (entry.sourcePath ?? entry.path), pin.baseUrl).href});
    }
    return {metadata: {files: INPUTS.length, downloadedBytes, reusedBytes}, library: {files}};
}
