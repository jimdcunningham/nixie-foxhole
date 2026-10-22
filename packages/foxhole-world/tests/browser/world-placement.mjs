import {Application,Texture,ImageSource} from 'pixi.js';
import {View3D,Camera3D,Container3D,AmbientLight,DirectionalLight,parseGltf,normalizeMeshopt} from '@pixi/3d';
import '@pixi/3d/webgl';import '@pixi/3d/webgpu';
import {loadWorldModels} from '../../authoring/world-models.mjs';
import {createWorldActorVisibility} from '../../authoring/world-actor-visibility.mjs';
import {retainModelMaterialNames} from '../../runtime/model-material-names.mjs';

// Independent real-asset regression for the reported Westgate layout overlap.
const status=document.querySelector('pre'),base=new URL('/foxhole/assets/world/',location.href),reads=new Map();
const read=async url=>{url=new URL(url,base).href;if(!reads.has(url))reads.set(url,fetch(url).then(r=>{if(!r.ok)throw Error(url+' '+r.status);return r.arrayBuffer();}));return reads.get(url);};
const json=async url=>JSON.parse(new TextDecoder().decode(await read(url)));
try{
 const index=await json('index.json'),manifest=await json(index.regions.westgate.manifest.path),world=await json(manifest.resources['westgate/world.json'].resource.path),night=await json(manifest.resources['westgate/night-materials.json'].resource.path),war=await fetch('./war-state.json').then(r=>r.json());
 const building=world.prototypes.map(p=>({...p,placements:p.placements.filter(row=>Math.hypot(row.matrix[12]-390,row.matrix[14]+380)<65||p.name.startsWith('BPFactory_C/'))})).filter(p=>p.placements.length);
 const policy=createWorldActorVisibility({region:'westgate',prototypes:world.prototypes});policy.setWarState({items:war.mapItems});
 const sources=new Map(),images=new Map();
 const model=async url=>{if(!sources.has(url))sources.set(url,(async()=>{const doc=await json(url),buffers=await Promise.all((doc.buffers||[]).map(b=>read(new URL(b.uri,url))));await normalizeMeshopt(doc,buffers);const textures=await Promise.all((doc.images||[]).map(async i=>{const u=new URL(i.uri,url).href;if(!images.has(u))images.set(u,(async()=>{const bitmap=await createImageBitmap(new Blob([await read(u)]),{premultiplyAlpha:'none',colorSpaceConversion:'none'});return new Texture({source:new ImageSource({resource:bitmap,alphaMode:'premultiply-alpha-on-upload',autoGenerateMipmaps:true})});})());return images.get(u);}));return retainModelMaterialNames(await parseGltf(doc,buffers,textures),doc);})());return sources.get(url);};
 for(const restored of [false,true]){
  const backend=new URLSearchParams(location.search).get('backend')||'webgpu';let gpu;
  if(backend==='webgpu'){const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice({requiredFeatures:['indirect-first-instance']});device.addEventListener('uncapturederror',e=>{status.textContent+='\nGPU ERROR '+e.error.message;});gpu={adapter,device};}
  const app=new Application();await app.init({width:580,height:480,resolution:1,autoStart:false,antialias:true,preference:backend,background:0x343b40,...(gpu?{webgpu:{gpu}}:{})});
  const panel=document.createElement('section');panel.innerHTML='<h2>'+(restored?'Current War Layout':'All Native Candidates')+'</h2>';panel.append(app.canvas);document.querySelector('main').append(panel);
  const view=new View3D({width:580,height:480,autoResize:false,toneMapping:'aces',camera:new Camera3D({near:.1,far:2000,fov:45}),environment:{skyColor:0xc4d4db,groundColor:0x464333,intensity:.75}});app.stage.addChild(view);
  view.camera.position.set(430,45,-323);view.camera.lookAt({x:390,y:10,z:-380});view.root.addChild(new AmbientLight({intensity:.2}));const sun=new DirectionalLight({intensity:5,color:0xfffaf1});sun.position.set(410,100,-320);sun.lookAt({x:390,y:7,z:-380});view.root.addChild(sun);
  const root=new Container3D();view.root.addChild(root);
  const scene=await loadWorldModels({region:'westgate',root,status(){},teamAt:()=> 'NONE',json:async p=>p.endsWith('/world.json')?{prototypes:building}:p.endsWith('/night-materials.json')?night:{assets:{}},assetUrl:p=>new URL(manifest.resources[p].resource.path,base).href,loadModel:model});
  if(scene.counts.failed.length)throw Error(JSON.stringify(scene.counts.failed));if(restored)scene.setWarState({items:war.mapItems});app.render();await app.renderer.extract.pixels({target:app.stage});
 }
 if(policy.visible('BPRefinery2')||!policy.visible('VillageWMedAttachedG2_2')||policy.summary.visibleOilRigs!==2)throw Error('Live layout selection failed');
 status.textContent='PASS: inactive refinery/factory variants hidden; active houses retained. Westgate oil rigs: '+policy.summary.visibleOilRigs+' of '+policy.summary.oilRigCandidates+' candidates. Selected native layer: '+policy.summary.layerMasks.join(',')+'. Backend: '+(new URLSearchParams(location.search).get('backend')||'webgpu');document.title='World Placement Verified';
}catch(error){status.textContent+='\nERROR '+error.stack;document.title='World Placement Failed';}
