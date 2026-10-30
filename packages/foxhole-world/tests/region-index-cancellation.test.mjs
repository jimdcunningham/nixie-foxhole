import test from 'node:test';
import assert from 'node:assert/strict';
import {FoxholeRegionSceneController} from '../../extensions/foxhole/app/plugins/foxhole/nixie/map/region-scene-controller.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<100&&!predicate();i++)await flush();assert.ok(predicate(),'operation did not start or finish');}
const scene=()=>({root:{removeFromParent(){}},passes:[],metrics:{},destroy(){}});
const json=version=>new Response(JSON.stringify({version:1,tag:version,regions:{a:{id:'a'},b:{id:'b'}}}));
function setup(fetcher){const loaded=[],view={passes:[],root:{addChild(){}},camera:{position:{x:0,y:0,z:100}},height:600,width:800};const c=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher,loadRegion:async({entry})=>{loaded.push(entry.id);return scene();}});const sync=keys=>c.sync({view,mode:'3d',settings:{enabled:true,regionKeys:keys.map(k=>k+'Hex')}});return{c,sync,loaded};}
test('retrying a sole region aborts a cooperative index and starts a new generation',async()=>{
 const requests=[];const f=setup((_url,{signal})=>new Promise((resolve,reject)=>{const r={signal,resolve,reject};requests.push(r);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});}));
 try{f.sync(['a']);await until(()=>requests.length===1);assert.equal(f.c.retryLoading(),true);f.sync(['a']);await until(()=>requests.length===2);assert.equal(requests[0].signal.aborted,true);requests[1].resolve(json('new'));await until(()=>f.loaded.length===1);assert.equal(f.c.index.tag,'new');}finally{f.c.destroy();}
});
test('retiring one index subscriber preserves another region',async()=>{
 const requests=[];const f=setup((_url,{signal})=>new Promise((resolve,reject)=>{requests.push({signal,resolve});signal.addEventListener('abort',()=>reject(signal.reason),{once:true});}));
 try{f.sync(['a','b']);await until(()=>requests.length===1);f.sync(['b']);await flush();assert.equal(requests[0].signal.aborted,false);requests[0].resolve(json('shared'));await until(()=>f.loaded.length===1);assert.deepEqual(f.loaded,['b']);assert.equal(requests.length,1);}finally{f.c.destroy();}
});
test('an abort-ignoring index drains before retry; stale response never becomes selected index',async()=>{
 const requests=[];const f=setup((_url,{signal})=>new Promise(resolve=>requests.push({signal,resolve})));
 try{f.sync(['a']);await until(()=>requests.length===1);assert.equal(f.c.retryLoading(),true);f.sync(['a']);await flush();assert.equal(requests.length,1);assert.equal(requests[0].signal.aborted,true);requests[0].resolve(json('stale'));await until(()=>requests.length===2);assert.equal(f.c.index,null);requests[1].resolve(json('fresh'));await until(()=>f.loaded.length===1);assert.equal(f.c.index.tag,'fresh');}finally{f.c.destroy();}
});
test('no-signal index consumers coalesce and survive another caller aborting',async()=>{
 const requests=[];const f=setup((_url,{signal})=>new Promise(resolve=>requests.push({signal,resolve}))),a=new AbortController();
 try{const abandoned=f.c.loadIndex(a.signal),rejection=assert.rejects(abandoned,{name:'AbortError'}),survivor=f.c.loadIndex();await until(()=>requests.length===1);a.abort();await rejection;assert.equal(requests[0].signal.aborted,false);requests[0].resolve(json('shared'));assert.equal((await survivor).tag,'shared');}finally{f.c.destroy();}
});
test('error clears failed generation and controller destruction aborts active index',async()=>{
 const requests=[];const f=setup((_url,{signal})=>new Promise((resolve,reject)=>{requests.push({signal,resolve,reject});signal.addEventListener('abort',()=>reject(signal.reason),{once:true});}));
 const first=f.c.loadIndex(),firstRejected=assert.rejects(first,/not found/);await until(()=>requests.length===1);requests[0].reject(Error('not found'));await firstRejected;const second=f.c.loadIndex(),secondRejected=assert.rejects(second,{name:'AbortError'});await until(()=>requests.length===2);f.c.destroy();assert.equal(requests[1].signal.aborted,true);await secondRejected;
});
test('retry loading is a no-op for disposed or already completed regions',async()=>{const f=setup(async()=>json('ready'));f.sync(['a']);await until(()=>f.loaded.length===1);assert.equal(f.c.retryLoading(),false);f.c.destroy();assert.equal(f.c.retryLoading(),false);});

