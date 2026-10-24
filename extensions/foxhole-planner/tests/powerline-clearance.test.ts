import assert from 'node:assert/strict';
import test from 'node:test';
import type { NixieExperimentalComponentEntitySnapshotV1 as Entity } from '@nixiejs/extension-sdk/experimental/scene-v2';
import { findFoxholePowerlineObstructions } from '../src/powerline-clearance.ts';
import type { FoxholeSceneV2AssetMetadata } from '../src/scene-v2-asset-metadata.ts';
import type { FoxholeSceneV2SplineConnectorData } from '../src/scene-v2-spline-connectors.ts';

const transform = (x = 0, y = 0, rotation = 0) => ({ ownerId: 'nixie.core', componentId: 'transform', version: 1,
    definitionAvailable: true, data: { x, y, rotation, scaleX: 1, scaleY: 1 } });
const structure = (entityId: string, x: number, y: number, rotation = 0): Entity => ({ entityId, revision: 1, components: [
    { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true, data: { assetId: 'building' } },
    transform(x, y, rotation),
] });
const cable: Entity = { entityId: 'cable', revision: 1, components: [transform()] };
const data: FoxholeSceneV2SplineConnectorData = { foxholeKey: 'powerline', startX: 0, startY: 0, startRotation: 0,
    endX: 100, endY: 0, endRotation: 0, minLength: 3.2, maxLength: 800, minRadius: 16, maxRadius: 800,
    maxBuffer: 3.2, curveT: 0, blueprint: false };
const metadata: Record<string, FoxholeSceneV2AssetMetadata> = {
    building: { footprintPolygons: [{ shape: [-1, -1, 1, -1, 1, 1, -1, 1] }] } as FoxholeSceneV2AssetMetadata,
};

test('power-line clearance uses the authored footprint and ten-centimetre connector buffer', () => {
    const touching = structure('touching', 50, 35.1);
    const clear = structure('clear', 50, 35.3);
    const context = { contractVersion: 1 as const, entities: [cable, touching, clear] };
    assert.deepEqual(findFoxholePowerlineObstructions(cable, data, context, metadata), ['touching']);
});

test('power-line clearance exempts only its explicitly attached building hosts', () => {
    const host = structure('host', 50, 0, Math.PI / 4);
    const context = { contractVersion: 1 as const, entities: [cable, host] };
    assert.deepEqual(findFoxholePowerlineObstructions(cable, data, context, metadata), ['host']);
    assert.deepEqual(findFoxholePowerlineObstructions(cable, { ...data, startAttachmentNodeId: host.entityId }, context, metadata), []);
});
