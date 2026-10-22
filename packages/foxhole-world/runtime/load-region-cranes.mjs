import {createCatalogModelLease} from './catalog-model-leases.mjs';
import {loadCatalogModel} from './catalog-model.mjs';
import {createMirroredGeometryCache} from '../authoring/mirrored-geometry.mjs';
import {Container3D,Model3D,Mesh3D,Matrix4} from '@pixi/3d';

// Pixi owns the source cache. Model3D instances reuse its geometry/materials;
// retiring a region destroys placements, while the catalog resource stays reusable.
export async function loadRegionCranes({baseUrl,root,placements,signal,fetcher=fetch,loadModel,scheduleModelTask=task=>task(),publishBatch=build=>build(),getActorVisible=()=>()=>true}){
 const lease=loadModel?null:createCatalogModelLease({load:url=>scheduleModelTask(()=>loadCatalogModel(url))});loadModel??=url=>lease.get(url);
 if(!placements.length)return {count:0,destroy(){}};
 try {
 const base=new URL('../',new URL(baseUrl,globalThis.location?.href)),response=await fetcher(new URL('models/manifest.v1.json',base),{signal,cache:'no-cache'});
 if(!response.ok)throw Error('The catalog crane model is unavailable ('+response.status+').');
 const catalog=await response.json(),descriptor=catalog.assets?.staticcrane;
 if(!descriptor||descriptor.path!=='types/structures/staticcrane/staticcrane.glb'||!['offsetX','offsetY','offsetZ'].every(k=>Number.isFinite(descriptor[k])))throw Error('Invalid stationary crane catalog model');
 const modelUrl=new URL(descriptor.path,base);modelUrl.searchParams.set('v',descriptor.sha256);
 const source=await loadModel(modelUrl.href),parts=descriptor.modelParts?.parts||[],partSources=new Map();
 if(parts.length>128)throw Error('Stationary crane exceeds the shared placement budget');
 await Promise.all(parts.map(async part=>{
  const id=part.resourceId.replace(/^foxhole\.model\./,''),resource=catalog.sharedParts?.[id];
  if(!/^shared\.[a-f0-9]{64}$/.test(id)||!resource||resource.path!=='shared/models/'+id.slice(7)+'.glb')throw Error('Invalid shared crane resource');
  if(!partSources.has(id))partSources.set(id,loadModel(new URL(resource.path,base).href));
  await partSources.get(id);
 }));
 signal?.throwIfAborted();
 const group=new Container3D({label:'Native Spawned Cranes'}),winding=createMirroredGeometryCache();
 // The catalog-to-native Z reflection reverses face orientation. Share vertices
 // and materials, but correct indices before the host applies its own frame.
 const correctWinding=node=>{if(node instanceof Mesh3D)node.geometry=winding.get(node.geometry);for(const child of node.children)correctWinding(child);};
 try{
  for(const placement of placements){
   const owner=new Container3D({label:placement.actor+'/'+placement.name});
   new Matrix4().fromArray(placement.matrix).decompose(owner.position,owner.quaternion,owner.scale);
   group.addChild(owner);
   const basis=new Container3D();basis.scale.z=-1;owner.addChild(basis);
   const origin=new Container3D();origin.position.set(descriptor.offsetX/32,descriptor.offsetZ/32,descriptor.offsetY/32);basis.addChild(origin);
   const model=new Model3D(source);origin.addChild(model);
   for(const part of parts){
    const anchor=model.getChildByLabel(part.nodeName,true);if(!anchor)throw Error('Missing shared crane placement: '+part.nodeName);
    anchor.addChild(new Model3D(await partSources.get(part.resourceId.replace(/^foxhole\.model\./,''))));
   }
  }
  correctWinding(group);
  await publishBatch(()=>{signal?.throwIfAborted();group.children.forEach((node,i)=>{node.visible=getActorVisible()(placements[i].actor);});root.addChild(group);return group;});
  return {count:placements.length,root:group,setActorVisibility(visible){group.children.forEach((node,i)=>{node.visible=visible(placements[i].actor);});},destroy(){group.removeFromParent();group.destroy({children:true});winding.destroy();lease?.release();}};
 }catch(error){group.destroy({children:true});winding.destroy();throw error;}
 }catch(error){lease?.release();throw error;}
}