test('retrying a partially attached region leaves an already-ready neighbor intact',async()=>{
 const calls=[],destroyed=[],attached=[],view={passes:[],root:{addChild:root=>attached.push(root.id)},camera:{position:{x:0,y:0,z:100}},height:600,width:800};
 const make=id=>({root:{id,removeFromParent(){}},passes:[],metrics:{},destroy(){destroyed.push(id);}});
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher:async()=>json('index'),loadRegion:options=>{calls.push(options);if(options.entry.id==='a')return Promise.resolve(make('ready'));const partial=make('partial');options.onSceneReady(partial);return new Promise(resolve=>{options.finish=()=>resolve(partial);});}});
 const sync=()=>controller.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['aHex','bHex']}});
 try{sync();await until(()=>calls.length===2&&controller.records.get('a')?.state.phase==='Ready');assert.deepEqual([...attached].sort(),['partial','ready']);assert.equal(controller.retryLoading(),true);assert.equal(calls[1].signal.aborted,true);assert.deepEqual(destroyed,['partial']);assert.equal(controller.records.get('a').state.phase,'Ready');assert.equal(controller.records.get('b').state.phase,'Queued');await flush();assert.equal(calls.length,2,'replacement waits for old loader to drain');calls[1].finish();await until(()=>calls.length===3);assert.equal(calls[2].entry.id,'b');assert.equal(destroyed.filter(id=>id==='partial').length,1,'late completion does not destroy scene twice');calls[2].finish();await until(()=>controller.records.get('b')?.state.phase==='Ready');assert.equal(attached.filter(id=>id==='ready').length,1);assert.equal(attached.filter(id=>id==='partial').length,2);}finally{controller.destroy();}
});
test('an indexLoader that ignores signals is drained and cannot publish stale data',async()=>{
 const requests=[],view={passes:[],root:{addChild(){}},camera:{position:{x:0,y:0,z:100}},height:600,width:800};const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',indexLoader:signal=>new Promise(resolve=>requests.push({signal,resolve})),loadRegion:async()=>scene()});const sync=()=>controller.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['aHex']}});
 try{sync();await until(()=>requests.length===1);assert.equal(controller.retryLoading(),true);await flush();assert.equal(requests.length,1);assert.equal(requests[0].signal.aborted,true);assert.equal(controller.index,null);requests[0].resolve({version:1,tag:'stale',regions:{a:{id:'a'}}});await until(()=>requests.length===2);assert.equal(controller.index,null);requests[1].resolve({version:1,tag:'fresh',regions:{a:{id:'a'}}});await until(()=>controller.records.get('a')?.state.phase==='Ready');assert.equal(controller.index.tag,'fresh');}finally{controller.destroy();}
});

test('post-ready layer work is not presented as a safe initial-load retry',async()=>{
 let options,destroyed=0;const statuses=[],view={passes:[],root:{addChild(){}},camera:{position:{x:0,y:0,z:100}},height:600,width:800};
 const c=new FoxholeRegionSceneController({baseUrl:'https://world.test/',onStatus:value=>statuses.push(value),fetcher:async()=>json('index'),loadRegion:async value=>{options=value;return{root:{removeFromParent(){}},passes:[],metrics:{},destroy(){destroyed++;}};}});
 try{c.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['aHex']}});await until(()=>c.records.get('a')?.state.phase==='Ready');options.onProgress({phase:'Loading layers: decals'});assert.equal(statuses.at(-1).retryableLoading,false);assert.equal(c.retryLoading(),false);assert.equal(destroyed,0);options.onProgress({phase:'error',error:'late detail failed'});assert.equal(statuses.at(-1).retryableFailed,false);assert.equal(c.retryFailed(),false);assert.equal(destroyed,0);assert.ok(c.records.get('a').scene);}finally{c.destroy();}
});
test('initial in-flight and failed records accurately advertise safe retry',async()=>{
 let fail;const statuses=[],view={passes:[],root:{addChild(){}}},c=new FoxholeRegionSceneController({baseUrl:'https://world.test/',onStatus:value=>statuses.push(value),fetcher:async()=>json('index'),loadRegion:()=>new Promise((_resolve,reject)=>{fail=reject;})});
 const saved=console.error;console.error=()=>{};try{c.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['aHex']}});await until(()=>!!fail);assert.equal(statuses.at(-1).retryableLoading,true);fail(Error('load failed'));await until(()=>c.records.get('a')?.state.phase==='error');assert.equal(statuses.at(-1).retryableFailed,true);assert.equal(c.retryFailed(),true);}finally{console.error=saved;c.destroy();}
});

