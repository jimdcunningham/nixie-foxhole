import {loadCatalogModel} from './catalog-model.mjs';
import {resourceFieldAssets,selectResourceFields} from '../authoring/resource-field-placements.mjs';
import {createMirroredGeometryCache,isMirroredTransform} from '../authoring/mirrored-geometry.mjs';
import {Container3D,Model3D,Mesh3D,Matrix4,BatchedMesh3D,RenderPassBit} from '@pixi/3d';

export async function loadRegionResourceFields({baseUrl,root,placements,signal,fetcher=fetch,loadModel=loadCatalogModel}){
 const summary={candidates:placements.length,visible:0,byAsset:{}};
 if(!placements.length)return {summary,setWarState(){},destroy(){}};
 const base=new URL('../',new URL(baseUrl,globalThis.location?.href)),response=await fetcher(new URL('models/manifest.v1.json',base),{signal,cache:'no-cache'});if(!response.ok)throw Error('Resource-field catalog unavailable ('+response.status+').');const catalog=await response.json();
 const sources=await Promise.all(Object.values(resourceFieldAssets).map(async asset=>{const d=catalog.assets?.[asset];if(!d||d.path!=='types/structures/'+asset+'/'+asset+'.glb'||!['offsetX','offsetY','offsetZ'].every(k=>Number.isFinite(d[k]))||d.modelParts?.parts?.length)throw Error('Invalid resource-field catalog model: '+asset);const url=new URL(d.path,base);url.searchParams.set('v',d.sha256);return {asset,descriptor:d,source:await loadModel(url.href)};}));signal?.throwIfAborted();
 const group=new Container3D({label:'Catalog Resource Fields'}),winding=createMirroredGeometryCache(),records=[];
 try{
  for(const {asset,descriptor:d,source}of sources){
   const model=new Model3D(source),parts=[];model.scale.z=-1;model.position.set(d.offsetX/32,d.offsetZ/32,-d.offsetY/32);
   const visit=(node,parent)=>{node.updateLocalTransform();const matrix=parent.clone().multiply(node.localTransform);if(node instanceof Mesh3D)parts.push({geometry:node.geometry,material:node.material,matrix});for(const child of node.children)visit(child,matrix);};visit(model,new Matrix4());model.destroy({children:true});
   const batch=new BatchedMesh3D({size:parts.length*placements.length,cull:'gpu',label:asset});let slot=0;
   for(const [i,p]of placements.entries())for(const part of parts){const matrix=new Matrix4().fromArray(p.matrix).multiply(part.matrix);batch.setGeometryAt(slot,isMirroredTransform(Array.from(matrix.elements))?winding.get(part.geometry):part.geometry);batch.setMaterialAt(slot,part.material);batch.setMatrixAt(slot,matrix);batch.items[slot].receiveShadow=true;const mask=(part.material.alphaMode==='blend'?RenderPassBit.TRANSPARENT:RenderPassBit.OPAQUE)|RenderPassBit.SHADOW;batch.setItemActive(slot,0);records.push({batch,slot:slot++,placement:i,asset,mask});}group.addChild(batch);
  }
  root.addChild(group);let lastItems,first=true;
  return {root:group,summary,setWarState(state,visible){const items=state?.items;if(!first&&items===lastItems)return;first=false;lastItems=items;const selected=selectResourceFields(placements,state,visible);summary.visible=selected.size;summary.byAsset={};for(const asset of selected.values())summary.byAsset[asset]=(summary.byAsset[asset]||0)+1;for(const r of records)r.batch.setItemActive(r.slot,selected.get(r.placement)===r.asset?r.mask:0);},destroy(){group.removeFromParent();group.destroy({children:true});winding.destroy();}};
 }catch(error){group.destroy({children:true});winding.destroy();throw error;}
}
