import {createLayerDemand} from './layer-demand.mjs';

const partitions=new WeakMap();

/** Assign an actor and all attached blueprint components to one cell. */
export function modelCells(data,category,{size=256}={}) {
 let sizes=partitions.get(data);if(!sizes)partitions.set(data,sizes=new Map());
 let cached=sizes.get(size);if(!cached)sizes.set(size,cached={actors:null,categories:new Map()});
 if(cached.categories.has(category))return cached.categories.get(category);
 const actors=cached.actors||new Map();
 // Unreal's region-wide foliage actor owns thousands of independent instances.
 // Only blueprint-owned instances share their building's residency cell.
 const buildingActors=new Set(data.prototypes.filter(p=>p.kind==='building').flatMap(p=>p.placements.map(row=>row.actor).filter(Boolean)));
 const actorKey=row=>row.instanced&&!buildingActors.has(row.actor)?row:row.actor||row.name||row;
 if(!cached.actors)
 for(const p of data.prototypes)for(const row of p.placements){const actor=actorKey(row);if(!actors.has(actor)||p.kind==='building')actors.set(actor,[Math.floor(row.matrix[12]/size),Math.floor(row.matrix[14]/size)]);}
 cached.actors=actors;
 const cells=new Map();
 for(const p of data.prototypes){if((p.kind==='building'?'building':p.category)!==category)continue;
  const groups=new Map();for(const row of p.placements){const [x,z]=actors.get(actorKey(row)),id=x+':'+z;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row);if(!cells.has(id))cells.set(id,{id,x,z,size,prototypes:[]});}
  for(const [id,placements]of groups)cells.get(id).prototypes.push({...p,placements});
 }
 const result=[...cells.values()].map(cell=>({...cell,data:{...data,prototypes:cell.prototypes}}));
 cached.categories.set(category,result);return result;
}

export function createModelCellStream({cells,signal,load,onChange=()=>{},radius=600,retainRadius=850,concurrency=1}) {
 const lifetime=new AbortController(),combined=signal?AbortSignal.any([signal,lifetime.signal]):lifetime.signal,handles=new Map(),seen=new Map();let lastKey='',disposed=false,lastCheck=-Infinity,lastPosition=null,lastOrthographic=false;const stats={selections:0,checkedCells:0};
 const demand=createLayerDemand({signal:combined,concurrency,onChange,tasks:Object.fromEntries(cells.map(cell=>[cell.id,{needed:flags=>!!flags[cell.id],
  load:async taskSignal=>{const handle=await load(cell,taskSignal);handles.set(cell.id,handle);taskSignal.throwIfAborted();},
  unload:()=>{handles.get(cell.id)?.dispose();handles.delete(cell.id);}
 }]))});
 function update(camera,now=performance.now()){
  if(disposed||!camera)return;
  const [x,y,z]=camera.position,orthographic=!!camera.orthographicHeight;
  // Demand is coarse; avoid sorting/allocating one object per cell every frame.
  // Teleports still react immediately, and a timed scan expires the grace ring.
  if(orthographic===lastOrthographic&&now>=lastCheck&&now-lastCheck<100&&lastPosition&&Math.hypot(x-lastPosition[0],y-lastPosition[1],z-lastPosition[2])<16)return;
  lastCheck=now;lastPosition=[x,y,z];lastOrthographic=orthographic;stats.selections++;const flags={};
  for(const cell of cells){stats.checkedCells++;const distance=Math.hypot(Math.max(0,cell.x*cell.size-x,x-(cell.x+1)*cell.size),Math.max(0,cell.z*cell.size-z,z-(cell.z+1)*cell.size),camera.orthographicHeight?0:Math.max(0,y-256));
   if(distance<(seen.has(cell.id)?retainRadius:radius)){flags[cell.id]=true;seen.set(cell.id,now);}else if(now-(seen.get(cell.id)??-Infinity)<8000)flags[cell.id]=true;else seen.delete(cell.id);
  }
  const key=Object.keys(flags).sort().join('|');if(key!==lastKey){lastKey=key;demand.setLayers(flags);}
 }
 return {update,stats,initialize:async camera=>{update(camera);await demand.whenIdle();},get busy(){return demand.busy;},get resident(){return handles.size;},
  dispose(){if(disposed)return Promise.resolve();disposed=true;const busy=demand.busy;lifetime.abort();const clear=()=>{for(const handle of handles.values())handle.dispose();handles.clear();};if(busy)return demand.whenSettled().then(clear);clear();return Promise.resolve();}
 };
}
