export const resourceFieldAssets=Object.freeze({20:'salvagefield',21:'componentsfield',23:'sulfurfield',61:'coalfield'});
export const isResourceFieldPrototype=p=>/^(BPResourceFieldProxy_C\/FieldProxyMesh|BP(?:Salvage|Components?|Sulfur|Coal)Field_C\/ResourceFieldMesh)$/.test(p.name);
export function resourceFieldPlacements(data){
 const actors=new Map();for(const p of data.prototypes)if(isResourceFieldPrototype(p))for(const row of p.placements){const actor=row.actor||row.name;if(!actor||actors.has(actor))continue;actors.set(actor,{actor,matrix:row.matrix.slice()});}return [...actors.values()];
}
// Same normalized War API -> native metre frame as icons and layout selection.
// One icon selects at most one candidate; nearby duplicate source actors cannot
// turn a single live field into two overlapping models.
export function selectResourceFields(placements,state,visible=()=>true,assets=resourceFieldAssets){
 const pairs=[];for(const [j,item]of (state?.items||[]).entries()){const asset=Object.hasOwn(assets,item.iconType)?assets[item.iconType]:null;if(!asset||!Number.isFinite(item.x)||!Number.isFinite(item.y))continue;const x=(item.x-.5)*2184,z=(.5-item.y)*1890;for(const [i,p]of placements.entries()){if(!visible(p.actor))continue;const distance=Math.hypot(x-p.matrix[12],z-p.matrix[14]);if(distance<=2)pairs.push({i,j,asset,distance});}}
 pairs.sort((a,b)=>a.distance-b.distance||a.i-b.i||a.j-b.j);const chosen=new Map(),icons=new Set();for(const p of pairs)if(!chosen.has(p.i)&&!icons.has(p.j)){chosen.set(p.i,p.asset);icons.add(p.j);}return chosen;
}
