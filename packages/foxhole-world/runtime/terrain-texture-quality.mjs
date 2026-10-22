export const TERRAIN_TEXTURE_TIERS=[128,256,512,1024,2048,4096];
const linear=Float64Array.from({length:256},(_,i)=>{const x=i/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});
const srgb=x=>Math.round(255*(x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055));
/** Area filtering in linear colour space; normal maps are averaged then normalized. */
export function resizeTerrainPixels(bytes,width,height,layers,maxSize,{kind='color',channels=4}={}){
 const scale=Math.min(1,maxSize/Math.max(width,height)),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
 if(w===width&&h===height)return {bytes,width,height};
 if(bytes.length!==width*height*layers*channels)throw Error('Invalid terrain pixel dimensions');
 const out=new Uint8Array(w*h*layers*channels),sx=width/w,sy=height/h;
 for(let layer=0;layer<layers;layer++)for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const left=x*sx,right=(x+1)*sx,top=y*sy,bottom=(y+1)*sy;let a=0,b=0,c=0,d=0,weight=0;
  for(let iy=Math.floor(top);iy<Math.ceil(bottom)&&iy<height;iy++){const wy=Math.min(bottom,iy+1)-Math.max(top,iy);for(let ix=Math.floor(left);ix<Math.ceil(right)&&ix<width;ix++){
   const k=((layer*height+iy)*width+ix)*channels,f=wy*(Math.min(right,ix+1)-Math.max(left,ix));weight+=f;
   if(channels===1){a+=bytes[k]*f;continue;}
   if(kind==='normal'){a+=(bytes[k]/127.5-1)*f;b+=(bytes[k+1]/127.5-1)*f;c+=(bytes[k+2]/127.5-1)*f;}else{a+=linear[bytes[k]]*f;b+=linear[bytes[k+1]]*f;c+=linear[bytes[k+2]]*f;}d+=bytes[k+3]*f;
  }}
  const k=((layer*h+y)*w+x)*channels;if(channels===1){out[k]=Math.round(a/weight);continue;}
  if(kind==='normal'){const n=Math.hypot(a,b,c);if(n<1e-8){a=0;b=0;c=1;}else{a/=n;b/=n;c/=n;}out[k]=Math.round((a+1)*127.5);out[k+1]=Math.round((b+1)*127.5);out[k+2]=Math.round((c+1)*127.5);}else{out[k]=srgb(a/weight);out[k+1]=srgb(b/weight);out[k+2]=srgb(c/weight);}out[k+3]=Math.round(d/weight);
 }
 return {bytes:out,width:w,height:h};
}
/** Conservative texel density at the nearest point of this region's bounds. */
export function terrainTextureTier(camera,bounds,{tileMetres=16}={}){
 if(!camera?.position||!camera.height)return 128;
 let metresPerPixel;
 if(camera.orthographicHeight)metresPerPixel=camera.orthographicHeight/camera.height;
 else{const p=camera.position,lo=bounds?.min||{x:-1092,y:-220,z:-945},hi=bounds?.max||{x:1092,y:256,z:945};const distance=Math.hypot(...['x','y','z'].map((key,i)=>Math.max(lo[key]-p[i],0,p[i]-hi[key])));metresPerPixel=2*Math.max(1,distance)*Math.tan((camera.fov||45)*Math.PI/360)/camera.height;}
 const wanted=tileMetres*2/Math.max(.0001,metresPerPixel);return TERRAIN_TEXTURE_TIERS.find(size=>size>=wanted)||4096;
}
export const terrainMipBytes=(width,height,layers,channels=4)=>{let bytes=0;for(;;){bytes+=width*height*layers*channels;if(width===1&&height===1)return bytes;width=Math.max(1,width>>1);height=Math.max(1,height>>1);}};
