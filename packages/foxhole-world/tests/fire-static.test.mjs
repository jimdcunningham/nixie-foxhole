import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {Material3D,View3D} from '@pixi/3d';
import {fireStaticProfile} from '../effect-materials.mjs';
import {packFireMasks,translateFireStatic} from '../prepare-effect-materials.mjs';
import {retainFireStaticMaterials,createFireStaticResolver,createFireStaticMaterial,fireStaticBit} from '../runtime/fire-static.mjs';
import {framedMaterialBits} from '../runtime/spatial-frame.mjs';
const row={path:'War/Content/FX/Materials/Candlelight.uasset',blend:'BLEND_Translucent',properties:{Expressions:[{ObjectPath:'War/Content/FX/Materials/FireStatic.10'}]},scalars:{Power:6,Brightness:10,Opacity:1,Tiling:.3,'Depth Fade':0},colors:Object.fromEntries(['Fire01','Fire02','Fire03','Fire04'].map(k=>[k,{R:.8,G:.2,B:0}])),textures:{SmokeAlphas01:{path:'native.mask'}}};
test('FireStatic profiles require qualified family evidence and retain distinct instance controls',()=>{
 const p=fireStaticProfile(row);assert.equal(p.power,6);assert.equal(p.brightness,10);assert.equal(p.tiling,.3);assert.equal(p.depthFade,0);
 assert.equal(fireStaticProfile({...row,name:'FireBarrel',properties:{}}),null);
 assert.equal(fireStaticProfile({...row,scalars:{...row.scalars,Tiling:NaN}}),null);
 assert.equal(fireStaticProfile({...row,properties:{Expressions:[{ObjectPath:'Other/FireStatic.1'}]}}),null);
});
test('mask packing preserves independent RGB and alpha without premultiplication',async()=>{
 const bytes=await sharp(Buffer.from([40,80,120,10]),{raw:{width:1,height:1,channels:4}}).png().toBuffer();const [rgb,alpha]=await packFireMasks(bytes);
 assert.deepEqual([...await sharp(rgb).raw().toBuffer()],[40,80,120,255]);assert.deepEqual([...await sharp(alpha).raw().toBuffer()],[10,10,10,255]);
 const material={name:'anything',extras:{foxholeMaterialSource:row.path}};let index=0;
 assert.equal(await translateFireStatic({material,row,image:async()=>({index:index++}),nativeImage:async()=>bytes}),true);
 const saved=structuredClone(material);assert.equal(await translateFireStatic({material,row}),false);assert.deepEqual(material,saved);
 assert.equal(material.extras.foxholeMaterialFamily,'fire-static');assert.equal(material.alphaMode,'BLEND');assert.equal(material.pbrMetallicRoughness.baseColorTexture,undefined);
});
test('native fire replacements share owned materials and fit the framed GPU row',async()=>{
 const p=fireStaticProfile(row),original=new Material3D(),other=new Material3D(),view=new View3D();let creates=0,created;
 const metadata={extras:{foxholeMaterialSource:row.path,foxholeMaterialFamily:'fire-static',foxholeFireStaticVersion:1,foxholeFireStatic:p}};
 const source=retainFireStaticMaterials({materials:[original,other]},{materials:[metadata,{name:'Candlelight'}]});
 const resolve=createFireStaticResolver((m,p)=>{creates++;return created=createFireStaticMaterial(m,p);});
 try{const [a,b]=await Promise.all([resolve(source),resolve(source)]);assert.equal(creates,1);assert.equal(a.size,1);assert.equal(a.get(original).material,b.get(original).material);assert.equal(original._extraBits.length,0);
  assert.ok(Math.abs(created.data.fireControls[3]-.3)<1e-6);assert.equal(created.data.fireControls[1],10);assert.equal(created.state.depthMask,false);
  const framed=new Material3D({alphaMode:'blend',extraBits:framedMaterialBits([fireStaticBit])});try{framed.data.fireTime=3;assert.equal(framed.data.fireTime,3);const d=framed.getPrimaryDescriptor(view);for(const bits of [d.bitsGl,d.bitsGpu])assert.ok(bits.some(b=>b.name.includes('foxholeNativeFireStatic')));}finally{framed.destroy();}
 }finally{original.destroy();other.destroy();created?.destroy();view.destroy({children:true});}
});

import {Container3D,parseGltf,RenderPassBit} from '@pixi/3d';
import {loadWorldModels} from '../authoring/world-models.mjs';
test('world fire preserves source geometry and actor visibility without casting opaque shadows',async()=>{
 const previous=globalThis.location;globalThis.location={search:''};const vertices=new Float32Array([0,0,0,1,0,0,0,0,1]),p=fireStaticProfile(row);
 const doc={asset:{version:'2.0'},buffers:[{byteLength:vertices.byteLength}],bufferViews:[{buffer:0,byteLength:vertices.byteLength}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,0,1]}],materials:[{extras:{foxholeMaterialSource:row.path,foxholeMaterialFamily:'fire-static',foxholeFireStaticVersion:1,foxholeFireStatic:p},alphaMode:'BLEND'}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
 const source=retainFireStaticMaterials(await parseGltf(doc,[vertices.buffer]),doc),root=new Container3D();let owned,world;
 try{world=await loadWorldModels({region:'fixture',root,optimize:false,status(){},teamAt:()=> 'NONE',prepareMaterials:createFireStaticResolver((original,profile)=>owned=createFireStaticMaterial(original,profile)),worldData:{prototypes:[{name:'AnyLamp/Flame',category:'structures',kind:'environment',file:'lamp.gltf',placements:[{actor:'lamp',matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}]}]},json:async()=>({assets:{}}),loadModel:async()=>source});
 assert.deepEqual(world.counts.failed,[]);const item=world.batches[0].items[0];assert.equal(item.material,owned);assert.equal(item._lastRenderPass,RenderPassBit.TRANSPARENT);assert.equal(item.geometry.indexBuffer.data.length,3);world.setWarState(null);assert.equal(item._lastRenderPass,RenderPassBit.TRANSPARENT);world.dispose();assert.equal(owned.destroyed,false);
 }finally{world?.dispose();root.destroy({children:true});owned?.destroy();source.destroy();globalThis.location=previous;}
});
