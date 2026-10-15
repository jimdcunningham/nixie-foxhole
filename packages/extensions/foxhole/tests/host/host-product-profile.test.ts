import assert from 'node:assert/strict';
import test from 'node:test';
import { registerFoxholeHostProductProfile } from '../../app/utils/host-product-profile.ts';
import { resolveNixieStudioAcquisitionAttribution, parseStoredNixieStudioAcquisitionAttribution } from '#nixie/utils/nixie-studio-activation.ts';
import { getNixiePublicUsernameError } from '#nixie/utils/nixie-public-username.ts';
import { isNxSiteSitemapPath } from '#nixie/utils/nx-site-public-paths.ts';
test('the bundled product retains attribution, reserved identities and its public route', () => {
    registerFoxholeHostProductProfile();
    for (const input of [{ pathname: '/foxhole-planner' }, { search: '?utm_source=foxhole-planner' }]) assert.deepEqual(resolveNixieStudioAcquisitionAttribution(input), { source: 'foxhole', detail: 'foxhole-planner' });
    assert.deepEqual(resolveNixieStudioAcquisitionAttribution({ referrer: 'https://nixie.foxholeplanner.com/editor', currentOrigin: 'https://nixiejs.com' }), { source: 'foxhole', detail: 'nixie.foxholeplanner.com' });
    assert.deepEqual(parseStoredNixieStudioAcquisitionAttribution({ source: 'foxhole', detail: 'old-campaign' }), { source: 'foxhole', detail: 'old-campaign' });
    for (const name of ['foxhole', 'foxholeplanner', 'foxwatch']) assert.equal(getNixiePublicUsernameError(name), 'That username is reserved.');
    assert.equal(isNxSiteSitemapPath('/foxhole-planner'), true);
});
