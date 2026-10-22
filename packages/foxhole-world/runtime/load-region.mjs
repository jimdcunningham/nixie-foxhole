import {decodeWorldImage} from './image-bitmap.mjs';
import {SurfaceDecalPass,surfaceDecalMaterial} from '../authoring/surface-decal-pass.mjs';
import {Buffer,BufferUsage,BufferImageSource,ImageSource,Texture,Rectangle,BindGroup,UniformGroup} from 'pixi.js';
import {Container3D,Geometry3D,Material3D,BaseMaterial3D,FlatMaterial,Mesh3D,BatchedMesh3D,Matrix4,RenderPassBit,ShaderDescriptor} from '@pixi/3d';
import {MeshoptDecoder} from 'meshoptimizer/decoder';
import {LiveTerrainPass} from '../authoring/live-terrain.mjs';
import {RoadShoulderPass} from '../authoring/road-shoulders.mjs';
import {createDistanceLod} from '../authoring/distance-lod.mjs';
import {loadBakedResource,decompressBakedBytes} from './resource-cache.mjs';
import {framedMaterialBits,applyRegionFrame} from './spatial-frame.mjs';
import {createBakedTextureDecoder} from './texture-decoder.mjs';

const constructors={Float32Array,Uint32Array,Uint16Array,Uint8Array,Int16Array,Int8Array};
const yieldFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
async function parallel(items,callback,concurrency=6){let index=0;const results=new Array(items.length);const workers=await Promise.allSettled(Array.from({length:Math.min(items.length,concurrency)},async()=>{while(index<items.length){const i=index++;results[i]=await callback(items[i],i);}}));const failure=workers.find(result=>result.status==='rejected');if(failure)throw failure.reason;return results;}

