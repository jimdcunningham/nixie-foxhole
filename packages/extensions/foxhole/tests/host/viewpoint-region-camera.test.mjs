import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveViewpointRegionCamera, consumeViewpointRegionCamera } from '../../app/plugins/foxhole/nixie/map/viewpoint-region-camera.mjs';
test('restoring a viewpoint suppresses only its selected-region fit on its own runtime', () => {
    const runtime = {}, other = {};
    preserveViewpointRegionCamera(runtime, 'TerminusHex, DeadLandsHex');
    assert.equal(consumeViewpointRegionCamera(other, 'DeadLandsHex|TerminusHex'), false);
    assert.equal(consumeViewpointRegionCamera(runtime, 'DeadLandsHex|TerminusHex'), true);
    assert.equal(consumeViewpointRegionCamera(runtime, 'DeadLandsHex|TerminusHex'), false);
    preserveViewpointRegionCamera(runtime, 'TerminusHex');
    assert.equal(consumeViewpointRegionCamera(runtime, 'HeartlandsHex'), false);
    assert.equal(consumeViewpointRegionCamera(runtime, 'TerminusHex'), false);
});
