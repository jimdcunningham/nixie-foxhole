import test from 'node:test';
import assert from 'node:assert/strict';
import {Container3D,View3D,Material3D,pbrLightingBit,shadowBitsGpu,shadowBitsGl} from '@pixi/3d';
import {worldShadowBit,shadowAppearanceKey} from '../authoring/shadow-appearance.mjs';
import {nativeWaterBit} from '../authoring/native-water-bit.mjs';
import {framedMaterialBits} from '../runtime/spatial-frame.mjs';
import {prepareCameraRelativeMaterial} from '../runtime/camera-relative-material.mjs';
import {FoxholeRegionSceneController} from '../../extensions/foxhole/app/plugins/foxhole/nixie/map/region-scene-controller.mjs';
test('shadow contrast and kernel width change independently and leave vendor bits intact',()=>{
 const view={[shadowAppearanceKey]:{soft:true,strength:'light'}};
 for(const [backend,bits,anchor]of [['gpu',shadowBitsGpu,'2.5 / sp.z'],['gl',shadowBitsGl,'2.5 / params.z']]){
  const source=bits['pcf-high'],fixed=worldShadowBit(source,view);assert.notEqual(fixed,source);assert.ok(fixed[backend].header.includes(anchor));assert.ok(!source[backend].header.includes(anchor));assert.equal(worldShadowBit(source,view),fixed);
  assert.ok(worldShadowBit(pbrLightingBit,view)[backend].fragment.lighting.includes('mix(1.0, shadow, 0.45)'));
  view[shadowAppearanceKey]={soft:false,strength:'strong'};assert.equal(worldShadowBit(source,view)[backend].header,source[backend].header);assert.ok(worldShadowBit(pbrLightingBit,view)[backend].fragment.lighting.includes('mix(1.0, shadow, 1.0)'));view[shadowAppearanceKey]={soft:true,strength:'light'};
 }
 assert.equal(worldShadowBit(pbrLightingBit,{}),pbrLightingBit);
});
test('live appearance switches reuse descriptors without stacking projection or changing source materials',()=>{
 const view=new View3D(),m=new Material3D();prepareCameraRelativeMaterial(m);const original=m.getPrimaryDescriptor(view);
 view[shadowAppearanceKey]={soft:true,strength:'light'};const light=m.getPrimaryDescriptor(view);assert.notEqual(light,original);assert.equal(m.getPrimaryDescriptor(view),light);
 view[shadowAppearanceKey]={soft:false,strength:'strong'};assert.notEqual(m.getPrimaryDescriptor(view),light);
 view[shadowAppearanceKey]={soft:true,strength:'light'};assert.equal(m.getPrimaryDescriptor(view),light);assert.equal(light.bitsGpu.filter(b=>b.name==='foxholeCameraRelativeProjection').length,1);m.destroy();view.destroy();
});
test('reflection and vegetation switches propagate during preparation and after arrival without reloads',async()=>{
 const view=new View3D(),calls=[],scene={root:new Container3D(),passes:[],metrics:{},setWaterReflections:v=>calls.push(['water',v]),setVegetationShadows:v=>calls.push(['vegetation',v]),destroy(){}};let loads=0,finish;
 const previous={soft:false,strength:'strong'};view[shadowAppearanceKey]=previous;
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{fixture:{id:'fixture'}}})),loadRegion:async options=>{loads++;options.onSceneCreated(scene);await new Promise(r=>finish=r);return scene;}});
 const settings={enabled:true,regionKeys:['fixtureHex'],waterReflections:true,vegetationShadows:true};const sync=()=>controller.sync({view,settings,mode:'3d'});
 try{sync();await new Promise(r=>setTimeout(r,0));Object.assign(settings,{waterReflections:false,vegetationShadows:false,softShadows:false,shadowStrength:'strong'});sync();assert.deepEqual(calls.slice(-2),[['water',false],['vegetation',false]]);finish();await new Promise(r=>setTimeout(r,0));sync();assert.equal(loads,1);assert.deepEqual(calls.slice(-2),[['water',false],['vegetation',false]]);controller.destroy();assert.equal(view[shadowAppearanceKey],previous);}finally{controller.destroy();view.destroy({children:true});}
});

test('water highlight replacement follows the PBR shadow strength on both backends',()=>{
 for(const backend of ['gl','gpu'])for(const [strength,value] of [['light','0.45'],['medium','0.7'],['strong','1.0']]){
  const view={[shadowAppearanceKey]:{soft:false,strength}};
  const pbr=worldShadowBit(pbrLightingBit,view)[backend].fragment.lighting;
  const water=worldShadowBit(nativeWaterBit,view)[backend].fragment.lobePerLight;
  assert.ok(pbr.includes('mix(1.0, shadow, '+value+')'));
  assert.ok(water.includes('mix(1.0, shadow, '+value+')'));
  assert.ok(nativeWaterBit[backend].fragment.lobePerLight.includes('*shadow;'));
 }
});


test('board-framed water uses the same shadow attenuation as PBR in the host descriptor',()=>{
 const view=new View3D(),bits=framedMaterialBits([nativeWaterBit]),material=new Material3D({extraBits:bits});
 prepareCameraRelativeMaterial(material);
 try{
  for(const soft of [false,true])for(const [strength,value]of [['light','0.45'],['medium','0.7'],['strong','1.0']]){
   view[shadowAppearanceKey]={soft,strength};const descriptor=material.getPrimaryDescriptor(view);
   for(const [backend,key]of [['gpu','bitsGpu'],['gl','bitsGl']]){
    const pbr=descriptor[key].find(bit=>bit.name.startsWith('pbrLighting'))[backend].fragment.lighting;
    const water=descriptor[key].find(bit=>bit.name.startsWith('foxholeNativeWater2:foxhole-frame:material'))[backend].fragment.lobePerLight;
    const attenuation='mix(1.0, shadow, '+value+')';
    assert.ok(pbr.includes(attenuation),'PBR follows '+strength+' shadows');
    assert.ok(water.includes(attenuation),backend+' board-framed water must replace the same shadowed specular energy');
    assert.doesNotMatch(water,/\*shadow;/,'no unadjusted specular correction remains');
   }
   assert.equal(material.getPrimaryDescriptor(view),descriptor,'the adapted descriptor is reused');
  }
  for(const backend of ['gl','gpu'])assert.match(bits.find(bit=>bit.name.startsWith('foxholeNativeWater2'))[backend].fragment.lobePerLight,/\*shadow;/,'source shader stays unmodified');
 }finally{material.destroy();view.destroy();}
});
