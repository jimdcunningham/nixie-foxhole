import {Assets} from 'pixi.js';
import {Material3D} from '@pixi/3d';
import native from '../authoring/native-flag-textures.json' with {type:'json'};
const leases=new Map();
export function nativeFactionFlagTexture(baseUrl,team,{loadTexture=url=>Assets.load(url),onAsset=()=>{}}={}){
 const record=native.textures[team];if(!record)throw Error('Unknown faction flag '+team);
 const url=new URL(record.path,new URL('../',new URL(baseUrl,globalThis.location?.href))).href;onAsset(url);return loadTexture(url);
}
export async function acquireCatalogFlagMaterials(baseUrl,{loadTexture=url=>Assets.load(url),onAsset=()=>{}}={}){
 const base=new URL('../',new URL(baseUrl,globalThis.location?.href)).href;let entry=leases.get(base);
 if(!entry){entry={references:0,materials:null};entry.promise=Promise.all(Object.entries(native.textures).map(async([team,record])=>{
  const url=new URL(record.path,base).href;onAsset(url);const texture=await loadTexture(url);
  return [team,texture];
 })).then(rows=>entry.materials=Object.fromEntries(rows.map(([team,texture])=>[team,new Material3D({baseColorTexture:texture,baseColor:0xffffff,roughness:.9,metallic:0,doubleSided:true,alphaMode:'mask',alphaCutoff:.3333})])));leases.set(base,entry);}
 entry.references++;
 try{const materials=await entry.promise;let released=false;return {materials,release(){if(released)return;released=true;if(--entry.references===0){for(const material of Object.values(materials))material.destroy();leases.delete(base);}}};}
 catch(error){if(--entry.references===0)leases.delete(base);throw error;}
}
