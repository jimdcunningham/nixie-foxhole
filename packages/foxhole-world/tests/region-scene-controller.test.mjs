import test from 'node:test';
import assert from 'node:assert/strict';
import {FoxholeRegionSceneController,selectedSpatialRegions,regionShellEdges} from '../../extensions/foxhole/app/plugins/foxhole/nixie/map/region-scene-controller.mjs';
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

test('only enabled, loaded terrain supplies ground and excavation follows the current region',async()=>{
 const cuts=[],view={passes:[],root:{addChild(){}},camera:{position:{x:0,y:0,z:100}},height:600,width:800};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{deadlands:{id:'deadlands'}}})),
  loadRegion:async()=>({root:{removeFromParent(){}},passes:[],metrics:{},update(){},setLayers(){},sampleGround:(x,y)=>x-y,setGroundCutouts:volumes=>cuts.push(volumes),destroy(){}})});
 const sync=(enabled,terrain)=>controller.sync({view,settings:{enabled,regionKeys:['DeadlandsHex'],worldLayers:{terrain}},mode:'2d',position:{x:0,y:0}});
 assert.equal(controller.sampleGround(10,20),null);
 sync(true,true);await flush();assert.equal(controller.sampleGround(10,20),-10);
 const volumes=[[[0,0,0],[1,0,0],[0,1,0],[0,0,1]]];controller.setGroundCutouts(volumes);assert.equal(cuts[0],volumes);
 sync(true,false);assert.equal(controller.sampleGround(10,20),null);
 sync(true,true);assert.equal(controller.sampleGround(10,20),-10);
 sync(false,true);assert.equal(controller.sampleGround(10,20),null);
 controller.setGroundCutouts([]);assert.equal(cuts.length,1);controller.destroy();
});

test('preferences changed during import apply before attachment and survive region switches without reloading on toggle',async()=>{
 const pending=[],applied=[],attached=[],view={passes:[],height:600,width:800,camera:{position:{x:0,y:0,z:100},mode:'perspective',fov:45},root:{addChild:root=>attached.push(root.id)}};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{deadlands:{id:'deadlands'},farranaccoast:{id:'farranaccoast'}}})),loadRegion:options=>new Promise(resolve=>pending.push({id:options.entry.id,resolve}))});
 const sync=(region,rocks)=>controller.sync({view,settings:{enabled:true,regionKeys:[region],worldLayers:{rocks}},mode:'3d',position:{x:0,y:0}});
 const scene=id=>({root:{id,removeFromParent(){}},passes:[],metrics:{},setLayers:flags=>{applied.push({id,...flags,attached:attached.includes(id)});},update(){},destroy(){}});
 sync('DeadlandsHex',true);await flush();sync('DeadlandsHex',false);
 pending[0].resolve(scene('deadlands'));await flush();
 assert.deepEqual(applied[0],{id:'deadlands',rocks:false,attached:false});
 sync('DeadlandsHex',true);assert.equal(pending.length,1);assert.equal(applied.at(-1).rocks,true);
 sync('FarranacCoastHex',false);await flush();pending[1].resolve(scene('farranaccoast'));await flush();
 assert.deepEqual(applied.at(-1),{id:'farranaccoast',rocks:false,attached:false});controller.destroy();
});
test('only explicit selections on a visible spatial map load',()=>{
 const base={enabled:true,regionKeys:['DeadlandsHex'],mode:'3d'};
 assert.deepEqual(selectedSpatialRegions(base),['deadlands']);assert.deepEqual(selectedSpatialRegions({...base,mode:'2d'}),['deadlands']);
 for(const state of [{...base,enabled:false},{...base,mode:'flat'},{...base,regionKeys:[]}])assert.deepEqual(selectedSpatialRegions(state),[]);
});
test('fetch retains its native calling convention instead of binding the controller as its receiver',async()=>{
 let loaded=false;
 const fetcher=function(){assert.equal(this,undefined);return Promise.resolve(new Response(JSON.stringify({version:1,regions:{deadlands:{id:'deadlands'}}})));};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher,loadRegion:async()=>{loaded=true;return {root:{removeFromParent(){}},passes:[],metrics:{},destroy(){}};}});
 controller.sync({view:{root:{addChild(){}},passes:[]},settings:{enabled:true,regionKeys:['DeadlandsHex']},mode:'3d',position:{x:0,y:0}});
 await flush();assert.equal(loaded,true);controller.destroy();
});
test('a late region response is destroyed instead of replacing the current selection',async()=>{
 const pending=[],attached=[],view={passes:[],root:{addChild:root=>attached.push(root)}},destroyed=[];
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{deadlands:{id:'deadlands'},callahans:{id:'callahans'}}})),loadRegion:options=>new Promise(resolve=>pending.push({options,resolve}))});
 const sync=(keys,enabled=true)=>controller.sync({view,settings:{enabled,regionKeys:keys},mode:'3d',position:{x:0,y:0}});
 const scene=id=>({root:{id,removeFromParent(){}},passes:[],metrics:{},update(){},destroy(){destroyed.push(id);}});
 sync(['DeadlandsHex']);await flush();sync(['CallahansPassageHex']);await flush();
 assert.equal(pending.length,1,'retired preparation drains before the next region allocates');pending[0].resolve(scene('old'));await flush();pending[1].resolve(scene('new'));await flush();
 assert.deepEqual(attached.map(root=>root.id),['new']);assert.deepEqual(destroyed,['old']);
 sync([],false);assert.equal(controller.active,false);assert.deepEqual(destroyed,['old','new']);controller.destroy();
});

