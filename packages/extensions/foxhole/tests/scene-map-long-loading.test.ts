import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';import {stripTypeScriptTypes} from 'node:module';import test from 'node:test';import {computed,shallowRef} from 'vue';
const source=readFileSync(new URL('../app/plugins/foxhole/nixie/scene-map-canvas-adapter.ts',import.meta.url),'utf8');
function clock(){let now=0,id=0;const timers=new Map();return {set(fn,ms){const key=++id;timers.set(key,{at:now+ms,fn});return key;},clear(key){timers.delete(key);},advance(ms){const end=now+ms;for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;},get count(){return timers.size;}};}
function fixture(){const timer=clock(),jobs=new Map(),toasts=[],dismissed=[];let seq=0,world;
 const factory=runInNewContext(stripTypeScriptTypes(source.replaceAll('import.meta.dev','false').replace(/^import .*;\r?\n/gm,'').replace('export function','function')+'\ncreateFoxholeSceneMapCanvas;'),{
  FoxholeRegionSceneController:class{constructor(options){world={options,retries:0,retryLoading(){this.retries++;return true;},retryFailed(){return true;},sync(){},destroy(){options.onStatus({phase:'idle'});}};return world;}},
  FoxholeMapViewportPlugin:class{updatePresentation(){}getSpatialWarState(){return null;}destroy(){}},selectedSpatialRegions:()=>[],regionIdForKey:key=>key.replace(/Hex$/,'').toLowerCase(),computed,shallowRef,
  foxholeWorldAssetDelivery:()=>({baseUrl:'/world/',revision:1,loadIndex:async()=>({})}),subscribeSceneViewpointRestore:()=>()=>{},consumeViewpointRegionCamera:()=>true,
  plannerRoadTourActions:shallowRef(null),plannerRoadTourStatus:shallowRef({}),beginShellProgressJob:job=>{const id=`job-${++seq}`;jobs.set(id,job);return id;},
  updateShellProgressJob:(id,update)=>jobs.set(id,{...jobs.get(id),...update}),finishShellProgressJob:id=>jobs.delete(id),
  showNxToast:toast=>{toasts.push(toast);return `toast-${toasts.length}`;},dismissNxToast:id=>dismissed.push(id),
  FOXHOLE_MAP_REGIONS:[{key:'DeadlandsHex',name:'Deadlands'},{key:'WestgateHex',name:'Westgate'}],getFoxholeRegionPosition:()=>({x:0,y:0}),useNixieSettingsStore:()=>({getValueOr(){}}),readFoxholeMapSettings:()=>({enabled:true,regionKeys:['DeadlandsHex']}),
  setTimeout:timer.set,clearTimeout:timer.clear,
 });
 const adapter=factory({app:{},viewport:{},before:{},runtime:{projectStore:{settings:{}}},viewMode:()=> '3d',nodeCount:()=>0,zoom:()=>1,pointer:()=>null,interacting:()=>false,suppressGrid(){},cameraTo(){}});return{adapter,world,timer,jobs,toasts,dismissed};}

test('a long loading hint is observational until explicitly selected and remains honest while retirement drains',()=>{
 const f=fixture();try{
  f.world.options.onStatus({phase:'Preparing region cache',region:'deadlands',retryableLoading:true,progress:{completed:5,total:10,unit:'asset records'}});f.timer.advance(59999);
  assert.equal(f.toasts.length,0);assert.equal(f.world.retries,0);f.timer.advance(1);
  assert.equal(f.toasts.length,1,'long loading becomes visible');assert.equal(f.jobs.size,1,'progress remains visible');
  assert.equal(f.toasts[0].persistent,true);assert.equal(f.toasts[0].kind,'warning');assert.match(f.toasts[0].message,/taking longer/i);assert.match(f.toasts[0].message,/previous load.*stop/i);
  assert.equal(f.world.retries,0,'no request is cancelled automatically');f.world.options.onStatus({phase:'Preparing region cache',region:'deadlands',retryableLoading:true,progress:{completed:6,total:10,unit:'asset records'}});assert.equal(f.toasts.length,1);
  f.toasts[0].onClick();assert.equal(f.world.retries,1,'only user action requests retry');assert.equal(f.toasts[0].onClick(),false,'consumed actions are inert');
  f.timer.advance(60000);assert.equal(f.toasts.length,2,'still-draining work can be flagged again');assert.equal(f.world.retries,1,'repeated hint does not auto-retry');
  f.world.options.onStatus({phase:'Ready',region:'deadlands'});assert.equal(f.jobs.size,0);assert.deepEqual(f.dismissed,['toast-2']);assert.equal(f.timer.count,0);assert.equal(f.toasts[1].onClick(),false,'ready world ignores stale hint');
 }finally{f.adapter.destroy();}
});

test('short loads and retired/error states do not leave a timer or stale retry',()=>{
 const f=fixture();try{
  f.world.options.onStatus({phase:'Downloading Region',region:'deadlands',retryableLoading:true});f.timer.advance(30000);f.world.options.onStatus({phase:'Ready'});f.timer.advance(60000);
  assert.equal(f.toasts.length,0);assert.equal(f.timer.count,0);
  f.world.options.onStatus({phase:'Downloading Region',region:'deadlands',retryableLoading:true});f.timer.advance(60000);assert.equal(f.toasts.length,1);
  f.world.options.onStatus({phase:'error',region:'deadlands',error:'missing',retryableFailed:true});assert.equal(f.toasts.length,2,'failure receives its own error action');assert.deepEqual(f.dismissed,['toast-1']);
  assert.equal(f.toasts[0].onClick(),false,'failed world ignores prior long-loading retry');assert.equal(f.world.retries,0);assert.equal(f.timer.count,0);
 }finally{f.adapter.destroy();}
});

