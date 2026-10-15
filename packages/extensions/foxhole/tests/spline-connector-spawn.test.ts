import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { createFoxholeStructureAssetSnapshot } from '../app/plugins/foxhole/nixie/structure-asset-snapshot.ts';
import { createFoxholeSplineConnectorSnapshot } from '../app/plugins/foxhole/nixie/spline-connector-snapshot.ts';
import { isFoxholeSplineConnectorStructure, normalizeFoxholeSplineConnectorState } from '../app/plugins/foxhole/nixie/spline-connector.ts';

const catalog = getFoxholeStructureCatalog('/foxhole/assets/');

test('every spawned spline asset starts at its minimum length through the shared asset factory', () => {
    const keys = Object.keys(catalog.structureByKey).filter(key => isFoxholeSplineConnectorStructure(catalog.structureByKey[key]));
    for (const key of ['trenchconnectort1', 'trenchconnectort2', 'trenchconnectort3', 'trenchconnectorbuildsite',
        'powerline', 'facilitypipe', 'sandbaghalfspline', 'sandbagfullspline']) assert.ok(keys.includes(key), key);
    for (const key of keys) {
        const snapshot = createFoxholeStructureAssetSnapshot({ asset: catalog.assetByKey[key],
            structure: catalog.structureByKey[key], label: key, x: 25, y: 40 });
        assert.equal(snapshot.type, 'foxholeSplineConnector', key);
        const state = normalizeFoxholeSplineConnectorState(snapshot.state);
        assert.equal(state.x, 25, key);
        assert.equal(state.y, 40, key);
        assert.ok(state.minLength > 0, key);
        assert.ok(Math.abs(Math.hypot(state.end.x - state.start.x, state.end.y - state.start.y) - state.minLength) < 1e-8, key);
    }
});

test('default end follows an explicitly supplied start and its tangent', () => {
    const snapshot = createFoxholeSplineConnectorSnapshot({ foxholeKey: 'trenchconnectort3',
        structure: catalog.structureByKey.trenchconnectort3, start: { x: 10, y: 20, rotation: Math.PI / 2 } });
    assert.ok(Math.abs(snapshot.state.end.x - 10) < 1e-8);
    assert.equal(snapshot.state.end.y, 20 + snapshot.state.minLength);
    assert.equal(snapshot.state.end.rotation, Math.PI / 2);
});

test('explicit imported endpoints remain intact, including intentionally collapsed geometry', () => {
    for (const end of [{ x: 0, y: 0, rotation: 0 }, { x: 220, y: -30, rotation: 0.7 }]) {
        const snapshot = createFoxholeSplineConnectorSnapshot({ foxholeKey: 'trenchconnectort3',
            structure: catalog.structureByKey.trenchconnectort3, end });
        assert.deepEqual(snapshot.state.end, end);
        assert.deepEqual(normalizeFoxholeSplineConnectorState(snapshot.state).end, end);
    }
});

test('surface pipe default end faces its start for a straight minimum-length span', () => {
    const snapshot = createFoxholeSplineConnectorSnapshot({ foxholeKey: 'facilitypipe', structure: catalog.structureByKey.facilitypipe });
    assert.equal(snapshot.state.end.rotation, Math.PI);
});
