import assert from 'node:assert/strict';
import test from 'node:test';
import { foxholeConnectorGeometryHandles } from '../src/connector-gesture-policy.ts';
import { createFoxholeSceneV2SplineProductData } from '../src/scene-v2-connector-products.ts';
import type { FoxholeSceneV2SplineConnectorData } from '../src/scene-v2-spline-connectors.ts';
import assets from '../src/scene-v2-assets-node.ts';

test('portable connectors expose only useful endpoint and tangent handles', () => {
    for (const key of ['powerline', 'waterwallsplinet1', 'facilitypipe', 'facilitypipeunderground', 'railtrackspline']) {
        const asset = assets[key]!;
        const data = createFoxholeSceneV2SplineProductData(key, asset.connector!) as unknown as FoxholeSceneV2SplineConnectorData;
        const handles = foxholeConnectorGeometryHandles(data, asset);
        assert.deepEqual(handles.slice(0, 2).map(handle => handle.id), ['start', 'end']);
        assert.equal(handles.length, ['powerline', 'waterwallsplinet1'].includes(key) ? 2 : 4, key);
        if (key === 'facilitypipe') {
            const end = handles.find(handle => handle.id === 'end-rotation')!;
            assert.ok(Math.abs(end.local.x - data.endX - Math.cos(data.endRotation) * 36) < 1e-8);
            assert.ok(Math.abs(end.local.y - data.endY - Math.sin(data.endRotation) * 36) < 1e-8);
        }
    }
});
