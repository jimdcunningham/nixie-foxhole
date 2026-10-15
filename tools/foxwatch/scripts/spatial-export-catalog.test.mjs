import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {spatialExportCatalog} from './spatial-export-catalog.mjs';

test('extraction metadata provides model scope and modification identity without rendered sprites',async()=>{
 const raw={assets:[{id:'warehouse',codeName:'Warehouse',categoryId:'facility',isVehicle:false,
   modifications:{},modificationSlots:[{name:'Options',variants:{default:{},z:{},lamp:{}}}]},{id:'upgrade-only',isUpgrade:true}]};
 const catalog=await spatialExportCatalog(raw);
 assert.equal(catalog.assets.length,1);assert.equal(catalog.assets[0].id,'warehouse');
 assert.deepEqual(Object.keys(catalog.assets[0].modifications[0].variants),['lamp','z']);
 assert.equal(catalog.assets[0].sprite,undefined);
});

test('the raw and published catalog identify the same upgrades on real extracted fixtures when available',async t=>{
 let raw,published;
 try{raw=JSON.parse(await readFile(new URL('../tmp/foxwatch-manifest.v1.json',import.meta.url),'utf8'));published=JSON.parse(await readFile(new URL('../../../packages/extensions/foxhole/public/foxhole/assets/manifest.v1.json',import.meta.url),'utf8'));}
 catch(error){if(error.code==='ENOENT'){t.skip('Requires local extraction data');return;}throw error;}
 const a=await spatialExportCatalog(raw),b=await spatialExportCatalog(published);
 for(const id of ['powerpole','facilitypowerdiesel','fortt3']){
  const slots=catalog=>catalog.assets.find(a=>a.id===id)?.modifications.map(s=>({name:s.name,variants:Object.entries(s.variants).map(([id,v])=>[id,v.isUpgrade===true])}));
  assert.deepEqual(slots(a),slots(b),id);
 }
});
