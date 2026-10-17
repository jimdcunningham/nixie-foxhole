/** Inspect complete GLB assemblies without relying on their declared model anchor. */
export function modelArtifactBounds(document: any, readPart: (resourceId: string) => any) {
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
    const visitDocument = (gltf: any, parent: number[]) => {
        const parts = new Map<string, string>((gltf.asset?.extras?.nixieModelParts?.parts ?? [])
            .map((part: any) => [part.nodeName, part.resourceId]));
        const visit = (index: number, ancestor: number[]) => {
            const node = gltf.nodes[index], matrix = multiply(ancestor, transform(node));
            for (const primitive of gltf.meshes?.[node.mesh]?.primitives ?? []) {
                const accessor = gltf.accessors[primitive.attributes.POSITION];
                for (let corner = 0; corner < 8; corner++) {
                    const point = [0, 1, 2].map(axis => (corner & (1 << axis)) ? accessor.max[axis] : accessor.min[axis]);
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
    visitDocument(document, identity());
    return { min: minimum, max: maximum, dimensions: maximum.map((value, axis) => value - minimum[axis]!) };
}
