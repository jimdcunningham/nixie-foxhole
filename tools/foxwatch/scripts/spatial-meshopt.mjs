import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

/** Losslessly compress geometry views, leaving embedded images untouched. */
export async function compressSpatialMeshopt(document, binary) {
    await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
    const images = new Set((document.images ?? []).map(image => image.bufferView));
    const indices = new Set(document.meshes.flatMap(mesh => mesh.primitives.map(primitive => primitive.indices)));
    const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
    const chunks = [];
    let length = 0, decodedLength = 0, saved = 0;
    for (const [index, view] of document.bufferViews.entries()) {
        let content = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
        const accessors = document.accessors.map((accessor, id) => ({ ...accessor, id })).filter(accessor => accessor.bufferView === index);
        const accessor = accessors[0];
        let stride, count, mode;
        if (!images.has(index) && accessor && accessors.every(value => !value.sparse)) {
            mode = indices.has(accessor.id) ? 'INDICES' : 'ATTRIBUTES';
            stride = view.byteStride ?? sizes[accessor.componentType] * components[accessor.type];
            count = view.byteLength / stride;
            if (Number.isInteger(count) && count > 0 && (mode === 'ATTRIBUTES' ? stride % 4 === 0 && stride <= 256 : [2, 4].includes(stride))) {
                const encoded = MeshoptEncoder.encodeGltfBuffer(content, count, stride, mode, 0);
                if (encoded.byteLength < content.byteLength) {
                    const checked = new Uint8Array(content.length);
                    MeshoptDecoder.decodeGltfBuffer(checked, count, stride, encoded, mode, 'NONE');
                    if (!Buffer.from(checked).equals(content)) throw new Error('Meshopt round-trip changed authored geometry');
                    saved += content.length - encoded.length;
                    content = Buffer.from(encoded);
                    view.extensions = { EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: content.length, byteStride: stride, count, mode, filter: 'NONE' } };
                    view.buffer = 1;
                    decodedLength += (4 - decodedLength % 4) % 4;
                    view.byteOffset = decodedLength;
                    decodedLength += view.byteLength;
                }
            }
        }
        const padding = Buffer.alloc((4 - length % 4) % 4);
        chunks.push(padding, content);
        length += padding.length;
        if (view.extensions?.EXT_meshopt_compression) view.extensions.EXT_meshopt_compression.byteOffset = length;
        else { view.buffer = 0; view.byteOffset = length; view.byteLength = content.length; }
        length += content.length;
    }
    chunks.push(Buffer.alloc((4 - length % 4) % 4));
    const packed = Buffer.concat(chunks);
    document.buffers = [{ byteLength: packed.length }];
    if (decodedLength) {
        document.buffers.push({ byteLength: decodedLength, extensions: { EXT_meshopt_compression: { fallback: true } } });
        for (const key of ['extensionsUsed', 'extensionsRequired']) document[key] = [...new Set([...(document[key] ?? []), 'EXT_meshopt_compression'])];
    }
    return { binary: packed, bytesSaved: saved, decodedGeometryBytes: decodedLength };
}
