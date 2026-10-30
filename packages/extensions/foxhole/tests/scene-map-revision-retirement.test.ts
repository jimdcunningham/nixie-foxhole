import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
import {computed,shallowRef} from 'vue';
const source=readFileSync(new URL('../app/plugins/foxhole/nixie/scene-map-canvas-adapter.ts',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('rapid catalog switches wait for every old controller before loading, even across disable',async()=>{
 let selected:any={revision:1,baseUrl:'/',loadIndex:async()=>({})};const worlds:any[]=[],jobs=new Map<string,any>();let progressWrites=0;
 const factory=runInNewContext(stripTypeScriptTypes(source.replaceAll('import.meta.dev','false').replace(/^import .*;\r?\n/gm,'').replace('export function','function')+'\ncreateFoxholeSceneMapCanvas;'),{
  FoxholeRegionSceneController:class {constructor(options:any){let resolve:any;const barrier=new Promise(r=>resolve=r);const entry={options,syncs:0,destroyed:0,resolve,sync(){this.syncs++;},destroy(){this.destroyed++;options.onStatus({phase:'idle'});},whenDisposed(){return barrier;}};worlds.push(entry);return entry;}},
  FoxholeMapViewportPlugin:class {getSpatialWarState(){return null;}destroy(){}}, foxholeWorldAssetDelivery:()=>selected,
  subscribeSceneViewpointRestore:()=>()=>{},consumeViewpointRegionCamera:()=>true,computed,shallowRef,
  plannerRoadTourActions:shallowRef(null),plannerRoadTourStatus:shallowRef({}), FOXHOLE_MAP_REGIONS:[{key:'WestgateHex'}],regionIdForKey:()=> 'westgate',getFoxholeRegionPosition:()=>({x:0,y:0}),
  useNixieSettingsStore:()=>({getValueOr(){}}),readFoxholeMapSettings:()=>({enabled:true,regionKeys:['WestgateHex']}),
  selectedSpatialRegions:()=>[],beginShellProgressJob:(job:any)=>{progressWrites++;jobs.set('job',job);return 'job';},finishShellProgressJob:(id:string)=>{progressWrites++;jobs.delete(id);},updateShellProgressJob:(id:string,job:any)=>{progressWrites++;jobs.set(id,{...jobs.get(id),...job});},dismissNxToast(){},showNxToast(){},setTimeout,clearTimeout,
 });
 const adapter=factory({app:{},viewport:{},before:{},runtime:{projectStore:{settings:{}}},viewMode:()=> '3d',nodeCount:()=>0,zoom:()=>1,pointer:()=>null,interacting:()=>false,suppressGrid(){},cameraTo(){}});
 const frame=(mode='3d')=>adapter.updateSpatialPresentation({view:{},mode,deltaMS:16});
 frame();assert.equal(worlds[0].syncs,1);
 selected={...selected,revision:2};frame();assert.equal(worlds[0].destroyed,1);assert.equal(worlds[1].syncs,0);assert.match(jobs.get('job').currentFile,/^Waiting for the previous map to stop/);
 const writes=progressWrites;frame();frame();assert.equal(progressWrites,writes,'waiting frames do not repeatedly write progress');
 frame('flat');assert.equal(jobs.size,0,'flat mode does not show a map loading wait');const idleWrites=progressWrites;frame('flat');assert.equal(progressWrites,idleWrites,'idle frames do not repeatedly write progress');frame();assert.equal(jobs.size,1);assert.equal(progressWrites,idleWrites+1,'resuming spatial view reports waiting again');
 selected=null;frame();selected={revision:3,baseUrl:'/',loadIndex:async()=>({})};frame();assert.equal(worlds.length,4);assert.equal(worlds[3].syncs,0);
 worlds[1].resolve();worlds[2].resolve();await tick();frame();assert.equal(worlds[3].syncs,0,'earlier live work still blocks replacement');
 worlds[0].resolve();await tick();frame();assert.equal(worlds[3].syncs,1);
 selected={...selected,revision:4};frame();assert.equal(worlds[4].syncs,0);adapter.destroy();worlds[3].resolve();await tick();frame();assert.equal(worlds[4].syncs,0,'destroyed adapters cannot restart work');
});
