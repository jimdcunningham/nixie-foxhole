import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyNixieExtensionPackage } from '@nixiejs/extension-package';

export async function verifyRemotePublicationPackage(packageFile) {
    const verified = await verifyNixieExtensionPackage(packageFile);
    const pin = JSON.parse(await fs.readFile(new URL('../src/asset-release-pin.json', import.meta.url), 'utf8'));
    const packs = verified.manifest.contributes?.experimentalAssetPacks ?? [];
    if (!pin.resourcePack || JSON.stringify(packs.find(pack => pack.id === pin.resourcePack.id)) !== JSON.stringify(pin.resourcePack)) {
        throw new Error('Published Planner must retain its pinned R2 resource pack.');
    }
    if (verified.metadata.files.some(file => /\.(?:glb|webp|png|jpe?g|dds|ktx2?)$/i.test(file.path))) {
        throw new Error('Remote Planner package must not contain game model or image bytes.');
    }
    const resources = verified.manifest.contributes?.experimentalResources ?? [];
    const templates = verified.manifest.contributes?.experimentalResourceTemplates ?? [];
    if ([...resources, ...templates].some(resource => resource.assetPack !== pin.resourcePack.id)) {
        throw new Error('Planner resources must resolve through the pinned R2 pack.');
    }
    return { packageSha256: verified.packageHash, archiveBytes: verified.archiveBytes,
        files: verified.metadata.files.length, remoteResources: resources.length, remoteTemplates: templates.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.log(JSON.stringify(await verifyRemotePublicationPackage(path.resolve(process.argv[2] ?? 'artifacts/extension.nxext'))));
}
