/** Prune UV channels unused by static glTF materials; retained vertex bytes stay unchanged. */
export function pruneUnusedStaticGltfUvs(document) {
    if (document.skins?.length || document.animations?.length) {
        throw new Error('Spatial geometry pruning requires a baked static model.');
    }
    let removedUvAttributes = 0;
    const usedAccessors = new Set();
    for (const mesh of document.meshes ?? []) {
        for (const primitive of mesh.primitives) {
            const usedUvs = new Set([0]);
            function visit(value, key = '') {
                if (!value || typeof value !== 'object') { return; }
                if (key.endsWith('Texture') && typeof value.index === 'number') {
                    usedUvs.add(value.extensions?.KHR_texture_transform?.texCoord ?? value.texCoord ?? 0);
                }
                for (const [childKey, child] of Object.entries(value)) { visit(child, childKey); }
            }
            visit(document.materials?.[primitive.material]);
            for (const name of Object.keys(primitive.attributes)) {
                const match = /^TEXCOORD_(\d+)$/.exec(name);
                if (match && !usedUvs.has(Number(match[1]))) {
                    delete primitive.attributes[name];
                    removedUvAttributes++;
                }
            }
            Object.values(primitive.attributes).forEach(index => usedAccessors.add(index));
            if (primitive.indices !== undefined) { usedAccessors.add(primitive.indices); }
            for (const target of primitive.targets ?? []) { Object.values(target).forEach(index => usedAccessors.add(index)); }
        }
    }
    const oldAccessors = document.accessors;
    const accessorMap = new Map([...usedAccessors].sort((a, b) => a - b).map((oldIndex, index) => [oldIndex, index]));
    document.accessors = [...accessorMap.keys()].map(index => oldAccessors[index]);
    for (const mesh of document.meshes ?? []) {
        for (const primitive of mesh.primitives) {
            for (const [name, index] of Object.entries(primitive.attributes)) { primitive.attributes[name] = accessorMap.get(index); }
            if (primitive.indices !== undefined) { primitive.indices = accessorMap.get(primitive.indices); }
            for (const target of primitive.targets ?? []) {
                for (const [name, index] of Object.entries(target)) { target[name] = accessorMap.get(index); }
            }
        }
    }
    const usedViews = new Set((document.images ?? []).map(image => image.bufferView).filter(index => index !== undefined));
    for (const accessor of document.accessors) {
        if (accessor.bufferView !== undefined) { usedViews.add(accessor.bufferView); }
        if (accessor.sparse) { usedViews.add(accessor.sparse.indices.bufferView); usedViews.add(accessor.sparse.values.bufferView); }
    }
    const oldViews = document.bufferViews;
    const viewMap = new Map([...usedViews].sort((a, b) => a - b).map((oldIndex, index) => [oldIndex, index]));
    document.bufferViews = [...viewMap.keys()].map(index => oldViews[index]);
    for (const image of document.images ?? []) { if (image.bufferView !== undefined) { image.bufferView = viewMap.get(image.bufferView); } }
    for (const accessor of document.accessors) {
        if (accessor.bufferView !== undefined) { accessor.bufferView = viewMap.get(accessor.bufferView); }
        if (accessor.sparse) {
            accessor.sparse.indices.bufferView = viewMap.get(accessor.sparse.indices.bufferView);
            accessor.sparse.values.bufferView = viewMap.get(accessor.sparse.values.bufferView);
        }
    }
    return { removedUvAttributes };
}
