import test from 'node:test';
import assert from 'node:assert/strict';
import {Container3D} from '@pixi/3d';
import {Texture} from 'pixi.js';
import {loadWorldDetails} from '../authoring/world-details.mjs';
import {applyRegionFrame} from '../runtime/spatial-frame.mjs';

test('framed effects retain native particle motion but use pixel-sized world billboards',async()=>{
 const root=new Container3D(),frame={x:1000,y:2000,scale:32};
 const effects={materials:{smoke:{file:'smoke.png',color:[1,1,1],opacity:1}},placements:[{actor:'chimney',name:'Smoke',system:'smoke',visible:true,autoActivate:true,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,100,20,-50,1]}],emitters:{smoke:[{name:'smoke',material:'smoke',count:1,acceleration:[[0,0,100],[0,0,100]],location:[[0,0,0],[0,0,0]],origin:[0,0,0],velocity:[[0,0,200],[0,0,200]],size:[[200,200,200],[200,200,200]],lifetime:[2,2],color:[[1,1,1],[1,1,1]],alpha:[1,1]}]}};
 const json=async path=>path.endsWith('details/render.json')?{chunks:[],coverage:[]}:path.endsWith('details/materials.json')?{}:path.endsWith('effects/render.json')?effects:{materials:{},placements:[]};
 for(const spatialFrame of [undefined,frame]){
  const sceneRoot=new Container3D();root.addChild(sceneRoot);
  await loadWorldDetails({region:'deadlands',root:sceneRoot,json,zipped:async()=>new ArrayBuffer(0),texture:async()=>Texture.WHITE,frame:spatialFrame,hexBit:{name:'boundary',gpu:{fragment:{material:'if(input.vPosition.y < -220.0) {discard;}'}},gl:{fragment:{material:'if(vPosition.y < -220.0) discard;'}}}});
  const p=sceneRoot.children.find(c=>c.constructor.name==='ParticleContainer3D');
  assert.equal(p.space,spatialFrame?'local':'world');
  assert.deepEqual([p.position.x,p.position.y,p.position.z],[100,20,-50], 'transparent sorting uses the chimney origin');
  assert.deepEqual([...p.data.f32.slice(0,3)],spatialFrame?[0,0,0]:[100,20,-50]);
  if(spatialFrame){
   applyRegionFrame({root:sceneRoot,materials:[],terrainPass:{}},spatialFrame);
   const launch=p.toGlobal({x:0,y:0,z:0});
   assert.ok(Math.abs(launch.x-4200)<.001&&Math.abs(launch.y+3600)<.001&&Math.abs(launch.z-640)<.001,'anchoring preserves framed launch coordinates');
  }
  assert.equal(p.geometry.dynamic,true,'framing must keep particle buffers out of static geometry atlases');
  assert.equal(p.material.state.depthTest,true);
  assert.equal(p.material.state.depthMask,false);
  assert.equal(p.data.f32[p._sizeRotIndex],spatialFrame?64:2);
  const attr=p._attributes.aVel;
  assert.ok(attr); // Motion stays in the same local metre frame as particle centres.
 }
 root.destroy({children:true});
});
