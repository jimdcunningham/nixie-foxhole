import assert from 'node:assert/strict';
import test from 'node:test';
import { hasAuthoredDestroyedTrenchConnectorLayers } from './authored-destroyed-connector-layers.mjs';

test('only the three destroyed connector tiers opt into authored component publishing', () => {
    for (const tier of [1, 2, 3]) {
        assert.equal(hasAuthoredDestroyedTrenchConnectorLayers({ id: `trenchconnectordestroyedt${tier}`, isDestroyed: true,
            renderLayers: [{ id: 'floor', componentName: 'Floor' }, { id: 'destroyed', componentName: 'Destroyed' }] }), true);
    }
    for (const id of ['trenchconnectordestroyedt4', 'trenchconnectort1', 'fortcornerdestroyedt1', 'trencht1', 'trenchconnectorbuildsite']) {
        assert.equal(hasAuthoredDestroyedTrenchConnectorLayers({ id, renderLayers: [{ componentName: 'Floor' }] }), false, id);
    }
});

test('a wreck without authored component identities retains the static publication policy', () => {
    for (const renderLayers of [undefined, [], [{ id: 'floor' }], [{ componentName: ' ' }]]) {
        assert.equal(hasAuthoredDestroyedTrenchConnectorLayers({ id: 'trenchconnectordestroyedt1', renderLayers }), false);
    }
    assert.equal(hasAuthoredDestroyedTrenchConnectorLayers(null), false);
});
