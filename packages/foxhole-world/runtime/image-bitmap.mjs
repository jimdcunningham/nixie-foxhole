// WebGL ignores UNPACK_PREMULTIPLY_ALPHA_WEBGL for ImageBitmap uploads.
// Decode upload-premultiplied images in that form so GL and GPU see the same
// texels. Data maps and already-premultiplied files retain their raw channels.
// Limit native decode overlap across model loaders without changing resolution.
let activeDecodes=0;const waiting=[];
async function acquireDecode(){if(activeDecodes<2){activeDecodes++;return;}await new Promise(resolve=>waiting.push(resolve));}
function releaseDecode(){const next=waiting.shift();if(next)next();else activeDecodes--;}
export async function decodeWorldImage(bytes,alphaMode='premultiply-alpha-on-upload'){
 await acquireDecode();
 try{return await createImageBitmap(bytes instanceof Blob?bytes:new Blob([bytes]),{premultiplyAlpha:alphaMode==='premultiply-alpha-on-upload'?'premultiply':'none',colorSpaceConversion:'none'});}
 finally{releaseDecode();}
}