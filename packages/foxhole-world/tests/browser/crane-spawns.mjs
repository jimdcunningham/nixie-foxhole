import {Application,Assets,Texture,ImageSource} from 'pixi.js';
import {View3D,Camera3D,Container3D,Model3D,Mesh3D,AmbientLight,DirectionalLight,parseGltf,normalizeMeshopt} from '@pixi/3d';
import '@pixi/3d/webgl';import '@pixi/3d/webgpu';
import {loadWorldModels} from '../../authoring/world-models.mjs';
import {loadCatalogModel} from '../../runtime/catalog-model.mjs';
import {loadRegionCranes} from '../../runtime/load-region-cranes.mjs';
import {craneSpawnPlacements} from '../../authoring/crane-spawn-placements.mjs';
import {createMirroredGeometryCache} from '../../authoring/mirrored-geometry.mjs';
import {retainModelMaterialNames} from '../../runtime/model-material-names.mjs';

const status=document.querySelector('pre'),base=new URL('/foxhole/assets/world/',location.href),cache=new Map(),identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const read=async url=>{url=new URL(url,base).href;if(!cache.has(url))cache.set(url,fetch(url).then(r=>{if(!r.ok)throw Error(url+' '+r.status);return r.arrayBuffer();}));return cache.get(url);};
const json=async url=>JSON.parse(new TextDecoder().decode(await read(url)));
function meshes(node){return [...(node instanceof Mesh3D?[node]:[]),...node.children.flatMap(meshes)];}
function bounds(node){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const mesh of meshes(node)){const b=mesh.geometry.bounds3D;for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const p=mesh.toGlobal({x,y,z});[p.x,p.y,p.z].forEach((v,i)=>{min[i]=Math.min(min[i],v);max[i]=Math.max(max[i],v);});}}return [...min,...max];}
try{
 const index=await json('index.json'),manifest=await json(index.regions.westgate.manifest.path),world=await json(manifest.resources['westgate/world.json'].resource.path),night=await json(manifest.resources['westgate/night-materials.json'].resource.path);
 const native=world.prototypes.filter(p=>p.name.startsWith('BPRefinery_C/')),actor=native[0].placements[0].actor;
 const data={prototypes:native.map(p=>({...p,placements:p.placements.filter(row=>row.actor===actor).map(row=>({...row,matrix:identity}))})).filter(p=>p.placements.length)};
 const catalog=await json('../models/manifest.v1.json'),craneNodes=[],views=[];
 const models=new Map(),images=new Map();
 const load=async url=>{if(!models.has(url))models.set(url,(async()=>{const doc=await json(url),buffers=await Promise.all((doc.buffers||[]).map(b=>read(new URL(b.uri,url))));await normalizeMeshopt(doc,buffers);const ts=await Promise.all((doc.images||[]).map(async i=>{const u=new URL(i.uri,url).href;if(!images.has(u))images.set(u,(async()=>{const bitmap=await createImageBitmap(new Blob([await read(u)]),{premultiplyAlpha:'none',colorSpaceConversion:'none'});return new Texture({source:new ImageSource({resource:bitmap,alphaMode:'premultiply-alpha-on-upload',autoGenerateMipmaps:true})});})());return images.get(u);}));return retainModelMaterialNames(await parseGltf(doc,buffers,ts),doc);})());return models.get(url);};
 const loadCatalog=descriptor=>{const url=new URL('../'+descriptor.path,base);if(descriptor.sha256&&!descriptor.path.startsWith('shared/'))url.searchParams.set('v',descriptor.sha256);return loadCatalogModel(url.href);};
 for(const mode of ['Native Map Refinery','Catalog Refinery']){
  const backend=new URLSearchParams(location.search).get('backend')||'webgpu';let gpu;
  if(backend==='webgpu'){const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice({requiredFeatures:['indirect-first-instance']});device.addEventListener('uncapturederror',e=>{status.textContent+='\nGPU ERROR '+e.error.message;});gpu={adapter,device};}
  const app=new Application();await app.init({width:580,height:480,resolution:1,autoStart:false,antialias:true,preference:backend,background:0x343b40,...(gpu?{webgpu:{gpu}}:{})});
  const panel=document.createElement('section');panel.innerHTML='<h2>'+mode+'</h2>';panel.append(app.canvas);document.querySelector('main').append(panel);
  const view=new View3D({width:580,height:480,autoResize:false,toneMapping:'aces',camera:new Camera3D({near:.1,far:2000,fov:45}),environment:{skyColor:0xc4d4db,groundColor:0x464333,intensity:.75}});app.stage.addChild(view);views.push({app,view});
  view.camera.position.set(28,22,40);view.camera.lookAt({x:0,y:0,z:0});view.root.addChild(new AmbientLight({intensity:.2}));const sun=new DirectionalLight({intensity:5,color:0xfffaf1});sun.position.set(50,100,60);sun.lookAt({x:0,y:0,z:0});view.root.addChild(sun);
  const root=new Container3D();view.root.addChild(root);
  if(mode.startsWith('Native')){
   const scene=await loadWorldModels({region:'westgate',root,status(){},teamAt:()=> 'NONE',json:async p=>p.endsWith('/world.json')?data:p.endsWith('/night-materials.json')?night:{assets:{}},assetUrl:p=>new URL(manifest.resources[p].resource.path,base).href,loadModel:load});
   if(scene.counts.failed.length)throw Error(JSON.stringify(scene.counts.failed));
   const cranes=await loadRegionCranes({baseUrl:'/foxhole/assets/world/',root:scene.layers.structures,placements:scene.cranePlacements});craneNodes.push(cranes.root);
  }else{
   const winding=createMirroredGeometryCache(),d=catalog.assets.refinery,basis=new Container3D();basis.scale.z=-1;root.addChild(basis);const origin=new Container3D();origin.position.set(d.offsetX/32,d.offsetZ/32,d.offsetY/32);basis.addChild(origin);const model=new Model3D(await loadCatalog(d));origin.addChild(model);
   const anchors=[];for(const p of d.modelParts.parts){const anchor=model.getChildByLabel(p.nodeName,true),id=p.resourceId.replace('foxhole.model.','');anchor.addChild(new Model3D(await loadCatalog(catalog.sharedParts[id])));anchors.push(anchor);}const correct=node=>{if(node instanceof Mesh3D)node.geometry=winding.get(node.geometry);for(const child of node.children)correct(child);};for(const anchor of anchors)correct(anchor);craneNodes.push(anchors[0]);
  }
  app.render();await app.renderer.extract.pixels({target:app.stage});
 }
 const left=bounds(craneNodes[0]),right=bounds(craneNodes[1]),error=Math.max(...left.map((v,i)=>Math.abs(v-right[i]))),leftMeshes=meshes(craneNodes[0]),rightMeshes=meshes(craneNodes[1]);
 if(error>.001)throw Error('Map/catalog crane bounds diverged by '+error+'m '+JSON.stringify({left,right}));
 if(leftMeshes.length!==rightMeshes.length||!leftMeshes.every((m,i)=>m.geometry.attributes.aPosition.buffer===rightMeshes[i].geometry.attributes.aPosition.buffer&&m.material===rightMeshes[i].material))throw Error('Crane sources are not shared');
 status.textContent='PASS: native and catalog crane bounds match within '+error.toFixed(6)+' metres. '+leftMeshes.length+' mesh parts share vertex buffers and materials with corrected winding. Westgate: '+craneSpawnPlacements(world).length+' native crane spawns. Backend: '+(new URLSearchParams(location.search).get('backend')||'webgpu');
 document.title='Posed Shared Cranes Verified';
}catch(error){status.textContent+='\nERROR '+error.stack;document.title='Crane Verification Failed';}
