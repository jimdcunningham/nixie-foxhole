import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;

export function readModelArtifact(bytes: Uint8Array) {
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true);
    return { document: JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))), binary: bytes.subarray(28 + length) };
}

/** Measure decoded vertices: transforming local AABB corners overestimates rotated walls. */
export function modelArtifactBounds(artifact: ReturnType<typeof readModelArtifact>, readPart: (resourceId: string) => ReturnType<typeof readModelArtifact>) {
    const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
    const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const multiply = (a: number[], b: number[]) => Array.from({ length: 16 }, (_, index) => {
        const column = Math.floor(index / 4), row = index % 4;
        return [0, 1, 2, 3].reduce((value, k) => value + a[k * 4 + row]! * b[column * 4 + k]!, 0);
    });
    const transform = (node: any) => {
        if (node.matrix) return node.matrix;
        const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
        const [sx, sy, sz] = node.scale ?? [1, 1, 1];
        const [tx, ty, tz] = node.translation ?? [0, 0, 0];
        return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
            2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
            2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
            tx, ty, tz, 1];
    };
    const visitDocument = (artifact: ReturnType<typeof readModelArtifact>, parent: number[]) => {
        const gltf = artifact.document, decoded = new Map<number, Uint8Array>();
        const positions = (accessorIndex: number) => {
            const accessor = gltf.accessors[accessorIndex], view = gltf.bufferViews[accessor.bufferView];
            let data = decoded.get(accessor.bufferView);
            if (!data) {
                const compressed = view.extensions?.EXT_meshopt_compression;
                if (compressed) {
                    data = new Uint8Array(view.byteLength);
                    MeshoptDecoder.decodeGltfBuffer(data, compressed.count, compressed.byteStride,
                        artifact.binary.subarray(compressed.byteOffset ?? 0, (compressed.byteOffset ?? 0) + compressed.byteLength), compressed.mode, compressed.filter);
                } else data = artifact.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
                decoded.set(accessor.bufferView, data);
            }
            const components: Record<number, { size: number; divisor: number; read: (offset: number) => number; }> = {};
            const bytes = new DataView(data.buffer, data.byteOffset, data.byteLength);
            components[5120] = { size: 1, divisor: 127, read: offset => bytes.getInt8(offset) };
            components[5121] = { size: 1, divisor: 255, read: offset => bytes.getUint8(offset) };
            components[5122] = { size: 2, divisor: 32767, read: offset => bytes.getInt16(offset, true) };
            components[5123] = { size: 2, divisor: 65535, read: offset => bytes.getUint16(offset, true) };
            components[5126] = { size: 4, divisor: 1, read: offset => bytes.getFloat32(offset, true) };
            const component = components[accessor.componentType]!;
            const stride = view.byteStride ?? component.size * 3;
            return Array.from({ length: accessor.count }, (_, i) => [0, 1, 2].map(axis => {
                const value = component.read((accessor.byteOffset ?? 0) + stride * i + axis * component.size);
                return accessor.normalized ? Math.max(-1, value / component.divisor) : value;
            }));
        };
        const parts = new Map<string, string>((gltf.asset?.extras?.nixieModelParts?.parts ?? [])
            .map((part: any) => [part.nodeName, part.resourceId]));
        const visit = (index: number, ancestor: number[]) => {
            const node = gltf.nodes[index], matrix = multiply(ancestor, transform(node));
            for (const primitive of gltf.meshes?.[node.mesh]?.primitives ?? []) {
                for (const point of positions(primitive.attributes.POSITION)) {
                    for (let axis = 0; axis < 3; axis++) {
                        const value = matrix[12 + axis]! + point.reduce((sum, coordinate, i) => sum + matrix[i * 4 + axis]! * coordinate, 0);
                        minimum[axis] = Math.min(minimum[axis]!, value);
                        maximum[axis] = Math.max(maximum[axis]!, value);
                    }
                }
            }
            const part = parts.get(node.name);
            if (part) visitDocument(readPart(part), matrix);
            for (const child of node.children ?? []) visit(child, matrix);
        };
        for (const root of gltf.scenes[gltf.scene ?? 0].nodes) visit(root, parent);
    };
    visitDocument(artifact, identity());
    return { min: minimum, max: maximum, dimensions: maximum.map((value, axis) => value - minimum[axis]!) };
}
