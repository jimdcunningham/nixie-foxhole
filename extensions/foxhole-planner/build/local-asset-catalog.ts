import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NixieExtensionManifestV1 } from '@nixiejs/extension-sdk';
import { parseNixieProductCatalogV1, resolveNixieProductCatalogResourcesV1, resolveNixieResourceV1 } from '@nixiejs/extension-sdk/scene-v2';
import { createCatalogRuntimeManifest } from './catalog-runtime-manifest.ts';

export async function readLocalAssetCatalog(directory: string, authored: NixieExtensionManifestV1, baseUrl: string,
    watch: (path: string) => void) {
    const selectionPath = join(directory, 'resources.json');
    const selection = await readFile(selectionPath, 'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
    });
    if (selection === null) return null;
    watch(selectionPath);
    const resourceIds: unknown = JSON.parse(selection);
    if (!Array.isArray(resourceIds) || !resourceIds.length || new Set(resourceIds).size !== resourceIds.length
        || resourceIds.some(id => typeof id !== 'string')) throw Error('Expected unique local Planner resource IDs');

    const catalogPath = join(directory, 'catalog.v1.json');
    watch(catalogPath);
    const bytes = await readFile(catalogPath);
    const sha256 = (content: Buffer) => createHash('sha256').update(content).digest('hex');
    const catalog = parseNixieProductCatalogV1(JSON.parse(bytes.toString('utf8')));
    const manifest = createCatalogRuntimeManifest(authored, catalog, { baseUrl,
        catalog: { sha256: sha256(bytes), byteLength: bytes.length } });
    const receipts = new Map(resolveNixieProductCatalogResourcesV1(catalog).assets.map(asset => [asset.path, asset]));
    const files = new Map<string, Buffer>();
    for (const id of resourceIds) {
        const declarations = manifest.contributes.resources;
        const resource = resolveNixieResourceV1(declarations, manifest.contributes.resourceTemplates ?? [], id);
        const receipt = resource && receipts.get(resource.path);
        const extension = receipt?.mediaType === 'model/gltf-binary' ? 'glb' : receipt?.mediaType === 'image/webp' ? 'webp' : null;
        if (!resource?.assetPack || !receipt || !extension) throw Error('Unknown local Planner model or texture: ' + id);
        const filename = `${receipt.sha256}.${extension}`;
        const output = `local-resources/${filename}`;
        if (!files.has(output)) {
            const path = join(directory, 'resources', filename);
            watch(path);
            const content = await readFile(path);
            if (content.length !== receipt.byteLength || sha256(content) !== receipt.sha256) throw Error('Local Planner resource integrity mismatch: ' + id);
            files.set(output, content);
        }
        const { assetPack, ...rest } = resource;
        const local = { ...rest, path: 'dist/' + output };
        const index = declarations.findIndex(declaration => declaration.id === id);
        if (index < 0) declarations.push(local);
        else declarations[index] = local;
    }
    return { bytes, manifest, files };
}
