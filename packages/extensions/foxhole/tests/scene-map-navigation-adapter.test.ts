import assert from 'node:assert/strict';
import test from 'node:test';
import { focusFoxholeSceneV2MapEntry } from '../app/plugins/foxhole/nixie/scene-map-navigation-adapter.ts';
import { getFoxholeMapSearchCameraTarget, type FoxholeMapSearchEntry } from '../app/plugins/foxhole/nixie/map/search.ts';

test('War map navigation uses the active ECS camera with the existing search framing', () => {
    const entry: FoxholeMapSearchEntry = { id: 'town', type: 'town', label: 'Town', regionKey: 'test', regionLabel: 'Test', searchLabel: 'Town', worldPosition: { x: 123, y: -456 } };
    const target = getFoxholeMapSearchCameraTarget(entry, { screenWidth: 1000, screenHeight: 600 });
    let restored: unknown;
    assert.equal(focusFoxholeSceneV2MapEntry({
        captureFrame: () => ({ x: 0, y: 0, worldWidth: 500, worldHeight: 300 }),
        getZoomScale: () => 2,
        restoreFrame: frame => { restored = frame; return true; },
    }, entry), true);
    assert.deepEqual(restored, { x: 123, y: -456, worldWidth: 1000 / target.scale, worldHeight: 600 / target.scale });
    assert.equal(focusFoxholeSceneV2MapEntry({ captureFrame: () => null, getZoomScale: () => null, restoreFrame: () => { throw new Error('Canvas is not ready'); } }, entry), false);
});
