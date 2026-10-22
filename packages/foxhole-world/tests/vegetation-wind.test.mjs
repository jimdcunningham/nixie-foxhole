import test from 'node:test';import assert from 'node:assert/strict';
import {Material3D,Container3D,parseGltf} from '@pixi/3d';
import {createVegetationWind,vegetationWindProfile,vegetationWindBit} from '../authoring/vegetation-wind.mjs';
import {loadWorldModels} from '../authoring/world-models.mjs';
const part=(material,name='BirchBushSmall')=>({geometry:{},material,materialName:name,bounds:{min:[-1,-.1,-1],max:[1,2,1]}}),p={category:'vegetation',path:'War/Content/Foliage/Bush01.Bush01'};
test('wind profiles anchor roots, bound displacement, and retain rigid structures and dead timber',()=>{
 const bush=vegetationWindProfile(p,[part()]);assert.equal(bush.root,0);assert.equal(bush.height,2);assert.equal(bush.amplitude,.2);
 const tree=vegetationWindProfile({category:'trees',path:'PineTree'},[{bounds:{min:[-3,-2,-3],max:[3,40,3]}}]);assert.equal(tree.amplitude,.45);
 for(const proto of [{...p,category:'building'},{...p,category:'rocks'},{...p,path:'DeadTree'},{...p,path:'FallenTree'},{...p,path:'TreeStump'}])assert.equal(vegetationWindProfile(proto,[part()]),null);
});
test('resident cells share wind materials and textures while local leases leave source appearance intact',()=>{
 const source=new Material3D({baseColor:0x719443,roughness:.94,alphaMode:'mask',alphaCutoff:.333,doubleSided:true,normalScale:.7}),wind=createVegetationWind({frame:{scale:32}}),original={color:[...source.data.baseColor],roughness:source.roughness,normal:source.normalScale};
 wind.update(3,{directionDeg:90,strength:.5});const a=wind.acquire(p,[part(source)]),b=wind.acquire(p,[part(source)]),material=a.parts[0].material;
 assert.notEqual(material,source);assert.equal(material,b.parts[0].material);assert.equal(wind.size,1);assert.equal(material.textures.baseColor,source.textures.baseColor);assert.deepEqual([...material.data.baseColor],original.color);assert.equal(material.roughness,original.roughness);assert.equal(material.normalScale,original.normal);assert.equal(material.alphaMode,'mask');assert.equal(material.alphaCutoff,.333);
 assert.ok(Math.abs(material.data.foliageWind[0])<1e-6);assert.equal(material.data.foliageWind[1],-1);assert.equal(material.data.foliageWind[2],0);assert.equal(material.data.foliageWind[3],.5);assert.deepEqual([...material.data.foliageUp],[0,0,1,3]);
 wind.setEnabled(false);assert.equal(material.data.foliageWind[3],0);wind.update(5,{directionDeg:0,strength:1});assert.equal(material.data.foliageWind[3],0);wind.setEnabled(true);assert.equal(material.data.foliageWind[3],1);assert.equal(material.data.foliageUp[3],5);
 wind.update(6,{strength:0});assert.equal(material.data.foliageWind[3],0);assert.equal(source.data.foliageWind,undefined);
 assert.ok(material._extraBits.includes(vegetationWindBit));a.release();assert.equal(material.destroyed,false);b.release();assert.equal(material.destroyed,true);assert.equal(source.destroyed,false);assert.equal(wind.size,0);wind.destroy();source.destroy();
});
test('native and host frames share physical wind direction and late cells inherit the current clock',()=>{
 const source=new Material3D(),native=createVegetationWind(),host=createVegetationWind({frame:{scale:32}});native.update(4,{directionDeg:45,strength:2});host.update(4,{directionDeg:45,strength:2});const a=native.acquire(p,[part(source)]),b=host.acquire(p,[part(source)]),ma=a.parts[0].material,mb=b.parts[0].material;
 assert.equal(ma.data.foliageWind[0],mb.data.foliageWind[0]);assert.equal(ma.data.foliageWind[2],mb.data.foliageWind[1]);assert.equal(ma.data.foliageWind[3],1);assert.ok(Math.abs(mb.data.foliageShape[2]/ma.data.foliageShape[2]-32)<1e-5);
 native.update(NaN,{directionDeg:NaN,strength:NaN});assert.deepEqual([...ma.data.foliageWind].map(v=>v||0),[1,0,0,0]);assert.equal(ma.data.foliageUp[3],0);native.destroy();a.release();host.destroy();b.release();source.destroy();
});
test('world foliage uses leased animation materials for full detail and LOD without changing geometry or binding solids',async()=>{
 const saved=globalThis.location;globalThis.location={search:''};const points=new Float32Array([0,0,0,0,2,0,1,2,0]),source=await parseGltf({asset:{version:'2.0'},buffers:[{byteLength:points.byteLength}],bufferViews:[{buffer:0,byteLength:points.byteLength}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,2,0]}],materials:[{name:'Leaves',alphaMode:'MASK'}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0},[points.buffer]);
 const root=new Container3D(),wind=createVegetationWind(),matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];let world;
 try{world=await loadWorldModels({region:'fixture',root,windMaterials:wind,status(){},teamAt:()=> 'NONE',worldData:{prototypes:[{...p,name:'Bush01',file:'bush.gltf',materials:[{name:'Leaves',masked:true}],placements:[{matrix}]}]},json:async id=>id.endsWith('/lod-manifest.json')?{assets:{'bush.gltf':{levels:[{file:'lod1.glb'},{file:'lod2.glb'}]}}}:{assets:{}},loadModel:async()=>source});
 assert.deepEqual(world.counts.failed,[]);assert.deepEqual(world.counts.lodFailures,[]);assert.equal(wind.size,1);const material=world.batches[0].items[0].material;assert.ok(world.batches.every(batch=>batch.items[0].material===material));assert.notEqual(material,source.materials[0]);assert.deepEqual([...points],[0,0,0,0,2,0,1,2,0]);
 world.dispose();world=null;assert.equal(wind.size,0);assert.equal(material.destroyed,true);
 }finally{world?.dispose();wind.destroy();root.destroy({children:true});source.destroy();globalThis.location=saved;}
});
