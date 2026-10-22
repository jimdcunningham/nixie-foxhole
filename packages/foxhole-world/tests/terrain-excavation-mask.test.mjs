import test from 'node:test';
import assert from 'node:assert/strict';
import {Material3D,Container3D,MaterialSystemGpu} from '@pixi/3d';
import {Texture,BindGroup} from 'pixi.js';
import {buildExcavationGrid,excavationGridContains,createTerrainExcavationMask} from '../authoring/terrain-excavation-mask.mjs';
import {packedWeatherSurfaceBit,packWeatherSurfacePixels} from '../authoring/weather-surface.mjs';
import {createRoadTransitions} from '../authoring/road-transitions.mjs';
import {compileNativeTerrainShader,nativeTerrainGlobalGroup} from '../authoring/native-terrain-bindings.mjs';
import {roadShoulderShader,RoadShoulderPass} from '../authoring/road-shoulders.mjs';
const prism=(x=0,z=0,min=-2,max=0)=>[min,max].flatMap(y=>[[x-2,y,z-2],[x+2,y,z-2],[x+2,y,z+2],[x-2,y,z+2]]);

test('excavation clears rising soil above grade, keeps the native footprint, and does not cut below an elevated floor',()=>{
 const data=buildExcavationGrid([prism()],100);
 assert.equal(excavationGridContains(data,[1,0.5,0]),true,'the old closed prism left this sloping soil in the bunker');
 assert.equal(excavationGridContains(data,[2.01,0.5,0]),false);
 assert.equal(excavationGridContains(data,[0,-2.1,0]),false);
 assert.equal(excavationGridContains(buildExcavationGrid([prism(0,0,3,5)],100),[0,0,0]),false);
});
test('float32 grid cells retain overlapping, rotated, tilted, negative-coordinate and moving openings',()=>{
 const tilted=prism(-200,-200).map(([x,y,z])=>[x+(y+2)*.2,y,z]);
 const data=buildExcavationGrid([tilted,prism(-198,-200)],100);
 assert.equal(excavationGridContains(data,[-200,1,-200]),true);
 assert.equal(excavationGridContains(data,[-197,1,-200]),true);
 assert.equal(excavationGridContains(data,[0,1,0]),false);
 const moved=buildExcavationGrid([prism(200,200)],100);
 assert.equal(excavationGridContains(moved,[-200,1,-200]),false);
 assert.equal(excavationGridContains(moved,[200,1,200]),true);
 assert.equal(excavationGridContains(buildExcavationGrid([],100),[200,1,200]),false);
});
test('repeated group movement reuses one small data texture within the eight-slot road material limit',()=>{
 const mask=createTerrainExcavationMask(),material=new Material3D({extraBits:[packedWeatherSurfaceBit,mask.bit]});mask.bind(material);
 assert.equal(material._textures.length,8);
 const source=material.textures.groundExcavations.source,resource=source.resource;
 try{for(let frame=0;frame<100;frame++)mask.set(Array.from({length:30},(_,i)=>prism(-24+i%6*5+frame*.03,-264+Math.floor(i/6)*5)),100);
  assert.equal(material.textures.groundExcavations.source,source);assert.equal(source.resource,resource);assert.ok(mask.bytes<=262144);
  assert.equal(mask.set(Array.from({length:30},(_,i)=>prism(-24+i%6*5+99*.03,-264+Math.floor(i/6)*5)),100),false);
  mask.set([],100);assert.equal(excavationGridContains(new Float32Array(source.resource.buffer),[-24,0,-264]),false);
  assert.equal(source.format,'rgba8unorm');
 }finally{material.destroy();mask.destroy();}
 assert.equal(source.destroyed,true);
});

test('weather packing retains every snow RGB and roughness byte without changing dimensions or mip sampling',()=>{
 const snow=new Uint8Array([32,64,128,255,17,79,113,255]),mask=new Uint8Array([1,77,3,255,9,199,8,255]);
 const packed=packWeatherSurfacePixels(snow,mask);
 assert.deepEqual(packed,new Uint8Array([32,64,128,77,17,79,113,199]));
 assert.deepEqual(snow,new Uint8Array([32,64,128,255,17,79,113,255]));
});

