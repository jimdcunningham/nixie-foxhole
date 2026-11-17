import native from '../authoring/native-howitzer-surfaces.json' with { type: 'json' };

/** Restore the authored NonMasked metal/roughness input on legacy map models. */
export function restoreNativeHowitzerSurfaces(doc, baseUrl) {
    const resources = [];
    for (const material of doc.materials ?? []) {
        const surface = material.pbrMetallicRoughness;
        if (!surface || surface.metallicRoughnessTexture) continue;

        const rule = native.materials.find(row => row.material === material.extras?.foxholeMaterialSource
            && row.albedo === material.extras?.foxholeAlbedoSource);
        if (!rule) continue;

        const binding = surface.baseColorTexture;
        const texture = doc.textures?.[binding?.index];
        if (!texture || !doc.images?.[texture.source]) continue;

        const uri = new URL(rule.resource.path, baseUrl).href;
        const source = doc.images.push({ uri }) - 1;
        const index = doc.textures.push({ ...texture, source }) - 1;
        surface.metallicRoughnessTexture = { ...binding, index };
        surface.metallicFactor = 1;
        surface.roughnessFactor = 1;
        material.extras.foxholePackedSurfaceSource = rule.packed;
        resources.push(rule.resource);
    }
    return resources;
}
