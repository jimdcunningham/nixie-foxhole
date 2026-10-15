import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import { resolveConnectorSplineTextureSlicing } from '../app/plugins/foxhole/nixie/spline-ribbon-mesh.ts';
import { getFoxholeStructureAsset } from '../app/plugins/foxhole/nixie/catalog.ts';
import { buildNativeSplineSurfaceMeshData } from '../../../../extensions/foxhole-planner/src/native-spline-surface.ts';

test('the active planner retains native geometry and independently repeating road material', () => {
    const road = getFoxholeManifest('/foxhole/assets/').assets.find(asset => asset.id === 'facilityroad')!;
    const scale = road.connector!.meshConfigs![0]!.splineMaterialScaling!;
    assert.ok(Math.abs(scale[1]! - 0.002222) < 1e-9);
    const span = road.renderLayers!.find(layer => layer.id === 'span')!;
    assert.equal(resolveConnectorSplineTextureSlicing('facilityroad',span,scale),undefined);
    assert.ok(Math.abs(span.nativeSurface!.body.lengthCm-450)<.001);
    const catalog = getFoxholeStructureAsset('facilityroad','/foxhole/assets/')!;
    const layer = Object.values(catalog.renderLayers ?? {}).find(layer => layer.id==='span')!;
    assert.deepEqual(layer.nativeSurface,span.nativeSurface);
    const mesh = buildNativeSplineSurfaceMeshData(layer.nativeSurface!,{ points:[{x:0,y:0},{x:960,y:0}],lengths:[0,960],totalLength:960 },scale)!;
    assert.ok(mesh.positions.length/2<=2048);
});
