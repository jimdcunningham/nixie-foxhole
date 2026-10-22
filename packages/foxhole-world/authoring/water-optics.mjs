export const acesIn=[.59719,.076,.0284,.35458,.90834,.13383,.04823,.01566,.83777],acesOut=[1.60475,-.10208,-.00327,-.53108,1.10813,-.07276,-.07367,-.00605,1.07602];
export const mul3=(m,v)=>[0,1,2].map(r=>m[r]*v[0]+m[r+3]*v[1]+m[r+6]*v[2]);
export function inverse3(m){const [a,d,g,b,e,h,c,f,i]=m,det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);return[e*i-f*h,f*g-d*i,d*h-e*g,c*h-b*i,a*i-c*g,b*g-a*h,b*f-c*e,c*d-a*f,a*e-b*d].map(x=>x/det);}
export function screenToLinear(rgb,exposure=1){const y=mul3(inverse3(acesOut),rgb.map(c=>Math.pow(c,2.2))).map(c=>Math.max(0,Math.min(.99999,c))),x=y.map(y=>{const a=1-.983729*y,b=.0245786-.432951*y,c=-.000090537-.238081*y;return(-b+Math.sqrt(b*b-4*a*c))/(2*a);});return mul3(inverse3(acesIn),x).map(c=>Math.max(0,c*.6/exposure));}
export function viewDepthFromProjection(depth,p,webgpu=false){const z=webgpu?depth:depth*2-1;return Math.abs((p[14]-z*p[15])/(z*p[11]-p[10]));}
const mat=m=>`mat3(${[0,1,2].map(i=>`vec3(${m.slice(i*3,i*3+3).map(x=>x.toFixed(10)).join(',')})`).join(',')})`;
export function waterOpticsHeader(gpu){const body=`
 vec3 y=clamp(${mat(inverse3(acesOut))}*pow(rgb,vec3(2.2)),vec3(0.0),vec3(0.99999));
 vec3 a=vec3(1.0)-0.983729*y;vec3 b=vec3(0.0245786)-0.432951*y;vec3 c=vec3(-0.000090537)-0.238081*y;
 vec3 v=(-b+sqrt(b*b-4.0*a*c))/(2.0*a);
 return max(vec3(0.0),${mat(inverse3(acesIn))}*v*(0.6/max(${gpu?'global.uExposure':'uExposure'},0.001)));
 `;
 if(gpu)return `fn waterDecodeScene(rgb:vec3<f32>)->vec3<f32>{${body.replace(/vec3 (\w+)=/g,'let $1=').replaceAll('vec3(','vec3<f32>(').replaceAll('mat3(','mat3x3<f32>(')}}
 fn waterSceneDepth(p:vec3<f32>)->f32{let size=vec2<i32>(textureDimensions(uOpaqueDepthTexture));let pixel=clamp(vec2<i32>(screenUVFromWorld(p)*vec2<f32>(size)),vec2<i32>(0),size-vec2<i32>(1));let d=textureLoad(uOpaqueDepthTexture,pixel,0);let projection=camera.uProjectionMatrix;return abs((projection[3][2]-d*projection[3][3])/(d*projection[2][3]-projection[2][2]));}`;
 return `vec3 waterDecodeScene(vec3 rgb){${body}}
 float waterSceneDepth(vec3 p){ivec2 size=textureSize(uOpaqueDepthTexture,0);ivec2 pixel=clamp(ivec2(screenUVFromWorld(p)*vec2(size)),ivec2(0),size-ivec2(1));float d=texelFetch(uOpaqueDepthTexture,pixel,0).r*2.0-1.0;return abs((uProjectionMatrix[3][2]-d*uProjectionMatrix[3][3])/(d*uProjectionMatrix[2][3]-uProjectionMatrix[2][2]));}`;
}
