import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { NixieExperimentalComponentEntitySnapshotV1 as Entity } from '@nixie/extension-sdk/experimental/scene-v2';
import assets from '../src/scene-v2-assets-node.ts';
import { bindFoxholeModelLayerNodes } from '../src/model-layer-nodes.ts';
import type { FoxholeModelLayerMetadata } from '../src/model-layer-nodes.ts';
import { finalizeFoxholeSurfacePlacement } from '../src/surface-placement.ts';

const floor = assets.foundation012x2t1 as FoxholeModelLayerMetadata;
bindFoxholeModelLayerNodes(floor, readFileSync(new URL('../../../packages/extensions/foxhole/public/foxhole/assets/models/foundation012x2t1.glb', import.meta.url)));
function entity(id: string, assetId: string, x = 0, elevation = 0, parentId?: string): Entity {
    return { entityId: id, revision: 0, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true, data: { assetId, catalogId: 'foxhole.structures' } },
        { ownerId: 'nixie.core', componentId: 'transform', version: 1, definitionAvailable: true, data: { x, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } },
        { ownerId: 'nixie.core', componentId: 'spatial-transform', version: 1, definitionAvailable: true, data: { elevation, rotationX: 0, rotationY: 0, scaleZ: 1 } },
        { ownerId: 'nixie.core', componentId: 'hierarchy', version: 1, definitionAvailable: true, data: { ...(parentId ? { parentId } : {}), order: 0 } },
    ] };
}
const building = entity('building', 'facilitypowerdiesel');
function run(entities: Entity[], x = 0, interaction: 'placement' | 'planar-translation' | 'transform' = 'planar-translation', id = 'building') {
    return finalizeFoxholeSurfacePlacement({ contractVersion: 1, entityId: id, interaction,
        transform: { x, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }, context: { contractVersion: 1, entities } }).transform;
}
test('ground height uses the packed floor rather than raised borders or buried base', () => {
    assert.ok(Math.abs(floor.foundationSurfaceZ! - 12.8) < 0.01);
    const foundation = entity('floor', 'foundation012x2t1');
    const before = structuredClone([building, foundation]);
    assert.equal(run([building, foundation], 0, 'placement').elevation, floor.foundationSurfaceZ);
    assert.equal(run([building, foundation]).elevation, floor.foundationSurfaceZ);
    assert.equal(run([building, foundation], 1000).elevation, 0);
    assert.deepEqual([building, foundation], before);
});
test('highest overlapping foundation surface includes elevation and scale', () => {
    const low = entity('low', 'foundation012x2t1', 0, 32);
    const high = entity('high', 'foundation012x2t1', 0, 80);
    high.components[2]!.data.scaleZ = 2;
    assert.equal(run([building, low, high]).elevation, 80 + floor.foundationSurfaceZ! * 2);
});
test('surface queries respect rotated, translated parents and convert back to local height', () => {
    const parent = entity('layer', '', 500, 100);
    parent.components[1]!.data.rotation = Math.PI / 2;
    const nested = entity('building', 'facilitypowerdiesel', 0, 0, 'layer');
    const foundation = entity('floor', 'foundation012x2t1', 500, 128);
    assert.ok(Math.abs(run([nested, parent, foundation]).elevation! - (28 + floor.foundationSurfaceZ!)) < 1e-8);
});
test('explicit height edits, foundations, vehicles and connectors never auto-ground', () => {
    const foundation = entity('floor', 'foundation012x2t1');
    assert.equal(run([building, foundation], 0, 'transform').elevation, undefined);
    assert.equal(run([foundation], 0, 'placement', 'floor').elevation, undefined);
    const pipe = entity('building', 'facilitypipe');
    assert.equal(run([pipe, foundation]).elevation, undefined);
});
