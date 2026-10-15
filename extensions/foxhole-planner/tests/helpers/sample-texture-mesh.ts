import assert from 'node:assert/strict';

/** Sample the actual textured triangles at a UV, including subdivided strips. */
export function sampleTextureMesh(
    mesh: { positions: ArrayLike<number>; uvs: ArrayLike<number>; indices: ArrayLike<number>; },
    u: number,
    v: number,
): { x: number; y: number; } {
    for (let index = 0; index < mesh.indices.length; index += 3) {
        const a = mesh.indices[index] * 2, b = mesh.indices[index + 1] * 2, c = mesh.indices[index + 2] * 2;
        const bx = mesh.uvs[b] - mesh.uvs[a], by = mesh.uvs[b + 1] - mesh.uvs[a + 1];
        const cx = mesh.uvs[c] - mesh.uvs[a], cy = mesh.uvs[c + 1] - mesh.uvs[a + 1];
        const determinant = bx * cy - by * cx;
        if (Math.abs(determinant) < 1e-10) {
            continue;
        }
        const px = u - mesh.uvs[a], py = v - mesh.uvs[a + 1];
        const wb = (px * cy - py * cx) / determinant, wc = (bx * py - by * px) / determinant;
        const wa = 1 - wb - wc;
        if (wa >= -1e-6 && wb >= -1e-6 && wc >= -1e-6) {
            return { x: mesh.positions[a] * wa + mesh.positions[b] * wb + mesh.positions[c] * wc,
                y: mesh.positions[a + 1] * wa + mesh.positions[b + 1] * wb + mesh.positions[c + 1] * wc };
        }
    }
    assert.fail(`Texture mesh has no triangle at ${u},${v}`);
}
