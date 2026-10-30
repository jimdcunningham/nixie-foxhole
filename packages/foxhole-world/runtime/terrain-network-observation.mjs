// Resource Timing exposes wire bytes only when same-origin or permitted by TAO.
// A missing or all-zero entry is ambiguous and must never be called a cache hit.
export function classifyResourceTiming(entry) {
 if (!entry || !Number.isFinite(entry.transferSize) || !Number.isFinite(entry.encodedBodySize)) return {kind:'unknown'};
 if (entry.transferSize>0) return {kind:'observed',bytes:entry.transferSize};
 if (entry.transferSize===0 && entry.encodedBodySize>0) return {kind:'http-cache',bytes:0};
 return {kind:'unknown'};
}
let sequence=0;
export function createResourceTimingObserver(perf=globalThis.performance, nextId=()=>globalThis.crypto?.randomUUID?.() ?? `${perf.timeOrigin}-${++sequence}-${Math.random()}`) {
 const used=new WeakSet(),active=new Map();
 return {
  start(url){const ticket={url,started:perf.now(),ambiguous:false},others=active.get(url)||new Set();if(others.size){ticket.ambiguous=true;for(const other of others)other.ambiguous=true;}others.add(ticket);active.set(url,others);return ticket;},
  finish(ticket,collect=true){const others=active.get(ticket.url);others?.delete(ticket);if(!others?.size)active.delete(ticket.url);if(!collect)return null;
   let entry;if(!ticket.ambiguous)try{entry=perf.getEntriesByName(ticket.url).find(item=>item.startTime>ticket.started&&!used.has(item));}catch{}
   if(entry)used.add(entry);return {id:nextId(),...classifyResourceTiming(entry)};
  },
 };
}
export function createTransferLedger() {
 const entries=new Map();
 return {
  add(value) {if(value && typeof value.id==='string' && !entries.has(value.id))entries.set(value.id,value);},
  values(){return [...entries.values()];},
  summary(){const result={bytes:0,unknown:0,observed:0,cached:0};for(const e of entries.values()){if(e.kind==='observed' && Number.isFinite(e.bytes)&&e.bytes>0){result.bytes+=e.bytes;result.observed++;}else if(e.kind==='http-cache')result.cached++;else result.unknown++;}return result;},
 };
}
