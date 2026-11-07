// Only map-owned model documents pass through here. Keep material names for
// geometry grouping, but remove image references before scheduling any decode.
export function stripMapTextures(document) {
    delete document.images;
    delete document.textures;
    delete document.samplers;
    for (const material of document.materials ?? []) {
        const color = material.pbrMetallicRoughness?.baseColorFactor;
        material.pbrMetallicRoughness = {
            baseColorFactor: color ? [...color.slice(0, 3), 1] : [0.58, 0.59, 0.55, 1],
            metallicFactor: 0,
            roughnessFactor: 1,
        };
        delete material.normalTexture;
        delete material.occlusionTexture;
        delete material.emissiveTexture;
        delete material.emissiveFactor;
        delete material.extensions;
        delete material.alphaCutoff;
        material.alphaMode = 'OPAQUE';
    }
}
