import {BufferImageSource,Texture} from 'pixi.js';
import {rdzExemptions,CONTOUR_INTERVAL} from './terrain-overlay-policy.mjs';

// RGBA8 carries exact float bytes, as in the existing excavation mask. No float
// texture filtering feature, large raster mask, extra mesh or render pass needed.
export function terrainPlanningOverlayBit({water=false}={}){
 // Native water supplies its own body/foam albedo, leaving the PBR base-color
 // sampler free for the shared mask. Keep water within WebGL's eight packed
 // material samplers; adding a ninth aliases the first slot's four-bit index.
 const glSample=water?'sampleBaseColorDirect((vec2(i%256,i/256)+vec2(0.5))/vec2(256.0,max(1.0,ceil(info.z/64.0))))':'texelFetch(uTerrainExemptions,ivec2(i%256,i/256),0)';
 const gpuSample=water?'sampleBaseColorDirect((vec2<f32>(vec2<i32>(i%256,i/256))+vec2<f32>(0.5))/vec2<f32>(256.0,max(1.0,ceil(info.z/64.0))))':'textureLoad(uTerrainExemptions,vec2<i32>(i%256,i/256),0)';
 const gl=`${water?'vec4 sampleBaseColorDirect(vec2 uv);':''}
float planningScalar(int i${water?',vec4 info':''}){uvec4 b=uvec4(round(${glSample}*255.0));return uintBitsToFloat(b.x|(b.y<<8u)|(b.z<<16u)|(b.w<<24u));}
float planningContour(float h,float interval,float width){float d=abs(fract(h/interval+0.5)-0.5)*interval;return (1.0-smoothstep(width*0.5,width*1.5,d))*(1.0-smoothstep(interval*0.2,interval*0.45,width));}
`;
 const gpu=`
fn planningScalar(i:i32${water?',info:vec4<f32>':''})->f32{let b=vec4<u32>(round(${gpuSample}*255.0));return bitcast<f32>(b.x|(b.y<<8u)|(b.z<<16u)|(b.w<<24u));}
fn planningContour(h:f32,interval:f32,width:f32)->f32{let d=abs(fract(h/interval+0.5)-0.5)*interval;return (1.0-smoothstep(width*0.5,width*1.5,d))*(1.0-smoothstep(interval*0.2,interval*0.45,width));}
`;
 const coordinates=`vec3 planningPoint=vPosition;
float borderDistance=min(945.0-abs(planningPoint.z),(1092.0-abs(planningPoint.x)-abs(planningPoint.z)*(546.0/945.0))/sqrt(1.0+(546.0/945.0)*(546.0/945.0)));
float borderAA=max(fwidth(borderDistance),0.25);`;
 const body=`
${water?coordinates:''}
if(terrainOverlayInfo.x>0.5${water?'':'||terrainOverlayInfo.y>0.5'}){
${water?'':coordinates+'\nfloat planningWidth=max(fwidth(planningPoint.y),0.0001);'}
if(terrainOverlayInfo.x>0.5&&borderDistance>=0.0&&borderDistance<=150.0+borderAA){
 bool exempt=false;
 for(int i=0;i<int(terrainOverlayInfo.z);i++){float cx=planningScalar(i*4);float cz=planningScalar(i*4+1);float r=planningScalar(i*4+2);vec2 delta=planningPoint.xz-vec2(cx,cz);if(dot(delta,delta)<=r*r){exempt=true;break;}}
 if(!exempt){float edge=1.0-smoothstep(150.0-borderAA,150.0+borderAA,borderDistance);float hatch=step(0.65,fract((planningPoint.x+planningPoint.z)/12.0));finalColor=mix(finalColor,vec3(0.78,0.17,0.08),edge*(0.24+0.10*hatch));}
}
${water?'':`if(terrainOverlayInfo.y>0.5&&planningWidth>0.00011){
 float minor=planningContour(planningPoint.y,terrainOverlayInfo.w,planningWidth);
 float major=planningContour(planningPoint.y,terrainOverlayInfo.w*5.0,planningWidth*1.4);
 finalColor=mix(finalColor,vec3(0.10,0.075,0.045),max(minor*0.5,major*0.85));
}`}
}
`;
 const fragment=water?body.replace(/planningScalar\((i\*4(?:\+[12])?)\)/g,'planningScalar($1,terrainOverlayInfo)'):body;
 const wgsl=fragment.replaceAll('vPosition','input.vPosition').replaceAll('terrainOverlayInfo',water?'material.terrainOverlayInfo':'terrain.terrainOverlayInfo')
  .replaceAll('vec3(','vec3<f32>(').replaceAll('vec2(','vec2<f32>(')
  .replace(/\bfloat (\w+)=/g,'var $1=').replace(/\bvec3 (\w+)=/g,'let $1=').replace(/\bvec2 (\w+)=/g,'let $1=')
  .replace('bool exempt=false','var exempt=false').replace(`for(int i=0;i<int(${water?'material':'terrain'}.terrainOverlayInfo.z);i++)`,`for(var i=0;i<i32(${water?'material':'terrain'}.terrainOverlayInfo.z);i++)`);
 return {name:water?'waterPlanningOverlays':'terrainPlanningOverlays',bindings:{[water?'material':'terrain']:{terrainOverlayInfo:'vec4<f32>',...(water?{}:{uTerrainExemptions:'texture_2d<f32>'})}},
  gpu:{header:gpu,fragment:{end:wgsl}},gl:{header:gl,fragment:{end:water?fragment.replaceAll('terrainOverlayInfo','material.terrainOverlayInfo'):fragment}}};
}

export function createTerrainPlanningOverlays(){
 const info=new Float32Array([0,0,0,CONTOUR_INTERVAL]);
 const source=new BufferImageSource({resource:new Uint8Array(256*4),width:256,height:1,format:'rgba8unorm',autoGenerateMipmaps:false,scaleMode:'nearest',alphaMode:'no-premultiply-alpha'});
 const texture=new Texture({source});
 let lastItems,lastKey='',disposed=false;
 return {info,source,bit:terrainPlanningOverlayBit(),waterBit:terrainPlanningOverlayBit({water:true}),bindWater(material){material.data.terrainOverlayInfo=info;material.textures.baseColor=texture;},get enabled(){return !!(info[0]||info[1]);},get key(){return Number(this.enabled);},
  set({rdz=false,topo=false}={},state){
   if(disposed)return false;let changed=info[0]!==Number(rdz)||info[1]!==Number(topo);
   const newlyEnabled=rdz&&!info[0];info[0]=Number(rdz);info[1]=Number(topo);
   if(rdz&&(newlyEnabled||lastItems!==state?.items)){
    lastItems=state?.items;const circles=rdzExemptions(state),key=JSON.stringify(circles);
    if(key!==lastKey){const data=new Float32Array(256*Math.max(1,Math.ceil(circles.length*4/256)));circles.forEach((circle,i)=>data.set(circle,i*4));source.resource=new Uint8Array(data.buffer);source.resize(256,data.length/256);source.update();info[2]=circles.length;lastKey=key;changed=true;}
   }
   return changed;
  },
  destroy(){if(disposed)return;disposed=true;texture.destroy(true);lastItems=null;}
 };
}
