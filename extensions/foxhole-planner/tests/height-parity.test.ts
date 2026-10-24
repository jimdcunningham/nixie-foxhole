import assert from 'node:assert/strict';
import test from 'node:test';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import { resolveFoxholeAssetHeightLane, resolveFoxholeConnectorRenderLane, FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE } from '../src/render-lanes.ts';

test('legacy height categories produce a predictable construction stack', () => {
    const stack = ['facilityroad', 'trencht1', 'foundation012x2t3', 'railtracksplinefoundation',
        'facilitypipe', 'facilityrefinery1', 'weatherstation', 'truckc', 'shippingcontainer',
        'wallsplinet3', 'facilitycatwalkplatform', 'powerpole', 'playerc', 'crane', 'largecrane'];
    const orders = stack.map(id => {
        const plan = renderFoxholeSceneV2Entity({ entityId: id, revision: 1, components: [{
            ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: id },
        }] });
        const visuals = plan.root.children.filter(node => node.kind === 'sprite' || node.kind === 'mesh');
        assert.ok(visuals.length, `${id} must paint a physical visual`);
        return Math.max(...visuals.map(node => node.laneOrder ?? 0));
    });
    // Trenches retain their elevated corner/wall components for joins; compare their ground surface separately.
    orders[1] = resolveFoxholeAssetHeightLane('trencht1')!.laneOrder;
    for (let index = 1; index < orders.length; index++) {
        assert.ok(orders[index]! > orders[index - 1]!, `${stack[index]} must sit above ${stack[index - 1]}: ${orders}`);
    }
});

test('all catwalk components remain overhead and rail forms stay below pipes', () => {
    for (const id of ['facilitycatwalkplatform', 'facilitycatwalkstairs']) {
        const plan = renderFoxholeSceneV2Entity({ entityId: id, revision: 1, components: [{
            ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: id },
        }] });
        assert.ok(plan.root.children.length);
        const physical = plan.root.children.filter(node => !node.id.startsWith('placement-invalid-') && node.experimentalPresentation?.excludeFromBounds !== true);
        assert.ok(physical.every(node => node.laneOrder === 120));
    }
    for (const id of ['railtracksplinebiarc', 'railtracksplinefoundation', 'smallrailtracksplinefoundation', 'cranerailtrackspline']) {
        assert.ok(resolveFoxholeConnectorRenderLane(id, FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE).laneOrder < 35);
    }
    assert.equal(resolveFoxholeConnectorRenderLane('facilitycatwalkbridge', FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE).laneOrder, 120);
});
