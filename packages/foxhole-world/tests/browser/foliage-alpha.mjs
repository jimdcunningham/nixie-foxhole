import {Application,Texture,ImageSource} from 'pixi.js';
import {View3D,Camera3D,Container3D,AmbientLight,DirectionalLight,parseGltf,normalizeMeshopt} from '@pixi/3d';
import '@pixi/3d/webgl';import '@pixi/3d/webgpu';
import {loadWorldModels} from '../../authoring/world-models.mjs';
import {retainModelMaterialNames} from '../../runtime/model-material-names.mjs';

// Real greenhouse assets: the left view omits the masked peer declarations;
// the right view uses the same region's existing alpha-bearing foliage peers.
const status=document.querySelector('pre'),base=new URL('/foxhole/assets/world/',location.href),cache=new Map();
const read=async url=>{url=new URL(url,base).href;if(!cache.has(url))cache.set(url,fetch(url).then(r=>{if(!r.ok)throw Error(url+' '+r.status);return r.arrayBuffer();}));return cache.get(url);};
const json=async url=>JSON.parse(new TextDecoder().decode(await read(url)));
try{
 const index=await json('index.json'),manifest=await json(index.regions.westgate.manifest.path),world=await json(manifest.resources['westgate/world.json'].resource.path);
 const night=await json(manifest.resources['westgate/night-materials.json'].resource.path);
 const building=world.prototypes.filter(p=>p.name.startsWith('TownWGreenhouse'));
 const textures=new Set(building.filter(p=>/\/Foliage\//i.test(p.path)).flatMap(p=>(p.materials||[]).map(m=>m.diffuse).filter(Boolean))),peers=[],found=new Set();
 for(const p of world.prototypes){if(!/\/Foliage\//i.test(p.path||'')||p.materials?.some(m=>m.diffuse&&m.masked!==true))continue;for(const m of p.materials||[])if(m.masked&&textures.has(m.diffuse)&&!found.has(m.diffuse)){found.add(m.diffuse);peers.push({...p,placements:[]});}}
 const results=[];
 for(const restored of [false,true]){
  const backend=new URLSearchParams(location.search).get('backend')||'webgpu';let gpu;
  if(backend==='webgpu'){const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice({requiredFeatures:['indirect-first-instance']});device.addEventListener('uncapturederror',e=>{status.textContent+='\nGPU ERROR '+e.error.message;});gpu={adapter,device};}
  const app=new Application();await app.init({width:800,height:700,resolution:1,autoStart:false,antialias:true,preference:backend,background:0x343b40,...(gpu?{webgpu:{gpu}}:{})});
  const panel=document.createElement('section');panel.innerHTML='<h2>'+(restored?'Restored Foliage Alpha':'Opaque Component Export')+'</h2>';panel.append(app.canvas);document.querySelector('main').append(panel);
  const view=new View3D({width:800,height:700,autoResize:false,toneMapping:'aces',camera:new Camera3D({near:0.1,far:2000,fov:45}),environment:{skyColor:0xc4d4db,groundColor:0x464333,intensity:0.75}});app.stage.addChild(view);
  view.camera.position.set(296,24,-423);view.camera.lookAt({x:275.25,y:12,z:-444.93});
  view.root.addChild(new AmbientLight({intensity:0.2}));const sun=new DirectionalLight({intensity:5,color:0xfffaf1});sun.position.set(250,100,-400);sun.lookAt({x:275,y:7,z:-445});view.root.addChild(sun);
  const root=new Container3D();view.root.addChild(root);const models=new Map(),images=new Map();
  const model=async url=>{if(!models.has(url))models.set(url,(async()=>{const doc=await json(url),buffers=await Promise.all((doc.buffers||[]).map(b=>read(new URL(b.uri,url))));await normalizeMeshopt(doc,buffers);const ts=await Promise.all((doc.images||[]).map(async i=>{const u=new URL(i.uri,url).href;if(!images.has(u))images.set(u,(async()=>{const bitmap=await createImageBitmap(new Blob([await read(u)]),{premultiplyAlpha:'none',colorSpaceConversion:'none'});return new Texture({source:new ImageSource({resource:bitmap,alphaMode:'premultiply-alpha-on-upload',autoGenerateMipmaps:true})});})());return images.get(u);}));return retainModelMaterialNames(await parseGltf(doc,buffers,ts),doc);})());return models.get(url);};
  const scene=await loadWorldModels({region:'westgate',root,status(){},teamAt:()=> 'NONE',json:async p=>p.endsWith('/world.json')?{prototypes:restored?[...building,...peers]:building}:p.endsWith('/night-materials.json')?night:{assets:{}},assetUrl:p=>{if(!manifest.resources[p])throw Error('Undeclared fixture model '+p);return new URL(manifest.resources[p].resource.path,base).href;},loadModel:model});
  if(scene.counts.failed.length)throw Error(JSON.stringify(scene.counts.failed));
  app.render();await app.renderer.extract.pixels({target:app.stage});
  results.push({restored,placements:scene.counts.placements,parts:scene.counts.parts,failed:scene.counts.failed,peerTextures:found.size,maskedSlots:scene.batches.flatMap(b=>b.items).filter(i=>i.material.alphaMode==='mask').length});
  status.textContent=JSON.stringify(results,null,2);
 }
 if(results[0].placements!==results[1].placements||results[0].parts!==results[1].parts||results[1].maskedSlots<=results[0].maskedSlots)throw Error('Foliage restoration changed geometry or failed to restore cutouts');
 document.title='Greenhouse Alpha Verified';
}catch(error){status.textContent+='\nERROR '+error.stack;document.title='Greenhouse Alpha Failed';}
