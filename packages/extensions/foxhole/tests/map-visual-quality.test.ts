import assert from 'node:assert/strict';
import test from 'node:test';
import {FOXHOLE_MAP_SETTING_KEYS,foxholeMapUserSettings,readFoxholeMapSettings} from '../app/plugins/foxhole/nixie/map-settings.ts';

test('asset quality settings stay local and shared shadows are no longer extension-owned',()=>{
 const defaults=readFoxholeMapSettings({});assert.equal(defaults.ambientOcclusion,true);assert.equal(defaults.vegetationDensity,'full');
 for(const name of ['ambientOcclusion','vegetationDensity'] as const){const def=foxholeMapUserSettings.find(s=>s.id===FOXHOLE_MAP_SETTING_KEYS[name])!;assert.equal(def.scope,'user');assert.equal(def.persist,'local');}
 assert.equal(foxholeMapUserSettings.some(s=>['foxhole.map.shadowQuality','foxhole.map.softShadows'].includes(s.id)),false);
 assert.equal('shadowQuality' in defaults,false);
 assert.equal(readFoxholeMapSettings({},id=>id==='nixie.graphics.softShadows'?false:undefined).softShadows,false);
});

test('asset quality values validate independently of host rendering preferences',()=>{
 const keys=FOXHOLE_MAP_SETTING_KEYS;
 for(const value of ['full','reduced','minimal'])assert.equal(readFoxholeMapSettings({},id=>id===keys.vegetationDensity?value:undefined).vegetationDensity,value);
 const invalid=readFoxholeMapSettings({},()=> 'bogus');assert.equal(invalid.vegetationDensity,'full');assert.equal(invalid.ambientOcclusion,true);
 const local=readFoxholeMapSettings({[keys.vegetationDensity]:'minimal',[keys.ambientOcclusion]:true},id=>id===keys.vegetationDensity?'reduced':id===keys.ambientOcclusion?false:undefined);
 assert.equal(local.vegetationDensity,'reduced');assert.equal(local.ambientOcclusion,false);assert.equal(local.modelLod,false);assert.equal(local.terrainLod,false);assert.equal(local.adaptiveStreaming,false);
});

test('the retired terrain Map choice enables Solid Map with a Detailed fallback', () => {
    const keys = FOXHOLE_MAP_SETTING_KEYS;
    const legacy = readFoxholeMapSettings({}, id => id === keys.terrainSurface ? 'map' : undefined);
    assert.equal(legacy.solidMap, true);
    assert.equal(legacy.terrainSurface, 'native');
    const plain = readFoxholeMapSettings({}, id => id === keys.terrainSurface ? 'plain' : undefined);
    assert.equal(plain.solidMap, false);
    assert.equal(plain.terrainSurface, 'plain');
});
