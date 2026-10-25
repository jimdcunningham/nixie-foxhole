import test from 'node:test';
import assert from 'node:assert/strict';
import {omitUnavailableSeatIcons} from './optional-seat-icons.mjs';
test('missing optional seat artwork is omitted while asset icons and valid artwork remain', async () => {
    const manifest={assets:[{icons:{default:'default.webp',rendered:'rendered.webp'},vehicleSeats:[{mc:{displayName:'Gunner',iconUrl:'missing.webp'}},{mc:{iconUrl:'valid.webp'}}]}]};
    assert.deepEqual(await omitUnavailableSeatIcons(manifest,url=>url==='valid.webp'),['missing.webp']);
    assert.deepEqual(manifest.assets[0].vehicleSeats[0].mc,{displayName:'Gunner'});
    assert.equal(manifest.assets[0].vehicleSeats[1].mc.iconUrl,'valid.webp');
    assert.deepEqual(manifest.assets[0].icons,{default:'default.webp',rendered:'rendered.webp'});
});
