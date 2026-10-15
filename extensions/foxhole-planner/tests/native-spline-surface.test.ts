import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNativeSplineSurfaceMeshData, readNativeSplineSurface } from '../src/native-spline-surface.ts';
import type { NativeSplineSurface } from '../src/native-spline-surface.ts';
import { buildSplineRibbonMeshData, resolveConnectorSplineTextureSlicing } from '../src/spline-ribbon-mesh.ts';

// Three native body rings: a wider middle, without a constant-width mask.
const mesh = () => ({ lengthCm: 450,
    positions: [0,-100,10, 0,100,10, 225,-150,10, 225,150,10, 450,-100,10, 450,100,10],
    uvs: [0,0, 0,1, .5,0, .5,1, 1,0, 1,1], indices: [0,1,2,1,3,2,2,3,4,3,5,4] });
const surface: NativeSplineSurface = { version: 1, verticalOffsetCm: 5, groundHeightCm: 0, body: mesh() };
const path = (length: number) => ({ points: [{ x: 0, y: 0 }, { x: length, y: 0 }], lengths: [0, length], totalLength: length });

for (const length of [288.32,432,546.5,960]) {
    test(`road stretches one varying body end to end at ${length}px`, () => {
        const before = JSON.stringify(surface);
        const data = buildNativeSplineSurfaceMeshData(surface, path(length), [0,.002222])!;
        assert.ok(data);
        assert.ok(data.positions.length / 2 <= 2048);
        assert.ok([...data.positions, ...data.uvs].every(Number.isFinite));
        const rows = Array.from({ length: data.positions.length / 2 }, (_, i) => ({ x: data.positions[i*2]!, y: data.positions[i*2+1]!, u: data.uvs[i*2]! }));
        assert.ok(Math.abs(Math.min(...rows.map(v => v.x))) < .001, 'no cap inset at start');
        assert.ok(Math.abs(Math.max(...rows.map(v => v.x))-length) < .001, 'no cap inset at end');
        const body = rows;
        const middle = body.filter(v => Math.abs(v.x-length/2) < .001);
        assert.ok(middle.some(v => Math.abs(v.y-48) < .001), 'native wider middle retained once');
        assert.ok(body.every(v => Math.abs(v.u - v.x/.32*.002222) < 1e-5), 'material scales independently through the whole body');
        assert.equal(JSON.stringify(surface),before,'source native vertices and UVs remain immutable');
    });
}

test('native surface uses repeating material rather than the legacy three-panel crop', () => {
    const layer = { width:864,height:410,nativeSurface:surface };
    assert.equal(resolveConnectorSplineTextureSlicing('facilityroad',layer),undefined);
    const data = buildSplineRibbonMeshData({ spanLayer:layer,pathSample:path(432),textureMaterialScale:[0,.002222] },
        { x:0,y:0,rotation:0 },{ x:432,y:0,rotation:0 },{ minLength:288.32,maxLength:960 });
    assert.deepEqual(data,buildNativeSplineSurfaceMeshData(surface,path(432),[0,.002222]));
});

test('native surface parsing rejects malformed geometry and UVs', () => {
    assert.equal(readNativeSplineSurface(surface),surface);
    for (const value of [null,{}, { ...surface,version:2 }, { ...surface,body:{ ...surface.body,indices:[0,1,999] } },
        { ...surface,body:{ ...surface.body,positions:[NaN,0,0] } }]) assert.equal(readNativeSplineSurface(value),undefined);
});
