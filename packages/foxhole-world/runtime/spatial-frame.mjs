import {Mesh3D,BatchedMesh3D} from '@pixi/3d';
import {prepareCameraRelativeMaterial} from './camera-relative-material.mjs';
import {cameraRelativeClipPosition} from './camera-relative-position.mjs';
import {createMirroredGeometryCache} from '../authoring/mirrored-geometry.mjs';
// Foxhole exports use metres/Y-up. Nixie uses board pixels/Z-up.
export function framedMaterialBits(bits,group='material') {
 const f=group+'.foxholeFrame',glF=group==='material'?f:'foxholeFrame';
 const position=(p,gpu)=>{const frame=gpu?f:glF,v=gpu?'vec3<f32>':'vec3';return `${v}((${p}.x-${frame}.x)/${frame}.z,${p}.z/${frame}.z,(${p}.y-${frame}.y)/${frame}.z)`;};
 const normal=(p,gpu)=>`${gpu?'vec3<f32>':'vec3'}(${p}.x,${p}.z,${p}.y)`;
 const begin=gpu=>`normal=${normal('normal',gpu)};viewDir=${normal('viewDir',gpu)};specularNormal=normal;`;
 const end=gpu=>`normal=${gpu?'vec3<f32>':'vec3'}(normal.x,normal.z,normal.y);viewDir=${gpu?'vec3<f32>':'vec3'}(viewDir.x,viewDir.z,viewDir.y);specularNormal=${gpu?'vec3<f32>':'vec3'}(specularNormal.x,specularNormal.z,specularNormal.y);`;
 const converted=bits.map(bit=>{
  const result=structuredClone(bit);result.name=bit.name+':foxhole-frame:'+group;
  // Reflections run after material-frame restoration and deliberately use world
  // positions/normals. Only the unit scale and water-plane up axis change.
  if(bit.name==='foxholeWaterScreenReflections'){
   for(const backend of ['gpu','gl']){const stage=result[backend];if(!stage?.fragment?.lighting)continue;stage.fragment.lighting=stage.fragment.lighting.replace(backend==='gpu'?'vec3<f32>(0.0,1.0,0.0),roughness,1.0':'vec3(0.0,1.0,0.0),roughness,1.0',backend==='gpu'?`vec3<f32>(0.0,0.0,1.0),roughness,${f}.z`:`vec3(0.0,0.0,1.0),roughness,${glF}.z`);}
   return result;
  }
  if(bit.name==='regionShellCutDepth')for(const backend of ['gpu','gl'])if(result[backend]?.vertex?.end)result[backend].vertex.end=result[backend].vertex.end.replaceAll('worldNormal.y','worldNormal.z');
  for(const [backend,gpu]of [['gpu',true],['gl',false]]){
   const stage=result[backend];if(!stage)continue;
   if(bit.name==='foxholeNativeWater2'){
    const frame=gpu?f:glF,local='foxholeFrame';
    const toWorld=gpu?'fn foxholeNativeToWorld(p:vec3<f32>,foxholeFrame:vec4<f32>)->vec3<f32>{return vec3<f32>(p.x*foxholeFrame.z+foxholeFrame.x,p.z*foxholeFrame.z+foxholeFrame.y,p.y*foxholeFrame.z);}':'vec3 foxholeNativeToWorld(vec3 p,vec4 foxholeFrame){return vec3(p.x*foxholeFrame.z+foxholeFrame.x,p.z*foxholeFrame.z+foxholeFrame.y,p.y*foxholeFrame.z);}';
    const depth=gpu?'fn foxholeNativeViewDepth(p:vec3<f32>,foxholeFrame:vec4<f32>)->f32{return -(camera.uViewMatrix*vec4<f32>(foxholeNativeToWorld(p,foxholeFrame),1.0)).z/foxholeFrame.z;}':'float foxholeNativeViewDepth(vec3 p,vec4 foxholeFrame){return -(uViewMatrix*vec4(foxholeNativeToWorld(p,foxholeFrame),1.0)).z/foxholeFrame.z;}';
    stage.header=toWorld+'\n'+depth+'\n'+stage.header.replace(gpu?'waterSceneDepth(p:vec3<f32>)':'waterSceneDepth(vec3 p)',gpu?'waterSceneDepth(p:vec3<f32>,foxholeFrame:vec4<f32>)':'waterSceneDepth(vec3 p,vec4 foxholeFrame)').replaceAll('screenUVFromWorld(p)','screenUVFromWorld(foxholeNativeToWorld(p,foxholeFrame))').replace(/return abs\(([^;]+)\);/g,'return abs($1)/foxholeFrame.z;');
    stage.fragment.material=stage.fragment.material.replace(gpu?'-(camera.uViewMatrix*vec4<f32>(input.vPosition,1.0)).z':'-(uViewMatrix*vec4(vPosition,1.0)).z',gpu?`foxholeNativeViewDepth(input.vPosition,${frame})`:`foxholeNativeViewDepth(vPosition,${frame})`).replace(/waterSceneDepth\((vPosition|input.vPosition|refractedPoint)\)/g,`waterSceneDepth($1,${frame})`).replace('uBrdfLutSampler,refractedPoint,',`uBrdfLutSampler,foxholeNativeToWorld(refractedPoint,${frame}),`).replace('uOpaqueColorTexture,refractedPoint,',`uOpaqueColorTexture,foxholeNativeToWorld(refractedPoint,${frame}),`);
   }
   if(stage.fragment)for(const key of Object.keys(stage.fragment)){
    let code=stage.fragment[key];if(typeof code!=='string')continue;
    code=code.replaceAll(gpu?'input.vPosition':'vPosition',position(gpu?'input.vPosition':'vPosition',gpu)).replaceAll(gpu?'input.vNormal':'vNormal',normal(gpu?'input.vNormal':'vNormal',gpu));
    stage.fragment[key]=code;
   }
  }
  return result;
 });
 return [{name:'foxholeNativeFrameBegin:'+group,bindings:{[group]:{foxholeFrame:'vec4<f32>'}},gpu:{fragment:{material:begin(true)},...(group==='material'?{vertex:{end:'clipPosition = '+cameraRelativeClipPosition('worldPosition.xyz',true)+';'}}:{})},gl:{fragment:{material:begin(false)},...(group==='material'?{vertex:{end:'gl_Position = '+cameraRelativeClipPosition('worldPosition.xyz',false)+';'}}:{})}},...converted,{name:'foxholeNativeFrameEnd:'+group,gpu:{fragment:{material:end(true)}},gl:{fragment:{material:end(false)}}}];
}

