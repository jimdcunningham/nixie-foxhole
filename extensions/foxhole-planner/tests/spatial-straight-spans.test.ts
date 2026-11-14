import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieSpatialPlanV1 } from '@nixiejs/extension-sdk/scene-v2';
import assets from '../src/scene-v2-assets-node.ts';
import { renderFoxholeSpatialConnector } from '../src/scene-v2-spatial-connectors.ts';
import { createFoxholeSceneV2SplineProductData } from '../src/scene-v2-connector-products.ts';
import type { FoxholeSceneV2SplineConnectorData } from '../src/scene-v2-spline-connectors.ts';

test('straight connector models follow the edited span in the shared spatial renderer', () => {
    const entity = { entityId: 'span', revision: 1, components: [] };
    for (const key of ['fieldbridge', 'fieldpier', 'facilitycatwalkbridge', 'wallsplinet1', 'wallsplinet2',
        'wallsplinet3', 'waterwallsplinet1', 'cranerailtrackspline']) {
        const asset = assets[key]!;
        const data = createFoxholeSceneV2SplineProductData(key, asset.connector!) as unknown as FoxholeSceneV2SplineConnectorData;
        const endpointBindings = { end: { entityId: 'support', point: [0, 0, 0] as [number, number, number] } };
        const moved = { ...data, startX: -20, startY: 35, startZ: 4, endX: 340, endY: -210, endZ: 48,
            endAttachmentNodeId: 'support', endpointBindings };
        const plan = parseNixieSpatialPlanV1(renderFoxholeSpatialConnector(entity, moved, asset));
        assert.ok(plan.nodes.length, key);
        for (const node of plan.nodes) {
            assert.equal(node.kind, 'model-path', key);
            assert.deepEqual(node.points, [-20, 35, 4, 340, -210, 48], key);
            assert.deepEqual(node.endpointBindings, endpointBindings, key);
        }
        if (key === 'fieldbridge' || key === 'fieldpier') {
            const ids = plan.nodes.map(node => node.id);
            assert.deepEqual(ids, ['deck', 'start-pillar', 'start-ramp', 'end-pillar']);
        }
    }
});
