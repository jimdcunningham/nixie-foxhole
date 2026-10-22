import assert from 'node:assert/strict';
import test from 'node:test';
import {FOXHOLE_WORLD_LAYER_DEFINITIONS,foxholeMapUserSettings,isFoxholeMapUserSettingKey,readFoxholeMapSettings} from '../../app/plugins/foxhole/nixie/map-settings.ts';

test('spatial layers default to full quality and persist as region independent user preferences',()=>{
 const defaults=readFoxholeMapSettings({});
 assert.equal(FOXHOLE_WORLD_LAYER_DEFINITIONS.length,12);
 assert.ok(Object.values(defaults.worldLayers).every(Boolean));
 for(const layer of FOXHOLE_WORLD_LAYER_DEFINITIONS){
  assert.equal(isFoxholeMapUserSettingKey(layer.settingId),true);
  assert.equal(foxholeMapUserSettings.find(d=>d.id===layer.settingId)?.defaultValue,true);
 }
 for(const region of ['DeadlandsHex','FarranacCoastHex']){
  const settings=readFoxholeMapSettings({'foxhole.map.regionKeys':region},id=>id==='foxhole.map.world.rocks'?false:undefined);
  assert.equal(settings.worldLayers.rocks,false);assert.equal(settings.worldLayers.building,true);
  assert.equal(settings.rocks,false); // IMM rock overlay remains independent.
 }
 assert.equal(readFoxholeMapSettings({},id=>id==='foxhole.map.world.rocks'?'false':undefined).worldLayers.rocks,true);
});

test('terrain surfaces are device-local and invalid values retain detailed terrain',()=>{
 const key='foxhole.map.terrainSurface';assert.equal(isFoxholeMapUserSettingKey(key),true);
 assert.equal(foxholeMapUserSettings.find(d=>d.id===key)?.persist,'local');
 assert.equal(readFoxholeMapSettings({}).terrainSurface,'native');
 for(const value of ['plain','map','native'])assert.equal(readFoxholeMapSettings({},id=>id===key?value:undefined).terrainSurface,value);
 assert.equal(readFoxholeMapSettings({},id=>id===key?'invalid':undefined).terrainSurface,'native');
});
