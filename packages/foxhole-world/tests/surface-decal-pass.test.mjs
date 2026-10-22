import test from 'node:test';
import assert from 'node:assert/strict';
import {Container3D,RenderPassBit} from '@pixi/3d';
import {Texture} from 'pixi.js';
import {loadWorldDetails} from '../authoring/world-details.mjs';
import {SurfaceDecalPass} from '../authoring/surface-decal-pass.mjs';

test('projected decals keep their surface pass after layer visibility changes',async()=>{
 const root=new Container3D(),geometries=[],materials=[];
 const vertices=new Float32Array([-1,-1,0,0,0,1,0,0,1,-1,0,0,0,1,1,0,1,1,0,0,0,1,1,1,-1,1,0,0,0,1,0,1]);
 const indices=new Uint32Array([0,1,2,0,2,3]);
 const meta={chunks:[{material:'dirt',category:'building',vertexOffset:0,vertexCount:4,indexOffset:0,indexCount:6}],coverage:[]};
 const details=await loadWorldDetails({region:'deadlands',root,
  json:async path=>path.endsWith('details/render.json')?meta:path.endsWith('details/materials.json')?{dirt:{file:'dirt',ormFile:'orm',tint:0xffffff}}:path.endsWith('effects/render.json')?{materials:{},placements:[]}:{materials:{},placements:[]},
  zipped:async path=>path.includes('vertices')?vertices.buffer:indices.buffer,texture:async()=>Texture.WHITE,
  geo:g=>(geometries.push(g),g),mat:m=>(materials.push(m),m),weatherMaterial:m=>m,
  hexBit:{name:'decalTestBoundary',gl:{fragment:{material:''}},gpu:{fragment:{material:''}}},weatherSurfaceBit:{name:'decalTestWeather',gl:{fragment:{material:''}},gpu:{fragment:{material:''}}}
 });
 const batch=root.children.find(c=>c.label==='Projected Native Decals'),material=materials[0],mask=material._passBit;
 assert.equal(material.nativeSurfaceDecal,true);
 assert.equal(mask&RenderPassBit.TRANSPARENT,0);
 assert.ok(mask>0);
 assert.equal(material.alphaMode,'blend');
 assert.equal(material.state.depthTest,true);
 assert.equal(material.state.depthMask,false);
 assert.equal(new SurfaceDecalPass().stage,'afterOpaque');
 details.syncLayers({building:false});
 assert.equal(batch.items[0]._lastRenderPass,0);
 details.syncLayers({building:true});
 assert.equal(batch.items[0]._lastRenderPass,mask);
 details.syncLayers({decals:false});assert.equal(batch.visible,false);
 details.syncLayers({decals:true});assert.equal(batch.visible,true);
 assert.equal(batch.items[0]._lastRenderPass,mask);
 root.destroy({children:true});for(const g of geometries)g.destroy(true);for(const m of materials)m.destroy();
});
