import assert from 'node:assert/strict';
import test from 'node:test';
import type { NixieExtensionRenderSpriteV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import assets from '../src/scene-v2-assets-node.ts';
import { sampleFoxholeSceneV2Connector } from '../src/scene-v2-connector-path.ts';
import { allowsFoxholeConnectorGuideRotation, renderFoxholeConnectorGuides } from '../src/scene-v2-connector-guides.ts';
import { renderFoxholeSceneV2SplineConnector } from '../src/scene-v2-spline-connectors.ts';
import { resolveWaterWallBuoys } from '../src/water-wall-spline.ts';

test('water walls stay straight with two endpoint handles even with saved curve tangents', () => {
    const asset = assets.waterwallsplinet1!;
    const data = {
        foxholeKey: 'waterwallsplinet1', startX: 20, startY: 30, startRotation: Math.PI / 2,
        endX: 340, endY: 150, endRotation: -Math.PI / 2,
        startHandleLength: 200, endHandleLength: 200,
        minLength: 160, maxLength: 640, minRadius: 24, maxRadius: 24,
        maxBuffer: 0, curveT: 1, blueprint: false,
    };
    assert.deepEqual(sampleFoxholeSceneV2Connector(data, asset).points, [{ x: 20, y: 30 }, { x: 340, y: 150 }]);
    assert.equal(allowsFoxholeConnectorGuideRotation(data, asset), false);
    const guide = renderFoxholeConnectorGuides(data, asset)[0];
    assert.ok(guide?.kind === 'group');
    const handles = guide.children.find(node => node.id === 'spline-guide-handles');
    assert.ok(handles?.kind === 'graphics');
    assert.equal(handles.commands.filter(command => command.op === 'circle').length, 2);
});

for (const [length, expected] of [[160, [0, 160]], [319, [0, 160, 319]], [320, [0, 160, 320]],
    [480, [0, 160, 320, 480]], [530, [0, 160, 320, 480, 530]], [639, [0, 160, 320, 480, 639]],
    [640, [0, 160, 320, 480, 640]], [2000, [0, 160, 320, 480, 2000]]] as const) {
    test(`water wall at ${length} units keeps both endpoints and capped interior buoys`, () => {
        const asset = assets.waterwallsplinet1!;
        const nodes = renderFoxholeSceneV2SplineConnector({
            foxholeKey: 'waterwallsplinet1', startX: 0, startY: 0, startRotation: 1,
            endX: length, endY: 0, endRotation: -1,
            minLength: 160, maxLength: 640, minRadius: 24, maxRadius: 24, maxBuffer: 0, curveT: 1, blueprint: false,
        }, asset);
        const buoys = nodes.filter((node): node is NixieExtensionRenderSpriteV1 => node.kind === 'sprite' && node.id.startsWith('spline-connector-buoy'));
        assert.deepEqual(buoys.map(node => node.x), expected);
        assert.ok(buoys.slice(0, -1).every(node => node.kind === 'sprite' && node.resourceId === asset.renderLayers.backtrim?.resourceId));
        assert.equal(buoys.at(-1)?.resourceId, asset.renderLayers.fronttrim?.resourceId);
        const net = nodes.find(node => node.id === 'spline-connector-span');
        assert.ok(net?.kind === 'mesh');
        assert.equal(Math.min(...net.positions.filter((_, index) => index % 2 === 0)), 0);
        assert.equal(Math.max(...net.positions.filter((_, index) => index % 2 === 0)), expected.at(-1));
        assert.equal(nodes.filter(node => /spline-connector-(back|front)-trim/.test(node.id)).length, 0);
        const netIndex = nodes.indexOf(net);
        assert.ok(nodes.every((node, index) => !node.id.includes('buoy') && !node.id.endsWith('-trim') || index < netIndex),
            'netting must draw above every buoy');
    });
}

test('water wall buoys follow fixed intervals along a diagonal chord', () => {
    const buoys = resolveWaterWallBuoys({ x: 30, y: 40 }, { x: 414, y: 552 });
    assert.deepEqual(buoys.map(({ x, y }) => ({ x, y })), [
        { x: 30, y: 40 }, { x: 126, y: 168 }, { x: 222, y: 296 }, { x: 318, y: 424 }, { x: 414, y: 552 },
    ]);
    assert.deepEqual(resolveWaterWallBuoys({ x: 0, y: 0 }, { x: 0, y: 0 }), []);
});

test('saved subminimum water wall geometry retains physical endpoints without inventing a length clamp', () => {
    const nodes = renderFoxholeSceneV2SplineConnector({
        foxholeKey: 'waterwallsplinet1', startX: 0, startY: 0, startRotation: 0,
        endX: 159, endY: 0, endRotation: 0,
        minLength: 0, maxLength: 640, minRadius: 24, maxRadius: 24, maxBuffer: 0, curveT: 1, blueprint: false,
    }, assets.waterwallsplinet1!);
    assert.deepEqual(nodes.filter(node => node.id.startsWith('spline-connector-buoy')).map(node => node.x), [0, 159]);
    assert.equal(nodes.some(node => node.kind === 'mesh'), true);
});

test('the observed diagonal partial-span drag keeps a front buoy at the snapped handle', () => {
    const asset = assets.waterwallsplinet1!;
    const data = { foxholeKey: 'waterwallsplinet1', startX: 0, startY: 0, startRotation: 0,
        endX: 231.5, endY: 33, endRotation: 0, minLength: 160, maxLength: 640,
        minRadius: 24, maxRadius: 24, maxBuffer: 0, curveT: 1, blueprint: false };
    const saved = structuredClone(data);
    const nodes = renderFoxholeSceneV2SplineConnector(data, asset);
    const buoys = nodes.filter((node): node is NixieExtensionRenderSpriteV1 => node.kind === 'sprite' && node.id.startsWith('spline-connector-buoy'));
    assert.equal(buoys.length, 3);
    assert.deepEqual({ x: 840 + buoys.at(-1)!.x! * 2, y: 669 + buoys.at(-1)!.y! * 2 }, { x: 1303, y: 735 });
    assert.equal(buoys.at(-1)!.resourceId, asset.renderLayers.fronttrim!.resourceId);
    const net = nodes.find(node => node.id === 'spline-connector-span');
    assert.ok(net?.kind === 'mesh');
    const length = Math.hypot(data.endX, data.endY);
    const projected = net.positions.filter((_, i) => i % 2 === 0)
        .map((x, i) => (x * data.endX + net.positions[i * 2 + 1]! * data.endY) / length);
    assert.ok(Math.abs(Math.max(...projected) - length) < 1e-5);
    assert.deepEqual(data, saved);
});
