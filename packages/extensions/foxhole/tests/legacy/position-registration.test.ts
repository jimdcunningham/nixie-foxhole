import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLegacyPlanPosition } from '../../app/plugins/foxhole/legacy/plan-position.ts';
import { refineAlphaTranslation, registerAlphaTranslation } from '../../tools/legacy-plans/position-registration.mjs';

const pack = (x: number, y: number) => (x + 4096) * 8192 + y + 4096;

function mask(points: Array<{ x: number; y: number }>) {
    return {
        points,
        occupied: new Set(points.map(point => pack(point.x, point.y))),
        centroid: {
            x: points.reduce((total, point) => total + point.x, 0) / points.length,
            y: points.reduce((total, point) => total + point.y, 0) / points.length,
        },
    };
}

test('alpha registration recovers a board-space translation without recentering the shape', () => {
    const legacy = mask([{ x: 3, y: 1 }, { x: 4, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }]);
    const nixie = mask([{ x: -2, y: 4 }, { x: -1, y: 4 }, { x: -2, y: 5 }, { x: -2, y: 6 }]);
    assert.deepEqual(registerAlphaTranslation(legacy, nixie), {
        x: 20,
        y: -12,
        score: 1,
        originScore: 0,
        areaRatio: 1,
    });
});

test('fine alpha registration resolves a correction between coarse four-pixel steps', () => {
    const legacy = mask([{ x: 3, y: 1 }, { x: 4, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }]);
    const nixie = mask([{ x: -2, y: 4 }, { x: -1, y: 4 }, { x: -2, y: 5 }, { x: -2, y: 6 }]);
    assert.deepEqual(refineAlphaTranslation(legacy, nixie, 4, -4), {
        x: 5,
        y: -3,
        score: 1,
        originScore: 0,
        areaRatio: 1,
    });
});

test('a changed published sprite does not reuse its old correction', () => {
    assert.deepEqual(resolveLegacyPlanPosition('aircraftbomberc', 'aircraftbomberc',
        { width: 1, height: 1 }, 100, 200, 0), { x: 100, y: 200 });
});

test('an upgraded refinery needs its matching variant sprite before shifting', () => {
    const parent = { width: 265, height: 692, offsetX: -20.91, offsetY: -17.621 };
    assert.deepEqual(resolveLegacyPlanPosition('oil_refinery_reformer', 'facilityrefineryoil',
        parent, 100, 200, 0, { width: 1, height: 1 }), { x: 100, y: 200 });
    assert.deepEqual(resolveLegacyPlanPosition('oil_refinery_reformer', 'facilityrefineryoil',
        parent, 100, 200, 0, { width: 265, height: 777, offsetX: -20.91, offsetY: 25.081 }),
    { x: 111, y: 185 });
});

test('alpha registration never replaces a better original placement', () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
    const legacy = mask(points);
    const nixie = { ...mask(points), centroid: { x: 50, y: 50 } };
    assert.deepEqual(registerAlphaTranslation(legacy, nixie), {
        x: 0, y: 0, score: 1, originScore: 1, areaRatio: 1,
    });
});
