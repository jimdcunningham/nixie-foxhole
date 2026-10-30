import sharp from 'sharp';

// Runtime packs snow RGB with roughness from the mask green channel into one
// texture. Dimensions must match and snow alpha must be opaque for every region.
export async function validateWeatherTexturePair(snowBytes,maskBytes){
 const [snow,mask]=await Promise.all([sharp(snowBytes,{limitInputPixels:4096**2}).ensureAlpha().raw().toBuffer({resolveWithObject:true}),sharp(maskBytes,{limitInputPixels:4096**2}).metadata()]);
 if(!snow.info.width||!snow.info.height||snow.info.channels!==4||snow.info.width!==mask.width||snow.info.height!==mask.height)throw Error('Weather snow/mask dimensions differ');
 for(let i=3;i<snow.data.length;i+=4)if(snow.data[i]!==255)throw Error('Weather snow texture must be opaque');
}
