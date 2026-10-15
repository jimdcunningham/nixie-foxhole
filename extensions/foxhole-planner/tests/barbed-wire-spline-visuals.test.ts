import assert from 'node:assert/strict';
import test from 'node:test';
import published from '../../../packages/extensions/foxhole/public/foxhole/assets/manifest.v1.json' with { type: 'json' };
import { createFoxholeSceneV2AssetMetadata } from '../src/scene-v2-asset-metadata.ts';
import type { PublishedFoxholeManifestForSceneV2 } from '../src/scene-v2-asset-metadata.ts';
import { renderFoxholeSceneV2SplineConnector } from '../src/scene-v2-spline-connectors.ts';

test('Barbed Wire uses its full extracted coil span along a curved path with endpoint posts', () => {
    const source = published.assets.find(asset => asset.id === 'barbedwirespline');
    assert.ok(source);
    const metadata = createFoxholeSceneV2AssetMetadata({
        assets: [source] as unknown as PublishedFoxholeManifestForSceneV2['assets'],
    }).assets.barbedwirespline!;
    assert.equal(metadata.connector?.pathStyle, 'spline');
    assert.equal(metadata.renderLayers.span?.width, 247 / 2);

    const nodes = renderFoxholeSceneV2SplineConnector({
        foxholeKey: 'barbedwirespline',
        startX: 0, startY: 0, startRotation: -0.5,
        endX: 240, endY: 0, endRotation: 0.5,
        minLength: 96, maxLength: 320, minRadius: 0, maxRadius: 128, maxBuffer: 128,
        curveT: 1, blueprint: false,
    }, metadata);
    const span = nodes.find(node => node.id === 'spline-connector-span');
    assert.ok(span?.kind === 'mesh');
    const startCenter = { x: (span.positions[0]! + span.positions[2]!) / 2,
        y: (span.positions[1]! + span.positions[3]!) / 2 };
    const endCenter = { x: (span.positions.at(-4)! + span.positions.at(-2)!) / 2,
        y: (span.positions.at(-3)! + span.positions.at(-1)!) / 2 };
    assert.ok(Math.hypot(startCenter.x, startCenter.y) < 0.01);
    assert.ok(Math.hypot(endCenter.x - 240, endCenter.y) < 0.01);
    const along = span.uvs.filter((_, index) => index % 4 === 0);
    assert.ok(Math.abs(along.at(-1)! - 240 / metadata.renderLayers.span!.width) < 0.2);
    const midpoint = Math.floor(span.positions.length / 8) * 4;
    assert.ok(Math.abs((span.positions[midpoint + 1]! + span.positions[midpoint + 3]!) / 2) > 5);
    assert.ok(nodes.some(node => node.id === 'spline-connector-back-trim'));
    assert.ok(nodes.some(node => node.id === 'spline-connector-front-trim'));
});
