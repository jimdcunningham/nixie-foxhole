import {catalogInputPath, readCatalogPin, verifyCatalogInput} from './prepare-catalog-input.mjs';
import {buildRuntimeCatalog} from './runtime-catalog.mjs';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNixieExtensionPackage} from '@nixiejs/extension-package';
export async function verifyRemotePublicationPackage(packageFile) {
    const verified = await verifyNixieExtensionPackage(packageFile);
    const pin = await readCatalogPin();
    const source = await fs.readFile(catalogInputPath());
    verifyCatalogInput(source, pin.catalog);
    const runtime = buildRuntimeCatalog(source);
    const catalogs = verified.manifest.contributes.productCatalogs ?? [];
    const declaration = catalogs.find(catalog => catalog.id === 'foxhole.catalog');
    if (catalogs.length !== 1 || !declaration || declaration.baseUrl !== pin.baseUrl || declaration.document.path !== 'dist/catalog.v1.json'
        || declaration.document.sha256 !== runtime.receipt.sha256 || declaration.document.byteLength !== runtime.receipt.byteLength) {
        throw Error('Planner must package the runtime catalog derived from the pinned input.');
    }
    const localeFiles = verified.metadata.files.filter(file => file.path.startsWith('dist/assets/catalog-locales/'));
    if (localeFiles.length !== runtime.localeModules.size || localeFiles.some(file => {
        const expected = runtime.localeModules.get(file.path.slice('dist/'.length));
        return !expected || file.bytes !== expected.length || file.sha256 !== createHash('sha256').update(expected).digest('hex');
    })) throw Error('Planner locale files differ from the pinned input.');
    if (verified.manifest.contributes.assetPacks?.length) throw Error('Planner must not declare a remote resource index.');
    if (verified.metadata.files.some(file => /\.(?:glb|webp|png|jpe?g|dds|ktx2?)$/i.test(file.path))) throw Error('Planner package must not contain game model or image bytes.');
    if (verified.metadata.files.filter(file => file.path.endsWith('/catalog.v1.json')).length !== 1) throw Error('Planner must contain exactly one catalog file.');
    const resources = verified.manifest.contributes.resources ?? [], templates = verified.manifest.contributes.resourceTemplates ?? [];
    const audio = resources.filter(resource => resource.kind === 'audio');
    const remote = resources.filter(resource => resource.kind !== 'audio');
    if ([...remote, ...templates].some(resource => resource.assetPack !== declaration.id)) throw Error('Planner models and images must resolve through its packaged catalog.');
    const declaredAudio = new Set(audio.map(resource => resource.path));
    const audioFiles = verified.metadata.files.filter(file => /\.(?:wav|flac)$/i.test(file.path));
    if (audioFiles.length !== declaredAudio.size || audioFiles.some(file =>
        !declaredAudio.has(file.path) || !/^dist\/audio\/[a-z0-9-]+\.(?:wav|flac)$/.test(file.path) || file.bytes > 2 * 1024 * 1024)) {
        throw Error('Planner audio files must be bounded and declared under dist/audio.');
    }
    return {packageSha256: verified.packageHash, archiveBytes: verified.archiveBytes, files: verified.metadata.files.length,
        catalogBytes: declaration.document.byteLength, remoteResources: remote.length, remoteTemplates: templates.length, localAudio: audioFiles.length};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await verifyRemotePublicationPackage(path.resolve(process.argv[2] ?? 'artifacts/extension.nxext'))));
