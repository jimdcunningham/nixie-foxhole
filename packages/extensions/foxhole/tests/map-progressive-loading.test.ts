import assert from 'node:assert/strict';
import test from 'node:test';
import {FOXHOLE_MAP_SETTING_KEYS,foxholeMapUserSettings,isFoxholeMapUserSettingKey,readFoxholeMapSettings} from '../app/plugins/foxhole/nixie/map-settings.ts';

test('progressive reveal is standard behavior and ignores the retired preference',()=>{
 const legacy='foxhole.map.progressiveLoading';
 assert.equal(foxholeMapUserSettings.some(setting=>setting.id===legacy),false);
 const settings=readFoxholeMapSettings({[legacy]:false},id=>id===legacy?false:undefined);
 assert.equal('progressiveLoading' in settings,false);
 assert.equal(settings.adaptiveStreaming,false);assert.equal(settings.modelLod,false);assert.equal(settings.terrainLod,false);assert.equal(settings.adaptiveTextures,false);assert.equal(settings.frustumCulling,true);
});

for(const name of ['adaptiveStreaming','modelLod','terrainLod','adaptiveTextures','frustumCulling'] as const){
 test(name+' is an independent local preference',()=>{
  const key=FOXHOLE_MAP_SETTING_KEYS[name],expected=name==='frustumCulling',definition=foxholeMapUserSettings.find(setting=>setting.id===key)!;
  assert.equal(definition.scope,'user');assert.equal(definition.persist,'local');assert.equal(definition.defaultValue,expected);assert.equal(isFoxholeMapUserSettingKey(key),true);
  const settings=readFoxholeMapSettings({[key]:expected},id=>id===key?!expected:undefined);
  assert.equal(settings[name],!expected,'resolved local preference overrides legacy project data');
  for(const other of ['adaptiveStreaming','modelLod','terrainLod','adaptiveTextures','frustumCulling'] as const)if(other!==name)assert.equal(settings[other],other==='frustumCulling');
 });
}
