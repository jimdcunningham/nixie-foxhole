import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFoxholeContactShadowCenter, resolveFoxholeContactShadowProjection, resolveFoxholeTextureSidecarUrl } from '../app/plugins/foxhole/nixie/contact-shadow.ts';

const metadata = { width: 71, height: 321, offsetX: -180.848, offsetY: 0,
    contactShadow: { profile: 'topdown-contact-v1', file: 'backwall.shadow.webp',
        width: 199, height: 449, offsetX: -180.848, offsetY: 0 } };

test('padded contact shadows retain the component world origin without double offsets', () => {
    const projection = resolveFoxholeContactShadowProjection('/assets/components/backwall/backwall.texture.webp?v=1', metadata)!;
    assert.equal(projection.textureUrl, '/assets/components/backwall/backwall.shadow.webp?v=1');
    assert.deepEqual(resolveFoxholeContactShadowCenter(projection, 0.5, 0.5), { x: 0, y: 0 });
    assert.deepEqual(resolveFoxholeContactShadowCenter(projection, 0, 0), { x: 35.5, y: 160.5 });
});

test('old or malformed sidecars do not add shadows or load unrelated URLs', () => {
    assert.equal(resolveFoxholeContactShadowProjection('/a.texture.webp', {}), null);
    assert.equal(resolveFoxholeContactShadowProjection('/a.texture.webp', { ...metadata, contactShadow: { ...metadata.contactShadow, file: '../b.shadow.webp' } }), null);
    assert.equal(resolveFoxholeContactShadowProjection('/a.texture.webp', { ...metadata, contactShadow: { ...metadata.contactShadow, width: NaN } }), null);
});

test('profile 16 shadows use the existing projection contract', () => {
    const projection = resolveFoxholeContactShadowProjection('/assets/backwall.texture.webp', {
        ...metadata, contactShadow: { ...metadata.contactShadow, profile: 'topdown-contact-v2' },
    });
    assert.equal(projection?.textureUrl, '/assets/backwall.shadow.webp');
    assert.equal(resolveFoxholeContactShadowProjection('/assets/backwall.texture.webp', {
        ...metadata, contactShadow: { ...metadata.contactShadow, profile: 'unknown-profile' },
    }), null);
});

test('faction, color and destroyed textures retain their own shadow projections', () => {
    for (const variant of ['', '.c', '.w', '.ffee22']) {
        assert.equal(resolveFoxholeTextureSidecarUrl(`/assets/tank.texture${variant}.webp?v=2`), `/assets/tank.texture${variant}.json?v=2`);
    }
    assert.equal(resolveFoxholeTextureSidecarUrl('/assets/tank.destroyed.texture.webp'), '/assets/tank.destroyed.texture.json');
    assert.equal(resolveFoxholeTextureSidecarUrl('/assets/icon.webp'), null);
});