test('a real two-surface road transition retains both normal maps, weather and excavation within eight slots',async()=>{
 const mask=createTerrainExcavationMask(),root=new Container3D();
 try{const roads=await createRoadTransitions({region:'fixture',json:async()=>({joins:[],skipped:[]}),texture:async()=>Texture.WHITE,geo:g=>g,
  mat:m=>{mask.bind(m);return m;},hexBit:{name:'fixtureHex'},groundBit:mask.bit,weatherSurfaceBit:packedWeatherSurfaceBit,
  weatherMaterial:m=>{for(const name of packedWeatherSurfaceBit.textures)m.textures[name]=Texture.WHITE;return m;},
  materials:{a:{file:'a',normalFile:'aNormal'},b:{file:'b',normalFile:'bNormal'}}});
  await roads.addPrepared({root,sourceTriangles:1,transitionTriangles:1,groups:new Map([['join',{join:{a:'a',b:'b'},
   p:[0,0,0,1,0,0,0,0,1],n:[0,1,0,0,1,0,0,1,0],uv:[0,0,1,0,0,1],ix:[0,1,2],extra:new Array(12).fill(0),native:new Array(12).fill(0)}]])});
  const material=root.children[0].material;assert.equal(material._textures.length,8);assert.equal(material.textures.occlusion,Texture.WHITE);
  assert.equal(material.textures.metallicRoughness,Texture.WHITE);assert.equal(material.textures.groundExcavations.source.width,256);
 }finally{root.destroy({children:true,geometry:true,material:true});mask.destroy();}
});


test('road shoulder excavation shares the existing group within the portable four-group GPU limit',async()=>{
 const mask=createTerrainExcavationMask(),pass=new RoadShoulderPass({terrainPass:{excavationMask:mask},geo:g=>g,release(){}});
 const meta={region:'fixture',buckets:[{start:0,count:1}],layers:[],snowSlice:0};
 const {bits,template}=roadShoulderShader(meta,mask),shader=compileNativeTerrainShader({material3d:{compileIsolatedShader:MaterialSystemGpu.prototype.compileIsolatedShader}},bits,template);
 try{assert.equal(shader.gpuProgram.gpuLayout.length,4);
  assert.equal(shader.gpuProgram.gpuLayout[3].length,4);
  assert.equal(shader.gpuProgram.gpuLayout[0].filter(e=>e.texture).length,3);
  assert.equal(shader.gpuProgram.gpuLayout[0].length,7);
  const nativeMeta={...meta,buckets:[{start:0,count:8},{start:8,count:30},{start:38,count:1}]};
  const native=roadShoulderShader(nativeMeta,mask),actual=compileNativeTerrainShader({material3d:{compileIsolatedShader:MaterialSystemGpu.prototype.compileIsolatedShader}},native.bits,native.template);
  assert.ok(actual.gpuProgram.gpuLayout.flat().filter(e=>e.texture).length<=16);actual.destroy();
  await pass.prepare({region:'fixture',json:async()=>({width:1,height:1,compressedBytes:1}),zipped:async()=>new Uint8Array([0]),terrain:()=>0});
  assert.equal(pass.group.getResource(3),mask.source);
  assert.equal(pass.uniforms.uniforms.excavationInfo,mask.info);
  assert.deepEqual(template.bindGroups,['global','camera','terrain','roadEdges']);
 }finally{shader.destroy();pass.destroy();mask.destroy();}
});


test('native terrain reuses only lighting bindings without mutating the shared model group',()=>{
 const resources=Array.from({length:15},(_,i)=>({_resourceId:i})),shared=new BindGroup(Object.fromEntries(resources.map((v,i)=>[i,v])));
 const session={renderer:{},globalBindGroup:shared},native=nativeTerrainGlobalGroup(session);
 try{assert.deepEqual(Object.keys(native.resources),['0','1','2','3','4','5','6']);
  for(let i=0;i<7;i++)assert.equal(native.getResource(i),shared.getResource(i));
  const replacement={_resourceId:20};shared.setResource(replacement,2);
  assert.equal(nativeTerrainGlobalGroup(session,native),native);assert.equal(native.getResource(2),replacement);
  assert.equal(shared.getResource(10),resources[10]);assert.equal(Object.keys(shared.resources).length,15);
  assert.equal(nativeTerrainGlobalGroup({...session,renderer:{gl:{}}}),shared);
 }finally{native.destroy();assert.equal(shared.getResource(0),resources[0]);shared.destroy();}
});
