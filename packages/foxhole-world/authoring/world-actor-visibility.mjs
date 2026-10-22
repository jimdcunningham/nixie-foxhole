import nativeRules from './native-placement-rules.json' with {type:'json'};

// Only public, fixed world-structure families are evidence for a map layout.
// Ordinary houses/props and player-built facilities are not inferred from API absence.
const iconFamilies={BPFactory_C:[34],BPRefinery_C:[17],BPStorageFacility_C:[33],BPSeaport_C:[52],BPMassProduction_C:[51],BPVehicleFactory_C:[12],BPHospital_C:[11],BPEngineeringCenter_C:[19],BPConstructionYard_C:[39],BPTownBase1_C:[56,57,58],BPTownBase2_C:[56,57,58],BPTownBase3_C:[56,57,58],BPAircraftDepot_C:[88],BPAircraftFactory_C:[89]};
const rigType='BPResourceOilRigProxy_C';
const near=(item,matrix)=>Math.hypot((item.x-.5)*2184-matrix[12],(.5-item.y)*1890-matrix[14])<=2;
const allowed=(rule,mask)=>!rule?.hidden&&(!rule?.include||(rule.include&mask)!==0)&&(!rule?.exclude||(rule.exclude&mask)===0);

export function createWorldActorVisibility({region,prototypes,rules=nativeRules.regions[region]?.actors||{}}){
 const actors=new Map();for(const p of prototypes)for(const row of p.placements)if(!actors.has(row.actor))actors.set(row.actor,{type:rules[row.actor]?.type||p.name.split('/')[0],matrix:rules[row.actor]?.position?[...row.matrix.slice(0,12),...rules[row.actor].position,1]:row.matrix});
 let items=null,masks=[],lastItems,revision=0;const resolved=new Map();
 function present(type,matrix){const family=type===rigType?[75]:iconFamilies[type];return !family||!!items?.some(i=>family.includes(+i.iconType)&&near(i,matrix));}
 const visible=(name,seen)=>{
  const cached=resolved.get(name);if(cached!==undefined)return cached;
  seen??=new Set();if(seen.has(name))return false;seen.add(name);
  const rule=rules[name],actor=actors.get(name);let value=true;
  if(rule?.parent&&!visible(rule.parent,seen))value=false;
  else if(rule?.hidden)value=false;
  else if(actor?.type===rigType&&!present(actor.type,actor.matrix))value=false;
  else if((rule?.include||rule?.exclude)&&(!masks.length||!masks.every(mask=>allowed(rule,mask))))value=false;
  resolved.set(name,value);return value;
 };
 const summary={ready:false,layerMasks:[],hiddenActors:0,oilRigCandidates:[...actors.values()].filter(a=>a.type===rigType).length,visibleOilRigs:0};
 function setWarState(state){
  const next=Array.isArray(state?.items)?state.items:null;if(next===lastItems)return false;lastItems=next;items=next;masks=[];resolved.clear();
  if(items){
   const bits=Object.values(rules).reduce((all,r)=>all|(r.include||0)|(r.exclude||0),0),candidates=[];
   for(let mask=1;mask<=bits;mask*=2)if(bits&mask){let score=0,evidence=0;for(const [name,actor]of actors){const rule=rules[name];if(!(rule?.include||rule?.exclude)||!iconFamilies[actor.type])continue;const expected=present(actor.type,actor.matrix);if(expected)evidence++;if(expected!==allowed(rule,mask))score+=expected?4:1;}candidates.push({mask,score,evidence});}
   if(candidates.some(c=>c.evidence)){const best=Math.min(...candidates.map(c=>c.score));masks=candidates.filter(c=>c.score===best).map(c=>c.mask);}
  }
  summary.ready=!!items;summary.layerMasks=masks;summary.hiddenActors=[...actors.keys()].filter(a=>!visible(a)).length;summary.visibleOilRigs=[...actors].filter(([name,a])=>a.type===rigType&&visible(name)).length;revision++;return true;
 }
 return {visible,setWarState,summary,get revision(){return revision;}};
}
