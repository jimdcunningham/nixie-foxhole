import { expandNixieExperimentalCatalogPathV1, parseNixieExperimentalProductCatalogDeclarationV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import type { NixieExperimentalProductCatalogV1, NixieExtensionManifestV1 } from '@nixiejs/extension-sdk';

/** Metadata is generated already. The build only binds stable IDs to its declared paths. */
export function createCatalogRuntimeManifest(authored: NixieExtensionManifestV1, catalog: NixieExperimentalProductCatalogV1,
    pin: {baseUrl: string; catalog: {sha256: string; byteLength: number}}): NixieExtensionManifestV1 {
    const manifest = structuredClone(authored);
    const declaration = parseNixieExperimentalProductCatalogDeclarationV1({contractVersion: 1, id: 'foxhole.catalog', baseUrl: pin.baseUrl,
        document: {path: 'dist/catalog.v1.json', sha256: pin.catalog.sha256, byteLength: pin.catalog.byteLength}});
    manifest.capabilities = [...new Set([...manifest.capabilities, 'resources.remote' as const])];
    delete manifest.contributes.experimentalAssetPacks;
    manifest.contributes.experimentalProductCatalogs = [declaration];
    manifest.contributes.experimentalResources = catalog.products.flatMap(product => (product.resources.model ?? []).map(resource => {
        const defaults = catalog.resourceDefaults.model!;
        const variant = resource.variant ?? defaults.variant;
        const id = variant === 'base' ? product.id : product.id + '.' + variant;
        return {contractVersion: 1 as const, id: 'foxhole.model.' + id, kind: 'model' as const, assetPack: declaration.id,
            path: expandNixieExperimentalCatalogPathV1(defaults.resourcePathTemplate ?? defaults.pathTemplate,
                {id: product.id, assetGroup: product.assetGroup, variant, sha256: resource.sha256})};
    })).concat(catalog.sharedResources.filter(resource => resource.id.startsWith('shared.') && resource.mediaType === 'model/gltf-binary')
        .map(resource => ({contractVersion: 1 as const, id: 'foxhole.model.' + resource.id, kind: 'model' as const, assetPack: declaration.id, path: resource.path})));
    const paths: Record<string, string> = {
        'foxhole.browser.': 'shared/icons/browser-{id}.webp', 'foxhole.map.': 'maps/{id}.webp',
        'foxhole.asset.': 'textures/{id}.webp', 'foxhole.icon.': 'icons/{id}.webp',
        'foxhole.mod.': 'shared/modifications/{id}.webp', 'foxhole.visual.': 'shared/visuals/{id}.webp',
    };
    manifest.contributes.experimentalResourceTemplates = (manifest.contributes.experimentalResourceTemplates ?? []).map(template => {
        if (!paths[template.idPrefix]) throw new Error('Unexpected Planner resource template: ' + template.idPrefix);
        return {...template, pathTemplate: paths[template.idPrefix]!, assetPack: declaration.id};
    });
    return manifest;
}
