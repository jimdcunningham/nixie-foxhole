import assert from 'node:assert/strict';
import test from 'node:test';
import {
    resolveIntervalMarkerSpritePosition,
    resolveMineSplineMarkerSample,
} from '../app/plugins/foxhole/nixie/interval-connector-path.ts';
import { centimetersToFoxholeBoardPixels } from '../app/plugins/foxhole/nixie/spline-connector.ts';
import type { FoxholeStructureRenderLayerAsset } from '../app/plugins/foxhole/nixie/catalog.ts';

const tankStopSpanLayer: FoxholeStructureRenderLayerAsset = {
    id: 'span',
    textureUrl: '',
    width: 101,
    height: 144,
    anchorX: 0.5,
    anchorY: 0.626,
    offsetX: -0.01,
    offsetY: -18.108,
};

const tankStopSpanAltLayer: FoxholeStructureRenderLayerAsset = {
    id: 'spanalt',
    textureUrl: '',
    width: 101,
    height: 144,
    anchorX: -1.894,
    anchorY: 0.611,
    offsetX: 241.807,
    offsetY: -15.954,
};

const tankStopConnector = {
    pathStyle: 'interval',
    meshConfigs: [{
        mode: 'interval',
        interval: 375,
        nativeMeshLengthCm: 206.242,
    }],
};

const mineSpanLayer: FoxholeStructureRenderLayerAsset = {
    id: 'span',
    textureUrl: '',
    width: 372,
    height: 114,
    anchorX: 0.15,
    anchorY: -0.099,
    offsetX: 130.218,
    offsetY: 68.281,
};

const mineSpanAltLayer: FoxholeStructureRenderLayerAsset = {
    id: 'spanalt',
    textureUrl: '',
    width: 298,
    height: 19,
    anchorX: 0.062,
    anchorY: -2.874,
    offsetX: 130.665,
    offsetY: 64.105,
};

test('interval marker sprites center on spline samples', () => {
    const placement = resolveIntervalMarkerSpritePosition(
        { x: 40, y: 64, rotation: 0, meshIndex: 0 },
        tankStopSpanLayer,
        tankStopSpanLayer,
        tankStopConnector,
    );
    assert.equal(placement.x, 40);
    assert.equal(placement.y, 64);
});

test('alternating tank stop spanalt layers stay on their spline samples', () => {
    const intervalPx = centimetersToFoxholeBoardPixels(375);
    const placement = resolveIntervalMarkerSpritePosition(
        { x: 40 + intervalPx, y: 64, rotation: 0, meshIndex: 1 },
        tankStopSpanAltLayer,
        tankStopSpanLayer,
        tankStopConnector,
    );
    assert.equal(placement.x, 40 + intervalPx);
    assert.equal(placement.y, 64);
});

test('mine spline markers alternate across the path using extracted side offsets', () => {
    const config = { relativeLocation: [0, 100, -10] } as never;
    const first = resolveMineSplineMarkerSample(
        { x: 80, y: 20, rotation: 0, meshIndex: 0 },
        config,
        0,
    );
    const second = resolveMineSplineMarkerSample(
        { x: 112, y: 20, rotation: 0, meshIndex: 0 },
        config,
        1,
    );

    assert.deepEqual({ x: first.x, y: first.y }, { x: 80, y: 52 });
    assert.deepEqual({ x: second.x, y: second.y }, { x: 112, y: -12 });
    assert.notEqual(first.rotation, second.rotation);
});

test('mine spline component layers share a marker transform', () => {
    const marker = { x: 80, y: 20, rotation: Math.PI / 2, meshIndex: 0 };
    const rotationSeed = 1_234_567;
    const mine = resolveMineSplineMarkerSample(marker, { relativeLocation: [0, 100, -10] } as never, 2, rotationSeed);
    const crater = resolveMineSplineMarkerSample(marker, { relativeLocation: [0, 100, 0] } as never, 2, rotationSeed);

    assert.equal(mine.x, crater.x);
    assert.equal(mine.y, crater.y);
    assert.equal(mine.rotation, crater.rotation);
});

test('mine spline rotation seed gives each runtime entity a stable pattern', () => {
    const marker = { x: 80, y: 20, rotation: 0, meshIndex: 0 };
    const config = { relativeLocation: [0, 100, -10] } as never;
    const firstEntity = resolveMineSplineMarkerSample(marker, config, 3, 123);
    const sameEntity = resolveMineSplineMarkerSample(marker, config, 3, 123);
    const secondEntity = resolveMineSplineMarkerSample(marker, config, 3, 456);

    assert.equal(firstEntity.rotation, sameEntity.rotation);
    assert.notEqual(firstEntity.rotation, secondEntity.rotation);
});

test('mine spline marker rotations do not repeat a fixed angular sequence', () => {
    const marker = { x: 80, y: 20, rotation: 0, meshIndex: 0 };
    const config = { relativeLocation: [0, 100, -10] } as never;
    const rotations = Array.from({ length: 6 }, (_, markerIndex) => (
        resolveMineSplineMarkerSample(marker, config, markerIndex, 123).rotation
    ));
    const angularSteps = rotations.slice(1).map((rotation, index) => rotation - rotations[index]!);

    assert.ok(new Set(angularSteps.map(step => step.toFixed(8))).size > 1);
});
