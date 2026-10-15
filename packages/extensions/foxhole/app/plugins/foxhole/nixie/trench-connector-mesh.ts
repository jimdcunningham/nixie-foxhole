import { Mesh, MeshGeometry, Texture } from 'pixi.js';
import { buildTrenchBuildSiteMesh } from './trench-connector.ts';
import type { TrenchEndpoint } from './trench-connector.ts';

/** Keep GPU buffers and the texture lease stable throughout an endpoint drag. */
export function updateTrenchBuildSiteMesh(mesh: Mesh | null, start: TrenchEndpoint, end: TrenchEndpoint): Mesh {
    const data = buildTrenchBuildSiteMesh(start, end);
    if (mesh) {
        const geometry = mesh.geometry as MeshGeometry;
        geometry.positions.set(data.positions);
        geometry.getBuffer('aPosition').update();
        geometry.indices.set(data.indices);
        geometry.indexBuffer.update();
        return mesh;
    }
    const result = new Mesh({
        geometry: new MeshGeometry({
            positions: new Float32Array(data.positions),
            uvs: new Float32Array(data.uvs),
            indices: new Uint32Array(data.indices),
        }),
        texture: Texture.EMPTY,
    });
    result.eventMode = 'none';
    return result;
}
