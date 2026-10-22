// Classify native meshes consistently even when a blueprint exports them as props.
export const worldModelLayers=['building','structures','rocks','trees','vegetation','infrastructure'];
export const isVegetationLayer=category=>category==='trees'||category==='vegetation';
export function worldModelLayer(prototype){
 if(prototype.kind==='building')return 'building';
 const mesh=(prototype.path||prototype.name||'').split('/').at(-1).split('.')[0];
 if(prototype.category==='rocks'||/^(?:Rock(?!et)|ShorelineRocks|Cliff|Boulder)/i.test(mesh))return 'rocks';
 if(/^(?:DeadTree|FallenTree|Tree(?:Trunk|Stump|_|[0-9]|$)|Stump|Birch|SilverBirch|Pine|Fir(?:[0-9]|Snow|Dead|$)|PoplarTree|BeechTree|OakTree|Willow)/i.test(mesh))return 'trees';
 if(prototype.category==='vegetation'||/\/Foliage\//i.test(prototype.path||''))return 'vegetation';
 return prototype.category;
}
const normalized=new WeakMap();
export function normalizeWorldModelLayers(data){
 if(normalized.has(data))return normalized.get(data);
 let changed=false;const prototypes=data.prototypes.map(p=>{const category=worldModelLayer(p);if(p.kind==='building'||category===p.category)return p;changed=true;return {...p,category};});
 const result=changed?{...data,prototypes}:data;normalized.set(data,result);normalized.set(result,result);return result;
}