export function framedTerrainTemplate(template){
 const t=structuredClone(template);
 t.gpu=t.gpu.replace('out.position=camera.uViewProjectionMatrix*vec4<f32>(input.aPosition,1.0);out.vPosition=input.aPosition;out.vNormal=input.aNormal;',
  'let wp=vec3<f32>(input.aPosition.x*terrain.foxholeFrame.z+terrain.foxholeFrame.x,input.aPosition.z*terrain.foxholeFrame.z+terrain.foxholeFrame.y,input.aPosition.y*terrain.foxholeFrame.z);out.position='+cameraRelativeClipPosition('wp',true)+';out.vPosition=wp;out.vNormal=vec3<f32>(input.aNormal.x,input.aNormal.z,input.aNormal.y);');
 t.gl.vertex=t.gl.vertex.replace('vPosition=aPosition;','vPosition=vec3(aPosition.x*foxholeFrame.z+foxholeFrame.x,aPosition.z*foxholeFrame.z+foxholeFrame.y,aPosition.y*foxholeFrame.z);').replace('vNormal=aNormal;','vNormal=vec3(aNormal.x,aNormal.z,aNormal.y);').replace('gl_Position=uViewProjectionMatrix*vec4(aPosition,1.0);','gl_Position='+cameraRelativeClipPosition('vPosition',false)+';');
 return t;
}

export function createRegionFramePreparation(region,{x=0,y=0,scale=32}={}){
 region.root.position.set(x,-y,0);region.root.rotation.x=Math.PI/2;region.root.scale.set(scale,scale,-scale);
 // The north/south reflection changes winding. Keep cached source geometry intact.
 const winding=createMirroredGeometryCache(),prepared=new WeakSet(),derivedSource=Symbol.for('nixie.spatial.derived-geometry-source');
 const geometry=g=>{
  // Host simplification preserves the winding of its source. Preparing an
  // arriving cell must not reflect that derived geometry a second time.
  let source=g;for(let depth=0;source&&depth<16;depth++,source=source[derivedSource])if(prepared.has(source)){prepared.add(g);return g;}
  const result=winding.get(g);prepared.add(result);return result;
 };const visit=node=>{if(node instanceof BatchedMesh3D){node.items.forEach((item,i)=>{if(item.material)prepareCameraRelativeMaterial(item.material);if(item.geometry){const next=geometry(item.geometry);if(next!==item.geometry)node.setGeometryAt(i,next);}});}else if(node instanceof Mesh3D&&node.geometry){if(node.material)prepareCameraRelativeMaterial(node.material);const next=geometry(node.geometry);if(next!==node.geometry)node.geometry=next;}for(const child of node.children)visit(child);};region.root.once('destroyed',()=>winding.destroy());
 const frame=new Float32Array([x,-y,scale,0]);
 region.terrainPass.frame=frame;
 return {frame,prepare(node=region.root){visit(node);for(const material of region.materials)material.data.foxholeFrame=frame;}};
}

export function applyRegionFrame(region,frame){const preparation=createRegionFramePreparation(region,frame);preparation.prepare();return preparation.frame;}

