import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerrainPlanningOverlays,terrainPlanningOverlayBit} from '../authoring/terrain-planning-overlays.mjs';
import {LiveTerrainPass} from '../authoring/live-terrain.mjs';
test('grid and pointer-cell updates change uniforms without allocating or uploading territory textures',async()=>{
 const pass=new LiveTerrainPass();await pass.load('fixture',{}, {surface:'plain',status(){}});
 const current=pass.current,resource=pass.planning.source.resource;
 pass.setPlanningOverlays({grid:true,gridCell:[125,250]});
 assert.deepEqual([...pass.planning.gridInfo],[1,125,250,1]);
 assert.equal(current.uniforms.uniforms.terrainGridOverlayInfo,pass.planning.gridInfo);
 assert.equal(pass.planning.set({grid:true,gridCell:[125,250]}),false);
 pass.setPlanningOverlays({grid:true,gridCell:[375,500]});
 assert.equal(pass.current,current);assert.equal(pass.planning.source.resource,resource);
 pass.setPlanningOverlays({grid:false});assert.deepEqual([...pass.planning.gridInfo],[0,0,0,0]);
 const material={data:{},textures:{}};pass.planning.bindWater(material);assert.equal(material.data.terrainGridOverlayInfo,pass.planning.gridInfo);
 pass.destroy();
});
test('terrain and water share metre-aligned major and subgrid shader coordinates in both backends',()=>{
 for(const water of [false,true]){
  const bit=terrainPlanningOverlayBit({water});
  for(const code of [bit.gl.fragment.end,bit.gpu.fragment.end]){
   assert.ok(code.includes('planningPoint.x+1092.0'));assert.ok(code.includes('945.0-planningPoint.z'));
   assert.ok(code.includes('125.0/3.0'));assert.ok(code.includes('terrainGridOverlayInfo'));
  }
 }
});
