import test from 'node:test';
import assert from 'node:assert/strict';
import {Container3D,Mesh3D,parseGltf} from '@pixi/3d';
import {craneSpawnPlacements} from '../authoring/crane-spawn-placements.mjs';
import {applyRegionFrame} from '../runtime/spatial-frame.mjs';
import {loadRegionCranes} from '../runtime/load-region-cranes.mjs';
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
test('native crane spawns compose actor tilt/rotation and deduplicate component records',()=>{
 const actor=[0,0,-1,0,0,1,0,0,1,0,0,0,100,5,-50,1];
 const row={actor:'refinery-1',matrix:actor},data={prototypes:[{name:'Refinery_C/Building',placements:[row]},{name:'Refinery_C/Barrel',localMatrix:identity,placements:[row]}]};
 const result=craneSpawnPlacements(data,{Refinery_C:[{name:'Spawn',structureId:'staticcrane',x:200,y:300,z:400,rotation:90}]});
 assert.equal(result.length,1);assert.deepEqual(result[0].matrix.slice(12,15),[97,9,-52]);
 assert.ok(Math.abs(result[0].matrix[0]+1)<1e-6&&Math.abs(result[0].matrix[10]+1)<1e-6);
 assert.equal(craneSpawnPlacements({prototypes:[{name:'Unknown/Building',placements:[row]}]}).length,0);
 const seaport=craneSpawnPlacements({prototypes:[{name:'BPSeaport_C/Building',placements:[{actor:'port',matrix:identity}]}]});
 assert.equal(seaport.length,2);assert.ok(seaport.every(p=>Math.abs(p.matrix[13]-3.07)<1e-5));
});
async function source(mesh){
 const data=new Float32Array([0,0,0,1,0,0,0,1,0]);
 return parseGltf({asset:{version:'2.0'},buffers:[{byteLength:mesh?data.byteLength:0}],bufferViews:mesh?[{buffer:0,byteLength:data.byteLength}]:[],accessors:mesh?[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}]:[],materials:mesh?[{}]:[],meshes:mesh?[{primitives:[{attributes:{POSITION:0},material:0}]}]:[],nodes:[mesh?{mesh:0}:{name:'shared-part-0000'}],scenes:[{nodes:[0]}],scene:0},[mesh?data.buffer:new ArrayBuffer(0)]);
}
test('map cranes reuse one catalog/shared source and restore the blueprint origin',async()=>{
 const root=new Container3D(),wrapper=await source(false),shared=await source(true),loads=[],id='shared.'+'a'.repeat(64);
 const descriptor={path:'types/structures/staticcrane/staticcrane.glb',sha256:'a'.repeat(64),offsetX:32,offsetY:64,offsetZ:96,modelParts:{version:1,parts:[{nodeName:'shared-part-0000',resourceId:'foxhole.model.'+id}]}};
 const cranes=await loadRegionCranes({baseUrl:'https://assets.test/foxhole/assets/world/',root,placements:[{actor:'a',name:'Spawn',matrix:identity},{actor:'b',name:'Spawn',matrix:identity}],fetcher:async()=>({ok:true,json:async()=>({assets:{staticcrane:descriptor},sharedParts:{[id]:{path:'shared/models/'+id.slice(7)+'.glb'}}})}),loadModel:async url=>{loads.push(url);return url.includes('types/structures')?wrapper:shared;}});
 const meshes=[];function visit(node){if(node instanceof Mesh3D)meshes.push(node);for(const c of node.children)visit(c);}visit(cranes.root);
 assert.equal(loads.length,2);assert.equal(cranes.count,2);assert.equal(meshes.length,2);assert.equal(meshes[0].geometry,meshes[1].geometry);assert.equal(meshes[0].material,meshes[1].material);
 assert.deepEqual([...meshes[0].geometry.indexBuffer.data],[0,2,1], 'native Z reflection must preserve outward faces');
 assert.deepEqual([...shared.geometries[0][0].indexBuffer.data],[0,1,2], 'cached catalog geometry stays unchanged');
 const origin=meshes[0].toGlobal({x:0,y:0,z:0});assert.deepEqual([origin.x,origin.y,origin.z],[1,3,-2]);
 const sourceGeometry=shared.geometries[0][0];applyRegionFrame({root,materials:[],terrainPass:{}},{scale:32});
 assert.deepEqual([...meshes[0].geometry.indexBuffer.data],[0,1,2], 'the host reflection cancels the native reflection');
 const framedIndices=meshes[0].geometry.indexBuffer;cranes.destroy();assert.notEqual(sourceGeometry.destroyed,true);root.destroy();assert.equal(framedIndices.destroyed,true);assert.equal(root.children.length,0);
 root.destroy();wrapper.destroy();shared.destroy();
});
