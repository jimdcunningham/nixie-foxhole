import {worldShadowBit,shadowAppearanceId} from './shadow-appearance.mjs';
import {createTerrainPlanningOverlays} from './terrain-planning-overlays.mjs';
import {simpleTerrainBit} from './simple-terrain-shader.mjs';
import {terrainTextureTier} from '../runtime/terrain-texture-quality.mjs';
import {compileNativeTerrainShader,nativeTerrainGlobalGroup} from './native-terrain-bindings.mjs';
import {framedMaterialBits,framedTerrainTemplate} from '../runtime/spatial-frame.mjs';
import {BufferImageSource,UniformGroup,BindGroup,State,CubeTexture} from 'pixi.js';
import {Pass3D,RenderPass,getCameraData,pbrLightingBit,iblBit,envSourceCubeBit,envSourceHemisphereBit,envSourceDefaultBit,shadowBitsGpu,shadowBitsGl,acesToneMappingBit} from '@pixi/3d';
import {liveTerrainBit,liveTerrainTemplate} from './live-terrain-shader.mjs';

class NativeTerrainDraw extends RenderPass {
 constructor(renderer,owner){super({renderer,name:'native-terrain-surface'});this.owner=owner;this.shader=null;this.key='';this.state=new State();this.state.depthTest=true;this.state.depthMask=true;this.state.culling=false;this.state.blend=false;}
 setup(b){b.writeColor(b.targetColor);b.writeDepth(b.targetDepth);}
 condition(){return this.owner.visible&&!!this.owner.current?.geometry;}
 render(session){const current=this.owner.current;if(!this.owner.visible||!current)return;const gl='gl' in session.renderer,env=session.view3d.environment instanceof CubeTexture?'cube':session.view3d.environment?'hemisphere':'none',filter=session.view3d.shadowFilter||'pcf',key=shadowAppearanceId(session.view3d)+current.meta.region+env+filter+(current.surface||'native')+this.owner.generation;
  if(!this.shader||key!==this.key){this.shader?.destroy();const shadows=(gl?shadowBitsGl:shadowBitsGpu)[filter]||(gl?shadowBitsGl:shadowBitsGpu).pcf;
   const mask=this.owner.excavationMask,base=mask?{...liveTerrainTemplate,bindGroups:[...liveTerrainTemplate.bindGroups,'excavation']}:liveTerrainTemplate,bits=[current.surface&&current.surface!=='native'?simpleTerrainBit(current.surface):liveTerrainBit(current.meta),...(mask?[mask.nativeBit]:[])];
   this.shader=compileNativeTerrainShader(this.pipe.renderer,[...(this.owner.frame?framedMaterialBits(bits,'terrain'):bits),worldShadowBit(shadows,session.view3d),env==='cube'?envSourceCubeBit:env==='hemisphere'?envSourceHemisphereBit:envSourceDefaultBit,iblBit,worldShadowBit(pbrLightingBit,session.view3d),acesToneMappingBit,...(this.owner.frame?framedMaterialBits([this.owner.planning.bit],'terrain'):[this.owner.planning.bit])],this.owner.frame?framedTerrainTemplate(base):base);this.key=key;
  }
  if(current.uniforms.uniforms.weather){current.uniforms.uniforms.weather[0]=this.owner.weather.wetness;current.uniforms.uniforms.weather[1]=this.owner.weather.snow;current.uniforms.update();}
  
  this.shader.groups[0]=gl?session.globalBindGroup:(this.globalGroup=nativeTerrainGlobalGroup(session,this.globalGroup));this.shader.groups[1]=getCameraData(session.view3d.camera).bindGroup;this.shader.groups[2]=current.group;
  if(this.owner.excavationMask)this.shader.groups[3]=this.owner.excavationMask.group;
  const geometries=this.owner.geometryLod?this.owner.geometryLod.getDraws(getCameraData(session.view3d.camera).frustum?.planesData):[current.geometry];
  for(const geometry of geometries)this.pipe.renderGeometry(geometry,this.shader,this.state);
 }
 destroy(){this.shader?.destroy();this.shader=null;this.globalGroup?.destroy();this.globalGroup=null;}
}
export class LiveTerrainPass extends Pass3D {
 constructor(){super();this.planning=createTerrainPlanningOverlays();this.generation=0;this.overrideSize=null;this.requestedSize=128;this.stage='afterOpaque';this.visible=true;this.current=null;this.weather={wetness:0,snow:0};this.environment='game';}
 build(graph,io){graph.addPass(new NativeTerrainDraw(io.renderer,this));}
 clear(){this.generation++;this.textureContext=null;const old=this.current;this.current=null;if(old){old.group.destroy();old.textureSet?.release();for(const source of old.ownedSources||old.sources)source.destroy();}}
 destroy(){this.clear();this.planning.destroy();}
 setPlanningOverlays(options,state){if(this.planning.set(options,state))this.current?.uniforms.update();}
 async load(region,geometry,{json,zipped,status,prepareTerrain=()=>{},terrainDescriptor,texturePool,signal,surface='native',texture}){
  this.clear();const generation=this.generation;
  if(surface==='plain'||surface==='map'){
   status(surface==='map'?'Loading processed terrain map…':'Preparing plain terrain…');
   const paint=surface==='map'?await texture(region+'/map/terrain.webp'):null;
   if(generation!==this.generation||signal?.aborted)throw signal?.reason||new DOMException('Terrain retired','AbortError');
   const uniforms=new UniformGroup({...(this.frame?{foxholeFrame:{value:this.frame,type:'vec4<f32>'}}:{}),surfaceColor:{value:new Float32Array([.195,.216,.119,1]),type:'vec4<f32>'},terrainOverlayInfo:{value:this.planning.info,type:'vec4<f32>'}});
   const group=new BindGroup({0:uniforms,...(paint?{1:paint.source,2:paint.source.style}:{}),[paint?3:1]:this.planning.source});
   // The provider owns the map bitmap. No native arrays, masks or weather textures
   // are requested or retained by these two lightweight surface modes.
   this.current={meta:{region},surface,geometry,uniforms,group,sources:paint?[paint.source]:[],ownedSources:[],qualityCap:0};
   return {surface};
  }
  status('Loading native terrain material textures…');const meta=await json(`${region}/terrain-live/material.json`),sources=[],arraySources=[];
  const source=async(data,width,height,layers,format,repeat=true,array=true)=>{const s=new BufferImageSource({resource:new Uint8Array(data),width,height,arrayLayerCount:layers,viewDimension:array?'2d-array':'2d',format,alphaMode:'no-premultiply-alpha',autoGenerateMipmaps:true,scaleMode:'linear',mipmapFilter:'linear',addressMode:repeat?'repeat':'clamp-to-edge',maxAnisotropy:16});sources.push(s);await prepareTerrain(s);return s;};
  let textureSet;
  try{
  let weight;
  const descriptors=terrainDescriptor?meta.buckets.flatMap((bucket,i)=>['albedo','normal'].map(name=>terrainDescriptor(`${region}/terrain-live/${name}-${i}.bin.gz`,name==='albedo'?'color':'normal'))).concat(terrainDescriptor(`${region}/terrain-live/weights.bin.gz`,'weights',{width:meta.weights.width,height:meta.weights.height,layers:meta.layers.length})):null;
  if(descriptors){textureSet=await texturePool.acquire(descriptors,128,{signal});if(generation!==this.generation||signal?.aborted){textureSet.release();throw signal?.reason||new DOMException('Terrain retired','AbortError');}arraySources.push(...textureSet.sources.slice(0,-1));weight=textureSet.sources.at(-1);for(const resource of textureSet.sources)await prepareTerrain(resource);}
  else{for(const [i,b]of meta.buckets.entries()){for(const name of ['albedo','normal']){const bytes=await zipped(`${region}/terrain-live/${name}-${i}.bin.gz`);arraySources.push(await source(bytes,b.size,b.size,b.count,name==='albedo'?'rgba8unorm-srgb':'rgba8unorm'));}}weight=await source(await zipped(`${region}/terrain-live/weights.bin.gz`),meta.weights.width,meta.weights.height,meta.layers.length,'r8unorm',false);}

  const noise=await source(await zipped(`${region}/terrain-live/noise.bin.gz`),meta.noise.width,meta.noise.height,1,'rgba8unorm',true,false);
  const snowMaterial=await source(await zipped(`${region}/terrain-live/snowMaterial.bin.gz`),meta.snowMaterial.width,meta.snowMaterial.height,1,'rgba8unorm',true,false);
  const uniforms=new UniformGroup({...(this.frame?{foxholeFrame:{value:this.frame,type:'vec4<f32>'}}:{}),weightTransform:{value:new Float32Array([meta.weights.minX,meta.weights.maxZ,meta.weights.width,meta.weights.height]),type:'vec4<f32>'},weather:{value:new Float32Array(4),type:'vec4<f32>'},terrainOverlayInfo:{value:this.planning.info,type:'vec4<f32>'}});
  const groupFor=(arrays,weights)=>{const entries={0:uniforms};let slot=1;for(const resource of arrays)entries[slot++]=resource;for(const resource of [weights,arrays[0].style,weights.style,noise,snowMaterial,this.planning.source])entries[slot++]=resource;return new BindGroup(entries);};
  if(generation!==this.generation||signal?.aborted)throw signal?.reason||new DOMException('Terrain retired','AbortError');
  const group=groupFor(arraySources,weight);this.current={meta,geometry,sources:[...(textureSet?.sources||[]),...sources],ownedSources:sources,uniforms,group,textureSet,qualityCap:textureSet?.cap||Infinity};
  if(descriptors)this.textureContext={pool:texturePool,descriptors,groupFor,prepareTerrain,signal};
  return {...meta,layers:meta.layers.length,sourceResolution:meta.size,textureSlices:meta.slices};
  }catch(error){textureSet?.release();for(const s of sources)s.destroy();throw error;}
 }
 get textureQuality(){return {cap:this.current?.qualityCap,requested:this.requestedSize,pending:!!this.pendingQuality,error:this.qualityError,pool:this.textureContext?.pool.stats};}
 setTextureSize(size=null){this.overrideSize=size;const wanted=size||this.automaticSize||128;this.requestedSize=wanted;return this.changeTextureSize(wanted);}
 updateQuality(camera){
  if(!this.textureContext||!this.current)return;this.automaticSize=this.visible?terrainTextureTier(camera,this.current.geometry.bounds3D):128;
  const wanted=this.overrideSize||this.automaticSize,now=performance.now();if(wanted!==this.candidateSize){this.candidateSize=wanted;this.candidateSince=now;}
  const delay=wanted>this.current.qualityCap?180:900;
  if(wanted!==this.current.qualityCap&&now-this.candidateSince>=delay&&now>=(this.retryQualityAt||0)){this.requestedSize=wanted;void this.changeTextureSize(wanted).catch(error=>{if(!this.textureContext?.signal?.aborted){this.qualityError=String(error);this.retryQualityAt=performance.now()+10000;}});}
 }
 changeTextureSize(wanted){
  const context=this.textureContext;if(!context||!this.current||this.current.qualityCap===wanted)return Promise.resolve();
  if(this.pendingQuality&&this.pendingWanted===wanted)return this.pendingQuality;
  const generation=this.generation;this.pendingWanted=wanted;
  const task=context.pool.schedule(async()=>{
   const old=this.current;if(!old||generation!==this.generation||wanted!==this.requestedSize)return;
   const next=await context.pool.acquire(context.descriptors,wanted,{signal:context.signal});
   if(this.current!==old||generation!==this.generation||wanted!==this.requestedSize||context.signal?.aborted){next.release();return;}
   if(next.cap===old.qualityCap){next.release();this.retryQualityAt=performance.now()+2000;return;}
   try{for(const source of next.sources)await context.prepareTerrain(source);if(this.current!==old||generation!==this.generation||wanted!==this.requestedSize||context.signal?.aborted){next.release();return;}const group=context.groupFor(next.sources.slice(0,-1),next.sources.at(-1));
    this.current={...old,group,textureSet:next,qualityCap:next.cap,sources:[...next.sources,...old.ownedSources]};old.group.destroy();old.textureSet.release();this.qualityError=null;
   }catch(error){next.release();throw error;}
  });
  this.pendingQuality=task;void task.finally(()=>{if(this.pendingQuality===task)this.pendingQuality=null;}).catch(()=>{});return task;
 }

}

