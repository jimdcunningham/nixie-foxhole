import nativeBindings from './native-catalog-bindings.json' with {type:'json'};
import {resourceFieldAssets,selectResourceFields} from './resource-field-placements.mjs';
export const catalogFamilies=Object.freeze({field:resourceFieldAssets,mine:Object.freeze({32:'sulfurmine',38:'scrapmine',40:'componentmine'}),rig:Object.freeze({75:'facilitymineoilrig'})});
const has=(catalog,asset)=>Object.hasOwn(catalog?.assets||{},asset);
export function catalogBindingFor(p,catalog){
 if(!catalog)return null;
 const type=p.name.split('/')[0];let binding=p.catalogBinding;
 if(!binding){
  if(type==='BPResourceFieldProxy_C'||/^BP(?:Salvage|Components?|Sulfur|Coal)Field_C$/.test(type))binding={kind:'field'};
  else if(type==='BPResourceMineProxy_C')binding={kind:'mine'};
  else if(type==='BPResourceOilRigProxy_C')binding={kind:'rig'};
  // Bridges, splines, rivers and infrastructure carry map-specific geometry.
  else if(p.category!=='infrastructure'&&!/Bridge|Spline|River|WaterBody/i.test(type)){const asset=nativeBindings.blueprints[type];if(asset)binding={kind:'fixed',asset};}
 }
 if(!binding)return null;
 if(binding.kind==='fixed'&&has(catalog,binding.asset))return {kind:'fixed',asset:binding.asset};
 if(catalogFamilies[binding.kind]&&Object.values(catalogFamilies[binding.kind]).every(asset=>has(catalog,asset)))return {kind:binding.kind};
 if(p.catalogBinding)throw Error('Published catalog binding is unavailable: '+p.name);return null;
}
export function catalogWorldPlacements(data,catalog){
 const placements=new Map();for(const p of data.prototypes){const binding=catalogBindingFor(p,catalog);if(!binding)continue;const type=p.name.split('/')[0];for(const row of p.placements){const actor=row.actor||row.name;if(!actor)throw Error('Catalog placement has no native actor: '+p.name);const key=type+':'+actor,existing=placements.get(key);if(existing){if(p.kind==='building')existing.category='building';continue;}placements.set(key,{actor,type,...binding,category:p.kind==='building'?'building':p.category||'structures',matrix:row.matrix.slice()});}}return [...placements.values()];
}
export function selectCatalogWorld(placements,state,visible=()=>true){
 const selected=new Map();for(const [i,p]of placements.entries())if(p.kind==='fixed'&&visible(p.actor))selected.set(i,p.asset);
 for(const [family,assets]of Object.entries(catalogFamilies)){const rows=placements.map((p,i)=>({...p,index:i})).filter(p=>p.kind===family),matched=selectResourceFields(rows,state,visible,assets);for(const [i,asset]of matched)selected.set(rows[i].index,asset);}return selected;
}
export function catalogAssetsFor(placements){return [...new Set(placements.flatMap(p=>p.kind==='fixed'?[p.asset]:Object.values(catalogFamilies[p.kind]||{})))].sort();}
// Retain actor metadata for native layout/ownership decisions; render data comes
// from the catalog. Proxy-only slabs and alternative mine meshes are omitted.
export function prepareCatalogWorld(data,catalog){
 const placements=catalogWorldPlacements(data,catalog),byType=new Map();for(const p of placements){if(!byType.has(p.type))byType.set(p.type,[]);byType.get(p.type).push(p);}
 const replaced=data.prototypes.filter(p=>catalogBindingFor(p,catalog)),remaining=data.prototypes.filter(p=>!catalogBindingFor(p,catalog));
 const markers=[...byType].map(([type,rows])=>({name:type+'/$Catalog',kind:rows.some(r=>r.category==='building')?'building':'environment',category:rows[0].category,catalogBinding:rows[0].kind==='fixed'?{kind:'fixed',asset:rows[0].asset}:{kind:rows[0].kind},placements:rows.map(p=>({actor:p.actor,name:p.actor,matrix:p.matrix}))}));
 return {world:{...data,prototypes:[...remaining,...markers]},placements,assets:catalogAssetsFor(placements),replacedFiles:new Set(replaced.map(p=>p.file).filter(Boolean)),remainingFiles:new Set(remaining.map(p=>p.file).filter(Boolean))};
}