test('war snapshots apply before attachment and update in place without reloading region assets',async()=>{
 const states=[],attached=[],view={passes:[],height:600,width:800,camera:{position:{x:0,y:50,z:100}},root:{addChild:root=>attached.push(root)}};let loads=0;
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{westgate:{id:'westgate'}}})),loadRegion:async()=>{loads++;return {root:{removeFromParent(){}},passes:[],metrics:{},setWarState:state=>states.push({state,attached:attached.length>0}),update(){},destroy(){}};}});
 const sync=warState=>controller.sync({view,settings:{enabled:true,regionKeys:['WestgateHex']},mode:'3d',position:{x:0,y:0},warState});
 const first={items:[{iconType:75,x:.5,y:.5}]},second={items:[]};sync(first);await flush();assert.deepEqual(states[0],{state:first,attached:false});sync(second);assert.equal(states.at(-1).state,second);assert.equal(loads,1);controller.destroy();
});

test('progressive terrain attaches once, inherits live preferences, and completes on the same owner',async()=>{
 let options,finish;const attached=[],states=[],layers=[],phases=[],pass={},environment={},oldEnvironment={};
 const view={passes:[],environment:oldEnvironment,camera:{position:{x:32,y:64,z:96}},height:600,width:800,root:{addChild:root=>attached.push(root)}};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{westgate:{id:'westgate'}}})),onStatus:status=>phases.push(status.phase),loadRegion:value=>{options=value;return new Promise(resolve=>{finish=resolve;});}});
 const first={items:[]},second={items:[{iconType:75,x:.5,y:.5}]};
 const sync=(state,rocks=false)=>controller.sync({view,settings:{enabled:true,regionKeys:['WestgateHex'],progressiveLoading:true,worldLayers:{rocks}},mode:'3d',position:{x:0,y:0},warState:state});
 sync(first);await flush();assert.equal(options.progressive,true);assert.deepEqual(options.priorityPosition,[1,3,2]);assert.equal(controller.active,false);
 sync(second);const scene={root:{removeFromParent(){}},passes:[pass],environment,metrics:{firstVisibleMs:100},update(){},sampleGround:()=>7,setWarState:state=>states.push(state),setLayers:value=>layers.push(value),destroy(){}};
 assert.equal(options.onSceneReady(scene),true);assert.equal(controller.active,true);assert.equal(controller.sampleGround(0,0),7);assert.equal(states.at(-1),second);assert.equal(layers.at(-1).rocks,false);assert.equal(view.environment,environment);
 sync(second,true);assert.equal(layers.at(-1).rocks,true);finish(scene);await flush();assert.equal(attached.length,1);assert.deepEqual(view.passes,[pass]);assert.equal(phases.at(-1),'Ready');controller.destroy();assert.equal(view.environment,oldEnvironment);assert.deepEqual(view.passes,[]);
});

