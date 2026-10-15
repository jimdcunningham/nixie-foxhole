import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    resolveFoxholeMapFitCamera,
    shouldFitFoxholeMapOnEnable,
} from '../app/plugins/foxhole/nixie/map/camera-fit.ts';

const mapController = readFileSync(new URL('../app/plugins/foxhole/nixie/map/controller.ts', import.meta.url), 'utf8');

test('map enable requests an initial fit only for an empty scene', () => {
    assert.equal(shouldFitFoxholeMapOnEnable(false, true, 0), true);
    assert.equal(shouldFitFoxholeMapOnEnable(false, true, 1), false);
    assert.equal(shouldFitFoxholeMapOnEnable(true, true, 0), false);
    assert.equal(shouldFitFoxholeMapOnEnable(true, false, 0), false);
});

test('initial map fit centers and scales the full active bounds with padding', () => {
    assert.deepEqual(resolveFoxholeMapFitCamera({
        left: -1_000,
        right: 1_000,
        top: -500,
        bottom: 500,
        width: 2_000,
        height: 1_000,
    }, {
        width: 1_200,
        height: 800,
    }), {
        position: { x: 0, y: 0 },
        scale: 0.504,
    });
});

test('map viewport applies the empty-scene fit before renderer initialization', () => {
    assert.match(mapController, /shouldFitFoxholeMapOnEnable\(previousSettings\.enabled, settings\.enabled, sceneNodeCount\)/);
    assert.match(
        mapController,
        /this\.fitMapOnNextSync = true;\s*this\.refreshViewportConstraints\(true\);\s*this\.fitMapToBoundsIfPending\(settings\);[\s\S]*?void this\.syncRenderer\(\)/,
    );
    assert.match(
        mapController,
        /this\.pluginContext\.session\.cameraTo\(\{[\s\S]*?position: camera\.position,[\s\S]*?scale: camera\.scale,[\s\S]*?time: 0/,
    );
});
