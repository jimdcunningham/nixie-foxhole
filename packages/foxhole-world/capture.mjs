// Generation-only: freeze the prepared viewer scene into render-ready resources.
// This module is never included in the client loader.
const properties=value=>Object.getOwnPropertyNames(Object.getPrototypeOf(value)).filter(key=>key!=='constructor'&&Object.getOwnPropertyDescriptor(Object.getPrototypeOf(value),key)?.get);
const uniformData=value=>Object.fromEntries(properties(value).map(key=>[key,plain(value[key])]));

function plain(value) {
 if (ArrayBuffer.isView(value)) return Array.from(value);
 if (Array.isArray(value)) return value.map(plain);
 if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,v])=>typeof v!=='function'&&v!==undefined).map(([k,v])=>[k,plain(v)]));
 return value;
}

export async function capturePreparedRegion(context, endpoint='/__bake') {
 const { root, view, region, world, terrainPass, roadShoulders }=context;
 const uploads=[];
 const upload=async(data,details={})=>{const reference={};uploads.push({data,details,reference});return reference;};
 const transfer=async({data,details,reference})=>{
  const bytes=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):data;
  const response=await fetch(endpoint+'/blob?details='+encodeURIComponent(JSON.stringify({...details,version:3})),{method:'POST',body:bytes});
  if(!response.ok)throw Error(await response.text());
  Object.assign(reference,await response.json());
 };
 const ids={buffers:new Map(),geometries:new Map(),materials:new Map(),sources:new Map(),textures:new Map(),nodes:new Map()};
 const scene={version:1,region,units:'metres-y-up',geometries:[],materials:[],sources:[],textures:[],nodes:[],lod:[],passes:{},counts:plain(world?.counts)};
 async function source(s){
  if(ids.sources.has(s))return ids.sources.get(s);
  const id=scene.sources.length;ids.sources.set(s,id);scene.sources.push(null);
  const row={width:s.width,height:s.height,format:s.format,viewDimension:s.viewDimension,layers:s.arrayLayerCount||1,alphaMode:s.alphaMode,autoGenerateMipmaps:s.autoGenerateMipmaps,style:plain({addressModeU:s.style.addressModeU,addressModeV:s.style.addressModeV,addressModeW:s.style.addressModeW,magFilter:s.style.magFilter,minFilter:s.style.minFilter,mipmapFilter:s.style.mipmapFilter,maxAnisotropy:s.style.maxAnisotropy})};
  const r=s.resource;
  if(ArrayBuffer.isView(r))row.resource=await upload(r,{kind:'pixels',...row});
  else if(Array.isArray(r))row.faces=await Promise.all(r.map(async face=>{const result=await fetch(face.currentSrc||face.src);if(!result.ok)throw Error('Cannot read cubemap face');return upload(await result.arrayBuffer(),{kind:'image'});}));
  else if(r?.currentSrc||r?.src||/^https?:/.test(s.label)){const url=r?.currentSrc||r?.src||s.label;if(new URL(url,location.href).origin!==location.origin)throw Error('Foreign texture in local bake');const response=await fetch(url);if(!response.ok)throw Error('Cannot read texture');row.resource=await upload(await response.arrayBuffer(),{kind:'image'});}
  else if(r){const canvas=new OffscreenCanvas(s.width,s.height),ctx=canvas.getContext('2d');ctx.drawImage(r,0,0);row.resource=await upload(await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer(),{kind:'image'});}
  else throw Error('Unsupported texture source '+s.constructor.name);
  scene.sources[id]=row;return id;
 }
 async function texture(t){
  if(ids.textures.has(t))return ids.textures.get(t);
  const id=scene.textures.length;ids.textures.set(t,id);scene.textures.push(null);
  scene.textures[id]={source:await source(t.source),frame:plain(t.frame),orig:plain(t.orig),trim:plain(t.trim),rotate:t.rotate};return id;
 }
 async function buffer(b,stride,kind='attributes'){
  if(!ids.buffers.has(b))ids.buffers.set(b,await upload(b,{kind,stride,constructor:b.constructor.name}));
  return ids.buffers.get(b);
 }
 async function geometry(g){
  if(ids.geometries.has(g))return ids.geometries.get(g);
  const id=scene.geometries.length;ids.geometries.set(g,id);scene.geometries.push(null);const attributes={};
  for(const [key,a]of Object.entries(g.attributes))attributes[key]={buffer:await buffer(a.buffer.data,a.stride||0),format:a.format,stride:a.stride,offset:a.offset,instance:a.instance};
  scene.geometries[id]={attributes,indices:await buffer(g.indexBuffer.data,0,'indices'),topology:g.topology,indexCount:g.indexCount};return id;
 }
 async function material(m){
  if(ids.materials.has(m))return ids.materials.get(m);
  const id=scene.materials.length;ids.materials.set(m,id);scene.materials.push(null);
  const textures={};for(const key of properties(m.textures)){const t=m.textures[key];if(t?.source)textures[key]=await texture(t);}
  const particle=m.constructor.name==='ParticleMaterial';
  scene.materials[id]={kind:particle?'particle':m.constructor.name==='FlatMaterial'?'flat':'pbr',features:plain(m._featureBits||[]),extraBits:plain(m._extraBits||[]),descriptor:particle?plain(m.getPrimaryDescriptor(view)):undefined,data:uniformData(m.data),textures,alpha:m.alpha,alphaCutoff:m.alphaCutoff,alphaMode:m.alphaMode,doubleSided:m.doubleSided,flatShading:m.flatShading,vertexColors:m.vertexColors,lit:m.lit,fog:m.fog,toneMapped:m.toneMapped,passBit:m._passBit,surfaceDecal:!!m.nativeSurfaceDecal,depthMask:m.state.depthMask,blendMode:m.state.blendMode};
  return id;
 }
 async function visit(node,parent=-1){
  const id=scene.nodes.length;ids.nodes.set(node,id);node.updateLocalTransform();
  globalThis.worldBakeProgress={phase:'Collecting',nodes:id,geometries:scene.geometries.length,materials:scene.materials.length};
  const row={parent,label:node.label,matrix:Array.from(node.localTransform.elements),visible:node.visible,lodOnly:!!node.lodOnly};scene.nodes.push(row);
  if(node.batch&&node.items){
   row.type='batch';row.slots=[];const matrices=new Float32Array(node.size*16),batch=node.matrices;
   for(let i=0;i<node.size;i++){
    const slot=node.items[i];matrices.set(batch.data.subarray(batch.offset+i*batch.stride,batch.offset+i*batch.stride+16),i*16);
    row.slots.push([await geometry(slot.geometry),await material(slot.material),slot._lastRenderPass,slot.receiveShadow!==false,slot.billboardMode||'none']);
   }
   row.matrices=await buffer(matrices,64);row.cull=node.cull;
  }else if(node.geometry&&node.material){
   row.type=node._particleMaterial?'particles':'mesh';row.geometry=await geometry(node.geometry);row.material=await material(node.material);row.castShadow=node.castShadow;row.receiveShadow=node.receiveShadow;
   if(row.type==='particles')row.uniforms=uniformData(node.uniforms);
  }else row.type='container';
  for(const child of node.children||[])await visit(child,id);
 }
 await visit(root);
 const current=terrainPass.current;
 if(current)scene.passes.terrain={meta:plain(current.meta),geometry:await geometry(current.geometry),sources:await Promise.all(current.sources.map(source)),weather:plain(terrainPass.weather)};
 if(roadShoulders.geometry)scene.passes.shoulders={geometry:await geometry(roadShoulders.geometry),source:await source(roadShoulders.source),edgeParams:Array.from(roadShoulders.uniforms.uniforms.edgeParams),visible:roadShoulders.visible};
 for(const record of world?.lodRecords||[])scene.lod.push({...plain({...record,levels:undefined}),levels:record.levels.map(level=>level.map(slot=>({batch:ids.nodes.get(slot.batch),index:slot.index,triangles:slot.triangles})))});
 scene.sites=plain(world?.sites||[]);
 scene.environment=view.environment?.source?{source:await source(view.environment.source)}:plain(view.environment);
 let next=0;
 await Promise.all(Array.from({length:4},async()=>{while(next<uploads.length){const index=next++;await transfer(uploads[index]);globalThis.worldBakeProgress={completed:index+1,total:uploads.length};}}));
 const response=await fetch(endpoint+'/region',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(scene)});
 if(!response.ok)throw Error(await response.text());
 return response.json();
}
