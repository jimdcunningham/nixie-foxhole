import nativeRules from './native-placement-rules.json' with {type:'json'};
const indexes=new WeakMap();
export const effectLayers=['water','building','structures','vegetation','rocks','infrastructure','roads'];
export const isWaterParticleSystem=system=>/\/(?:RiverSplashes\d*|Waterfall\w*|WaterMist|Fish01|Motor[Bb]oat\w*|LandingSplash)(?:\.|$)/.test(system||'');
export function effectOwnerLayer(placement,{region,worldData}={}){
 if(isWaterParticleSystem(placement.system))return 'water';
 let owners;
 if(worldData){owners=indexes.get(worldData);if(!owners){owners=new Map();for(const p of worldData.prototypes||[])for(const row of p.placements||[]){const category=p.kind==='building'?'building':p.category,prior=owners.get(row.actor);if(!prior||category==='building')owners.set(row.actor,category);}indexes.set(worldData,owners);}}
 let actor=placement.actor;const seen=new Set(),rules=nativeRules.regions[region]?.actors||{};
 // Child actors such as attached lanterns inherit the building's layer.
 while(actor&&!seen.has(actor)){seen.add(actor);const parent=rules[actor]?.parent;if(parent){actor=parent;continue;}break;}
 const owner=owners?.get(actor)||owners?.get(placement.actor);if(effectLayers.includes(owner))return owner;
 return /\/(?:Leaves\d*|GrassBlowing|FlowerFluff|Fireflies|SouthernDust|Blowing[Ss]now\w*|SnowBlowing|Mist|SulfurMist)\./.test(placement.system||'')?'vegetation':'structures';
}
export function isPersistentParticleEmitter(native){return native?.enabled!==false&&!(native?.loops>0);}