/** Loads only baked buffers/images. No source mesh import, projection, clipping or recipe replay. */
export async function loadBakedRegion({baseUrl,entry,signal,frame,onProgress=()=>{}}){
 const started=performance.now(),metrics={downloadBytes:0,cacheHits:0,cacheMisses:0,cacheWriteFailures:0};
 const base=new URL(baseUrl,location.href),ownedBuffers=[],ownedGeometries=[],ownedMaterials=[],ownedSources=[],ownedTextures=[],nodes=[],passes=[],particles=[];
 const raw=new Map(),textureDecoder=createBakedTextureDecoder();let disposed=false;
 const release=()=>{if(disposed)return;disposed=true;textureDecoder.destroy();for(const p of passes)p.destroy();for(const node of [...nodes].reverse()){node.removeFromParent();if(!node.destroyed)node.destroy();}for(const m of ownedMaterials)if(!m.destroyed)m.destroy();for(const g of ownedGeometries)if(!g.destroyed)g.destroy(true);for(const t of ownedTextures)if(!t.destroyed)t.destroy(false);for(const s of ownedSources){s.resource?.close?.();if(!s.destroyed)s.destroy();}for(const b of ownedBuffers)if(!b.destroyed)b.destroy();};
 const downloads=new Map();
 const read=async resource=>{const physical=resource.pack||resource;let pending=downloads.get(physical.path);if(!pending){pending=loadBakedResource(base,physical,{signal,metrics});downloads.set(physical.path,pending);}const bytes=await pending;signal?.throwIfAborted();if(!resource.pack)return bytes;if(!Number.isSafeInteger(resource.offset)||resource.offset<0||resource.offset+resource.bytes>bytes.byteLength)throw Error('Invalid packed range');return bytes.slice(resource.offset,resource.offset+resource.bytes);};
 try{
  onProgress({phase:'Downloading Region',...metrics});
  const scene=JSON.parse(new TextDecoder().decode(await decompressBakedBytes(await read(entry.manifest))));
  if(scene.version!==1||scene.region!==entry.id||scene.units!=='metres-y-up'||!Array.isArray(scene.nodes)||!Array.isArray(scene.geometries))throw Error('Unsupported baked region');
  const buffers=[];function scan(value){if(!value||typeof value!=='object')return;if(value.sourceHash&&value.constructor&&value.path&&!raw.has(value.path)){raw.set(value.path,null);buffers.push(value);}for(const v of Object.values(value))scan(v);}scan(scene);
  await MeshoptDecoder.ready;
  await parallel(buffers,async ref=>{const decoded=await decompressBakedBytes(await read(ref));let bytes=new Uint8Array(decoded);if(ref.codec!=='raw'){if(!['ATTRIBUTES','INDICES'].includes(ref.codec)||ref.rawBytes>1024**3)throw Error('Unsupported buffer encoding');bytes=new Uint8Array(ref.rawBytes);MeshoptDecoder.decodeGltfBuffer(bytes,ref.count,ref.stride,new Uint8Array(decoded),ref.codec);}const Type=constructors[ref.constructor];if(!Type||bytes.byteLength!==ref.rawBytes)throw Error('Invalid baked buffer');raw.set(ref.path,new Type(bytes.buffer,bytes.byteOffset,bytes.byteLength/Type.BYTES_PER_ELEMENT));});
  onProgress({phase:'Loading Materials',...metrics});
  const sources=await parallel(scene.sources,async row=>{
   const options={width:row.width,height:row.height,format:row.format,viewDimension:row.viewDimension,arrayLayerCount:row.layers,alphaMode:row.alphaMode,autoGenerateMipmaps:row.autoGenerateMipmaps,...row.style};
   let source;
   if(row.resource?.codec==='pixels'){
    const {images,channels}=row.resource,layerSize=row.width*row.height*channels,bytes=new Uint8Array(layerSize*row.layers);
    await parallel(images,async(ref,index)=>{const decoded=await textureDecoder.decode((await read(ref)).slice(0),channels,ref.pixelHash);if(decoded.width!==row.width||decoded.height!==row.height)throw Error('Invalid baked texture dimensions');bytes.set(new Uint8Array(decoded.bytes),index*layerSize);},2);
    source=new BufferImageSource({...options,resource:bytes});
   }else if(row.resource){const bitmap=await decodeWorldImage(await read(row.resource),row.alphaMode);source=new ImageSource({...options,resource:bitmap});}
   else throw Error('Unsupported baked texture source');
   ownedSources.push(source);return source;
  },3);
  const textures=scene.textures.map(row=>{const rect=value=>value?new Rectangle(value.x,value.y,value.width,value.height):undefined;const texture=new Texture({source:sources[row.source],frame:rect(row.frame),orig:rect(row.orig),trim:rect(row.trim),rotate:row.rotate});ownedTextures.push(texture);return texture;});
  const materials=scene.materials.map(row=>{
   const bits=[...row.features,...row.extraBits],options={extraBits:frame&&row.kind!=='particle'?framedMaterialBits(bits):bits,alpha:row.alpha,alphaMode:row.alphaMode,alphaCutoff:row.alphaCutoff,doubleSided:row.doubleSided,flatShading:row.flatShading,fog:row.fog};
   const material=row.kind==='particle'?new BaseMaterial3D({...options,extraBits:[],descriptor:row.descriptor}):row.kind==='flat'?new FlatMaterial(options):new Material3D(options);
   material.vertexColors=row.vertexColors;material.lit=row.lit;material.toneMapped=row.toneMapped;
   for(const [key,value]of Object.entries(row.data))material.data[key]=Array.isArray(value)?new Float32Array(value):value;
   for(const [key,id]of Object.entries(row.textures))material.textures[key]=textures[id];
   material._passBit=row.passBit;material.state.depthMask=row.depthMask;material.state.blendMode=row.blendMode;
   if(row.surfaceDecal){material._passBit=RenderPassBit.TRANSPARENT;surfaceDecalMaterial(material);}
   ownedMaterials.push(material);return material;
  });
  const pixiBuffers=new Map();
  const geometries=scene.geometries.map(row=>{const attributes={};for(const [key,a]of Object.entries(row.attributes)){let buffer=pixiBuffers.get(a.buffer.path);if(!buffer){buffer=new Buffer({data:raw.get(a.buffer.path),usage:BufferUsage.VERTEX | BufferUsage.COPY_DST});ownedBuffers.push(buffer);pixiBuffers.set(a.buffer.path,buffer);}attributes[key]={...a,buffer};}const geometry=new Geometry3D({attributes,indices:raw.get(row.indices.path),topology:row.topology,indexCount:row.indexCount});ownedGeometries.push(geometry);return geometry;});
  onProgress({phase:'Preparing Display',...metrics});
  for(const [i,row]of scene.nodes.entries()){
   signal?.throwIfAborted();let node;
   if(row.type==='batch'){
    node=new BatchedMesh3D({size:row.slots.length,cull:row.cull,label:row.label});const matrices=raw.get(row.matrices.path),matrix=new Matrix4();
    for(let slot=0;slot<row.slots.length;slot++){const [g,m,mask,receiveShadow,billboardMode]=row.slots[slot];node.setGeometryAt(slot,geometries[g]);node.setMaterialAt(slot,materials[m]);matrix.elements.set(matrices.subarray(slot*16,slot*16+16));node.setMatrixAt(slot,matrix);node.items[slot].receiveShadow=receiveShadow;node.items[slot].billboardMode=billboardMode;node.setItemActive(slot,scene.materials[m].surfaceDecal&&mask?materials[m]._passBit:mask);}
   }else if(row.type==='mesh'||row.type==='particles'){
    node=new Mesh3D({geometry:geometries[row.geometry],material:materials[row.material],castShadow:row.castShadow,receiveShadow:row.receiveShadow,label:row.label});if(row.type==='particles')particles.push({material:node.material,uniforms:row.uniforms});
   }else node=new Container3D({label:row.label});
   const transform=new Matrix4();transform.elements.set(row.matrix);transform.decompose(node.position,node.quaternion,node.scale);
   node.visible=row.visible;node.lodOnly=row.lodOnly;nodes.push(node);if(row.parent>=0)nodes[row.parent].addChild(node);
   if(i%32===0)await yieldFrame();
  }
  const terrainPass=new LiveTerrainPass();passes.push(terrainPass);
  if(scene.passes.terrain){const row=scene.passes.terrain,meta=row.meta,s= row.sources.map(id=>sources[id]);const uniforms=new UniformGroup({...(frame?{foxholeFrame:{value:new Float32Array([frame.x,-frame.y,frame.scale,0]),type:'vec4<f32>'}}:{}),weightTransform:{value:new Float32Array([meta.weights.minX,meta.weights.maxZ,meta.weights.width,meta.weights.height]),type:'vec4<f32>'},weather:{value:new Float32Array([row.weather.wetness,row.weather.snow,0,0]),type:'vec4<f32>'}});const entries={0:uniforms};let slot=1;for(const source of s.slice(0,meta.buckets.length*2))entries[slot++]=source;const weight=s[meta.buckets.length*2];for(const value of [weight,s[0].style,weight.style,s.at(-2),s.at(-1)])entries[slot++]=value;const group=new BindGroup(entries);terrainPass.current={meta,geometry:geometries[row.geometry],sources:[],uniforms,group};terrainPass.weather=row.weather;}
  let shoulders;
  if(scene.passes.shoulders){const row=scene.passes.shoulders;shoulders=new RoadShoulderPass({terrainPass,geo:g=>g,release:()=>{}});shoulders.geometry=geometries[row.geometry];shoulders.source=sources[row.source];shoulders.visible=row.visible;shoulders.uniforms=new UniformGroup({edgeParams:{value:new Float32Array(row.edgeParams),type:'vec4<f32>'}});shoulders.group=new BindGroup({0:shoulders.uniforms,1:shoulders.source,2:shoulders.source.style});passes.push(shoulders);}
  if(scene.materials.some(m=>m.surfaceDecal))passes.push(new SurfaceDecalPass());
  const records=scene.lod.map(row=>({...row,levels:row.levels.map(level=>level.map(s=>({...s,batch:nodes[s.batch]})))}));
  for(const record of records)record.level=-2;
  const lod=createDistanceLod(records,scene.counts?.triangles||0);
  const root=nodes[0];root.eventMode='none';
  if(frame)applyRegionFrame({root,materials,terrainPass},frame);
  downloads.clear();raw.clear();textureDecoder.destroy();
  metrics.readyMs=performance.now()-started;onProgress({phase:'Ready',...metrics});
  return {root,passes,terrainPass,materials,scene,sites:scene.sites,lod,metrics,update({time=performance.now()/1000,camera}){for(const m of materials)if('waterTime'in m.data)m.data.waterTime=time;for(const p of particles)p.material.data.uParticleTime=time;if(camera)lod.update(camera);},destroy:release};
 }catch(error){release();throw error;}
}