test('switching model detail retires a partial region and rejects stale publication',async()=>{
 const pending=[],destroyed=[],attached=[],view={passes:[],root:{addChild:root=>attached.push(root.id)},camera:{position:{x:0,y:0,z:50}},height:600,width:800};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{westgate:{id:'westgate'}}})),loadRegion:options=>new Promise(resolve=>pending.push({options,resolve}))});
 const sync=modelLod=>controller.sync({view,settings:{enabled:true,regionKeys:['WestgateHex'],modelLod},mode:'3d',position:{x:0,y:0}});
 const scene=id=>({root:{id,removeFromParent(){}},passes:[],metrics:{},destroy(){if(!destroyed.includes(id))destroyed.push(id);}});
 sync(true);await flush();const old=scene('old');pending[0].options.onSceneReady(old);sync(false);await flush();assert.equal(pending[0].options.signal.aborted,true);assert.equal(pending.length,1);assert.equal(controller.active,false);
 assert.equal(pending[0].options.onSceneReady(scene('late')),false);pending[0].resolve(old);await flush();assert.equal(pending[1].options.progressive,true);assert.equal(pending[1].options.modelLod,false);pending[1].resolve(scene('replacement'));await flush();assert.deepEqual(attached,['old','replacement']);assert.deepEqual(destroyed,['old','late']);controller.destroy();
});

test('a failed partial load removes its render passes and restores the previous environment',async()=>{
 let options,fail;const previous={},environment={},pass={},errors=[],view={passes:[],environment:previous,root:{addChild(){}},camera:{position:{x:0,y:0,z:50}},height:600,width:800};let destroyed=0;
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{westgate:{id:'westgate'}}})),onStatus:status=>errors.push(status),loadRegion:value=>{options=value;return new Promise((_,reject)=>{fail=reject;});}});
 controller.sync({view,settings:{enabled:true,regionKeys:['WestgateHex'],progressiveLoading:true},mode:'3d',position:{x:0,y:0}});await flush();options.onSceneReady({root:{removeFromParent(){}},passes:[pass],environment,metrics:{},destroy(){destroyed++;}});
 const saved=console.error;console.error=()=>{};try{fail(Error('late model failure'));await flush();}finally{console.error=saved;}
 assert.equal(controller.active,false);assert.equal(view.environment,previous);assert.deepEqual(view.passes,[]);assert.equal(destroyed,1);assert.equal(errors.at(-1).phase,'error');controller.destroy();
});

test('explicit selection has no region-count cap and queues every selected region',async()=>{
 const keys=Array.from({length:37},(_,i)=>`Region${i}Hex`),ids=keys.map(k=>k.replace(/Hex$/,'' ).toLowerCase());
 assert.deepEqual(selectedSpatialRegions({enabled:true,mode:'3d',regionKeys:[...keys,keys[0]]}),ids);
 assert.deepEqual(selectedSpatialRegions({enabled:true,mode:'flat',regionKeys:keys}),[]);
 const loaded=[],view={passes:[],root:{addChild(){}},camera:{position:{x:0,y:0,z:10}}},statuses=[];
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',onStatus:s=>statuses.push(s),fetcher:async()=>new Response(JSON.stringify({version:1,regions:Object.fromEntries(ids.map(id=>[id,{id}]))})),loadRegion:async({entry})=>{loaded.push(entry.id);return{root:{removeFromParent(){}},passes:[],metrics:{downloadBytes:10},destroy(){}};}});
 controller.sync({view,mode:'3d',settings:{enabled:true,regionKeys:keys},regions:ids.map((id,i)=>({id,position:{x:i*100,y:0}}))});
 for(let i=0;i<100&&loaded.length<ids.length;i++)await flush();
 assert.deepEqual(loaded,ids);assert.equal(controller.records.size,37);assert.equal(statuses.at(-1).readyRegions,37);assert.equal(statuses.at(-1).downloadBytes,370);controller.destroy();
});

