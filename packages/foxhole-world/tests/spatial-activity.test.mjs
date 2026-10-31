import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerrainPlanningOverlays} from '../authoring/terrain-planning-overlays.mjs';
test('activity images share the planning sampler and stable frames or pulse updates never upload images again',()=>{
 const overlay=createTerrainPlanningOverlays(),size=512,image=new Uint8ClampedArray(size*size*4),heat=new Uint8ClampedArray(image.length);
 image.set([230,50,10,200]);heat.set([255,180,20,120]);
 try{
  overlay.set({front:true,hotspots:true,frontImage:image,heatImage:heat,heatAlpha:.5});
  assert.equal(overlay.source.width,size);assert.equal(overlay.source.height,size*3+1);
  const bytes=overlay.source.resource;
  assert.deepEqual([...bytes.slice(size*(size+1)*4,size*(size+1)*4+4)],[230,50,10,200]);
  assert.deepEqual([...bytes.slice(size*(size*2+1)*4,size*(size*2+1)*4+4)],[255,180,20,120]);
  assert.equal(overlay.set({front:true,hotspots:true,frontImage:image,heatImage:heat,heatAlpha:.5}),false);
  assert.equal(overlay.set({front:true,hotspots:true,frontImage:image,heatImage:heat,heatAlpha:.6}),true);assert.equal(overlay.source.resource,bytes);
  overlay.set({front:false,hotspots:false});assert.equal(overlay.source.resource,bytes);
  const updated=new Uint8ClampedArray(image);updated[0]=123;overlay.set({front:true,frontImage:updated});assert.notEqual(overlay.source.resource,bytes);
 }finally{overlay.destroy();}
});
