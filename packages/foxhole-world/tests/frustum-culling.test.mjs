import test from 'node:test';
import assert from 'node:assert/strict';
import {Container3D,BatchedMesh3D,Geometry3D,Material3D,Matrix4,RenderPassBit} from '@pixi/3d';
import {setRegionFrustumCulling} from '../runtime/frustum-culling.mjs';
import {createChunkedTerrainLod} from '../runtime/terrain-chunks.mjs';
import {FoxholeRegionSceneController} from '../../extensions/foxhole/app/plugins/foxhole/nixie/map/region-scene-controller.mjs';

test('culling switches native batch producers without changing geometry, transforms or actor visibility',()=>{
 const root=new Container3D(),parent=root.addChild(new Container3D()),batch=parent.addChild(new BatchedMesh3D({size:2,cull:'off'}));
 const geometry=new Geometry3D({positions:new Float32Array([0,0,0,1,0,0,0,1,0]),indices:new Uint32Array([0,1,2])}),material=new Material3D();
 for(let i=0;i<2;i++){batch.setGeometryAt(i,geometry);batch.setMaterialAt(i,material);batch.setMatrixAt(i,new Matrix4());}
 batch.setItemActive(0,RenderPassBit.OPAQUE|RenderPassBit.SHADOW);batch.setItemActive(1,0);
 const masks=batch.items.map(item=>item._lastRenderPass),matrices=Float32Array.from(batch.matrices.data),indices=geometry.indexBuffer.data;
 try{for(const enabled of [true,false,true]){setRegionFrustumCulling(root,enabled);assert.equal(batch.cull,enabled?'gpu':'off');assert.equal(batch.batch.cull,batch.cull);assert.equal(batch.items[0].geometry,geometry);assert.equal(batch.items[1].geometry,geometry);assert.equal(geometry.indexBuffer.data,indices);assert.deepEqual(batch.items.map(item=>item._lastRenderPass),masks);assert.deepEqual(Float32Array.from(batch.matrices.data),matrices);}}finally{root.destroy({children:true});geometry.destroy(true);material.destroy();}
});

test('full-detail terrain frustum rejection changes draws without rebuilding or retiring source buffers',async()=>{
 const source=new Float32Array([0,0,0,1,0,0,0,0,1,1,0,1]),meta={min:[0,0,0],max:[1,0,1],components:[{name:'fixture',size:2,offset:0}]};let builds=0,releases=0;
 const manager=createChunkedTerrainLod({meta,source,adaptive:false,frustumCulling:true,create:mesh=>{builds++;return mesh;},release(){releases++;},apply(){}}),geometry=await manager.initialize();
 const outside=new Float32Array(24);outside[0]=-1;outside[3]=-1000;
 assert.deepEqual(manager.getDraws(outside),[]);assert.equal(manager.stats.draws,0);assert.equal(manager.stats.step,1);assert.equal(manager.stats.pending,false);
 manager.frustumCulling=false;assert.deepEqual(manager.getDraws(outside),[geometry]);manager.frustumCulling=true;assert.deepEqual(manager.getDraws(),[geometry]);assert.equal(builds,1);assert.equal(releases,0);assert.equal(geometry.step,1);manager.destroy();assert.equal(releases,1);
});

test('live frustum toggles retain a resident scene, all layer demand and original view ownership',async()=>{
 const view={cull:'auto',_sceneBatch:{cull:'cpu'},passes:[],height:800,width:1200,camera:{position:{x:0,y:0,z:100000}},root:{addChild(){}}},updates=[],options=[];let destroyed=0;
 const scene={root:{removeFromParent(){}},passes:[],metrics:{},setFrustumCulling(value){updates.push(value);},destroy(){destroyed++;}};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{fixture:{id:'fixture'}}})),loadRegion:async value=>{options.push(value);return scene;}}),layers={terrain:true,building:true},sync=frustumCulling=>controller.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['fixtureHex'],progressiveLoading:false,frustumCulling,worldLayers:layers}});
 sync(true);await new Promise(r=>setTimeout(r,0));assert.equal(options.length,1);assert.equal(options[0].frustumCulling,true);assert.equal(options[0].layers,layers);assert.equal(view._sceneBatch.cull,'gpu');
 sync(false);assert.equal(view._sceneBatch.cull,'off');assert.equal(updates.at(-1),false);sync(true);assert.equal(updates.at(-1),true);assert.equal(view.cull,'gpu');assert.equal(options.length,1);assert.equal(destroyed,0);assert.equal(controller.records.get('fixture').scene,scene);controller.destroy();assert.equal(view.cull,'auto');assert.equal(view._sceneBatch.cull,'cpu');assert.equal(destroyed,1);
});
