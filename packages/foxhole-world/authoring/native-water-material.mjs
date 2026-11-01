import {waterScreenReflectionsBit} from './water-screen-reflections.mjs';
import {RefractiveWaterMaterial} from './refractive-water.mjs';import {nativeWaterBit} from './native-water-bit.mjs';import {waterStencilBit} from './water-stencil.mjs';
export async function createNativeWaterMaterial({region,json,texture,hexBit,extraBits=[],contained}){
 const [meta,masks]=await Promise.all([json(`${region}/water-source/render.json`),contained?Promise.resolve([]):json(`${region}/water-source/boat-stencils.json`)]);
 const [large,small,foam,modulation,clouds,bed]=await Promise.all([texture(meta.textures.waveLarge,true),texture(meta.textures.waveSmall,true),texture(meta.textures.foam,true),texture(meta.textures.modulation,true),texture(meta.textures.clouds,true),texture(`${region}/water-source/terrain-height.png`)]);
 bed.source.autoGenerateMipmaps=false;bed.source.style.addressMode='clamp-to-edge';
 const material=new RefractiveWaterMaterial({roughness:.13,metallic:0,ior:1.333,doubleSided:true,extraBits:[...(hexBit?[hexBit]:[]),...(contained?[]:[waterStencilBit(masks)]),nativeWaterBit,waterScreenReflectionsBit,...extraBits]});
 // Water composites its transmission itself and outputs alpha 1. Publish its
 // surface depth so later SSAO cannot shade the submerged terrain through it.
 material.state.depthMask=true;
 Object.assign(material.textures,{waveLarge:large,waveSmall:small,waterFoam:foam,waterBed:bed,metallicRoughness:modulation,occlusion:clouds});
 const c=meta.material.colors,rgba=c=>[c.R,c.G,c.B,1];Object.assign(material.data,{waterBody:rgba(c['Body Color']),waterShallow:rgba(c['Depth Colour']),waterFoamColor:rgba(c.EdgeColour01),waterReflectionStrength:1,waveStrength:.75,hasPonds:region==='deadlands'?1:0});
 // Reuse the former unused scatter vector: keep framed materials within the 256-byte row.
 material.data.waterSurface=[contained?1:0,contained?.opacity??0,contained?.roughness??.1,0];
 if(contained){material.data.waterBody=[...contained.color,1];material.data.waterShallow=[...contained.color,1];material.data.hasPonds=0;material.data.waveStrength=.2;}
 return{material,info:{method:contained?'Contained Water2 optics, calm moving normals, refraction and screen-space reflections':'Native Water2 textures, scene-depth contact foam, shallow refraction, screen-space reflections, depth absorption and native boat stencils',masks:masks.length,ior:1.333}};
}
