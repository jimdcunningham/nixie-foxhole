import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildFoxholeStructureSelectionGeometry,
    isPointInsideFoxholeStructureSelectionGeometry,
} from '../app/plugins/nixie/board/types/foxhole-structure-selection.ts';

const sprite = {
    width: 512,
    height: 512,
    anchorX: 0.5,
    anchorY: 0.5,
    offsetX: 0,
    offsetY: 0,
};

test('authored selection polygons override sprite selection geometry in meter units', () => {
    const geometry = buildFoxholeStructureSelectionGeometry({
        selectionPolygons: [{
            shape: [-1, 2.5, -2.5, 2.5, -2.5, -2.5, 2.5, -2.5, 2.5, -1],
        }],
        sprite,
        pixelsPerUnit: 32,
    });

    assert.deepEqual(geometry?.bounds, {
        minX: -80,
        minY: -80,
        maxX: 80,
        maxY: 80,
    });
    assert.deepEqual(geometry?.hitPolygons, [[-32, 80, -80, 80, -80, -80, 80, -80, 80, -32]]);
    assert.equal(geometry?.hitBoxes.length, 0);
});

test('corner selection polygons exclude their cutout from cursor hit testing', () => {
    const geometry = buildFoxholeStructureSelectionGeometry({
        selectionPolygons: [{
            shape: [-1, 2.5, -2.5, 2.5, -2.5, -2.5, 2.5, -2.5, 2.5, -1],
        }],
        sprite,
        pixelsPerUnit: 32,
    });

    assert.ok(geometry);
    assert.equal(isPointInsideFoxholeStructureSelectionGeometry(-64, 64, geometry), true);
    assert.equal(isPointInsideFoxholeStructureSelectionGeometry(64, 64, geometry), false);
});

test('multiple selection polygons are unioned for bounds and cursor hits', () => {
    const geometry = buildFoxholeStructureSelectionGeometry({
        selectionPolygons: [
            { shape: [-2.5, -2.5, 0, -2.5, 0, 2.5, -2.5, 2.5] },
            { shape: [0.5, -1, 2.5, -1, 2.5, 1, 0.5, 1] },
        ],
        sprite,
        pixelsPerUnit: 32,
    });

    assert.ok(geometry);
    assert.deepEqual(geometry.bounds, { minX: -80, minY: -80, maxX: 80, maxY: 80 });
    assert.equal(isPointInsideFoxholeStructureSelectionGeometry(-64, 0, geometry), true);
    assert.equal(isPointInsideFoxholeStructureSelectionGeometry(64, 0, geometry), true);
    assert.equal(isPointInsideFoxholeStructureSelectionGeometry(8, 64, geometry), false);
});

test('trench selection keeps its full width and trims vertical sprite padding', () => {
    const geometry = buildFoxholeStructureSelectionGeometry({
        sprite: { ...sprite, width: 392, height: 187.5 },
        renderLayers: [
            { width: 640, height: 200, offsetX: 0, offsetY: 0 },
            { width: 40, height: 200, offsetX: 320, offsetY: 0 },
        ],
    });

    assert.deepEqual(geometry?.bounds, { minX: -196, minY: -42, maxX: 202, maxY: 42 });
    assert.equal(isPointInsideFoxholeStructureSelectionGeometry(0, 75, geometry!), false);
    assert.equal(isPointInsideFoxholeStructureSelectionGeometry(165, 0, geometry!), true);
});
