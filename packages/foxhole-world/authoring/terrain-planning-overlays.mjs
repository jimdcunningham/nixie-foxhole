import {BufferImageSource,Texture} from 'pixi.js';
import {MAP_OVERLAY_SIZE,planningTerritories,rasterizePlanningTerritories} from './terrain-map-raster.mjs';
import {rdzExemptions,CONTOUR_INTERVAL} from './terrain-overlay-policy.mjs';

// RGBA8 carries exact float bytes, as in the existing excavation mask. No float
// texture filtering feature or extra render pass is needed. The optional 512²
// territory field shares this texture and costs about 1 MiB per selected region.
export function terrainPlanningOverlayBit({water=false}={}){
 // Native water supplies its own body/foam albedo, leaving the PBR base-color
 // sampler free for the shared mask. Keep water within WebGL's eight packed
 // material samplers; adding a ninth aliases the first slot's four-bit index.
 const glFetch=water?'sampleBaseColorDirect((vec2(p)+vec2(0.5))/vec2(options.w,planningTextureHeight(info,options)))':'texelFetch(uTerrainExemptions,p,0)';
 const gpuFetch=water?'sampleBaseColorDirect((vec2<f32>(p)+vec2<f32>(0.5))/vec2<f32>(options.w,planningTextureHeight(info,options)))':'textureLoad(uTerrainExemptions,p,0)';
 const gl=`${water?'vec4 sampleBaseColorDirect(vec2 uv);':''}
float planningTextureHeight(vec4 info,vec4 options){return max(1.0,ceil(info.z*4.0/options.w))+(options.w>256.0?options.w:0.0);}
vec4 planningTexel(ivec2 p,vec4 info,vec4 options){return ${glFetch};}
float planningScalar(int i,vec4 info,vec4 options){int width=int(options.w);uvec4 b=uvec4(round(planningTexel(ivec2(i%width,i/width),info,options)*255.0));return uintBitsToFloat(b.x|(b.y<<8u)|(b.z<<16u)|(b.w<<24u));}
vec4 planningMap(vec2 uv,vec4 info,vec4 options){ivec2 p=ivec2(clamp(uv,vec2(0.0),vec2(0.999999))*options.w);p.y+=int(max(1.0,ceil(info.z*4.0/options.w)));return planningTexel(p,info,options);}
float planningDivision(vec2 uv,vec4 info,vec4 options){vec2 p=uv*options.w-vec2(0.5);vec2 cell=floor(p),f=fract(p);vec2 a=(cell+vec2(0.5))/options.w;vec4 tl=planningMap(a,info,options),tr=planningMap(a+vec2(1.0,0.0)/options.w,info,options),bl=planningMap(a+vec2(0.0,1.0)/options.w,info,options),br=planningMap(a+vec2(1.0,1.0)/options.w,info,options);vec4 d=vec4(tl.b,tr.b,bl.b,br.b)*64.0-vec4(32.0);if(tl.a==tr.a&&tl.a==bl.a&&tl.a==br.a){d=abs(d);}return abs(mix(mix(d.x,d.y,f.x),mix(d.z,d.w,f.x),f.y));}
float planningContour(float h,float interval,float width){float d=abs(fract(h/interval+0.5)-0.5)*interval;return (1.0-smoothstep(width*0.5,width*1.5,d))*(1.0-smoothstep(interval*0.2,interval*0.45,width));}
`;
 const gpu=`
fn planningTextureHeight(info:vec4<f32>,options:vec4<f32>)->f32{return max(1.0,ceil(info.z*4.0/options.w))+select(0.0,options.w,options.w>256.0);}
fn planningTexel(p:vec2<i32>,info:vec4<f32>,options:vec4<f32>)->vec4<f32>{return ${gpuFetch};}
fn planningScalar(i:i32,info:vec4<f32>,options:vec4<f32>)->f32{let width=i32(options.w);let b=vec4<u32>(round(planningTexel(vec2<i32>(i%width,i/width),info,options)*255.0));return bitcast<f32>(b.x|(b.y<<8u)|(b.z<<16u)|(b.w<<24u));}
fn planningMap(uv:vec2<f32>,info:vec4<f32>,options:vec4<f32>)->vec4<f32>{var p=vec2<i32>(clamp(uv,vec2<f32>(0.0),vec2<f32>(0.999999))*options.w);p.y+=i32(max(1.0,ceil(info.z*4.0/options.w)));return planningTexel(p,info,options);}
fn planningDivision(uv:vec2<f32>,info:vec4<f32>,options:vec4<f32>)->f32{let p=uv*options.w-vec2<f32>(0.5);let cell=floor(p);let f=fract(p);let a=(cell+vec2<f32>(0.5))/options.w;let tl=planningMap(a,info,options);let tr=planningMap(a+vec2<f32>(1.0,0.0)/options.w,info,options);let bl=planningMap(a+vec2<f32>(0.0,1.0)/options.w,info,options);let br=planningMap(a+vec2<f32>(1.0,1.0)/options.w,info,options);var d=vec4<f32>(tl.b,tr.b,bl.b,br.b)*64.0-vec4<f32>(32.0);if(tl.a==tr.a&&tl.a==bl.a&&tl.a==br.a){d=abs(d);}return abs(mix(mix(d.x,d.y,f.x),mix(d.z,d.w,f.x),f.y));}
fn planningContour(h:f32,interval:f32,width:f32)->f32{let d=abs(fract(h/interval+0.5)-0.5)*interval;return (1.0-smoothstep(width*0.5,width*1.5,d))*(1.0-smoothstep(interval*0.2,interval*0.45,width));}
`;
 const coordinates=`vec3 planningPoint=vPosition;
float borderDistance=min(945.0-abs(planningPoint.z),(1092.0-abs(planningPoint.x)-abs(planningPoint.z)*(546.0/945.0))/sqrt(1.0+(546.0/945.0)*(546.0/945.0)));
float borderAA=max(fwidth(borderDistance),0.25);`;
 const body=`
${coordinates}
if(terrainOverlayInfo.x>0.5${water?'':'||terrainOverlayInfo.y>0.5'}){
${water?'':'float planningWidth=max(fwidth(planningPoint.y),0.0001);'}
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
 const mapBody=`
if(borderDistance>=0.0){
 if(terrainMapOverlayInfo.z>0.5||terrainMapOverlayInfo.y>0.5){
  vec2 territoryUv=vec2(planningPoint.x/2184.0+0.5,0.5-planningPoint.z/1890.0);
  vec4 territory=planningMap(territoryUv,terrainOverlayInfo,terrainMapOverlayInfo);
  float team=floor(territory.r*255.0+0.5);
  if(terrainMapOverlayInfo.z>0.5&&team>0.5){vec3 tint=vec3(0.0,0.62745,0.0);if(team>1.5){tint=vec3(0.0,0.0,1.0);}finalColor=mix(finalColor,tint,territory.g);}
  if(terrainMapOverlayInfo.y>0.5){float divisionWidth=min(12.0,max(length(fwidth(planningPoint.xz)),1.0));float division=1.0-smoothstep(divisionWidth*0.5,divisionWidth*1.5,planningDivision(territoryUv,terrainOverlayInfo,terrainMapOverlayInfo));finalColor=mix(finalColor,vec3(0.0),division*0.15);}
 }
 if(terrainMapOverlayInfo.x>0.5){float border=1.0-smoothstep(borderAA*0.5,borderAA*1.5,borderDistance);finalColor=mix(finalColor,vec3(1.0),border*0.18);}
}
`;
 const fragment=(body+mapBody).replace(/planningScalar\((i\*4(?:\+[12])?)\)/g,'planningScalar($1,terrainOverlayInfo,terrainMapOverlayInfo)');
 const wgsl=fragment.replaceAll('vPosition','input.vPosition').replaceAll('terrainOverlayInfo',water?'material.terrainOverlayInfo':'terrain.terrainOverlayInfo').replaceAll('terrainMapOverlayInfo',water?'material.terrainMapOverlayInfo':'terrain.terrainMapOverlayInfo')
  .replaceAll('vec3(','vec3<f32>(').replaceAll('vec2(','vec2<f32>(')
  .replace(/\bvec4 (\w+)=/g,'let $1=').replace(/\bfloat (\w+)=/g,'var $1=').replace(/\bvec3 (\w+)=/g,'var $1=').replace(/\bvec2 (\w+)=/g,'let $1=')
  .replace('bool exempt=false','var exempt=false').replace(`for(int i=0;i<int(${water?'material':'terrain'}.terrainOverlayInfo.z);i++)`,`for(var i=0;i<i32(${water?'material':'terrain'}.terrainOverlayInfo.z);i++)`);
 return {name:water?'waterPlanningOverlays':'terrainPlanningOverlays',bindings:{[water?'material':'terrain']:{terrainOverlayInfo:'vec4<f32>',terrainMapOverlayInfo:'vec4<f32>',...(water?{}:{uTerrainExemptions:'texture_2d<f32>'})}},
  gpu:{header:gpu,fragment:{end:wgsl}},gl:{header:gl,fragment:{end:water?fragment.replaceAll('terrainOverlayInfo','material.terrainOverlayInfo').replaceAll('terrainMapOverlayInfo','material.terrainMapOverlayInfo'):fragment}}};
}

export function createTerrainPlanningOverlays(){
 const info=new Float32Array([0,0,0,CONTOUR_INTERVAL]),mapInfo=new Float32Array([0,0,0,256]);
 const source=new BufferImageSource({resource:new Uint8Array(256*4),width:256,height:1,format:'rgba8unorm',autoGenerateMipmaps:false,scaleMode:'nearest',alphaMode:'no-premultiply-alpha'});
 const texture=new Texture({source});
 let lastItems,lastLabels,lastStyle,lastMinute,lastKey='',territoryKey='',circles=[],raster=null,disposed=false;
 return {info,mapInfo,source,bit:terrainPlanningOverlayBit(),waterBit:terrainPlanningOverlayBit({water:true}),bindWater(material){material.data.terrainOverlayInfo=info;material.data.terrainMapOverlayInfo=mapInfo;material.textures.baseColor=texture;},get enabled(){return !!(info[0]||info[1]||mapInfo[0]||mapInfo[1]||mapInfo[2]);},get key(){return Number(this.enabled);},
  set({rdz=false,topo=false,borders=false,divisions=false,faction=false}={},state){
   if(disposed)return false;
   let changed=info[0]!==Number(rdz)||info[1]!==Number(topo)||mapInfo[0]!==Number(borders)||mapInfo[1]!==Number(divisions)||mapInfo[2]!==Number(faction),upload=false;
   const newlyEnabled=rdz&&!info[0];info[0]=Number(rdz);info[1]=Number(topo);mapInfo[0]=Number(borders);mapInfo[1]=Number(divisions);mapInfo[2]=Number(faction);
   if(rdz&&(newlyEnabled||lastItems!==state?.items)){
    lastItems=state?.items;const next=rdzExemptions(state),key=JSON.stringify(next);
    if(key!==lastKey){circles=next;info[2]=circles.length;lastKey=key;upload=true;}
   }
   const minute=Math.floor((state?.referenceTimestamp??Date.now())/60000),style=String(state?.warStart)+':'+String(state?.suppressFaction);
   if((divisions||faction)&&(!raster||lastLabels!==state?.labels||lastStyle!==style||lastMinute!==minute)){
    lastLabels=state?.labels;lastStyle=style;lastMinute=minute;
    const sites=planningTerritories(state),key=JSON.stringify(sites);
    if(!raster||key!==territoryKey){raster=rasterizePlanningTerritories(sites);territoryKey=key;upload=true;}
   }
   if(upload){
    const width=raster?MAP_OVERLAY_SIZE:256,rows=Math.max(1,Math.ceil(circles.length*4/width)),data=new Float32Array(width*(rows+(raster?width:0)));
    circles.forEach((circle,i)=>data.set(circle,i*4));const bytes=new Uint8Array(data.buffer);if(raster)bytes.set(raster,width*rows*4);
    source.resource=bytes;source.resize(width,data.length/width);source.update();mapInfo[3]=width;changed=true;
   }
   return changed;
  },
  destroy(){if(disposed)return;disposed=true;texture.destroy(true);lastItems=null;lastLabels=null;raster=null;}
 };
}
