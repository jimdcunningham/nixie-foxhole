import assert from 'node:assert/strict';
import test from 'node:test';
import published from '../../../packages/extensions/foxhole/public/foxhole/assets/manifest.v1.json' with { type: 'json' };
import { createFoxholeAssetIdentityResolver } from '../src/catalog-identity.ts';

test('published canonical IDs, codenames and legacy keys resolve to one SDK asset identity', () => {
    const resolve = createFoxholeAssetIdentityResolver(published.assets);
    for (const asset of published.assets) {
        assert.equal(resolve(asset.id), asset.id);
        assert.equal(resolve(asset.id.toUpperCase()), asset.id);
        for (const alias of [asset.codeName, asset.legacyKey].filter(Boolean)) {
            assert.equal(resolve(alias), asset.id, `${asset.id}: ${alias}`);
        }
    }
    assert.equal(resolve('worldroad'), 'greatmarchroad');
    assert.equal(resolve('emplacedaircraftc'), 'emplacedaac');
    assert.equal(resolve('emplacedaircraftw'), 'emplacedaaw');
    assert.equal(resolve('missing-extension-asset'), null);
});

test('colliding historical aliases stay unresolved while exact canonical IDs remain authoritative', () => {
    const resolve = createFoxholeAssetIdentityResolver([{ id: 'one', legacyKey: 'shared' },
        { id: 'two', legacyKey: 'shared', codeName: 'one' }]);
    assert.equal(resolve('shared'), null);
    assert.equal(resolve('one'), 'one');
    assert.equal(resolve({}), null);
});
