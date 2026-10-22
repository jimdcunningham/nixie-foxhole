import {BufferImageSource,Texture,UniformGroup,BindGroup} from 'pixi.js';
import {excavationVolume} from './terrain-excavations.mjs';

const GRID=[-1120,-960,32,70],ROWS=60,TEXTURE_WIDTH=256,MAX_TEXELS=131072;

/** Vertical excavation reaches the surface, retaining the real floor and XY footprint.
 * Raising the structure above the soil still leaves the ground intact beneath it.
 */
export function buildExcavationGrid(volumes,ceiling,shapes=new Map()){
 const cells=Array.from({length:GRID[3]*ROWS},()=>[]),rows=new Array(cells.length*4).fill(0);
 for(const points of volumes){
  const anchor=points[0],relative=points.map(p=>p.map((v,k)=>v-anchor[k])),shapeKey=JSON.stringify(relative);
  let shape=shapes.get(shapeKey);
  if(!shape){const top=Math.max(...relative.map(p=>p[1]))+1;shape=excavationVolume([...relative,...relative.map(p=>[p[0],top,p[2]])]);
   // The upward extrusion is open: a height cap is precisely what left soil
   // inside sloped bunker openings. Vertical footprint and lower faces remain.
   shape.planes=shape.planes.filter(p=>p[1]<=0);if(shapes.size>=512)shapes.delete(shapes.keys().next().value);shapes.set(shapeKey,shape);
  }
  const volume={min:shape.min.map((v,k)=>v+anchor[k]),max:shape.max.map((v,k)=>v+anchor[k]),
   planes:shape.planes.map(p=>[p[0],p[1],p[2],p[3]-p[0]*anchor[0]-p[1]*anchor[1]-p[2]*anchor[2]])};
  if(volume.planes.length<4)continue;
  const offset=rows.length/4;
  rows.push(volume.min[0],volume.min[2],volume.max[0],volume.max[2],volume.planes.length,0,0,0,...volume.planes.flat());
  const x0=Math.max(0,Math.floor((volume.min[0]-GRID[0])/GRID[2])),x1=Math.min(GRID[3]-1,Math.floor((volume.max[0]-GRID[0])/GRID[2]));
  const z0=Math.max(0,Math.floor((volume.min[2]-GRID[1])/GRID[2])),z1=Math.min(ROWS-1,Math.floor((volume.max[2]-GRID[1])/GRID[2]));
  for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)cells[z*GRID[3]+x].push(offset);
 }
 for(let cell=0;cell<cells.length;cell++){const list=cells[cell];if(!list.length)continue;rows[cell*4]=rows.length/4;rows[cell*4+1]=list.length;for(const offset of list)rows.push(offset,0,0,0);}
 if(rows.length/4>MAX_TEXELS)throw Error('The terrain excavation mask exceeds its storage budget.');
 return new Float32Array(rows);
}

/** CPU oracle for the exact float32 grid and planes read by both shaders. */
export function excavationGridContains(data,[x,y,z]){
 const cx=Math.floor((x-GRID[0])/GRID[2]),cz=Math.floor((z-GRID[1])/GRID[2]);
 if(cx<0||cx>=GRID[3]||cz<0||cz>=ROWS)return false;
 const cell=(cz*GRID[3]+cx)*4;
 for(let i=0;i<data[cell+1];i++){
  const offset=data[(data[cell]+i)*4]*4;
  if(x<data[offset]||z<data[offset+1]||x>data[offset+2]||z>data[offset+3])continue;
  let inside=true;
  for(let p=0;p<data[offset+4];p++){const at=offset+8+p*4;if(data[at]*x+data[at+1]*y+data[at+2]*z+data[at+3]>0.0001){inside=false;break;}}
  if(inside)return true;
 }
 return false;
}

