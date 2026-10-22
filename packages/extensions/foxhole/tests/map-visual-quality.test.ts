import assert from 'node:assert/strict';
import test from 'node:test';
import {FOXHOLE_MAP_SETTING_KEYS,foxholeMapUserSettings,readFoxholeMapSettings} from '../app/plugins/foxhole/nixie/map-settings.ts';
test('visual quality defaults preserve the existing appearance and stay local',()=>{
 const defaults=readFoxholeMapSettings({});assert.equal(defaults.ambientOcclusion,true);assert.equal(defaults.vegetationDensity,'full');assert.equal(defaults.shadowQuality,'medium');
 for(const name of ['ambientOcclusion','vegetationDensity','shadowQuality'] as const){const def=foxholeMapUserSettings.find(s=>s.id===FOXHOLE_MAP_SETTING_KEYS[name])!;assert.equal(def.scope,'user');assert.equal(def.persist,'local');}
});
test('quality values validate and local choices override legacy data independently',()=>{
 const keys=FOXHOLE_MAP_SETTING_KEYS;
 for(const value of ['off','low','medium','high'])assert.equal(readFoxholeMapSettings({},id=>id===keys.shadowQuality?value:undefined).shadowQuality,value);
 for(const value of ['full','reduced','minimal'])assert.equal(readFoxholeMapSettings({},id=>id===keys.vegetationDensity?value:undefined).vegetationDensity,value);
 const invalid=readFoxholeMapSettings({},()=> 'bogus');assert.equal(invalid.shadowQuality,'medium');assert.equal(invalid.vegetationDensity,'full');assert.equal(invalid.ambientOcclusion,true);
 const local=readFoxholeMapSettings({[keys.shadowQuality]:'high',[keys.vegetationDensity]:'minimal',[keys.ambientOcclusion]:true},id=>id===keys.shadowQuality?'off':id===keys.vegetationDensity?'reduced':id===keys.ambientOcclusion?false:undefined);
 assert.equal(local.shadowQuality,'off');assert.equal(local.vegetationDensity,'reduced');assert.equal(local.ambientOcclusion,false);assert.equal(local.modelLod,false);assert.equal(local.terrainLod,false);assert.equal(local.adaptiveStreaming,false);
});