test('mixed regions advertise only independently safe initial retries',async()=>{
 const calls=[],statuses=[],destroyed=[],view={passes:[],root:{addChild(){}}};const readyScene={root:{removeFromParent(){}},passes:[],metrics:{},destroy(){destroyed.push('ready');}};
 const c=new FoxholeRegionSceneController({baseUrl:'https://world.test/',onStatus:value=>statuses.push(value),fetcher:async()=>json('index'),loadRegion:options=>{calls.push(options);return options.entry.id==='a'?Promise.reject(Error('initial failed')):Promise.resolve(readyScene);}}),saved=console.error;console.error=()=>{};
 try{c.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['aHex','bHex']}});await until(()=>c.records.get('a')?.state.phase==='error'&&c.records.get('b')?.state.phase==='Ready');const b=calls.find(call=>call.entry.id==='b');b.onProgress({phase:'Loading layers: decals'});let status=statuses.at(-1);assert.equal(status.retryableFailed,true);assert.equal(status.retryableLoading,false);assert.match(status.error,/initial failed/);b.onProgress({phase:'error',error:'late detail failed'});status=statuses.at(-1);assert.equal(status.retryableFailed,true);assert.equal(c.retryFailed(),true);assert.equal(c.records.has('a'),false);assert.ok(c.records.get('b').scene);assert.equal(destroyed.length,0);}finally{console.error=saved;c.destroy();}
});

test('initial partial-scene errors can retry behind the tracked drain barrier',async()=>{
 let options,finish,destroyed=0;const statuses=[],view={passes:[],root:{addChild(){}}},partial={root:{removeFromParent(){}},passes:[],metrics:{},destroy(){destroyed++;}};
 const c=new FoxholeRegionSceneController({baseUrl:'https://world.test/',onStatus:value=>statuses.push(value),fetcher:async()=>json('index'),loadRegion:value=>{options=value;value.onSceneReady(partial);return new Promise(resolve=>{finish=()=>resolve(partial);});}});
 try{c.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['aHex']}});await until(()=>!!options);options.onProgress({phase:'error',error:'initial detail failed'});assert.equal(statuses.at(-1).retryableFailed,true);assert.equal(c.retryFailed(),true);assert.equal(destroyed,1);assert.equal(options.signal.aborted,true);c.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['aHex']}});await flush();assert.equal(c.loading.size,1,'old initial loader retains its drain slot');}finally{finish();c.destroy();await flush();}
});
test('selection generation changes for replaced ids, positions and loading settings',async()=>{
 const statuses=[],view={passes:[],root:{addChild(){}},camera:{position:{x:0,y:0,z:100}},height:600,width:800},c=new FoxholeRegionSceneController({baseUrl:'https://world.test/',onStatus:s=>statuses.push(s),fetcher:async()=>json('index'),loadRegion:async()=>scene()});
 const sync=(regions,extra={})=>c.sync({view,mode:'3d',settings:{enabled:true,regionKeys:regions.map(r=>r.id+'Hex'),...extra},regions});
 try{sync([{id:'a',position:{x:0,y:0}}]);await until(()=>c.records.get('a')?.state.phase==='Ready');const first=statuses.at(-1).selectionGeneration;assert.ok(Number.isSafeInteger(first));sync([{id:'a',position:{x:0,y:0}}]);assert.equal(c.selectionGeneration,first);sync([{id:'b',position:{x:0,y:0}}]);assert.ok(c.selectionGeneration>first);const second=c.selectionGeneration;await until(()=>c.records.get('b')?.state.phase==='Ready');sync([{id:'b',position:{x:32,y:0}}]);assert.ok(c.selectionGeneration>second);const third=c.selectionGeneration;await until(()=>c.records.get('b')?.state.phase==='Ready');sync([{id:'b',position:{x:32,y:0}}],{modelLod:true});assert.ok(c.selectionGeneration>third);}finally{c.destroy();}
});

test('position changes report the new selection even while the old region drains',async()=>{
 const statuses=[],calls=[],view={passes:[],root:{addChild(){}},camera:{position:{x:0,y:0,z:100}},height:600,width:800},c=new FoxholeRegionSceneController({baseUrl:'https://world.test/',onStatus:s=>statuses.push(s),fetcher:async()=>json('index'),loadRegion:options=>{calls.push(options);return new Promise(resolve=>{options.finish=()=>resolve(scene());});}});
 const sync=x=>c.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['aHex']},regions:[{id:'a',position:{x,y:0}}]});
 try{sync(0);await until(()=>calls.length===1);const previous=statuses.at(-1).selectionGeneration;sync(32);assert.ok(statuses.at(-1).selectionGeneration>previous);assert.equal(c.records.get('a').state.phase,'Queued');assert.equal(calls.length,1,'old loader is still draining');}finally{calls[0].finish();c.destroy();await flush();}
});
