import {MeshoptDecoder} from 'meshoptimizer/decoder';
import {buildFoxholeModelTextureTransforms} from '../src/model-texture-presentation.ts';
import type {FoxholeFlagAtlasCatalog, FoxholeFlagAtlasMetadata} from '../src/model-texture-presentation.ts';
import type {FoxholeSceneV2ModelSource} from '../src/scene-v2-models.ts';

/** Extract the named two-row FlagWind atlas before packaging, never in the host or runtime. */
export async function createFoxholeFlagAtlasCatalog(models: readonly FoxholeSceneV2ModelSource[], read: (path: string) => Promise<Uint8Array>): Promise<FoxholeFlagAtlasCatalog> {
    await MeshoptDecoder.ready;
    const own = new Map<string, FoxholeFlagAtlasMetadata[]>(), byId = new Map(models.map(model => [model.id, model]));
    for (const model of models) own.set(model.id, readFlagAtlases(await read(model.path), model.path));
    const collect = (id: string, visiting = new Set<string>()): FoxholeFlagAtlasMetadata[] => {
        if (visiting.has(id) || !byId.has(id)) throw Error('Invalid flag atlas dependency: ' + id);
        const next = new Set(visiting).add(id), materials = new Map<string, FoxholeFlagAtlasMetadata>();
        for (const row of [...own.get(id)!, ...(byId.get(id)!.dependencyIds ?? []).flatMap(dependency => collect(dependency, next))]) {
            const previous = materials.get(row.materialName);
            if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw Error('Conflicting named flag atlas: ' + row.materialName);
            materials.set(row.materialName, row);
        }
        return [...materials.values()];
    };
    const catalog: FoxholeFlagAtlasCatalog = {};
    for (const model of models) {
        const id = 'foxhole.model.' + model.id, rows = collect(model.id);
        if (rows.length) {
            catalog[id] = rows;
            buildFoxholeModelTextureTransforms(id, catalog, 'colonial');
            buildFoxholeModelTextureTransforms(id, catalog, 'warden');
        }
    }
    return catalog;
}

function readFlagAtlases(bytes: Uint8Array, path: string): FoxholeFlagAtlasMetadata[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fail = (): never => { throw Error('Invalid flag atlas GLB: ' + path); };
    if (bytes.length < 20 || bytes.length > 32 * 1024 * 1024 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2
        || view.getUint32(8, true) !== bytes.length || view.getUint32(16, true) !== 0x4e4f534a || view.getUint32(12, true) > bytes.length - 20) fail();
    const jsonLength = view.getUint32(12, true), document = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
    const materials = new Map<number, {name: string; rows: Set<number>; unsupported: boolean}>();
    for (const [index, material] of (document.materials ?? []).entries()) {
        if (/^flagwind/i.test(material.name ?? '')) materials.set(index, {name: material.name, rows: new Set(), unsupported: false});
    }
    if (!materials.size) return [];
    const binaryStart = 28 + jsonLength;
    if (binaryStart > bytes.length || view.getUint32(24 + jsonLength, true) !== 0x004e4942
        || view.getUint32(20 + jsonLength, true) !== bytes.length - binaryStart) fail();
    const binary = bytes.subarray(binaryStart);
    for (const mesh of document.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
        const material = materials.get(primitive.material);
        if (!material) continue;
        const accessor = document.accessors?.[primitive.attributes?.TEXCOORD_0], bufferView = document.bufferViews?.[accessor?.bufferView];
        const size = accessor?.componentType === 5126 ? 4 : accessor?.componentType === 5123 ? 2 : accessor?.componentType === 5121 ? 1 : 0;
        if (!accessor || !bufferView || accessor.type !== 'VEC2' || accessor.sparse || !size || (size !== 4 && accessor.normalized !== true)
            || !Number.isInteger(accessor.count) || accessor.count <= 0 || accessor.count > 4_000_000) fail();
        const compression = bufferView.extensions?.EXT_meshopt_compression ?? bufferView.extensions?.KHR_meshopt_compression;
        let data: Uint8Array, stride = bufferView.byteStride ?? size * 2;
        if (compression) {
            if (compression.buffer !== 0 || !Number.isInteger(compression.count) || compression.count <= 0
                || !Number.isInteger(compression.byteStride) || compression.byteStride < size * 2 || compression.count * compression.byteStride > 32 * 1024 * 1024
                || compression.mode !== 'ATTRIBUTES') fail();
            data = new Uint8Array(compression.count * compression.byteStride);
            const offset = compression.byteOffset ?? 0;
            if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(compression.byteLength) || compression.byteLength <= 0 || offset + compression.byteLength > binary.length) fail();
            MeshoptDecoder.decodeGltfBuffer(data, compression.count, compression.byteStride, binary.subarray(offset, offset + compression.byteLength), compression.mode, compression.filter ?? 'NONE');
            stride = compression.byteStride;
        } else {
            const offset = bufferView.byteOffset ?? 0;
            if (bufferView.buffer !== 0 || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(bufferView.byteLength)
                || bufferView.byteLength < 0 || offset + bufferView.byteLength > binary.length) fail();
            data = binary.subarray(offset, offset + bufferView.byteLength);
        }
        const offset = accessor.byteOffset ?? 0;
        if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(stride) || stride < size * 2
            || offset + (accessor.count - 1) * stride + size * 2 > data.length) fail();
        const uv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        let low = Infinity, high = -Infinity;
        for (let index = 0; index < accessor.count; index++) {
            const at = offset + index * stride + size;
            const value = size === 4 ? uv.getFloat32(at, true) : size === 2 ? uv.getUint16(at, true) / 65535 : uv.getUint8(at) / 255;
            if (!Number.isFinite(value)) fail();
            low = Math.min(low, value); high = Math.max(high, value);
        }
        const row = low < 0.5 ? 0 : 1;
        // Preserve the retained behavior for other FlagWind layouts; never guess their atlas.
        if (Math.abs(low - row * 0.5) > 0.02 || Math.abs(high - (row + 1) * 0.5) > 0.02) { material.unsupported = true; continue; }
        material.rows.add(row);
    }
    const rows: FoxholeFlagAtlasMetadata[] = [];
    for (const material of materials.values()) {
        if (!material.rows.size || material.unsupported) continue;
        if (material.rows.size !== 1) throw Error('Conflicting named flag atlas rows: ' + material.name);
        const authoredRow = [...material.rows][0] as 0 | 1;
        rows.push({materialName: material.name, authoredRow});
    }
    return rows;
}