export function terrainExcavationBit(group='material'){
 const native=group!=='material',gpu=`
 fn excavationScalar(index:i32,info:vec4<f32>)->f32{
  let pixel=vec2<i32>(index%256,index/256);
  let rgba=${native?'textureLoad(uGroundExcavations,pixel,0)':'sampleGroundExcavationsDirect((vec2<f32>(pixel)+vec2<f32>(0.5))/info.xy)'};
  let bytes=vec4<u32>(round(rgba*255.0));return bitcast<f32>(bytes.x|(bytes.y<<8u)|(bytes.z<<16u)|(bytes.w<<24u));
 }
 fn excavationTexel(index:i32,info:vec4<f32>)->vec4<f32>{return vec4<f32>(excavationScalar(index*4,info),excavationScalar(index*4+1,info),excavationScalar(index*4+2,info),excavationScalar(index*4+3,info));}
 fn excavationContains(p:vec3<f32>,info:vec4<f32>)->bool{
  let cell=vec2<i32>(floor((p.xz-vec2<f32>(-1120.0,-960.0))/32.0));
  if(any(cell<vec2<i32>(0))||cell.x>=70||cell.y>=60){return false;}
  let header=excavationTexel(cell.y*70+cell.x,info);
  for(var i=0;i<i32(header.y);i++){
   let offset=i32(excavationTexel(i32(header.x)+i,info).x);let bounds=excavationTexel(offset,info);
   if(any(p.xz<bounds.xy)||any(p.xz>bounds.zw)){continue;}
   let count=i32(excavationTexel(offset+1,info).x);var inside=true;
   for(var j=0;j<count;j++){let plane=excavationTexel(offset+2+j,info);if(dot(plane.xyz,p)+plane.w>0.0001){inside=false;break;}}
   if(inside){return true;}
  }
  return false;
 }`,gl=`${native?'':'vec4 sampleGroundExcavationsDirect(vec2 uv);'}
 float excavationScalar(int index,vec4 info){
  ivec2 pixel=ivec2(index%256,index/256);vec4 rgba=${native?'texelFetch(uGroundExcavations,pixel,0)':'sampleGroundExcavationsDirect((vec2(pixel)+vec2(0.5))/info.xy)'};
  uvec4 bytes=uvec4(round(rgba*255.0));return uintBitsToFloat(bytes.x|(bytes.y<<8u)|(bytes.z<<16u)|(bytes.w<<24u));
 }
 vec4 excavationTexel(int index,vec4 info){return vec4(excavationScalar(index*4,info),excavationScalar(index*4+1,info),excavationScalar(index*4+2,info),excavationScalar(index*4+3,info));}
 bool excavationContains(vec3 p,vec4 info){
  ivec2 cell=ivec2(floor((p.xz-vec2(-1120.0,-960.0))/32.0));
  if(any(lessThan(cell,ivec2(0)))||cell.x>=70||cell.y>=60)return false;
  vec4 header=excavationTexel(cell.y*70+cell.x,info);
  for(int i=0;i<int(header.y);i++){
   int offset=int(excavationTexel(int(header.x)+i,info).x);vec4 bounds=excavationTexel(offset,info);
   if(any(lessThan(p.xz,bounds.xy))||any(greaterThan(p.xz,bounds.zw)))continue;
   int count=int(excavationTexel(offset+1,info).x);bool inside=true;
   for(int j=0;j<count;j++){vec4 plane=excavationTexel(offset+2+j,info);if(dot(plane.xyz,p)+plane.w>0.0001){inside=false;break;}}
   if(inside)return true;
  }
  return false;
 }`;
 return {name:'nativeGroundExcavation:'+group,...(!native?{textures:['groundExcavations']}:{ }),bindings:{[group]:{excavationInfo:'vec4<f32>',...(native?{uGroundExcavations:'texture_2d<f32>'}:{})}},
  gpu:{header:gpu,fragment:{material:`if(excavationContains(input.vPosition,${group}.excavationInfo)){discard;}`}},gl:{header:gl,fragment:{material:`if(excavationContains(vPosition,${native?'':'material.'}excavationInfo)){discard;}`}}};
}

/** Exact float32 bytes in an ordinary RGBA8 slot keep both renderer backends compatible. */
export function createTerrainExcavationMask(){
 let data=new Float32Array(TEXTURE_WIDTH*128),key='',disposed=false,used=0;const materials=new Set(),shapes=new Map(),info=new Float32Array([TEXTURE_WIDTH,128,0,0]);
 const source=new BufferImageSource({resource:new Uint8Array(data.buffer),width:TEXTURE_WIDTH,height:128,format:'rgba8unorm',alphaMode:'no-premultiply-alpha',autoGenerateMipmaps:false,scaleMode:'nearest'}),texture=new Texture({source});
 const uniforms=new UniformGroup({excavationInfo:{value:info,type:'vec4<f32>'}}),group=new BindGroup({0:uniforms,1:source});
 return {bit:terrainExcavationBit(),nativeBit:terrainExcavationBit('excavation'),group,source,info,
  bind(material){materials.add(material);material.data.excavationInfo=info;material.textures.groundExcavations=texture;},
  set(volumes,ceiling){if(disposed)return false;const nextKey=JSON.stringify([volumes,ceiling]);if(key===nextKey)return false;
   const packed=buildExcavationGrid(volumes,ceiling,shapes);let height=source.height;while(height*TEXTURE_WIDTH<packed.length)height*=2;
   if(height!==source.height){data=new Float32Array(TEXTURE_WIDTH*height);source.resource=new Uint8Array(data.buffer);source.resize(TEXTURE_WIDTH,height);info[1]=height;uniforms.update();for(const material of materials)material.data.excavationInfo=info;}
   data.fill(0,0,used);data.set(packed);used=packed.length;source.update();key=nextKey;return true;
  },
  get bytes(){return data.byteLength;},
  destroy(){if(disposed)return;disposed=true;materials.clear();shapes.clear();group.destroy();uniforms.buffer?.destroy();texture.destroy(true);data=null;}
 };
}
