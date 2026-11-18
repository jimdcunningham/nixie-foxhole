import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieSpatialPlanV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { NixieComponentEntitySnapshotV1 as Entity } from '@nixiejs/extension-sdk/scene-v2';
import assets from '../src/scene-v2-assets-node.ts';
import { renderFoxholeSpatialConnector } from '../src/scene-v2-spatial-connectors.ts';
import { createFoxholeSceneV2SplineProductData } from '../src/scene-v2-connector-products.ts';
import type { FoxholeSceneV2SplineConnectorData } from '../src/scene-v2-spline-connectors.ts';

const entity: Entity = { entityId: 'connector', revision: 1, components: [] };
const endpointBindings = { start: { entityId: 'anchor', point: [0,0,0] as [number,number,number] } };
const rails = ['railtrackspline', 'railtracksplinebiarc', 'railtracksplinefoundation', 'railtracksplinetown',
    'smallrailtrackspline', 'smallrailtracksplinebiarc', 'smallrailtracksplinefoundation'];

test('Dragon’s Teeth cycle four rigid spatial variants on the authored interval', () => {
    const id = 'tankstopsplinet3';
    const asset = assets[id]!;
    assert.ok(asset.model);
    const model = { ...asset.model, pathProfile: { version: 1 as const, parts: Object.fromEntries(
        [0, 1, 2, 3].map(index => [`marker${index + 1}`, { meshIndex: index, origin: [120 * index, 0, 0] as [number, number, number] }]),
    ) } };
    const data = createFoxholeSceneV2SplineProductData(id, asset.connector!) as unknown as FoxholeSceneV2SplineConnectorData;
    data.endX = data.maxLength;
    const plan = parseNixieSpatialPlanV1(renderFoxholeSpatialConnector(entity, data, { ...asset, model }));
    assert.equal(plan.nodes.length, 4);
    const positions = plan.nodes.flatMap(node => {
        assert.ok(node.kind === 'model-path' && node.instances);
        return node.instances.map(instance => [Math.round(instance.distance), node.meshIndex]);
    }).sort((a, b) => a[0]! - b[0]!);
    assert.deepEqual(positions, [[0, 0], [120, 1], [240, 2], [360, 3], [480, 0]]);
});

test('minefield spatial recipes repeat each prototype with deterministic stagger and native height', () => {
    for (const id of ['minespline', 'infantryminespline', 'tankminespline', 'waterminespline', 'surfacewaterminespline']) {
        const asset = assets[id]!;
        assert.ok(asset.model);
        const variants = asset.renderLayers.spanalt ? 2 : 1;
        const model = { ...asset.model, pathProfile: { version: 1 as const, parts: Object.fromEntries(
            Array.from({ length: variants }, (_, index) => [`marker${index + 1}`,
                { meshIndex: index, origin: [0, 32, index ? -3.2 : 0] as [number, number, number] }]),
        ) } };
        const data = createFoxholeSceneV2SplineProductData(id, asset.connector!) as unknown as FoxholeSceneV2SplineConnectorData;
        Object.assign(data, { endX: data.maxLength, startZ: 4, endZ: 36 });
        const plan = parseNixieSpatialPlanV1(renderFoxholeSpatialConnector(entity, data, { ...asset, model }));
        assert.equal(plan.nodes.length, variants, id);
        for (const [index, node] of plan.nodes.entries()) {
            assert.ok(node.kind === 'model-path' && node.instances && node.instances.length >= 3);
            assert.equal(node.points[2], 4);
            assert.equal(node.points.at(-1), 36);
            assert.deepEqual(node.instances.slice(0, 2).map(instance => instance.offset?.[1]), [32, -32]);
            assert.equal(node.instances[1]!.offset![2], index ? -3.2 : 0);
        }
    }
});

