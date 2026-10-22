import assert from 'node:assert/strict';
import test from 'node:test';
import { FOXHOLE_WORLD_LAYER_DEFINITIONS, readFoxholeMapSettings } from '../app/plugins/foxhole/nixie/map-settings.ts';
import { FOXHOLE_WORLD_LAYER_GROUPS, activeWorldLayerGroups, worldLayerGroupPatch } from '../app/plugins/foxhole/nixie/map/world-layer-groups.ts';

test('ten panel groups cover every renderer preference exactly once', () => {
    assert.deepEqual(FOXHOLE_WORLD_LAYER_GROUPS.map(group => group.label), ['Terrain', 'Buildings', 'Props', 'Nature', 'Trees', 'Rocks', 'Transport', 'Water', 'Surface Detail', 'Effects']);
    const members = FOXHOLE_WORLD_LAYER_GROUPS.flatMap(group => [...group.layers]);
    assert.equal(new Set(members).size, members.length);
    assert.deepEqual([...members].sort(), FOXHOLE_WORLD_LAYER_DEFINITIONS.map(layer => layer.id).sort());
    for (const group of FOXHOLE_WORLD_LAYER_GROUPS) {
        const settings = readFoxholeMapSettings({}, id => worldLayerGroupPatch(group.id, false)[id]);
        for (const layer of FOXHOLE_WORLD_LAYER_DEFINITIONS) assert.equal(settings.worldLayers[layer.id], !group.layers.some(key => key === layer.id));
    }
});

test('partly visible saved groups stay active and unrelated toggles preserve their member preferences', () => {
    const saved = { 'foxhole.map.world.rocks': false, 'foxhole.map.world.vegetation': true, 'foxhole.map.world.shell': false };
    const read = (values: Record<string, boolean>) => readFoxholeMapSettings({}, id => values[id]).worldLayers;
    assert.ok(activeWorldLayerGroups(read(saved)).includes('nature'));
    assert.ok(activeWorldLayerGroups(read(saved)).includes('terrain'));
    const after = { ...saved, ...worldLayerGroupPatch('water', false) };
    assert.equal(read(after).rocks, false);assert.equal(read(after).vegetation, true);assert.equal(read(after).shell, false);assert.equal(read(after).water, false);
    const hidden = read({ ...after, ...worldLayerGroupPatch('nature', false) });
    assert.equal(hidden.rocks, false);assert.equal(hidden.vegetation, false);assert.ok(!activeWorldLayerGroups(hidden).includes('nature'));
    const shown = read({ ...after, ...worldLayerGroupPatch('nature', true) });
    assert.equal(shown.rocks, false);assert.equal(shown.vegetation, true);
    const treesHidden = read({ ...after, ...worldLayerGroupPatch('trees', false) });
    assert.equal(treesHidden.trees, false);assert.equal(treesHidden.vegetation, true);assert.equal(treesHidden.rocks, false);
    assert.deepEqual(worldLayerGroupPatch('rocks', true), { 'foxhole.map.world.rocks': true });
    assert.deepEqual(worldLayerGroupPatch('unknown', false), {});
});