test('multiple regions retain independent state, cameras, ground and shared view effects during deselection',async()=>{
 const frames=[],states=[],destroyed=[],basePass={},originalEnvironment={},environments={a:{},b:{}},common={a:{},b:{}},local={a:{},b:{}},statuses=[];
 const view={passes:[basePass],environment:originalEnvironment,root:{addChild(){}},camera:{position:{x:96,y:-160,z:64},mode:'perspective',fov:45},height:600,width:800};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',onStatus:s=>statuses.push(s),fetcher:async()=>new Response(JSON.stringify({version:1,regions:{a:{id:'a'},b:{id:'b'}}})),loadRegion:async({entry})=>({root:{removeFromParent(){}},passes:[local[entry.id],common[entry.id]],sharedPasses:{ssao:common[entry.id]},environment:environments[entry.id],metrics:{},setWarState:state=>states.push([entry.id,state]),update:frame=>frames.push([entry.id,frame.camera.position]),sampleGround:x=>entry.id==='a'&&x<0?3:entry.id==='b'&&x>=0?7:null,destroy(){destroyed.push(entry.id);}})});
 const a={id:'a',position:{x:32,y:64},warState:{items:['a']}},b={id:'b',position:{x:64,y:96},warState:{items:['b']}};
 const sync=rows=>controller.sync({view,mode:'3d',settings:{enabled:true,regionKeys:rows.map(r=>r.id+'Hex')},regions:rows});
 sync([a,b]);await flush();sync([a,b]);assert.deepEqual(view.passes,[basePass,local.a,local.b,common.a]);assert.equal(view.environment,environments.a);assert.equal(controller.sampleGround(-1,0),3);assert.equal(controller.sampleGround(1,0),7);assert.deepEqual(frames.slice(-2),[['a',[2,2,-3]],['b',[1,2,-2]]]);assert.equal(states.find(x=>x[0]==='b')[1],b.warState);
 sync([b]);assert.deepEqual(destroyed,['a']);assert.deepEqual(view.passes,[basePass,local.b,common.b]);assert.equal(view.environment,environments.b);assert.equal(controller.sampleGround(-1,0),null);assert.equal(statuses.at(-1).regionCount,1);
 controller.destroy();assert.deepEqual(destroyed,['a','b']);assert.deepEqual(view.passes,[basePass]);assert.equal(view.environment,originalEnvironment);
});

test('one failed region does not evict ready regions or prevent subsequent queued downloads',async()=>{
 const loaded=[],statuses=[],view={passes:[],root:{addChild(){}}};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',onStatus:s=>statuses.push(s),fetcher:async()=>new Response(JSON.stringify({version:1,regions:{a:{id:'a'},b:{id:'b'},c:{id:'c'}}})),loadRegion:async({entry})=>{loaded.push(entry.id);if(entry.id==='b')throw Error('failed B');return{root:{removeFromParent(){}},passes:[],metrics:{},destroy(){}};}});
 const saved=console.error;console.error=()=>{};try{controller.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['aHex','bHex','cHex']}});await flush();}finally{console.error=saved;}
 assert.deepEqual(loaded,['a','b','c']);assert.equal(controller.active,true);assert.equal(statuses.at(-1).readyRegions,2);assert.equal(statuses.at(-1).failedRegions,1);assert.match(statuses.at(-1).error,/b: failed B/);controller.destroy();
});

test('only shared border walls disappear when adjacent region terrain is attached',()=>{
 const ash={x:-104831.9952,y:120959.9936},red={x:-52415.9976,y:151199.992};
 assert.deepEqual(regionShellEdges(ash,[red]),[true,true,true,false,true,true]);
 assert.deepEqual(regionShellEdges(red,[ash]),[false,true,true,true,true,true]);
 assert.deepEqual(regionShellEdges(ash,[]),Array(6).fill(true));
 assert.deepEqual(regionShellEdges(ash,[{x:0,y:0}]),Array(6).fill(true));
});

test('initial layer flags reach the loader and changes update preparation before attachment',async()=>{
 let options,finish;const applied=[],attached=[],view={passes:[],root:{addChild:root=>attached.push(root)}};
 const scene={root:{removeFromParent(){}},passes:[],metrics:{},setLayers:flags=>applied.push(flags),destroy(){}};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{westgate:{id:'westgate'}}})),loadRegion:value=>{options=value;value.onSceneCreated(scene);return new Promise(resolve=>finish=resolve);}});
 const sync=flags=>controller.sync({view,settings:{enabled:true,regionKeys:['WestgateHex'],worldLayers:flags},mode:'3d'});
 const initial={terrain:true,water:true,building:false};sync(initial);await flush();assert.equal(options.layers,initial);assert.equal(attached.length,0);
 const changed={...initial,building:true};sync(changed);assert.equal(applied.at(-1),changed);assert.equal(attached.length,0);finish(scene);await flush();assert.equal(attached.length,1);controller.destroy();
});