test('sandbag splines place rigid variants along the path with the full wall lead-in', () => {
    for (const id of ['sandbaghalfspline', 'sandbagfullspline']) {
        const asset = assets[id]!;
        assert.ok(asset.model);
        const parts = Object.fromEntries([0, 1, 2, 3].map(index =>
            [`marker${index + 1}`, { meshIndex: index, origin: [0, 0, 0] as [number, number, number] }]));
        if (id === 'sandbagfullspline') parts.start = { meshIndex: 4, origin: [0, 0, 0] };
        const model = { ...asset.model, pathProfile: { version: 1 as const, parts } };
        const data = createFoxholeSceneV2SplineProductData(id, asset.connector!) as unknown as FoxholeSceneV2SplineConnectorData;
        data.endX = data.maxLength;
        const plan = parseNixieSpatialPlanV1(renderFoxholeSpatialConnector(entity, data, { ...asset, model }));
        const instances = plan.nodes.flatMap(node => {
            assert.ok(node.kind === 'model-path' && node.instances);
            return node.instances.map(instance => ({ mesh: node.meshIndex, distance: instance.distance }));
        }).sort((a, b) => a.distance - b.distance);
        const full = id === 'sandbagfullspline';
        const step = asset.connector!.meshConfigs[0]!.interval;
        assert.deepEqual(instances.slice(0, 6).map(instance => instance.mesh), full ? [4, 0, 1, 2, 3, 0] : [0, 1, 2, 3, 0, 1]);
        assert.ok(instances.every((instance, index) => Math.abs(instance.distance - index * step) < .001));
    }
});

test('all seven reference roads overlap the visible parts of native tiles', () => {
    for (const id of ['dirtroad', 'gravelroad', 'greatmarchroad', 'packeddirtroad',
        'snowdirtroad', 'snowgravelroad', 'snowpackeddirtroad']) {
        const asset = assets[id]!;
        const data = createFoxholeSceneV2SplineProductData(id, asset.connector!) as unknown as FoxholeSceneV2SplineConnectorData;
        Object.assign(data, { endX: data.maxLength * .75, endY: 96, endRotation: .3, curveT: 1, startZ: 8, endZ: 32 });
        const plan = parseNixieSpatialPlanV1(renderFoxholeSpatialConnector(entity, data, asset));
        const [road] = plan.nodes;
        assert.ok(plan.nodes.length > 1, id);
        assert.ok(road?.kind === 'model-path');
        assert.equal(road.resourceId, asset.model!.resourceId);
        assert.equal(road.meshIndex, 0);
        assert.ok(road.points.length > 6);
        assert.deepEqual(road.points.slice(0, 3), [0, 0, 8]);
        assert.deepEqual(road.points.slice(-3), [data.endX, 96, 32]);
        const pitch = Math.min(asset.connector!.meshConfigs[0]!.interval, asset.model!.width * 0.75);
        for (const [index, node] of plan.nodes.entries()) {
            assert.ok(node.kind === 'model-path');
            assert.ok(Math.abs(node.startInset! - index * pitch) < 0.001);
            assert.equal(node.resourceId, asset.model!.resourceId);
        }
        const last = plan.nodes.at(-1);
        assert.ok(last?.kind === 'model-path');
        assert.equal(last.endInset, 0);
    }
});

test('Provisional Road repeats only the span mesh across short and long paths', () => {
    const id = 'facilityroad';
    const asset = assets[id]!;
    assert.ok(asset.model && asset.connector);
    const parts = {
        span: { meshIndex: 0, origin: [0, 0, 0] as [number, number, number] },
        start: { meshIndex: 1, origin: [0, 0, 0] as [number, number, number] },
        end: { meshIndex: 2, origin: [0, 0, 0] as [number, number, number] },
    };
    for (const model of [{ ...asset.model, pathProfile: undefined }, { ...asset.model, pathProfile: { version: 1 as const, parts } }]) {
        for (const endX of [64, 960]) {
            const data = createFoxholeSceneV2SplineProductData(id, asset.connector) as unknown as FoxholeSceneV2SplineConnectorData;
            Object.assign(data, { endX, endY: 0, startZ: 8, endZ: 32 });
            const { nodes } = parseNixieSpatialPlanV1(renderFoxholeSpatialConnector(entity, data, { ...asset, model }));
            assert.equal(nodes.length, 1);
            const [road] = nodes;
            assert.ok(road?.kind === 'model-path');
            assert.equal(road.meshIndex, model.pathProfile ? 0 : 1);
            assert.equal(road.startInset, undefined);
            assert.equal(road.endInset, undefined);
            assert.deepEqual(road.points.slice(0, 3), [0, 0, 8]);
            assert.deepEqual(road.points.slice(-3), [endX, 0, 32]);
        }
    }
});

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
            assert.deepEqual(parseNixieSpatialPlanV1(plan), plan);
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
    assert.deepEqual(parseNixieSpatialPlanV1(plan),plan);
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
        assert.deepEqual(parseNixieSpatialPlanV1(plan),plan);
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
