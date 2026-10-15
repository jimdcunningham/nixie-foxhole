import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { resolveFoxholeSplinePathConstraints } from '../app/plugins/foxhole/nixie/spline-connector-guides.ts';
import { normalizeFoxholeSplineConnectorState } from '../app/plugins/foxhole/nixie/spline-connector.ts';
import { sampleConnectorPath } from '../app/plugins/foxhole/nixie/pipe-connector-path.ts';
import { REFERENCE_ROAD_SPLINE_KEYS, isWorldRoadEditCandidateValid } from '../app/plugins/foxhole/nixie/world-road-edit-validity.ts';
import { buildSplineRibbonMeshData } from '../../../../extensions/foxhole-planner/src/spline-ribbon-mesh.ts';

export const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
export const captured = JSON.parse(readFileSync(new URL('./fixtures/world-road-exact-bend.json', import.meta.url), 'utf8'));

function input(key: string, rotation: number, length = 160) {
    const state = normalizeFoxholeSplineConnectorState({ ...captured.before.state, foxholeKey: key,
        end: { x: length, y: 0, rotation } });
    const spanLayer = catalog.assetByKey[key]!.renderLayers.find(layer => layer.id === 'span')!;
    const constraints = resolveFoxholeSplinePathConstraints(state, 'spline');
    return { state, constraints, options: { spanLayer,
        pathSample: sampleConnectorPath(state.start, state.end, constraints, 'spline', { foxholeKey: key }) } };
}

test('all seven published road widths and offsets retain their native frames', () => {
    const frames = [...REFERENCE_ROAD_SPLINE_KEYS].map(key => {
        const layer = catalog.assetByKey[key]!.renderLayers.find(layer => layer.id === 'span')!;
        return [key, layer.width, layer.height, layer.offsetY];
    });
    assert.deepEqual(frames, [
        ['dirtroad', 640, 727, 5.149], ['gravelroad', 640, 727, 5.149],
        ['greatmarchroad', 512, 855, -0.006], ['packeddirtroad', 640, 727, 5.149],
        ['snowdirtroad', 640, 727, 5.149], ['snowgravelroad', 640, 727, 5.149],
        ['snowpackeddirtroad', 640, 727, 5.149],
    ]);
});

test('rejects the exact captured UI bend, whose original straight state remains valid', () => {
    assert.equal(captured.after.id, 'foxhole-spline-connector-15abf827-2b23-4d3e-8a6c-4066053a3600');
    assert.equal(captured.after.state.end.rotation, -1.047);
    for (const node of [captured.before, captured.after]) {
        const state = normalizeFoxholeSplineConnectorState(node.state);
        const spanLayer = catalog.assetByKey.greatmarchroad!.renderLayers[0]!;
        const constraints = resolveFoxholeSplinePathConstraints(state, 'spline');
        const before = JSON.stringify({ state, spanLayer, constraints });
        assert.equal(isWorldRoadEditCandidateValid('greatmarchroad', { spanLayer }, state.start, state.end, constraints), node === captured.before);
        assert.equal(JSON.stringify({ state, spanLayer, constraints }), before, 'validation never changes native art or saved state');
    }
});

test('rejects full-width folds even when the centerline exceeds the authored 5m radius', () => {
    for (const key of REFERENCE_ROAD_SPLINE_KEYS) {
        for (const rotation of [Math.PI / 12, -Math.PI / 12, Math.PI / 6]) {
            const { state, constraints, options } = input(key, rotation);
            assert.equal(isWorldRoadEditCandidateValid(key, options, state.start, state.end, constraints), false, key);
            const mesh = buildSplineRibbonMeshData(options, state.start, state.end, constraints)!;
            assert(mesh.positions.length > 0, 'the rejected path was otherwise renderable');
        }
    }
});

test('accepts unchanged straight and gentle long bends, including mirrored and wrapped rotations', () => {
    for (const key of REFERENCE_ROAD_SPLINE_KEYS) {
        for (const [rotation, length] of [[0, 160], [Math.PI / 12, 800], [-Math.PI / 12, 800], [Math.PI * 2, 800]]) {
            const { state, constraints, options } = input(key, rotation!, length);
            const before = buildSplineRibbonMeshData(options, state.start, state.end, constraints)!;
            assert.equal(isWorldRoadEditCandidateValid(key, options, state.start, state.end, constraints), true, `${key}:${rotation}`);
            assert.deepEqual(buildSplineRibbonMeshData(options, state.start, state.end, constraints), before);
        }
    }
});

test('rejects a nonlocal ribbon loop and missing/nonfinite road geometry without changing other connectors', () => {
    const { state, constraints, options } = input('greatmarchroad', 0, 800);
    const points = Array.from({ length: 4097 }, (_, i) => ({
        x: Math.cos(i / 4096 * Math.PI * 2.2) * 300, y: Math.sin(i / 4096 * Math.PI * 2.2) * 300,
    }));
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths.at(-1)! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
    const loop = { ...options, pathSample: { points, lengths, totalLength: lengths.at(-1)! } };
    const mesh = buildSplineRibbonMeshData(loop, state.start, state.end, constraints)!;
    for (let i = 0; i < mesh.indices.length; i += 3) {
        const [a, b, c] = [...mesh.indices.slice(i, i + 3)].map(index => ({ x: mesh.positions[index * 2]!, y: mesh.positions[index * 2 + 1]! }));
        assert((b!.x - a!.x) * (c!.y - a!.y) - (b!.y - a!.y) * (c!.x - a!.x) >= 0,
            'the nonlocal crossing is not a local triangle inversion');
    }
    assert.equal(isWorldRoadEditCandidateValid('greatmarchroad', loop, state.start, state.end, constraints), false);
    assert.equal(isWorldRoadEditCandidateValid('greatmarchroad', undefined, state.start, state.end, constraints), false);
    assert.equal(isWorldRoadEditCandidateValid('greatmarchroad', options, state.start, { ...state.end, rotation: NaN }, constraints), false);
    assert.equal(isWorldRoadEditCandidateValid('greatmarchroad', { ...loop,
        pathSample: { ...loop.pathSample, totalLength: Infinity } }, state.start, state.end, constraints), false);
    for (const key of ['facilitypipe', 'railtrackspline', 'trencht1', 'provisionalroad', 'some-road']) {
        assert.equal(isWorldRoadEditCandidateValid(key, undefined, state.start, state.end, constraints), true);
    }
    assert.equal(catalog.assetByKey.worldroad, catalog.assetByKey.greatmarchroad, 'legacy alias resolves the same guarded identity');
});
