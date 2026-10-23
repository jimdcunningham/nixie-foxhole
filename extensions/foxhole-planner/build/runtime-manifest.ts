import type { NixieExperimentalAssetPackV1, NixieExtensionManifestV1 } from '@nixie/extension-sdk';

/** Build-specific declarations belong to the runtime output, never the authored input. */
export function createFoxholeRuntimeManifest(
    authored: NixieExtensionManifestV1,
    models: readonly { id: string; packagedPath: string; }[],
    resourcePack: NixieExperimentalAssetPackV1 | null,
): NixieExtensionManifestV1 {
    const manifest = structuredClone(authored);
    manifest.contributes.experimentalResources = [
        ...(manifest.contributes.experimentalResources ?? []).filter(resource => resource.kind !== 'model' || !resource.id.startsWith('foxhole.model.')),
        ...models.map(model => ({ contractVersion: 1 as const, id: `foxhole.model.${model.id}`, kind: 'model' as const,
            path: `dist/assets/scene-v2/${model.packagedPath}`, ...(resourcePack ? { assetPack: resourcePack.id } : {}) })),
    ];
    if (resourcePack) {
        manifest.capabilities = [...new Set([...manifest.capabilities, 'resources.remote' as const])];
        manifest.contributes.experimentalAssetPacks = [resourcePack];
        manifest.contributes.experimentalResourceTemplates = (manifest.contributes.experimentalResourceTemplates ?? [])
            .map(row => ({ ...row, assetPack: resourcePack.id }));
    } else {
        delete manifest.contributes.experimentalAssetPacks;
        manifest.contributes.experimentalResourceTemplates = (manifest.contributes.experimentalResourceTemplates ?? [])
            .map(({ assetPack, ...row }) => row);
    }
    return manifest;
}
