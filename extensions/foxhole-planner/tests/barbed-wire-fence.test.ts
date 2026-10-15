import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleBarbedWireFencePath, resolveBarbedWireFencePosts } from '../src/barbed-wire-fence.ts';
import { sampleFoxholeSceneV2Connector } from '../src/scene-v2-connector-path.ts';
import { renderFoxholeSceneV2SplineConnector } from '../src/scene-v2-spline-connectors.ts';
import assets from '../src/scene-v2-assets-node.ts';

const start = { x: 0, y: 0, rotation: 0 }, end = { x: 320, y: 0, rotation: 0 };
const data = { foxholeKey: 'barbedwirewallspline', startX: 0, startY: 0, startRotation: 0,
    endX: 320, endY: 0, endRotation: 0, minLength: 128, maxLength: 320,
    minRadius: 0.32, maxRadius: 0.32, maxBuffer: 128, curveT: 0, blueprint: false };

test('fence retains both bend posts and native 2.2 m intervals at minimum and maximum lengths', () => {
    for (const length of [128, 320]) {
        const path = sampleBarbedWireFencePath(start, { ...end, x: length }, { curveT: 0, maxBuffer: 128 });
        assert.deepEqual(path.points.map(point => point.x), [0, 32, length - 32, length]);
        const posts = resolveBarbedWireFencePosts(path, { interval: 220 });
        assert.deepEqual(posts.filter(post => post.bend).map(post => post.x), [32, length - 32]);
        assert.equal(posts.length + 2, length === 128 ? 4 : 7);
        assert.ok(posts.every(post => post.x > 0 && post.x < length));
        const interiors = posts.filter(post => !post.bend);
        interiors.forEach((post, index) => assert.ok(Math.abs(post.x - 32 - (index + 1) * 70.4) < 1e-6));
    }
});

test('fence bends follow endpoint rotations and the wheel adjusts their position without curving the sections', () => {
    const corner = { x: 320, y: 96, rotation: Math.PI / 2 };
    const path = sampleBarbedWireFencePath(start, corner, { curveT: 0 });
    assert.deepEqual(path.points, [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 320, y: 64 }, { x: 320, y: 96 }]);
    const adjusted = sampleBarbedWireFencePath(start, corner, { curveT: 0.5, maxBuffer: 128 });
    assert.equal(adjusted.points[1]!.x, 80);
    assert.equal(adjusted.points[2]!.y, 16);
    assert.ok(path.totalLength > Math.hypot(corner.x, corner.y));
    assert.equal(resolveBarbedWireFencePosts(path).filter(post => post.bend)[1]!.rotation, Math.PI / 2);
});

test('Scene V2 uses published wire and post resources, keeps both ends, and supports appearance state', () => {
    const asset = assets.barbedwirewallspline;
    assert.ok(asset.renderLayers.span && asset.renderLayers.backtrim && asset.renderLayers.middlepillars && asset.renderLayers.fronttrim);
    assert.equal(asset.connector?.minLengthCm, 400);
    assert.equal(asset.connector?.maxLengthCm, 1000);
    assert.deepEqual(sampleFoxholeSceneV2Connector(data, asset).points.map(point => point.x), [0, 32, 288, 320]);
    for (const blueprint of [false, true]) {
        const nodes = renderFoxholeSceneV2SplineConnector({ ...data, blueprint }, asset);
        const wire = nodes.find(node => node.id === 'spline-connector-span');
        assert.equal(wire?.kind, 'mesh');
        assert.equal(wire?.kind === 'mesh' && wire.resourceId, asset.renderLayers.span.resourceId);
        const posts = nodes.filter(node => node.kind === 'sprite');
        assert.equal(posts.length, 7);
        assert.equal(posts.filter(post => post.resourceId === asset.renderLayers.middlepillars.resourceId).length, 3);
        assert.equal(posts.filter(post => post.resourceId === asset.renderLayers.backtrim.resourceId).length, 3);
        assert.deepEqual(posts.filter(node => node.id.endsWith('-trim')).map(node => [node.x, node.y]), [[0, 0], [320, 0]]);
        assert.ok(nodes.every(node => (node.kind === 'sprite' || node.kind === 'mesh')
            && (blueprint ? node.tint === 0x335CFF : node.tint === undefined)));
        assert.equal(nodes.some(node => node.kind === 'graphics'), false);
    }
});