test('two regions prepare concurrently, share one index and release a slot out of order',async()=>{
 const pending=new Map(),attached=[],statuses=[];let requests=0,active=0,peak=0;
 const view={passes:[],root:{addChild:root=>attached.push(root.id)}};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher:async()=>{requests++;return new Response(JSON.stringify({version:1,regions:{a:{id:'a'},b:{id:'b'},c:{id:'c'}}}));},onStatus:s=>statuses.push(s),loadRegion:({entry})=>{active++;peak=Math.max(peak,active);return new Promise(resolve=>pending.set(entry.id,()=>{active--;resolve({root:{id:entry.id,removeFromParent(){}},passes:[],metrics:{},destroy(){}});}));}});
 controller.sync({view,settings:{enabled:true,regionKeys:['aHex','bHex','cHex']},mode:'3d'});await flush();
 assert.deepEqual([...pending.keys()],['a','b']);assert.equal(requests,1);assert.equal(statuses.at(-1).loadingRegions,2);
 pending.get('b')();await flush();assert.deepEqual([...pending.keys()],['a','b','c']);assert.deepEqual(attached,['b']);assert.equal(peak,2);
 pending.get('c')();await flush();pending.get('a')();await flush();assert.deepEqual(attached,['b','c','a']);assert.equal(statuses.at(-1).readyRegions,3);assert.equal(statuses.at(-1).phase,'Ready');controller.destroy();
});

test('cancelling one region does not abort the shared index needed by its neighbor',async()=>{
 let resolveIndex,indexSignal,requests=0;const loaded=[];
 const view={passes:[],root:{addChild(){}}},controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher:(_url,{signal})=>{requests++;indexSignal=signal;return new Promise(resolve=>resolveIndex=resolve);},loadRegion:async({entry})=>{loaded.push(entry.id);return{root:{removeFromParent(){}},passes:[],metrics:{},destroy(){}};}});
 const sync=keys=>controller.sync({view,settings:{enabled:true,regionKeys:keys},mode:'3d'});
 sync(['aHex','bHex']);await flush();sync(['bHex']);assert.equal(requests,1);assert.equal(indexSignal.aborted,false);
 resolveIndex(new Response(JSON.stringify({version:1,regions:{a:{id:'a'},b:{id:'b'}}})));await flush();assert.deepEqual(loaded,['b']);assert.equal(controller.active,true);controller.destroy();assert.equal(indexSignal.aborted,true);
});

test('retired parallel jobs drain before replacements allocate and late results never attach',async()=>{
 const pending=[],attached=[],destroyed=[],view={passes:[],root:{addChild:root=>attached.push(root.id)}};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{a:{id:'a'},b:{id:'b'},c:{id:'c'}}})),loadRegion:options=>new Promise(resolve=>pending.push({options,resolve}))});
 const sync=keys=>controller.sync({view,settings:{enabled:true,regionKeys:keys},mode:'3d'}),scene=id=>({root:{id,removeFromParent(){}},passes:[],metrics:{},destroy(){destroyed.push(id);}});
 sync(['aHex','bHex']);await flush();assert.equal(pending.length,2);sync(['cHex']);assert.ok(pending.every(p=>p.options.signal.aborted));
 pending[0].resolve(scene('old-a'));await flush();assert.equal(pending.length,2,'the other retired job still owns resources');pending[1].resolve(scene('old-b'));await flush();assert.equal(pending.length,3);assert.equal(pending[2].options.entry.id,'c');
 pending[2].resolve(scene('new-c'));await flush();assert.deepEqual(attached,['new-c']);assert.deepEqual(destroyed,['old-a','old-b']);controller.destroy();
});

test('a parallel failure frees its slot without evicting or waiting for its live neighbor',async()=>{
 const pending=new Map(),view={passes:[],root:{addChild(){}}},statuses=[];
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{a:{id:'a'},b:{id:'b'},c:{id:'c'}}})),onStatus:s=>statuses.push(s),loadRegion:({entry})=>new Promise((resolve,reject)=>pending.set(entry.id,{resolve,reject}))});
 controller.sync({view,settings:{enabled:true,regionKeys:['aHex','bHex','cHex']},mode:'3d'});await flush();const saved=console.error;console.error=()=>{};try{pending.get('b').reject(Error('B failed'));await flush();}finally{console.error=saved;}
 assert.deepEqual([...pending.keys()],['a','b','c']);const scene=()=>({root:{removeFromParent(){}},passes:[],metrics:{},destroy(){}});pending.get('a').resolve(scene());pending.get('c').resolve(scene());await flush();assert.equal(statuses.at(-1).readyRegions,2);assert.equal(statuses.at(-1).failedRegions,1);assert.equal(controller.active,true);controller.destroy();
});

