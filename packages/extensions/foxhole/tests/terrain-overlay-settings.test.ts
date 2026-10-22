import test from 'node:test';
import assert from 'node:assert/strict';
import {FOXHOLE_MAP_SETTING_KEYS,readFoxholeMapSettings,isFoxholeMapUserSettingKey} from '../app/plugins/foxhole/nixie/map-settings.ts';

test('terrain overlays default off and stay independent of raster RDZ and asset visibility',()=>{
 const defaults=readFoxholeMapSettings({},()=>undefined);
 assert.equal(defaults.terrainRdz,false);assert.equal(defaults.terrainTopo,false);
 for(const key of ['terrainRdz','terrainTopo'] as const)assert.equal(isFoxholeMapUserSettingKey(FOXHOLE_MAP_SETTING_KEYS[key]),true);
 const values:Record<string,unknown>={[FOXHOLE_MAP_SETTING_KEYS.terrainRdz]:true,[FOXHOLE_MAP_SETTING_KEYS.terrainTopo]:true};
 const on=readFoxholeMapSettings({},id=>values[id]);assert.equal(on.terrainRdz,true);assert.equal(on.terrainTopo,true);assert.equal(on.rdz,false);assert.deepEqual(on.worldLayers,defaults.worldLayers);
 const legacy=readFoxholeMapSettings({},id=>id===FOXHOLE_MAP_SETTING_KEYS.rdz?true:undefined);assert.equal(legacy.rdz,true);assert.equal(legacy.terrainRdz,false);
});
