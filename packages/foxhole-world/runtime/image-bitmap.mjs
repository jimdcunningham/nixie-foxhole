// WebGL ignores UNPACK_PREMULTIPLY_ALPHA_WEBGL for ImageBitmap uploads.
// Decode upload-premultiplied images in that form so GL and GPU see the same
// texels. Data maps and already-premultiplied files retain their raw channels.
export function decodeWorldImage(bytes,alphaMode='premultiply-alpha-on-upload'){
 return createImageBitmap(bytes instanceof Blob?bytes:new Blob([bytes]),{premultiplyAlpha:alphaMode==='premultiply-alpha-on-upload'?'premultiply':'none',colorSpaceConversion:'none'});
}
