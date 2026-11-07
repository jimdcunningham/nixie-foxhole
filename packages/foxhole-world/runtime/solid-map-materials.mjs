export const solidMapColors = Object.freeze({
    building: 0xd1bb9b,
    structures: 0xbf886c,
    rocks: 0x8490a1,
    trees: 0x41674f,
    vegetation: 0x799d68,
    infrastructure: 0x9c8874,
    road: 0xc9ab77,
    rail: 0x746578,
    water: 0x4d8799,
});

// Only map-owned model documents pass through here. Keep material names for
// geometry grouping, but remove image references before scheduling any decode.
export function stripMapTextures(document) {
    delete document.images;
    delete document.textures;
    delete document.samplers;
    for (const material of document.materials ?? []) {
        material.pbrMetallicRoughness = {
            baseColorFactor: [0.64, 0.50, 0.33, 1],
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
