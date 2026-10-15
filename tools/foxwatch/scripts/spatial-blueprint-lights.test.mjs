import assert from 'node:assert/strict';
import test from 'node:test';
import {attachSpatialBlueprintLights} from './spatial-blueprint-lights.mjs';
const document = () => ({nodes:[{name:'wall-group'}],scene:0,scenes:[{nodes:[0]}]});
const source = extra => ({type:'spot',intensity:100,intensityUnits:'Candelas',attenuationRadius:1200,outerConeAngle:35,innerConeAngle:8,color:[1,.5,0],enabled:true,...extra});
const row = extra => ({name:'fixture',translation:[1,2,3],direction:[0,-1,0],source:source(),...extra});
test('authored spot placement, direction, cone, color and photometry survive export',()=>{
 const doc=document(); assert.equal(attachSpatialBlueprintLights(doc,{blueprintLights:[row()]}),1);
 const light=doc.extensions.KHR_lights_punctual.lights[0],node=doc.nodes[1];
 assert.deepEqual(node.translation,[1,2,3]);assert.equal(light.range,12);assert.equal(light.intensity,100);
 assert.equal(light.spot.outerConeAngle,35*Math.PI/180);assert.equal(light.spot.innerConeAngle,8*Math.PI/180);
 assert.ok(Math.abs(light.color[1]-.21404114)<1e-7);assert.deepEqual(doc.scenes[0].nodes,[0,1]);
 // Rotation of glTF's -Z spotlight axis by q must follow the authored direction.
 const [x,y,z,w]=node.rotation;const direction=[-2*(x*z+y*w),-2*(y*z-x*w),-(1-2*(x*x+y*y))];
 direction.forEach((n,i)=>assert.ok(Math.abs(n-[0,-1,0][i])<1e-6));
});
test('point fixtures and disabled modification fixtures retain their defaults and groups',()=>{
 const doc=document(); attachSpatialBlueprintLights(doc,{semanticGroups:{wall:'wall-group'},blueprintLights:[
 row({group:'wall',source:source({type:'point',enabled:false,intensityUnits:'Lumens',intensity:4*Math.PI})})]});
 assert.deepEqual(doc.nodes[0].children,[1]);assert.equal(doc.nodes[1].extensions.KHR_node_visibility.visible,false);
 const light=doc.extensions.KHR_lights_punctual.lights[0];assert.equal(light.intensity,0);assert.equal(light.spot,undefined);
 assert.equal(doc.nodes[1].extras.nixieBlueprintLight.candela,1);
});
test('legacy unitless and custom attenuation remain bounded and explicit',()=>{
 for(const custom of [false,true]){
 const doc=document();attachSpatialBlueprintLights(doc,{blueprintLights:[row({source:source({intensity:625,intensityUnits:'Unitless',useInverseSquaredFalloff:!custom,lightFalloffExponent:4,useTemperature:true,temperature:3000})})]});
 const light=doc.extensions.KHR_lights_punctual.lights[0];assert.ok(light.color.every(n=>Number.isFinite(n)&&n>=0&&n<=1));
 if(!custom)assert.equal(light.intensity,1);else assert.equal(doc.nodes[1].extras.nixieBlueprintLight.falloffApproximation,'inverse-square-midpoint');
 }
});
test('malformed lights and missing groups fail instead of silently emitting broken fixtures',()=>{
 assert.equal(attachSpatialBlueprintLights(document(),{}),0);
 for(const bad of [row({direction:[0,0,0]}),row({group:'missing'}),row({source:source({intensity:NaN})}),row({source:source({attenuationRadius:-2})})])
 assert.throws(()=>attachSpatialBlueprintLights(document(),{blueprintLights:[bad]}));
 assert.throws(()=>attachSpatialBlueprintLights(document(),{blueprintLights:Array(65).fill(row())}));
});
