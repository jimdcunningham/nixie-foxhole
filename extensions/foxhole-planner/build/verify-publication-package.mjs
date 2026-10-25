import {readCatalogPin} from './prepare-catalog-input.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNixieExtensionPackage} from '@nixiejs/extension-package';
export async function verifyRemotePublicationPackage(packageFile) {
    const verified = await verifyNixieExtensionPackage(packageFile);
    const pin = await readCatalogPin();
    const catalogs = verified.manifest.contributes.experimentalProductCatalogs ?? [];
    const declaration = catalogs.find(catalog => catalog.id === 'foxhole.catalog');
    if (catalogs.length !== 1 || !declaration || declaration.baseUrl !== pin.baseUrl || declaration.document.path !== 'dist/catalog.v1.json'
        || declaration.document.sha256 !== pin.catalog.sha256 || declaration.document.byteLength !== pin.catalog.byteLength) {
        throw Error('Planner must retain its single pinned packaged catalog.');
    }
    if (verified.manifest.contributes.experimentalAssetPacks?.length) throw Error('Planner must not declare a remote resource index.');
    if (verified.metadata.files.some(file => /\.(?:glb|webp|png|jpe?g|dds|ktx2?)$/i.test(file.path))) throw Error('Planner package must not contain game model or image bytes.');
    if (verified.metadata.files.filter(file => file.path.endsWith('/catalog.v1.json')).length !== 1) throw Error('Planner must contain exactly one catalog file.');
    const resources = verified.manifest.contributes.experimentalResources ?? [], templates = verified.manifest.contributes.experimentalResourceTemplates ?? [];
    if ([...resources, ...templates].some(resource => resource.assetPack !== declaration.id)) throw Error('Planner resources must resolve through its packaged catalog.');
    return {packageSha256: verified.packageHash, archiveBytes: verified.archiveBytes, files: verified.metadata.files.length,
        catalogBytes: declaration.document.byteLength, remoteResources: resources.length, remoteTemplates: templates.length};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await verifyRemotePublicationPackage(path.resolve(process.argv[2] ?? 'artifacts/extension.nxext'))));
