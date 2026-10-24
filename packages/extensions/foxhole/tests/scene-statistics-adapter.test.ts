import assert from 'node:assert/strict';
import test from 'node:test';
import { projectFoxholeSceneStatistics } from '../app/plugins/foxhole/nixie/scene-statistics-adapter.ts';
import type { NixieExperimentalComponentEntitySnapshotV1 as Entity } from '@nixiejs/extension-sdk/experimental/scene-v2';

function entity(id: string, parentId: string | null, asset = false): Entity {
    return { entityId: id, revision: 1, components: [
        { ownerId: 'nixie.core', componentId: 'hierarchy', version: 1, definitionAvailable: true, data: { parentId, order: 0 } },
        ...(asset ? [{ ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: 'facilitytransferresource' } }] : []),
    ] };
}

test('Statistics projects ECS selection and layer descendants without building a Native board', () => {
    const entities = [entity('layer', null), entity('group', 'layer'), entity('a', 'group', true),
        entity('b', 'layer', true), entity('elsewhere', null, true)];
    const before = structuredClone(entities);
    const result = projectFoxholeSceneStatistics(entities, ['group', 'a'], 'layer');
    assert.deepEqual(result.scene.map(node => node.id), ['a', 'b', 'elsewhere']);
    assert.deepEqual(result.selection.map(node => node.id), ['a']);
    assert.deepEqual(result.layer.map(node => node.id), ['a', 'b']);
    assert.equal(result.selection[0]!.state.foxholeKey, 'facilitytransferresource');
    assert.equal(result.selection[0]!.type, 'foxholeAsset');
    assert.deepEqual(entities, before);
});

test('Statistics excludes unresolved components and safely terminates malformed hierarchy cycles', () => {
    const unresolved = entity('unresolved', null, true);
    unresolved.components[1]!.definitionAvailable = false;
    const entities = [unresolved, entity('a', 'b', true), entity('b', 'a', true)];
    const result = projectFoxholeSceneStatistics(entities, ['unrelated'], null);
    assert.deepEqual(result.scene.map(node => node.id), ['a', 'b']);
    assert.deepEqual(result.selection, []);
    assert.deepEqual(result.layer, []);
});
