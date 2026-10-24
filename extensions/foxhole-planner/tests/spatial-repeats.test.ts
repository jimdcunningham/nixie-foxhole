import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExperimentalSpatialPlanV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import type { NixieExperimentalComponentEntitySnapshotV1 as Entity } from '@nixiejs/extension-sdk/experimental/scene-v2';
import assets from '../src/scene-v2-assets-node.ts';
import { renderFoxholeSpatialConnector } from '../src/scene-v2-spatial-connectors.ts';
import { createFoxholeSceneV2SplineProductData } from '../src/scene-v2-connector-products.ts';
import type { FoxholeSceneV2SplineConnectorData } from '../src/scene-v2-spline-connectors.ts';

const entity: Entity = { entityId: 'connector', revision: 1, components: [] };
const endpointBindings = { start: { entityId: 'anchor', point: [0,0,0] as [number,number,number] } };
const rails = ['railtrackspline', 'railtracksplinebiarc', 'railtracksplinefoundation', 'railtracksplinetown',
    'smallrailtrackspline', 'smallrailtracksplinebiarc', 'smallrailtracksplinefoundation'];

test('all rail profiles preserve the authored path and rigid sleepers through serialization', () => {
    for (const id of rails) {
        const asset = assets[id]!;
        assert.ok(asset.model?.pathProfile, `focused export required: ${id}`);
        for (const limit of ['minLength', 'maxLength'] as const) {
            const data = createFoxholeSceneV2SplineProductData(id, asset.connector!) as unknown as FoxholeSceneV2SplineConnectorData;
            Object.assign(data, { endX: data[limit], endY: 30, startRotation: .1, endRotation: -.1,
                startZ: 16, endZ: 48 });
            const before = structuredClone(data);
            const plan = renderFoxholeSpatialConnector(entity, { ...data, endpointBindings }, asset)!;
            assert.deepEqual(parseNixieExperimentalSpatialPlanV1(plan), plan);
            assert.deepEqual(renderFoxholeSpatialConnector(entity, { ...JSON.parse(JSON.stringify(data)), endpointBindings }, asset), plan);
            assert.deepEqual(data, before);
            const sleeper = plan.nodes.find(node => node.id === 'rail-sleepers');
            assert.ok(sleeper?.kind === 'model-path' && sleeper.instances?.length);
            assert.deepEqual(sleeper.sourceOrigin, asset.model.pathProfile.parts.sleeper!.origin);
            assert.deepEqual(sleeper.endpointBindings,endpointBindings);
            assert.ok(sleeper.instances.every(instance => Number.isFinite(instance.distance) && instance.distance >= 0));
            const span = plan.nodes.find(node => node.id === 'rail-span');
            assert.ok(span?.kind === 'model-path');
            assert.deepEqual(span.points.slice(0,3), [0,0,16]);
            assert.deepEqual(span.points.slice(-3), [data.endX,30,48]);
            assert.equal(plan.nodes.some(node => node.id === 'rail-bed'), !id.endsWith('foundation') && !id.endsWith('town'));
        }
    }
});

test('barbed wire repeats both rigid coil rows with lateral separation and endpoint posts', () => {
    const asset = assets.barbedwirespline!;
    const data = createFoxholeSceneV2SplineProductData('barbedwirespline', asset.connector!) as unknown as FoxholeSceneV2SplineConnectorData;
    Object.assign(data, { endX: data.maxLength, endY: 32, endZ: 64 });
    const plan = renderFoxholeSpatialConnector(entity,data,asset)!;
    assert.deepEqual(parseNixieExperimentalSpatialPlanV1(plan),plan);
    const [first,second,posts] = plan.nodes;
    assert.ok(first?.kind === 'model-path' && second?.kind === 'model-path' && posts?.kind === 'model-path');
    assert.ok(first.instances!.length > 1 && second.instances!.length > 1);
    assert.ok(first.instances![0]!.offset![1] * second.instances![0]!.offset![1] < 0);
    assert.equal(posts.instances!.length,2);
    assert.equal(posts.instances![0]!.distance,0);
    assert.ok(posts.instances![1]!.distance > data.maxLength);
});

test('fence panels retain sharp sections, separate corner posts and global preview weights at both limits', () => {
    const asset = assets.barbedwirewallspline!;
    for (const limit of ['minLength','maxLength'] as const) {
        const data = createFoxholeSceneV2SplineProductData('barbedwirewallspline',asset.connector!) as unknown as FoxholeSceneV2SplineConnectorData;
        Object.assign(data, { endX: data[limit], endY: 32, startZ: 16, endZ: 48 });
        const before = structuredClone(data);
        const plan = renderFoxholeSpatialConnector(entity,{ ...data, endpointBindings },asset)!;
        assert.deepEqual(parseNixieExperimentalSpatialPlanV1(plan),plan);
        const panels = plan.nodes.filter(node => node.id.startsWith('fence-section'));
        assert.equal(panels.length,3);
        let previousEnd = 0;
        for (const panel of panels) {
            assert.ok(panel.kind === 'model-path');
            assert.equal(panel.points.length,6);
            assert.deepEqual(panel.endpointBindings,endpointBindings);
            assert.equal(panel.deformationRange![0],previousEnd);
            previousEnd = panel.deformationRange![1];
        }
        assert.equal(previousEnd,1);
        const bends = plan.nodes.find(node => node.id === 'fence-bend-posts');
        assert.ok(bends?.kind === 'model-path');
        assert.equal(bends.instances!.length,4);
        assert.ok(bends.instances!.slice(1,-1).every(instance => Number.isFinite(instance.rotation)));
        const middle = plan.nodes.find(node => node.id === 'fence-middle-posts');
        if (limit === 'maxLength') assert.ok(middle?.kind === 'model-path' && middle.instances!.length >= 3);
        assert.deepEqual(data,before);
        assert.deepEqual(renderFoxholeSpatialConnector(entity,{ ...JSON.parse(JSON.stringify(data)), endpointBindings },asset),plan);
    }
});
