import sharp from 'sharp';
import {resizeTerrainPixels} from '../runtime/terrain-texture-quality.mjs';

// Publication-only reduction: ORM contains independent
// linear data channels, unlike sRGB color and unit-vector normal textures.
export async function reduceDetailTexture(bytes,{role,maxSize=512,quality=80,ormQuantizationStep=null}={}){
 if(!['color','normal','orm'].includes(role)||!Number.isInteger(maxSize)||maxSize<1||!Number.isInteger(quality)||quality<1||quality>100||(ormQuantizationStep!==null&&(!Number.isInteger(ormQuantizationStep)||ormQuantizationStep<1||ormQuantizationStep>255||role!=='orm')))throw Error('Invalid detail texture reduction options');
 const sourceMetadata=await sharp(bytes,{limitInputPixels:4096**2}).metadata();if(!['png','webp'].includes(sourceMetadata.format))throw Error('Unsupported detail image format');
 const image=await sharp(bytes,{limitInputPixels:4096**2}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const {width,height}=image.info;if(!width||!height||image.info.channels!==4)throw Error('Invalid detail texture input');
 const pixels=new Uint8Array(image.data.buffer,image.data.byteOffset,image.data.byteLength);let reduced;
 if(role!=='orm') reduced=resizeTerrainPixels(pixels,width,height,1,maxSize,{kind:role});
 else if(Math.max(width,height)<=maxSize)reduced={bytes:pixels,width,height};
 else{
  const channels=[];let w,h;for(let c=0;c<4;c++){
   const plane=new Uint8Array(width*height);for(let i=0;i<plane.length;i++)plane[i]=pixels[4*i+c];
   const scaled=resizeTerrainPixels(plane,width,height,1,maxSize,{channels:1});w=scaled.width;h=scaled.height;channels.push(scaled.bytes);
  }
  const out=new Uint8Array(w*h*4);for(let i=0;i<w*h;i++)for(let c=0;c<4;c++)out[4*i+c]=channels[c][i];reduced={bytes:out,width:w,height:h};
 }
 const quantized=ormQuantizationStep!==null;let encodedPixels=reduced.bytes;
 if(quantized){encodedPixels=Uint8Array.from(reduced.bytes);for(let i=0;i<encodedPixels.length;i+=4)for(let c=0;c<3;c++)encodedPixels[i+c]=Math.min(255,Math.round(encodedPixels[i+c]/ormQuantizationStep)*ormQuantizationStep);}
 const input=()=>sharp(Buffer.from(encodedPixels),{raw:{width:reduced.width,height:reduced.height,channels:4}});
 let output=await input().webp(quantized?{lossless:true,effort:2,exact:true}:{quality,alphaQuality:100,effort:2,exact:true}).toBuffer(),extension='.webp';
 let check=await sharp(output).ensureAlpha().raw().toBuffer();let alphaOK=check.length===reduced.bytes.length;
 for(let i=3;alphaOK&&i<check.length;i+=4)if(check[i]!==reduced.bytes[i])alphaOK=false;
 if(quantized&&alphaOK)for(let i=0;i<check.length;i++)if(check[i]!==encodedPixels[i]){alphaOK=false;break;}
 if(!alphaOK){output=await input().png({compressionLevel:9}).toBuffer();extension='.png';check=await sharp(output).ensureAlpha().raw().toBuffer();if(check.length!==reduced.bytes.length)throw Error('Detail texture dimensions changed');for(let i=3;i<check.length;i+=4)if(check[i]!==reduced.bytes[i])throw Error('Detail alpha integrity failure');if(quantized)for(let i=0;i<check.length;i++)if(check[i]!==encodedPixels[i])throw Error('Quantized detail texture changed pixels');}
 const unchanged=width===reduced.width&&height===reduced.height&&output.length>=bytes.length;
 return {bytes:unchanged?bytes:output,extension:unchanged?'.'+sourceMetadata.format:extension,width:reduced.width,height:reduced.height,unchanged,quantized:quantized&&!unchanged};
}
