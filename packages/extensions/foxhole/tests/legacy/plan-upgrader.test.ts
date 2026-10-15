import assert from 'node:assert/strict';
import test from 'node:test';
import { LegacyPlanSaveUpgrader } from '../../app/plugins/foxhole/legacy/plan-upgrader.ts';
import type { LegacyPlanSave } from '../../app/plugins/foxhole/legacy/plan-types.ts';

test('upgrades missing version fort corner socket remap to 1.0.5', () => {
    const upgrader = new LegacyPlanSaveUpgrader();
    const input: LegacyPlanSave = {
        entities: [
            {
                id: 1,
                type: 'building',
                subtype: 'fortcornert1',
                x: 105.6,
                y: 0,
                rotation: 0,
                connections: {
                    1: { 2: 3 },
                },
            },
            {
                id: 2,
                type: 'building',
                subtype: 'fortt1',
                x: 0,
                y: 0,
                rotation: 0,
                connections: {
                    3: { 1: 1 },
                },
            },
        ],
    };

    const result = upgrader.upgrade(input);
    assert.equal(result.toVersion, '1.0.5');
    assert.equal(result.fromVersion, null);
    assert.equal(input.version, undefined, 'input must not be mutated');

    const corner = result.save.entities?.[0];
    assert.ok(corner);
    assert.equal(corner.key, 'fortcornert1');
    assert.equal(corner.type, undefined);
    assert.ok(corner.connections?.['6']);
    assert.equal(corner.connections?.['1'], undefined);
    // 1.0.0 → 1.0.1 scales positions by /1.056
    assert.ok(Math.abs((corner.x ?? 0) - 100) < 0.001);
});

test('converts radians to degrees and railPoints to bezier for isBezier buildings', () => {
    const upgrader = new LegacyPlanSaveUpgrader({
        buildingFlags: {
            pipeline: { isBezier: true, hasHandle: true },
        },
    });
    const input: LegacyPlanSave = {
        version: '1.0.2',
        entities: [
            {
                id: 10,
                type: 'building',
                subtype: 'pipeline',
                x: 0,
                y: 0,
                rotation: Math.PI / 2,
                railPoints: [
                    { x: 0, y: 0, rotation: 0 },
                    { x: 64, y: 0, rotation: Math.PI },
                ],
            },
        ],
    };

    const result = upgrader.upgrade(input);
    const entity = result.save.entities?.[0];
    assert.equal(result.toVersion, '1.0.5');
    assert.ok(entity);
    assert.equal(entity.key, 'pipeline');
    assert.ok(Math.abs((entity.rotation ?? 0) - 90) < 0.001);
    assert.equal(entity.railPoints, undefined);
    assert.equal(entity.bezier?.length, 2);
    assert.equal(entity.bezier?.[0]?.rotation, 180);
    assert.ok(Math.abs((entity.bezier?.[1]?.rotation ?? 0) - 180) < 0.001);
});

test('renames townbase3 to townbase1 at 1.0.4 → 1.0.5', () => {
    const upgrader = new LegacyPlanSaveUpgrader();
    const result = upgrader.upgrade({
        version: '1.0.4',
        entities: [{ id: 1, key: 'townbase3', x: 0, y: 0, rotation: 0 }],
    });
    assert.equal(result.save.entities?.[0]?.key, 'townbase1');
    assert.equal(result.toVersion, '1.0.5');
});

test('maps regionKey to regionKeys and offsets entities for 1.0.3 → 1.0.4', () => {
    const upgrader = new LegacyPlanSaveUpgrader({
        maps: {
            AcrithiaHex: { key: 'AcrithiaHex', gridCoord: { x: 1, y: 2 } },
        },
    });
    const result = upgrader.upgrade({
        version: '1.0.3',
        projectSettings: {
            regionKey: 'acrithiahex',
            regionCrop: { x: 10, y: 20 },
        },
        entities: [{ id: 1, key: 'fortt1', x: 0, y: 0, rotation: 0 }],
    });

    assert.deepEqual(result.save.projectSettings?.regionKeys, ['AcrithiaHex']);
    assert.equal(result.save.projectSettings?.regionKey, undefined);
    assert.notEqual(result.save.entities?.[0]?.x, 0);
    assert.notEqual(result.save.entities?.[0]?.y, 0);
    assert.ok((result.save.projectSettings?.regionCrop?.x ?? 0) > 10);
});

test('shape subtype becomes type and handlePoint becomes dimensions', () => {
    const upgrader = new LegacyPlanSaveUpgrader();
    const result = upgrader.upgrade({
        version: '1.0.2',
        entities: [
            {
                id: 3,
                type: 'shape',
                subtype: 'rectangle',
                x: 0,
                y: 0,
                rotation: 0,
                handlePoint: { x: 128, y: 64 },
            },
        ],
    });
    const entity = result.save.entities?.[0];
    assert.equal(entity?.type, 'rectangle');
    assert.equal(entity?.subtype, undefined);
    assert.equal(entity?.width, 128);
    assert.equal(entity?.height, 64);
    assert.equal(entity?.handlePoint, undefined);
});
