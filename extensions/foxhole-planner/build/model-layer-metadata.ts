import { createHash } from 'node:crypto';
import type { FoxholeModelLayerMetadata } from '../src/model-layer-nodes.ts';
export interface PublishedModelLayers {
    schemaVersion: 1;
    publicationSha256: string;
    extractorSha256: string;
    models: Record<string, { path: string; modelLayerNodes?: Record<string, string[]>; foundationSurfaceZ?: number; }>;
}
export function applyPublishedModelLayers(asset: FoxholeModelLayerMetadata, assetId: string, path: string, input: PublishedModelLayers,
    expected: { publicationSha256: string; extractorSource: string; }): void {
    if (input.schemaVersion !== 1 || input.publicationSha256 !== expected.publicationSha256
        || input.extractorSha256 !== createHash('sha256').update(expected.extractorSource.replaceAll('\r\n', '\n')).digest('hex')) {
        throw new Error('Published model-layer metadata is stale; publish the Planner overlay again.');
    }
    const row = input.models[assetId];
    if (!row || row.path !== path) throw new Error('Missing published model-layer metadata: ' + assetId);
    if (row.modelLayerNodes) asset.modelLayerNodes = structuredClone(row.modelLayerNodes);
    if (row.foundationSurfaceZ !== undefined) {
        if (!Number.isFinite(row.foundationSurfaceZ)) throw new Error('Invalid published foundation surface.');
        asset.foundationSurfaceZ = row.foundationSurfaceZ;
    }
}
