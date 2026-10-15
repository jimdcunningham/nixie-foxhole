import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FOXHOLE_MAP_MOD_DIR,
    buildFoxholeMapRegionTextureKeyMap,
    getFoxholeMapModTexturePath,
} from '../app/plugins/foxhole/nixie/map/mod-store.ts';

test('getFoxholeMapModTexturePath builds Processed hex path', () => {
    assert.equal(
        getFoxholeMapModTexturePath('MapAbandonedWard'),
        `${FOXHOLE_MAP_MOD_DIR}MapAbandonedWard.png`,
    );
});

test('buildFoxholeMapRegionTextureKeyMap includes published regions', () => {
    const keys = buildFoxholeMapRegionTextureKeyMap();
    assert.ok(Object.keys(keys).length > 0);
    for (const [regionKey, textureKey] of Object.entries(keys)) {
        assert.equal(regionKey, regionKey.toLowerCase());
        assert.ok(textureKey.length > 0);
    }
});
