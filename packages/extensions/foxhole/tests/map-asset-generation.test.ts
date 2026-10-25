import assert from 'node:assert/strict';
import test from 'node:test';
import {computed} from 'vue';
import {installFoxholeMapData, getFoxholeMapDataRevision, buildFoxholePublishedMapFallbackCache} from '../app/plugins/foxhole/nixie/map/data.ts';
import {FOXHOLE_MAP_REGIONS, FOXHOLE_MAP_ICONS, resolveFoxholeMapIconUrl} from '../app/plugins/foxhole/nixie/map/constants.ts';
import {installFoxholeAssetLocations} from '../app/plugins/foxhole/nixie/asset-locations.ts';
function fixture(version: string) {
    return {schemaVersion:'1.0.0',source:{kind:'fixture'},
        maps:{FixtureHex:{name:'Region '+version,textureKey:'Map'+version,gridCoord:{x:1,y:2},static:{icons:[]}}},
        mapIcons:{one:{name:'Icon '+version,icon:'MapIcon'+version,category:'structures',key:'hospital'}},
        warApiFallback:{maps:{FixtureHex:{labels:{version:1,items:[{text:version,x:0,y:0}]}}}}};
}
test('map metadata, reactive picker indexes and tooltip URLs follow A/B/back from the selected catalog', () => {
    const initial=FOXHOLE_MAP_REGIONS.length, icons=FOXHOLE_MAP_ICONS;
    const names=computed(()=>FOXHOLE_MAP_REGIONS.map(region=>region.name).join('|'));
    installFoxholeAssetLocations(path=>'https://assets.example/foxhole-planner/objects/'+path);
    try {
        const first=getFoxholeMapDataRevision();
        for (const version of ['a','b','a']) {
            installFoxholeMapData(fixture(version));
            assert.equal(names.value,'Region '+version);
            assert.equal(FOXHOLE_MAP_REGIONS[0]!.textureKey,'Map'+version);
            assert.equal(icons,FOXHOLE_MAP_ICONS);
            assert.equal(icons.one!.name,'Icon '+version);
            assert.equal(resolveFoxholeMapIconUrl('/foxhole/assets/',icons.one!),
                'https://assets.example/foxhole-planner/objects/maps/MapIcons/MapIcon'+version+'.webp');
            assert.equal(buildFoxholePublishedMapFallbackCache().FixtureHex!.labels!.items[0]!.text,version);
        }
        assert.equal(getFoxholeMapDataRevision(),first+3);
        assert.throws(()=>installFoxholeMapData({...fixture('broken'),maps:[]}),/map inventory/);
        assert.equal(names.value,'Region a');
    } finally {installFoxholeMapData(null);installFoxholeAssetLocations(null);}
    assert.equal(FOXHOLE_MAP_REGIONS.length,initial);
    assert.equal(resolveFoxholeMapIconUrl('/local/',{iconName:'MapIcon'}),'/local/maps/MapIcons/MapIcon.webp');
    assert.equal(resolveFoxholeMapIconUrl('/local/',{iconName:''}),null);
});
