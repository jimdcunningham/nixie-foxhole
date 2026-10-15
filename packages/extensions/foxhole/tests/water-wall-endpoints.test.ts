import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import { normalizeFoxholeSplineConnectorState, resolveEffectiveConnectorPathStyle } from '../app/plugins/foxhole/nixie/spline-connector.ts';
import { getFoxholeSplineLocalEditableHandles } from '../app/plugins/foxhole/nixie/spline-connector-handles.ts';
import { resolveFoxholeSplineGuidePath, resolveFoxholeSplinePathConstraints } from '../app/plugins/foxhole/nixie/spline-connector-guides.ts';
import { getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { resolveConnectorSpanInsets, resolveConnectorSpanTextureMapping } from '../app/plugins/foxhole/nixie/pipe-connector-path.ts';
import { buildSplineRibbonMeshData } from '../app/plugins/foxhole/nixie/spline-ribbon-mesh.ts';
import { resolveWaterWallBuoys, resolveWaterWallNetInsets } from '../../../../extensions/foxhole-planner/src/water-wall-spline.ts';

test('water walls ignore saved tangents and expose only two editable endpoints', () => {
    const asset = getFoxholeManifest('/foxhole/assets/').assets.find(asset => asset.id === 'waterwallsplinet1')!;
    const style = resolveEffectiveConnectorPathStyle(asset.connector?.pathStyle, asset.id);
    const state = normalizeFoxholeSplineConnectorState({
        foxholeKey: asset.id,
        start: { x: 20, y: 30, rotation: Math.PI / 2, handleLength: 200 },
        end: { x: 340, y: 150, rotation: -Math.PI / 2, handleLength: 200 },
    });
    assert.deepEqual(resolveFoxholeSplineGuidePath(state, resolveFoxholeSplinePathConstraints(state, style), style).points,
        [{ x: 20, y: 30 }, { x: 340, y: 150 }]);
    assert.deepEqual(getFoxholeSplineLocalEditableHandles(state, style).map(handle => handle.id), ['start', 'end']);
});

test('native water wall netting reaches both physical endpoints at partial and exact intervals', () => {
    const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
    const structure = catalog.structureByKey.waterwallsplinet1!;
    const asset = catalog.assetByKey.waterwallsplinet1!;
    const span = asset.renderLayers.find(layer => layer.id === 'span')!;
    const style = resolveEffectiveConnectorPathStyle(structure.connector?.pathStyle, structure.id);
    const insets = resolveConnectorSpanInsets(style, structure.connector, undefined, undefined, { foxholeKey: structure.id });
    assert.deepEqual(insets, { startInset: 0, endInset: 0 });
    for (const length of [159, 160, 319, 320, 530, 640]) {
        const state = normalizeFoxholeSplineConnectorState({ foxholeKey: structure.id, end: { x: length, y: 0, rotation: 0 } });
        const constraints = resolveFoxholeSplinePathConstraints(state, style);
        const net = buildSplineRibbonMeshData({ spanLayer: span,
            ...resolveWaterWallNetInsets(state.start, state.end, structure.connector?.meshConfigs[1]),
            textureMapping: resolveConnectorSpanTextureMapping(span, structure.connector, span.width, style, { foxholeKey: structure.id }),
            pathSample: resolveFoxholeSplineGuidePath(state, constraints, style),
        }, state.start, state.end, constraints);
        assert.ok(net);
        assert.equal(Math.min(...net.positions.filter((_, index) => index % 2 === 0)), 0);
        assert.equal(Math.max(...net.positions.filter((_, index) => index % 2 === 0)), length);
        const buoys = resolveWaterWallBuoys(state.start, state.end, structure.connector?.meshConfigs[1]);
        assert.equal(buoys[0]!.x, 0);
        assert.equal(buoys.at(-1)!.x, length);
        assert.ok(buoys.length <= 5);
        assert.equal(buoys.filter(buoy => buoy.x === length).length, 1);
        assert.ok(buoys.slice(1, -1).every((buoy, i) => buoy.x === (i + 1) * 160));
    }
});

test('native partial-span regression reaches the observed snapped front handle without changing geometry', () => {
    const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
    const structure = catalog.structureByKey.waterwallsplinet1!;
    const span = catalog.assetByKey.waterwallsplinet1!.renderLayers.find(layer => layer.id === 'span')!;
    const style = resolveEffectiveConnectorPathStyle(structure.connector?.pathStyle, structure.id);
    const state = normalizeFoxholeSplineConnectorState({ foxholeKey: structure.id, start: { x: 0, y: 0, rotation: 0 },
        end: { x: 231.5, y: 33, rotation: 0 } });
    const saved = structuredClone(state);
    const buoys = resolveWaterWallBuoys(state.start, state.end, structure.connector?.meshConfigs[1]);
    assert.equal(buoys.length, 3);
    assert.deepEqual({ x: 840 + buoys.at(-1)!.x * 2, y: 669 + buoys.at(-1)!.y * 2 }, { x: 1303, y: 735 });
    const constraints = resolveFoxholeSplinePathConstraints(state, style);
    const net = buildSplineRibbonMeshData({ spanLayer: span,
        ...resolveWaterWallNetInsets(state.start, state.end, structure.connector?.meshConfigs[1]),
        textureMapping: resolveConnectorSpanTextureMapping(span, structure.connector, span.width, style, { foxholeKey: structure.id }),
        pathSample: resolveFoxholeSplineGuidePath(state, constraints, style),
    }, state.start, state.end, constraints);
    assert.ok(net);
    const length = Math.hypot(state.end.x, state.end.y);
    const projected = net.positions.filter((_, i) => i % 2 === 0)
        .map((x, i) => (x * state.end.x + net.positions[i * 2 + 1]! * state.end.y) / length);
    assert.ok(Math.abs(Math.max(...projected) - length) < 1e-5);
    assert.deepEqual(state, saved);
});
