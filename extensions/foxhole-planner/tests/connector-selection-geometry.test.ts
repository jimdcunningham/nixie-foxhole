import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExperimentalSelectionGeometryV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import { resolveFoxholeConnectorSelectionGeometry } from '../src/connector-selection-geometry.ts';
import type { FoxholeSceneV2SplineConnectorData } from '../src/scene-v2-spline-connectors.ts';

const data: FoxholeSceneV2SplineConnectorData = { foxholeKey: 'powerline', startX: 10, startY: 20, startRotation: 0,
    endX: 110, endY: 120, endRotation: Math.PI, minLength: 0, maxLength: 1000, minRadius: 0, maxRadius: 1000,
    maxBuffer: 0, curveT: 0, blueprint: false };
test('power-line selection uses its oriented core stroke and every connector retains its endpoint midpoint', () => {
    const before = structuredClone(data);
    const geometry = resolveFoxholeConnectorSelectionGeometry(data);
    assert.deepEqual(geometry.transformOrigin, { x: 60, y: 70 });
    assert.equal(geometry.frameAngle, Math.PI / 4);
    assert.equal(geometry.localQuad?.length, 4);
    assert.deepEqual(parseNixieExperimentalSelectionGeometryV1(geometry), geometry);
    assert.deepEqual(data, before);
    assert.deepEqual(resolveFoxholeConnectorSelectionGeometry({ ...data, foxholeKey: 'facilitypipe' }), { contractVersion: 1,
        transformOrigin: { x: 60, y: 70 } });
    assert.ok(resolveFoxholeConnectorSelectionGeometry({ ...data, endX: 10, endY: 20 }).localQuad);
});
