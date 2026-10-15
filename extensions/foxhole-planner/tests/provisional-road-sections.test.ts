import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSplineRibbonMeshData, resolveConnectorSplineTextureSlicing } from '../src/spline-ribbon-mesh.ts';
import published from '../../../packages/extensions/foxhole/public/foxhole/assets/manifest.v1.json' with { type: 'json' };
import { createFoxholeSceneV2AssetMetadata } from '../src/scene-v2-asset-metadata.ts';
import type { PublishedFoxholeManifestForSceneV2 } from '../src/scene-v2-asset-metadata.ts';
import { renderFoxholeSceneV2SplineConnector } from '../src/scene-v2-spline-connectors.ts';
import { parseNixieExtensionRenderPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';

const layer = { width: 864, height: 410, offsetY: 0 };
const start = { x: 0, y: 0, rotation: 0 };
const constraints = { minLength: 288.32, maxLength: 960, minRadius: 160, maxRadius: 960, maxBuffer: 64 };

for (const length of [288.32, 432, 546.5, 960]) {
    test(`legacy cached road keeps its three-panel mapping at ${length}px`, () => {
        const mesh = buildSplineRibbonMeshData({ spanLayer: layer,
            textureMapping: { repeatLength: 432 },
            textureSlicing: resolveConnectorSplineTextureSlicing('facilityroad', layer),
        }, start, { x: length, y: 0, rotation: 0 }, constraints)!;
        assert.ok(mesh);
        const rows = Array.from({ length: mesh.uvs.length / 4 }, (_, i) => ({ x: mesh.positions[i * 4]!, u: mesh.uvs[i * 4]! }));
        assert.ok(Math.abs(rows[0]!.u) < 0.00001);
        assert.ok(Math.abs(rows.at(-1)!.u - 1) < 0.00001);
        assert.ok(rows.every(row => row.u >= -0.00001 && row.u <= 1.00001));
        assert.ok(rows.some(row => Math.abs(row.x - 144) < 0.001 && Math.abs(row.u - 1 / 3) < 0.00001));
        assert.ok(rows.some(row => Math.abs(row.x - (length - 144)) < 0.001 && Math.abs(row.u - 2 / 3) < 0.00001));
        for (let i = 1; i < rows.length; i++) {
            const a = rows[i - 1]!; const b = rows[i]!;
            if (b.u < a.u - 0.00001) {
                assert.ok(Math.abs(b.x - a.x) < 0.001, 'repeat boundaries share positions');
                assert.ok(Math.abs(b.u - 1 / 3) < 0.00001, 'only the body repeats');
            }
            if (a.x > 144.001 && b.x < length - 144.001 && b.x > a.x + 0.0001 && b.u >= a.u) {
                assert.ok(Math.abs((b.u - a.u) / (b.x - a.x) - 1 / 432) < 0.00001, 'body UV density stays constant, including partial repeats');
            }
        }
    });
}

test('older road textures and unrelated assets retain their current mapping', () => {
    assert.equal(resolveConnectorSplineTextureSlicing('facilityroad', { width: 320 }), undefined);
    assert.equal(resolveConnectorSplineTextureSlicing('dirtroad', layer), undefined);
    assert.equal(resolveConnectorSplineTextureSlicing('sandbaghalfspline', { width: 270 })?.tileBody, undefined);
});

test('published road retains native length-dependent UV scaling through the SDK renderer', () => {
    const row = published.assets.find(asset => asset.id === 'facilityroad')!;
    const { assets } = createFoxholeSceneV2AssetMetadata({ assets: [row] } as unknown as PublishedFoxholeManifestForSceneV2);
    const asset = assets.facilityroad!;
    const scale = asset.connector!.meshConfigs[0]!.materialScale!;
    assert.ok(Math.abs(scale[1]! - 0.002222) < 1e-9);
    const native = asset.renderLayers.span!.nativeSurface!;
    assert.ok(Math.abs(native.body.lengthCm - 450) < .001);
    assert.ok(Math.abs(native.verticalOffsetCm - 5) < .001);
    const nodes = renderFoxholeSceneV2SplineConnector({ foxholeKey: 'facilityroad',
        startX: 0, startY: 0, startRotation: 0, endX: 546.5, endY: -9, endRotation: 0,
        minLength: 288.32, maxLength: 960, minRadius: 160, maxRadius: 960,
        maxBuffer: 64, curveT: 0, blueprint: false }, asset);
    const span = nodes.find(node => node.id === 'spline-connector-span');
    assert.ok(span?.kind === 'mesh');
    assert.equal(span.textureAddressMode, 'repeat');
    assert.ok(span.positions.length/2 <= 2048);
    assert.ok(span.uvs.some(u => u > 1), 'native material UVs repeat independently');
    assert.doesNotThrow(() => parseNixieExtensionRenderPlanV1({ schemaVersion:1,root:{id:'road',kind:'group',children:nodes} }));
    for (const [endX,endY,endRotation] of [[960,0,0],[850.5,-377,-1.571]]) {
        const long = renderFoxholeSceneV2SplineConnector({foxholeKey:'facilityroad',startX:0,startY:0,startRotation:0,
            endX,endY,endRotation,minLength:288.32,maxLength:960,minRadius:160,maxRadius:960,maxBuffer:64,curveT:0,blueprint:false},asset);
        assert.doesNotThrow(() => parseNixieExtensionRenderPlanV1({schemaVersion:1,root:{id:'road',kind:'group',children:long}}));
    }
});
