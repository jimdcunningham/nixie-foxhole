/** Generated GLBs live beside the textures and icons of their owning catalog asset. */
export function spatialModelPath(asset, id = asset.id) {
    if (!/^[a-z0-9-]+$/.test(asset.id) || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(id)
        || (id !== asset.id && !id.startsWith(asset.id + '.'))) throw Error('Invalid spatial model identity');
    const type = asset.isItem ? 'items' : asset.isVehicle ? 'vehicles' : 'structures';
    return 'types/' + type + '/' + asset.id + '/' + id + '.glb';
}
