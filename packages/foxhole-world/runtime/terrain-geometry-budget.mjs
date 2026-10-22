const pools=new WeakMap();
export const TERRAIN_GEOMETRY_BUDGET=256*1024*1024;

/** Required coarse relief is never evicted. All detail and in-flight replacements
 * share the remaining byte budget, including simultaneous old/new geometries. */
export function createTerrainGeometryBudget(limitBytes=TERRAIN_GEOMETRY_BUDGET){
 const entries=new Set();let sequence=0;
 const stats={limitBytes,baseBytes:0,detailBytes:0,pendingBytes:0,totalBytes:0,evictions:0,denied:0,coarseOverBudget:false};
 function refresh(){stats.detailBytes=stats.pendingBytes=0;for(const entry of entries)stats[entry.resident?'detailBytes':'pendingBytes']+=entry.bytes;stats.totalBytes=stats.baseBytes+stats.detailBytes+stats.pendingBytes;stats.coarseOverBudget=stats.baseBytes>limitBytes;}
 function remove(entry,evict=false){if(!entries.delete(entry))return;refresh();if(evict){stats.evictions++;entry.onEvict();}}
 function victim(priority=Infinity){return [...entries].filter(entry=>entry.priority<priority).sort((a,b)=>a.priority-b.priority||a.used-b.used)[0];}
 return {stats,retainBase(bytes){stats.baseBytes+=bytes;refresh();while(stats.totalBytes>limitBytes){const old=victim();if(!old)break;remove(old,true);}let released=false;return()=>{if(released)return;released=true;stats.baseBytes-=bytes;refresh();};},
  reserve(bytes,priority,onEvict){
   if(!Number.isSafeInteger(bytes)||bytes<0)throw Error('Invalid terrain allocation');
   if(bytes+stats.baseBytes>limitBytes){stats.denied++;return null;}
   // Check that enough lower-priority detail exists before evicting anything.
   const victims=[...entries].filter(entry=>entry.priority<priority*.9).sort((a,b)=>a.priority-b.priority||a.used-b.used);let available=limitBytes-stats.totalBytes;
   for(const entry of victims)available+=entry.bytes;
   if(available<bytes){stats.denied++;return null;}
   while(stats.totalBytes+bytes>limitBytes)remove(victims.shift(),true);
   const entry={bytes,priority,onEvict,used:++sequence,resident:false};entries.add(entry);refresh();
   return {commit(){if(!entries.has(entry))return false;entry.resident=true;refresh();return true;},touch(value){if(entries.has(entry)){entry.priority=value;entry.used=++sequence;}},release(){remove(entry);}};
  }
 };
}
export function terrainGeometryBudgetFor(renderer){if(!renderer)return createTerrainGeometryBudget();let pool=pools.get(renderer);if(!pool){pool=createTerrainGeometryBudget();pools.set(renderer,pool);}return pool;}
