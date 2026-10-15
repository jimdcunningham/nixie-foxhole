import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';

export type FoxholeModelLayerMetadata = FoxholeSceneV2AssetMetadata & { modelLayerNodes?: Record<string, string[]>; foundationSurfaceZ?: number; };

/** Recover foundation borders and floor height by their authored planar bounds.
 * Only exact, untransformed matches are bound; borders never define the walking surface.
 */
export function bindFoxholeModelLayerNodes(asset: FoxholeModelLayerMetadata, bytes: Uint8Array): void {
    if (!asset.model || !/^Foundation/i.test(asset.codeName)) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const document = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))));
    const result: Record<string, string[]> = {};
    for (const node of document.nodes ?? []) {
        if (typeof node.name !== 'string' || node.mesh === undefined || node.matrix || node.translation || node.rotation || node.scale) continue;
        const bounds = (document.meshes[node.mesh]?.primitives ?? []).map((primitive: { attributes: { POSITION: number; }; }) => document.accessors[primitive.attributes.POSITION]);
        if (!bounds.length || bounds.some((accessor: { min?: number[]; max?: number[]; }) => !accessor.min || !accessor.max)) continue;
        const min = [0, 1, 2].map(axis => Math.min(...bounds.map((accessor: { min: number[]; }) => accessor.min[axis])));
        const max = [0, 1, 2].map(axis => Math.max(...bounds.map((accessor: { max: number[]; }) => accessor.max[axis])));
        const x = (min[0]! + max[0]!) * 16 + (asset.model.offsetX ?? 0);
        const y = (min[2]! + max[2]!) * 16 + (asset.model.offsetY ?? 0);
        const width = (max[0]! - min[0]!) * 32, height = (max[2]! - min[2]!) * 32;
        const matches = Object.entries(asset.renderLayers).filter(([, layer]) => Math.hypot(layer.offsetX - x, layer.offsetY - y) < 2
            && Math.abs(layer.width - width) < 3 && Math.abs(layer.height - height) < 3);
        if (matches.length !== 1) continue;
        const [id, layer] = matches[0]!;
        if (layer.componentTags?.length) (result[id] ??= []).push(node.name);
        else asset.foundationSurfaceZ = Math.round((max[1]! * 32 + (asset.model.offsetZ ?? 0)) * 1000) / 1000;
    }
    asset.modelLayerNodes = result;
}
