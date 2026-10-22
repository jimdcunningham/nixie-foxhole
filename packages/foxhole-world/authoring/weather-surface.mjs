// Reconstruct the native WeatherControl inputs on ground and road surfaces.
// Cooked material arithmetic is unavailable; these responses are approximations.
import {BufferImageSource,Texture} from 'pixi.js';
const gl=`
vec2 weatherUV=vec2(vPosition.x,-vPosition.z)/3.0;
float surfaceUp=clamp(normal.y,0.0,1.0);
float weatherPattern=sampleWeatherNoise(weatherUV/6.0).r;
float roadWet=material.surfaceWeather.x*pow(surfaceUp,2.0)*mix(0.6,1.0,weatherPattern);
albedo*=1.0-roadWet*0.4;roughness=mix(roughness,0.075,roadWet);
float roadSnow=material.surfaceWeather.y*pow(surfaceUp,3.0)*smoothstep(0.12,0.55,weatherPattern);
vec3 roadSnowColor=pow(sampleWeatherSnow(weatherUV).rgb,vec3(2.2));
vec3 roadSnowN=sampleWeatherBump(weatherUV).rgb*2.0-1.0;
albedo=mix(albedo,roadSnowColor,roadSnow);roughness=mix(roughness,sampleWeatherMask(weatherUV).g,roadSnow);
vec3 roadT=normalize(vec3(1.0,-normal.x/max(abs(normal.y),0.001),0.0));vec3 roadB=normalize(cross(normal,roadT));
normal=normalize(mix(normal,roadT*roadSnowN.x-roadB*roadSnowN.y+normal*max(0.05,roadSnowN.z),roadSnow));specularNormal=normal;
`;
const gpu=gl.replaceAll('vPosition','input.vPosition').replace(/vec2 (\w+)=/g,'let $1=').replace(/vec3 (\w+)=/g,'let $1=').replace(/float (\w+)=/g,'let $1=').replaceAll('vec2(','vec2<f32>(').replaceAll('vec3(','vec3<f32>(');
export const weatherSurfaceBit={name:'foxholeGroundWeather',textures:['weatherSnow','weatherBump','weatherMask','weatherNoise'],bindings:{material:{surfaceWeather:'vec4<f32>'}},gl:{fragment:{material:gl}},gpu:{fragment:{material:gpu}}};

// The road transition already uses all eight Pixi material texture slots.
// Snow RGB and roughness G share identical native UVs and dimensions; putting
// roughness in the unused snow alpha retains every sampled byte and frees a slot.
export const packedWeatherSurfaceBit={...weatherSurfaceBit,name:'foxholeGroundWeatherPacked',textures:['weatherSnow','weatherBump','weatherNoise'],
 gl:{fragment:{material:gl.replace('sampleWeatherMask(weatherUV).g','sampleWeatherSnow(weatherUV).a')}},
 gpu:{fragment:{material:gpu.replace('sampleWeatherMask(weatherUV).g','sampleWeatherSnow(weatherUV).a')}}};

export function packWeatherSurfacePixels(snow,mask){
 if(snow.length!==mask.length)throw Error('Weather texture dimensions differ.');
 const pixels=new Uint8Array(snow.length);
 for(let i=0;i<snow.length;i+=4){if(snow[i+3]!==255)throw Error('Packed weather requires an opaque snow texture.');pixels[i]=snow[i];pixels[i+1]=snow[i+1];pixels[i+2]=snow[i+2];pixels[i+3]=mask[i+1];}
 return pixels;
}

export function packWeatherSurfaceTextures(snow,mask){
 const a=snow.source,b=mask.source;if(a.width!==b.width||a.height!==b.height)throw Error('Weather texture dimensions differ.');
 const read=source=>{if(ArrayBuffer.isView(source.resource))return source.resource;const canvas=new OffscreenCanvas(source.width,source.height),context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(source.resource,0,0);return context.getImageData(0,0,source.width,source.height).data;};
 const resource=packWeatherSurfacePixels(read(a),read(b));
 const source=new BufferImageSource({resource,width:a.width,height:a.height,format:'rgba8unorm',alphaMode:'no-premultiply-alpha',autoGenerateMipmaps:true,scaleMode:'linear',mipmapFilter:'linear',addressMode:'repeat',maxAnisotropy:a.style.maxAnisotropy});
 return new Texture({source});
}
