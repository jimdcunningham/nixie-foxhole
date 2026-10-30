import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerrainTexturePool} from '../runtime/terrain-texture-pool.mjs';

test('shared in-flight color and weight transfers reach subscribers once', async () => {
 const previous=globalThis.Worker,jobs=[];
 globalThis.Worker=class {constructor(){queueMicrotask(()=>this.onmessage?.({data:{kind:'foxhole-worker-ready'}}));}postMessage(data){jobs.push({worker:this,data});} terminate(){}};
 try {
  const pool=createTerrainTexturePool({createSource:o=>({...o,destroy(){}})});
  const color={baseUrl:'https://world.test/',kind:'color',entry:{size:128,slices:[{resource:{hash:'a',path:'same'}}]}};
  const weights={baseUrl:'https://world.test/',kind:'weights',width:4,height:4,layers:1,entry:{resource:{hash:'b',path:'weights'}}};
  const one=[],two=[];
  const first=pool.acquire([color,weights],128,{onObservation:o=>one.push(o)});
  const second=pool.acquire([color,weights],128,{onObservation:o=>two.push(o)});
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(jobs.length,2);
  for(const {worker,data} of jobs){const bytes=data.kind==='weights'?16:128*128*4;
   worker.onmessage({data:{id:data.id,result:new ArrayBuffer(bytes),observations:[{id:data.kind,kind:'network',bytes:100}]}});
  }
  const [a,b]=await Promise.all([first,second]);
  assert.deepEqual(one.map(x=>x.id).sort(),['array','weights']);
  assert.deepEqual(two.map(x=>x.id).sort(),['array','weights']);
  const late=[];const c=await pool.acquire([color,weights],128,{onObservation:o=>late.push(o)});
  assert.deepEqual(late,[],'a completed pooled texture cannot create a new download');
  a.release();b.release();c.release();
 } finally {globalThis.Worker=previous;}
});
test('an aborted subscriber does not receive later observations from a shared worker',async()=>{
 const previous=globalThis.Worker,jobs=[];globalThis.Worker=class{constructor(){queueMicrotask(()=>this.onmessage?.({data:{kind:'foxhole-worker-ready'}}));}postMessage(data){jobs.push({worker:this,data});}terminate(){}};
 try{const input={baseUrl:'https://world.test/',kind:'color',entry:{size:128,slices:[{resource:{hash:'c',path:'same'}}]}};
  const pool=createTerrainTexturePool({createSource:o=>({...o,destroy(){}})}),abort=new AbortController(),one=[],two=[];
  const first=pool.acquire([input],128,{signal:abort.signal,onObservation:e=>one.push(e)}),second=pool.acquire([input],128,{onObservation:e=>two.push(e)});
  await new Promise(resolve=>setTimeout(resolve,0));abort.abort();const {worker,data}=jobs[0];worker.onmessage({data:{kind:'terrain-observation',id:data.id,observation:{id:'x',kind:'unknown'}}});
  worker.onmessage({data:{id:data.id,result:new ArrayBuffer(128*128*4)}});await assert.rejects(first,{name:'AbortError'});const lease=await second;
  assert.deepEqual(one,[]);assert.deepEqual(two,[{id:'x',kind:'unknown'}]);lease.release();
 }finally{globalThis.Worker=previous;}
});