test('a failed region and long-loading neighbor keep separate actions without duplicate notices',()=>{
 const f=fixture();try{
  const mixed={phase:'Loading regions 1/2',retryableLoading:true,retryableFailed:true,progress:{completed:1,total:2,unit:'regions'},error:'a: unavailable'};
  f.world.options.onStatus(mixed);assert.equal(f.toasts.length,1);assert.equal(f.toasts[0].kind,'error');
  f.timer.advance(60000);assert.equal(f.toasts.length,2);assert.equal(f.toasts[1].kind,'warning');assert.equal(f.jobs.size,1);
  f.world.options.onStatus(mixed);assert.equal(f.toasts.length,2,'status frames do not duplicate either notice');
  f.world.options.onStatus({phase:'idle'});assert.equal(f.jobs.size,0);assert.deepEqual(f.dismissed,['toast-1','toast-2']);assert.equal(f.timer.count,0);
  assert.equal(f.toasts[0].onClick(),false);assert.equal(f.toasts[1].onClick(),false);assert.equal(f.world.retries,0);
 }finally{f.adapter.destroy();}
});

test('retrying again while the previous load drains does not permanently silence the hint',()=>{
 const f=fixture();try{
  f.world.retryLoading=()=>false;
  f.world.options.onStatus({phase:'Downloading Region',region:'deadlands',retryableLoading:true});f.timer.advance(60000);
  assert.equal(f.toasts.length,1);f.toasts[0].onClick();assert.equal(f.timer.count,1,'a queued retry still has a future hint');
  f.timer.advance(60000);assert.equal(f.toasts.length,2);
 }finally{f.adapter.destroy();}
});

test('post-ready work without safe disposal has a non-actionable notice, with safe transitions',()=>{
 const f=fixture();try{
  const loading={phase:'Loading layers: decals',region:'deadlands',retryableLoading:false};
  f.world.options.onStatus(loading);f.timer.advance(60000);
  assert.equal(f.toasts.length,1);assert.equal(f.toasts[0].onClick,undefined);assert.doesNotMatch(f.toasts[0].message,/select to retry/i);assert.equal(f.jobs.size,1);
  f.world.options.onStatus({...loading,retryableLoading:true});assert.equal(f.toasts.length,2);assert.deepEqual(f.dismissed,['toast-1']);assert.equal(typeof f.toasts[1].onClick,'function');
  f.world.options.onStatus(loading);assert.equal(f.toasts.length,3);assert.deepEqual(f.dismissed,['toast-1','toast-2']);assert.equal(f.toasts[2].onClick,undefined);
  assert.equal(f.toasts[1].onClick(),false,'old retry becomes inert when it is unsafe');assert.equal(f.world.retries,0);
  f.world.options.onStatus({phase:'error',region:'deadlands',error:'late layer failed',retryableFailed:false});
  assert.equal(f.toasts.length,4);assert.equal(f.toasts[3].kind,'error');assert.equal(f.toasts[3].onClick,undefined);assert.doesNotMatch(f.toasts[3].message,/select to retry/i);assert.match(f.toasts[3].message,/Some Deadlands content could not load.*late layer failed/);
  f.world.options.onStatus({phase:'error',region:'deadlands',error:'late layer failed',retryableFailed:true});assert.equal(f.toasts.length,5);assert.equal(typeof f.toasts[4].onClick,'function');
  f.world.options.onStatus({phase:'error',region:'deadlands',error:'late layer failed',retryableFailed:false});assert.equal(f.toasts.length,6);assert.equal(f.toasts[5].onClick,undefined);assert.equal(f.toasts[4].onClick(),false);
 }finally{f.adapter.destroy();}
});

test('changing the selected load restarts the clock even when multi-region labels match',()=>{
 const f=fixture();try{
  f.world.options.onStatus({phase:'Loading',region:'deadlands',selectionGeneration:1,retryableLoading:true});f.timer.advance(59000);
  f.world.options.onStatus({phase:'Loading',region:'westgate',selectionGeneration:2,retryableLoading:true});f.timer.advance(1000);
  assert.equal(f.toasts.length,0,'new region must not inherit the old wait');f.timer.advance(59000);
  assert.equal(f.toasts.length,1);assert.match(f.toasts[0].message,/Westgate/);
  f.world.options.onStatus({phase:'Loading regions 0/2',selectionGeneration:3,retryableLoading:true});
  assert.deepEqual(f.dismissed,['toast-1']);assert.equal(f.toasts[0].onClick(),false);
  f.timer.advance(59000);f.world.options.onStatus({phase:'Loading regions 0/2',selectionGeneration:4,retryableLoading:true});f.timer.advance(1000);
  assert.equal(f.toasts.length,1,'different multi-region selections must not share a timer');f.timer.advance(59000);
  assert.equal(f.toasts.length,2);assert.match(f.toasts[1].message,/World Map/);
 }finally{f.adapter.destroy();}
});
