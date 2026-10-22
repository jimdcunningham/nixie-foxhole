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

test('rendering appearance controls default independently and read persisted local preferences',()=>{
 const defaults=readFoxholeMapSettings({},()=>undefined);
 assert.equal(defaults.softShadows,true);assert.equal(defaults.shadowStrength,'light');assert.equal(defaults.vegetationShadows,true);assert.equal(defaults.waterReflections,true);
 const values:Record<string,unknown>={[FOXHOLE_MAP_SETTING_KEYS.softShadows]:false,[FOXHOLE_MAP_SETTING_KEYS.shadowStrength]:'strong',[FOXHOLE_MAP_SETTING_KEYS.vegetationShadows]:false,[FOXHOLE_MAP_SETTING_KEYS.waterReflections]:false};
 const saved=readFoxholeMapSettings({},id=>values[id]);assert.equal(saved.softShadows,false);assert.equal(saved.shadowStrength,'strong');assert.equal(saved.vegetationShadows,false);assert.equal(saved.waterReflections,false);assert.equal(saved.shadowQuality,defaults.shadowQuality);
 for(const name of ['softShadows','shadowStrength','vegetationShadows','waterReflections'] as const)assert.equal(isFoxholeMapUserSettingKey(FOXHOLE_MAP_SETTING_KEYS[name]),true);
 assert.equal(readFoxholeMapSettings({},id=>id===FOXHOLE_MAP_SETTING_KEYS.shadowStrength?'invalid':undefined).shadowStrength,'light');
});
