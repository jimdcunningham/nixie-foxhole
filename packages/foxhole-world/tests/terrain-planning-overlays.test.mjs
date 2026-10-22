import test from 'node:test';
import assert from 'node:assert/strict';
import {regionBorderDistance,rdzExemptions,inRapidDecayZone,contourDistance} from '../authoring/terrain-overlay-policy.mjs';
import {createTerrainPlanningOverlays} from '../authoring/terrain-planning-overlays.mjs';
import {LiveTerrainPass} from '../authoring/live-terrain.mjs';
const icon=(type,x,z)=>({iconType:type,x:x/2184+.5,y:.5-z/1890});

test('RDZ uses perpendicular metres on all six region edges, including diagonal edges',()=>{
 const k=546/945,n=Math.hypot(1,k);
 for(const sx of [-1,1])for(const sz of [-1,1]){
  for(const d of [0,149.99,150.01]){
   const x=sx*(819-d/n),z=sz*(472.5-d*k/n);
   assert.ok(Math.abs(regionBorderDistance(x,z)-d)<1e-8);
   assert.equal(inRapidDecayZone(x,z),d<=150);
  }
 }
 for(const sign of [-1,1]){assert.equal(inRapidDecayZone(0,sign*796),true);assert.equal(inRapidDecayZone(0,sign*794),false);assert.equal(inRapidDecayZone(0,sign*946),false);}
 assert.equal(inRapidDecayZone(0,0),false);
});

test('current war fields/mines/world bases cut exact 50 m holes; spawn candidates and ordinary facilities do not',()=>{
 for(const type of [20,21,23,27,32,35,38,40,45,46,47,56,57,58,61,62]){
  const circles=rdzExemptions({items:[icon(type,0,850)]});assert.equal(circles.length,1,String(type));
  assert.equal(inRapidDecayZone(49.9,850,circles),false);assert.equal(inRapidDecayZone(50.1,850,circles),true);
 }
 for(const type of [11,17,34,55,-2,75])assert.deepEqual(rdzExemptions({items:[icon(type,0,850)]}),[],'no unsupported exemption for '+type);
 assert.deepEqual(rdzExemptions(null),[]);
 assert.deepEqual(rdzExemptions({items:[icon(20,0,0),{iconType:20,x:NaN,y:0}]}),[]);
});

test('duplicate and reordered map snapshots retain exemption storage; turning RDZ off does not erase Topo',()=>{
 const overlay=createTerrainPlanningOverlays(),a=icon(20,0,850),b=icon(45,100,850);
 try{
  assert.equal(overlay.set({rdz:true,topo:true},{items:[a,b,a]}),true);assert.equal(overlay.info[2],2);
  const bytes=overlay.source.resource;assert.equal(overlay.set({rdz:true,topo:true},{items:[b,a]}),false);assert.equal(overlay.source.resource,bytes);
  assert.equal(overlay.set({topo:true},{items:[]}),true);assert.equal(overlay.info[0],0);assert.equal(overlay.info[1],1);
  overlay.set({rdz:true},{items:[]});assert.equal(overlay.info[2],0);
 }finally{overlay.destroy();overlay.destroy();}
 assert.equal(overlay.source.destroyed,true);
});

test('exemption storage grows without silently dropping circles and preserves float bytes',()=>{
 const items=Array.from({length:300},(_,i)=>icon(20,-100+i*.5,850));const overlay=createTerrainPlanningOverlays();
 try{overlay.set({rdz:true},{items});assert.equal(overlay.info[2],300);assert.equal(overlay.source.height,5);const data=new Float32Array(overlay.source.resource.buffer);assert.equal(data[0],-100);assert.equal(data[2],50);assert.equal(data[299*4],49.5);}finally{overlay.destroy();}
});

test('contour intervals include negative elevations and do not depend on camera distance',()=>{
 for(const h of [-50,-10,0,10,50])assert.ok(contourDistance(h)<1e-10);
 assert.ok(Math.abs(contourDistance(-9)-1)<1e-10);assert.equal(contourDistance(5),5);
});

test('Plain and Map terrain keep geometry and bindings while toggles and war exemptions update in place',async()=>{
 for(const surface of ['plain','map']){
  const pass=new LiveTerrainPass(),geometry={},paint={source:{style:{}}};
  await pass.load('fixture',geometry,{surface,status(){},texture:async()=>paint});
  const current=pass.current,group=current.group;
  pass.setPlanningOverlays({rdz:true,topo:true},{items:[icon(20,0,850)]});
  assert.equal(pass.current,current);assert.equal(pass.current.geometry,geometry);assert.equal(pass.current.group,group);
  assert.equal(current.uniforms.uniforms.terrainOverlayInfo,pass.planning.info);assert.equal(pass.planning.info[2],1);
  pass.setPlanningOverlays({rdz:true,topo:false},{items:[]});assert.equal(pass.planning.info[2],0);
  pass.destroy();assert.equal(pass.planning.source.destroyed,true);
 }
});
