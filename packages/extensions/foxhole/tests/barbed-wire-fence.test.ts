import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { sampleConnectorPath } from '../app/plugins/foxhole/nixie/pipe-connector-path.ts';
import { DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE, getFoxholeSplineConnectorConstraints } from '../app/plugins/foxhole/nixie/spline-connector.ts';
import { sampleBarbedWireFencePath, resolveBarbedWireFencePosts, isBarbedWireFence } from '../../../../extensions/foxhole-planner/src/barbed-wire-fence.ts';
import { isWaterWallSpline, resolveWaterWallBuoys } from '../../../../extensions/foxhole-planner/src/water-wall-spline.ts';

test('Native path and guide geometry use the same fence sections and adjustable bends', () => {
    const state = { ...DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE, foxholeKey: 'barbedwirewallspline',
        start: { x: 10, y: 20, rotation: 0 }, end: { x: 266, y: 116, rotation: Math.PI / 2 },
        minLength: 128, maxLength: 320, minRadius: 0.32, maxRadius: 0.32, maxBuffer: 128 };
    for (const curveT of [0, 0.5, 1]) {
        const constraints = getFoxholeSplineConnectorConstraints({ ...state, curveT }, 'spline');
        assert.equal(constraints.curveT, curveT);
        assert.deepEqual(sampleConnectorPath(state.start, state.end, constraints, 'spline', { foxholeKey: state.foxholeKey }),
            sampleBarbedWireFencePath(state.start, state.end, constraints));
    }
});

test('Native renders brace posts at bends and simple posts between them', () => {
    const file = new URL('../app/plugins/nixie/board/types/foxhole-spline-connector.ts', import.meta.url);
    const source = ts.createSourceFile('connector.ts', readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const nodeClass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'FoxholeSplineConnectorNode') as ts.ClassDeclaration;
    const method = nodeClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'syncWallMiddlePillars')!.getText(source);
    const code = ts.transpile(`class Methods { ${method} }; return Methods.prototype;`, { target: ts.ScriptTarget.ES2022 });
    const prototype = new Function('isBarbedWireFence', 'resolveBarbedWireFencePosts', 'isWaterWallSpline', 'resolveWaterWallBuoys',
        'getLayerById', 'resolveLandWallLayerMeshConfig', 'resolveCenteredMeshConfigIntervalBoundarySamples', code)(
        isBarbedWireFence, resolveBarbedWireFencePosts, isWaterWallSpline, resolveWaterWallBuoys,
        (layers: { id: string }[], id: string) => layers.find(layer => layer.id === id), () => undefined, () => []);
    const path = sampleBarbedWireFencePath({ x: 0, y: 0, rotation: 0 }, { x: 320, y: 0, rotation: 0 }, { curveT: 0 });
    const rendered: Array<{ layer: string; x: number; }> = [];
    const host = Object.assign(Object.create(prototype), {
        boardState: { foxholeKey: 'barbedwirewallspline' }, clearOverlay() {},
        getResolvedConnector: () => ({ meshConfigs: [{}, {}, { interval: 220 }] }),
        getSampledPath: () => path, createIntervalMarkerSprite: () => ({}),
        positionIntervalMarkerSprite: (_sprite: unknown, layer: { id: string }, _reference: unknown, marker: { x: number; meshIndex: number }) => {
            assert.equal(marker.meshIndex, 0);
            rendered.push({ layer: layer.id, x: marker.x });
        },
        wallMiddlePillarOverlay: { addChild() {} },
    });
    host.syncWallMiddlePillars([{ id: 'backtrim' }, { id: 'middlepillars' }], 1);
    assert.deepEqual(rendered.filter(post => post.layer === 'backtrim').map(post => post.x), [32, 288]);
    assert.equal(rendered.filter(post => post.layer === 'middlepillars').length, 3);
});
