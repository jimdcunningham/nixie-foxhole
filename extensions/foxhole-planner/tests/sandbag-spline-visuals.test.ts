import assert from 'node:assert/strict';
import test from 'node:test';
import published from '../../../packages/extensions/foxhole/public/foxhole/assets/manifest.v1.json' with { type: 'json' };
import { createFoxholeSceneV2AssetMetadata } from '../src/scene-v2-asset-metadata.ts';
import type { PublishedFoxholeManifestForSceneV2 } from '../src/scene-v2-asset-metadata.ts';
import { renderFoxholeSceneV2SplineConnector } from '../src/scene-v2-spline-connectors.ts';
import { resolveSandbagSplineTextureSlicing } from '../src/spline-ribbon-mesh.ts';

for (const [id, width, height, interval] of [
    ['sandbaghalfspline', 270, 66, 95],
    ['sandbagfullspline', 273, 75, 74],
] as const) {
    test(`${id} renders a textured curved span instead of an interval marker or guide`, () => {
        const textureUrl = `/foxhole/assets/types/structures/${id}/${id}.texture.webp`;
        const result = createFoxholeSceneV2AssetMetadata({ assets: [{
            id, codeName: id, sprite: { width, height }, variants: { default: { textureUrl } },
            connector: { splineComponentName: 'Sandbag', pathStyle: 'interval', minLengthCm: 420,
                maxLengthCm: 1000, meshConfigs: [{ mode: 'interval', interval }] },
        }] });
        const asset = result.assets[id]!;
        assert.equal(asset.connector?.spline, true);
        assert.equal(asset.renderLayers.span?.resourceId, `foxhole.visual.${id}-layer-span`);
        assert.equal(asset.renderLayers.span?.width, width / 2);
        assert.ok(result.visualResources.some(resource => resource.sourceUrl === textureUrl));

        const nodes = renderFoxholeSceneV2SplineConnector({ foxholeKey: id,
            startX: 0, startY: 0, startRotation: 0,
            endX: 260, endY: 70, endRotation: 0,
            minLength: 134.4, maxLength: 320, minRadius: 16, maxRadius: 320, maxBuffer: 128,
            curveT: 1, blueprint: false,
        }, asset);
        const span = nodes.find(node => node.id === 'spline-connector-span');
        assert.ok(span?.kind === 'mesh');
        assert.equal(span.resourceId, asset.renderLayers.span?.resourceId);
        assert.ok(span.positions.length > 8);
        assert.equal(span.textureAddressMode, 'clamp-to-edge');
        const along = span.uvs.filter((_, index) => index % 4 === 0);
        const slicing = resolveSandbagSplineTextureSlicing(id)!;
        assert.ok(Math.abs(along[0]!) < 0.001);
        assert.ok(Math.abs(along.at(-1)! - 1) < 0.001);
        assert.ok(along.every(u => u >= -0.001 && u <= 1.001));
        const repeatJoins = along.flatMap((u, index) =>
            index > 0 && u < along[index - 1]! - 0.1 ? [index] : []);
        assert.ok(repeatJoins.length > 0);
        for (const index of repeatJoins) {
            assert.ok(Math.abs(along[index - 1]! - slicing.repeatEndU) < 0.001);
            assert.ok(Math.abs(along[index]! - slicing.repeatStartU) < 0.001);
            for (let coordinate = 0; coordinate < 4; coordinate++) {
                assert.ok(Math.abs(span.positions[((index - 1) * 4) + coordinate]!
                    - span.positions[(index * 4) + coordinate]!) < 0.001);
            }
        }
        assert.equal(nodes.some(node => node.kind === 'graphics'), false);
        assert.equal(nodes.some(node => node.id.includes('interval')), false);
    });
}

test('published sandbags resolve span textures without explicit variant URLs', () => {
    const assets = published.assets.filter(asset =>
        asset.id === 'sandbaghalfspline' || asset.id === 'sandbagfullspline');
    const result = createFoxholeSceneV2AssetMetadata({ assets: assets as unknown as PublishedFoxholeManifestForSceneV2['assets'] });
    for (const asset of assets) {
        const expectedUrl = `/foxhole/assets/types/structures/${asset.id}/${asset.id}.texture.webp`;
        const metadata = result.assets[asset.id];
        assert.ok(metadata?.renderLayers.span);
        assert.ok(result.visualResources.some(resource => resource.sourceUrl === expectedUrl));
        const nodes = renderFoxholeSceneV2SplineConnector({ foxholeKey: asset.id,
            startX: 0, startY: 0, startRotation: 0, endX: 134.4, endY: 0, endRotation: 0,
            minLength: 134.4, maxLength: 320, minRadius: 16, maxRadius: 320, maxBuffer: 128,
            curveT: 1, blueprint: false,
        }, metadata);
        assert.ok(nodes.some(node => node.id === 'spline-connector-span' && node.kind === 'mesh'));
    }
});
