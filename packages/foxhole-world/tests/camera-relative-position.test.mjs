import test from 'node:test';
import assert from 'node:assert/strict';
import {Camera3D,Matrix4} from '@pixi/3d';
import {cameraRelativeClipPosition} from '../runtime/camera-relative-position.mjs';
import {framedMaterialBits,framedTerrainTemplate} from '../runtime/spatial-frame.mjs';
import {liveTerrainTemplate} from '../authoring/live-terrain-shader.mjs';
import {roadShoulderShader} from '../authoring/road-shoulders.mjs';

// Round each GPU multiply/add, including the homogeneous divide. CPU double
// arithmetic alone hides the depth reversals caused by a large map translation.
const f=Math.fround;
function multiply(m,p){return [0,1,2,3].map(r=>f(f(f(f(m[r]*p[0])+f(m[r+4]*p[1]))+f(m[r+8]*p[2]))+m[r+12]));}
function depth(p){return f(p[2]/p[3]);}

test('the reported Tempest camera retains thin surface ordering throughout a full orbit',()=>{
 const eye=[216960.19921197867,996.2739738173675,967.4353533435678];
 const target=[217869.6965922134,1284.70087040003,-.015807171404978927];
 const distance=Math.hypot(...eye.map((v,i)=>v-target[i]));
 const camera=new Camera3D({near:distance*.02,far:distance*24});
 let previousReversals=0;
 for(const mode of ['perspective','orthographic']){
  camera.mode=mode;camera.orthographicSize=6132.292594766694;
  for(let turn=0;turn<360;turn++){
   const a=turn*Math.PI/180,dx=eye[0]-target[0],dy=eye[1]-target[1];
   camera.position.set(target[0]+dx*Math.cos(a)-dy*Math.sin(a),target[1]+dx*Math.sin(a)+dy*Math.cos(a),eye[2]);
   camera.lookAt({x:target[0],y:target[1],z:target[2]},{x:0,y:0,z:1});
   const view=new Matrix4().getInverse(camera.getGlobalTransform(new Matrix4())).elements;
   const projection=camera.computeProjection(1846/1163,new Matrix4());
   const vp=new Matrix4().multiplyMatrices(projection,{elements:view}).elements;
   const rotation=[...view.slice(0,12),0,0,0,1],position=[camera.position.x,camera.position.y,camera.position.z].map(f);
   const relative=p=>multiply(projection.elements,multiply(rotation,p.map((v,i)=>f(v-position[i]))));
   for(const z of [0,10,100,500]){
    const lower=[f(target[0]),f(target[1]),z],upper=[lower[0],lower[1],f(z+.05)];
    if(depth(multiply(vp,lower))<=depth(multiply(vp,upper)))previousReversals++;
    assert.ok(depth(relative(lower))>depth(relative(upper)),`${mode} lost surface ordering at ${turn} degrees and height ${z}`);
   }
  }
 }
 assert.ok(previousReversals>0,'the fixture must expose the previous combined-matrix precision failure');
});

test('framed terrain, shoulders and materials use the same camera-relative projection on both backends',()=>{
 const end=framedMaterialBits([])[0];
 assert.equal(end.gpu.vertex.end,'clipPosition = '+cameraRelativeClipPosition('worldPosition.xyz',true)+';');
 assert.equal(end.gl.vertex.end,'gl_Position = '+cameraRelativeClipPosition('worldPosition.xyz',false)+';');
 for(const template of [liveTerrainTemplate,roadShoulderShader({},null,'plain').template]){
  const framed=framedTerrainTemplate(template);
  assert.ok(framed.gpu.includes(cameraRelativeClipPosition('wp',true)));
  assert.ok(framed.gl.vertex.includes(cameraRelativeClipPosition('vPosition',false)));
  assert.ok(framed.gpu.includes('out.vPosition=wp;'),'lighting and native texture coordinates stay in world space');
 }
 // Terrain invokes fragment framing twice, so it must not inject mesh locals.
 assert.equal(framedMaterialBits([],'terrain').at(-1).gpu.vertex,undefined);
});


test('frame preparation covers imported model materials and caches each environment descriptor',async()=>{
 const {Container3D,Mesh3D,Material3D,Geometry3D,View3D,BaseMaterial3D}=await import('@pixi/3d');
 const {applyRegionFrame}=await import('../runtime/spatial-frame.mjs');
 const view=new View3D(),root=new Container3D(),material=new Material3D({roughness:.94});
 const mesh=new Mesh3D({material,geometry:new Geometry3D({positions:new Float32Array([0,0,0,1,0,0,0,0,1]),indices:new Uint32Array([0,1,2])})});root.addChild(mesh);
 const original=material.getPrimaryDescriptor(view);
 applyRegionFrame({root,materials:[],terrainPass:{}},{x:209663.9904,y:0,scale:32});
 const fixed=material.getPrimaryDescriptor(view);assert.notEqual(fixed,original);assert.equal(material.getPrimaryDescriptor(view),fixed);
 assert.ok(fixed.bitsGpu.some(bit=>bit.name==='foxholeCameraRelativeProjection'));assert.equal(mesh.material,material);assert.equal(material.roughness,Math.fround(.94));
 const {prepareCameraRelativeMaterial}=await import('../runtime/camera-relative-material.mjs');
 prepareCameraRelativeMaterial(material);assert.equal(material.getPrimaryDescriptor(view),fixed,'later streamed cells never stack wrappers');
 const custom=new BaseMaterial3D({descriptor:{template:{gpu:'custom'}}});const descriptor=custom.getPrimaryDescriptor(view);prepareCameraRelativeMaterial(custom);assert.equal(custom.getPrimaryDescriptor(view),descriptor,'custom shaders retain their own coordinate contract');
 root.destroy({children:true});view.destroy();material.destroy();custom.destroy();
});


test('camera-relative projection runs before authored depth offsets',()=>{
 const bits=framedMaterialBits([{name:'nativeDepthOffset',gpu:{vertex:{end:'clipPosition.z -= 0.00001;'}},gl:{vertex:{end:'gl_Position.z -= 0.00001;'}}}]);
 assert.ok(bits[0].gpu.vertex.end.includes('camera.uProjectionMatrix'));
 assert.equal(bits[1].gpu.vertex.end,'clipPosition.z -= 0.00001;');
 assert.equal(bits[1].gl.vertex.end,'gl_Position.z -= 0.00001;');
 assert.equal(bits.at(-1).gpu.vertex,undefined);
});