test('surface changes reload selected regions once with the chosen mode and retain the camera',async()=>{
 const loads=[],destroyed=[],camera={position:{x:12,y:34,z:56}},view={passes:[],camera,height:600,width:800,root:{addChild(){}}};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{deadlands:{id:'deadlands'}}})),loadRegion:async options=>{loads.push(options.terrainSurface);return {root:{removeFromParent(){}},passes:[],metrics:{},destroy(){destroyed.push(options.terrainSurface);}};}});
 const sync=surface=>controller.sync({view,settings:{enabled:true,regionKeys:['DeadlandsHex'],terrainSurface:surface},mode:'3d'});
 sync(undefined);await flush();sync('map');await flush();sync('map');await flush();sync('plain');await flush();
 assert.deepEqual(loads,['native','map','plain']);assert.deepEqual(destroyed,['native','map']);assert.equal(view.camera,camera);assert.deepEqual(camera.position,{x:12,y:34,z:56});controller.destroy();
});

test('selected distant regions keep terrain and water while nearby model layers become demanded',()=>{
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',loadRegion(){}});
 controller.adaptiveStreaming=true;
 controller.layers={terrain:true,water:true,building:true,roads:true,effects:true};controller.view={camera:{mode:'perspective',position:{x:0,y:0,z:30000*32}},height:800,width:1200};
 const record={position:{x:0,y:0}};assert.equal(controller.detailLayers(record).building,false);assert.equal(controller.detailLayers(record).water,true);
 controller.view.camera.position.z=300*32;assert.equal(controller.detailLayers(record).building,true);
 controller.view.camera.position.z=30000*32;assert.equal(controller.detailLayers(record).building,true,'camera pans keep a grace period');record.detailSeen=-Infinity;assert.equal(controller.detailLayers(record).building,false);
 controller.view.camera={mode:'orthographic',position:{x:0,y:0,z:100000},orthographicSize:100,zoom:1};assert.equal(controller.detailLayers(record).building,true,'orthographic demand uses scale instead of camera altitude');controller.destroy();
});

test('region progress stays nonreactive and diagnostics are pulled without status aggregation',()=>{
 const c=new FoxholeRegionSceneController({baseUrl:'https://world.test/',loadRegion:async()=>{}});
 const state={phase:'Streaming vegetation',downloadBytes:1048576};c.records.set('fixture',{id:'fixture',state,scene:null});
 c.report();assert.equal(c.onStatus,null);assert.match(c.diagnostics()[0],/downloaded:1.0 MiB/);assert.match(c.diagnostics().join(' '),/Streaming vegetation/);
 let reads=0;c.records.values=()=>{reads++;throw Error('unused status aggregation');};c.report();assert.equal(reads,0);
});

