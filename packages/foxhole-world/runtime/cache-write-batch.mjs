import {freshCacheSummary} from './cache-enumeration.mjs';
/** Amortize retention bookkeeping for concurrent, new cache entries. */
export function batchRetainedCacheWrites(cache,{body,usage,summaryKey,now,budget,maxEntries,summaryRecheck,mutate,writeUsage,readUsage,commitSummary}){
 const putOne=cache.put.bind(cache),pending=[];let scheduled=false;
 const cancel=response=>{void response?.body?.cancel().catch(()=>{});};
 async function fast(rows){
  if(!usage||new Set(rows.map(r=>typeof r.key==='string'?r.key:r.key.url)).size!==rows.length)return null;
  let summary;try{summary=await (await usage.match(summaryKey))?.json();}catch{return null;}
  const time=now(),added=rows.reduce((n,r)=>n+r.bytes.byteLength,0);
  if(!Number.isSafeInteger(summary?.bytes)||summary.bytes<0||!Number.isSafeInteger(summary?.count)||summary.count<0
   ||!freshCacheSummary(summary,time,summaryRecheck)
   ||summary.bytes+added>budget||summary.count+rows.length>maxEntries)return null;
  const reads=await Promise.allSettled(rows.map(r=>body.match(r.key)));
  const previous=reads.filter(r=>r.status==='fulfilled').map(r=>r.value),failed=reads.find(r=>r.status==='rejected');
  if(failed){previous.forEach(cancel);throw failed.reason;}
  const replacing=previous.some(Boolean);previous.forEach(cancel);if(replacing)return null;
  // A crash or partial failure must force reconciliation, never preserve a
  // current-looking total that omits a body written by this transaction.
  await usage.delete(summaryKey);
  const results=await Promise.allSettled(rows.map(async row=>{
   const headers=new Headers(row.headers);headers.set('X-Foxhole-Cached-Bytes',String(row.bytes.byteLength));
   await body.put(row.key,new Response(row.bytes,{headers}));
   await writeUsage(row.key,false,await readUsage(row.key));
   return true;
  }));
  if(results.every(r=>r.status==='fulfilled'))await commitSummary(summary,{
   bytes:summary.bytes+added,count:summary.count+rows.length,verifiedAt:summary.verifiedAt,
  },rows.map(row=>[row.key,true]));
  return results;
 }
 async function flush(){
  try{
   while(pending.length){
    const batch=pending.splice(0,16);
    if(batch.length===1){const row=batch[0];try{row.resolve(await putOne(row.key,row.response));}catch(e){row.reject(e);}continue;}
    const prepared=await Promise.allSettled(batch.map(async row=>({...row,bytes:await row.response.arrayBuffer(),headers:row.response.headers})));
    const rows=[];prepared.forEach((r,i)=>{if(r.status==='fulfilled')rows.push(r.value);else batch[i].reject(r.reason);});
    let results;
    try{results=rows.length>1?await mutate(()=>fast(rows)):null;}catch(error){rows.forEach(r=>r.reject(error));continue;}
    if(results){results.forEach((r,i)=>r.status==='fulfilled'?rows[i].resolve(r.value):rows[i].reject(r.reason));continue;}
    // Existing keys, stale totals and budget pressure retain the established
    // eviction/accounting path, including active leases and legacy entries.
    for(const row of rows)try{row.resolve(await putOne(row.key,new Response(row.bytes,{headers:row.headers})));}catch(error){row.reject(error);}
   }
  }finally{scheduled=false;if(pending.length)schedule();}
 }
 function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(()=>void flush());}
 cache.put=(key,response)=>new Promise((resolve,reject)=>{pending.push({key,response,resolve,reject});schedule();});
 return cache;
}
