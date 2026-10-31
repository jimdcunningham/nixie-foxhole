import test from 'node:test';
import assert from 'node:assert/strict';
import {planningTerritories,rasterizePlanningTerritories,MAP_OVERLAY_SIZE} from '../authoring/terrain-map-raster.mjs';
import {createTerrainPlanningOverlays,terrainPlanningOverlayBit} from '../authoring/terrain-planning-overlays.mjs';
const labels=[{x:.25,y:.5,mapMarkerType:'Major',teamId:'COLONIALS'},{x:.75,y:.5,mapMarkerType:'Major',teamId:'WARDENS'}];
test('territory field follows major labels and native metre distances on either side of a division',()=>{
 const sites=planningTerritories({labels}),data=rasterizePlanningTerritories(sites),size=MAP_OVERLAY_SIZE;
 const sample=(x,y)=>data.slice((y*size+x)*4,(y*size+x)*4+4);
 assert.equal(sample(100,256)[0],1);assert.equal(sample(400,256)[0],2);
 assert.ok(Math.abs(sample(255,256)[2]-127.5)<20);assert.equal(sample(100,256)[2],255);
 assert.equal(planningTerritories({labels:[...labels,{x:NaN,y:.5,mapMarkerType:'Major'},{x:.5,y:.5,mapMarkerType:'Minor'}]}).length,2);
 assert.equal(planningTerritories({labels,suppressFaction:true})[0][2],0);
});
test('capture tint fades like the 2D map and respects playback time',()=>{
 const label={...labels[0],capturedTimestamp:1000};
 assert.equal(planningTerritories({labels:[label],warStart:1,referenceTimestamp:1000})[0][3],Math.round(.35*255));
 assert.equal(planningTerritories({labels:[label],warStart:1,referenceTimestamp:43201000})[0][3],Math.round(.15*255));
 assert.equal(planningTerritories({labels:[label],warStart:1000,referenceTimestamp:1000})[0][3],Math.round(.15*255));
});
test('camera frames and toggles retain territory storage; ownership updates rebuild it without losing RDZ',()=>{
 const overlay=createTerrainPlanningOverlays(),state={labels,items:[{iconType:20,x:.5,y:.05}]};
 try{
  overlay.set({rdz:true,divisions:true,faction:true},state);const bytes=overlay.source.resource;
  assert.equal(overlay.source.width,MAP_OVERLAY_SIZE);assert.equal(overlay.source.height,MAP_OVERLAY_SIZE+1);
  assert.equal(overlay.info[2],1);assert.equal(new Float32Array(bytes.buffer)[2],50);
  for(let i=0;i<60;i++)assert.equal(overlay.set({rdz:true,divisions:true,faction:true},state),false);
  overlay.set({rdz:true,divisions:false,faction:false},state);assert.equal(overlay.source.resource,bytes);
  overlay.set({rdz:true,divisions:true,faction:true},{...state,labels:labels.map(l=>({...l,teamId:'WARDENS'}))});assert.notEqual(overlay.source.resource,bytes);assert.equal(overlay.info[2],1);
  const material={data:{},textures:{}};overlay.bindWater(material);assert.equal(material.data.terrainMapOverlayInfo,overlay.mapInfo);assert.equal(material.textures.baseColor.source,overlay.source);
 }finally{overlay.destroy();}
});
test('both shader backends share the packed texture without another water sampler',()=>{
 for(const water of [false,true]){
  const bit=terrainPlanningOverlayBit({water});assert.ok(bit.gl.fragment.end.includes('terrainMapOverlayInfo'));assert.ok(bit.gpu.fragment.end.includes('planningMap('));
  assert.ok(!bit.gpu.fragment.end.includes('vec4 territory'));
  if(water)assert.ok(!JSON.stringify(bit.bindings).includes('texture_2d'));
 }
});