test('adaptive streaming reloads while retaining progressive reveal and the camera',async()=>{
 const camera={mode:'perspective',position:{x:0,y:0,z:30000*32}},view={passes:[],camera,height:800,width:1200,root:{addChild(){}}},seen=[],retired=[];
 const c=new FoxholeRegionSceneController({baseUrl:'https://test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{fixture:{id:'fixture'}}})),loadRegion:async options=>{seen.push(options);return{root:{removeFromParent(){}},passes:[],metrics:{},destroy(){retired.push(options.adaptiveStreaming);}};}}),flags={terrain:true,building:true};
 const sync=adaptiveStreaming=>c.sync({view,mode:'3d',settings:{enabled:true,regionKeys:['fixtureHex'],progressiveLoading:true,adaptiveStreaming,worldLayers:flags}});
 sync(false);await flush();assert.equal(seen[0].progressive,true);assert.equal(seen[0].adaptiveStreaming,false);assert.equal(seen[0].layers,flags);
 sync(true);await flush();assert.equal(seen[1].adaptiveStreaming,true);assert.equal(seen[1].progressive,true);assert.equal(seen[1].layers.building,false);
 sync(false);await flush();assert.equal(seen[2].layers,flags);assert.deepEqual(retired,[false,true]);assert.equal(view.camera,camera);assert.equal(camera.position.z,30000*32);c.destroy();
});

test('retired progressive preference cannot disable early reveal and detail settings reload independently',async()=>{
 const camera={position:{x:0,y:0,z:500}},view={passes:[],camera,height:800,width:1200,root:{addChild(){}}},seen=[],retired=[];
 const c=new FoxholeRegionSceneController({baseUrl:'https://test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{fixture:{id:'fixture'}}})),loadRegion:async options=>{seen.push(options);return{root:{removeFromParent(){}},passes:[],metrics:{},destroy(){retired.push(options);}};}});
 const settings={enabled:true,regionKeys:['fixtureHex'],progressiveLoading:false,worldLayers:{terrain:true,building:true}};
 const sync=()=>c.sync({view,settings,mode:'3d'});
 try{
  sync();await flush();assert.equal(seen[0].progressive,true);
  settings.progressiveLoading=true;sync();await flush();assert.equal(seen.length,1,'obsolete setting changes cannot retire a region');
  for(const key of ['modelLod','terrainLod','adaptiveTextures','adaptiveStreaming']){
   const previous=seen.length;settings[key]=true;sync();await flush();assert.equal(seen.length,previous+1);assert.equal(retired.length,previous);
   const options=seen.at(-1);assert.equal(options.progressive,true);
   for(const name of ['modelLod','terrainLod','adaptiveTextures','adaptiveStreaming'])assert.equal(options[name],settings[name]===true);
   assert.equal(view.camera,camera);assert.equal(camera.position.z,500);sync();await flush();assert.equal(seen.length,previous+1);
   assert.match(c.diagnostics()[0],/mode:progressive/);
  }
 }finally{c.destroy();}
});

test('live scene wind reaches resident smoke without reloading the region',async()=>{
 const frames=[],view={passes:[],root:{addChild(){}},camera:{position:{x:0,y:0,z:100}},height:600,width:800};let loads=0;
 const controller=new FoxholeRegionSceneController({baseUrl:'https://world.test/',fetcher:async()=>new Response(JSON.stringify({version:1,regions:{deadlands:{id:'deadlands'}}})),loadRegion:async()=>{loads++;return{root:{removeFromParent(){}},passes:[],metrics:{},update:frame=>frames.push(frame),destroy(){}};}});
 const sync=wind=>controller.sync({view,settings:{enabled:true,regionKeys:['DeadlandsHex'],worldLayers:{}},mode:'3d',deltaMS:16,wind});
 sync({directionDeg:0,strength:0});await flush();sync({directionDeg:135,strength:1});
 assert.deepEqual(frames.at(-1).wind,{directionDeg:135,strength:1});assert.equal(loads,1);
 sync({directionDeg:135,strength:0});assert.equal(frames.at(-1).wind.strength,0);assert.equal(loads,1);controller.destroy();
});


test('verified index injection avoids a mutable request and rejects late results after retirement',async()=>{
 let finish,reads=0;
 const index={version:1,regions:{}};
 const controller=new FoxholeRegionSceneController({baseUrl:'https://pinned.test/world/',loadRegion:async()=>{},
  fetcher:async()=>{throw Error('Mutable index request');},indexLoader:()=>{reads++;return Promise.resolve(index);}});
 assert.equal(await controller.loadIndex(),index);assert.equal(await controller.loadIndex(),index);assert.equal(reads,1);controller.destroy();
 const retired=new FoxholeRegionSceneController({baseUrl:'https://pinned.test/world/',loadRegion:async()=>{},
  indexLoader:signal=>new Promise(resolve=>{finish=()=>{assert.equal(signal.aborted,true);resolve(index);};})});
 const pending=retired.loadIndex();retired.destroy();finish();await assert.rejects(pending,/abort/i);assert.equal(retired.index,null);
 const unsupported=new FoxholeRegionSceneController({baseUrl:'https://pinned.test/world/',loadRegion:async()=>{},indexLoader:async()=>({version:2})});
 await assert.rejects(unsupported.loadIndex(),/Unsupported/);unsupported.destroy();
});
