import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { computed, shallowRef } from 'vue';
import { selectedSpatialRegions, regionIdForKey } from '../app/plugins/foxhole/nixie/map/region-scene-controller.mjs';

const source=readFileSync(new URL('../app/plugins/foxhole/nixie/scene-map-canvas-adapter.ts',import.meta.url),'utf8');
test('a failed region remains visible and retryable while its neighbor is still loading',()=>{
 const jobs=new Map<string,any>(),toasts:any[]=[],dismissed:string[]=[];let sequence=0,world:any;
 const factory=runInNewContext(stripTypeScriptTypes(source.replaceAll('import.meta.dev','false').replace(/^import .*;\r?\n/gm,'').replace('export function','function')+'\ncreateFoxholeSceneMapCanvas;'),{
  FoxholeRegionSceneController:class {constructor(options:any){world={options,retries:0,retryFailed(){this.retries++;return true;},sync(){},destroy(){options.onStatus({phase:'idle'});}};return world;}},
  FoxholeMapViewportPlugin:class {updatePresentation(){} getSpatialWarState(){return null;} destroy(){}},
  selectedSpatialRegions,regionIdForKey,computed,shallowRef, setTimeout: () => 1, clearTimeout: () => {},
  foxholeWorldAssetDelivery:()=>({baseUrl:'/world/',revision:1,loadIndex:async()=>({})}),
  subscribeSceneViewpointRestore:()=>()=>{},consumeViewpointRegionCamera:()=>true,
  plannerRoadTourActions:shallowRef(null),plannerRoadTourStatus:shallowRef({}),
  beginShellProgressJob:(job:any)=>{const id=`job-${++sequence}`;jobs.set(id,job);return id;},
  updateShellProgressJob:(id:string,update:any)=>jobs.set(id,{...jobs.get(id),...update}),finishShellProgressJob:(id:string)=>jobs.delete(id),
  showNxToast:(toast:any)=>{toasts.push(toast);return `toast-${toasts.length}`;},dismissNxToast:(id:string)=>dismissed.push(id),
  FOXHOLE_MAP_REGIONS:[],getFoxholeRegionPosition:()=>({x:0,y:0}),useNixieSettingsStore:()=>({getValueOr(){}}),
  readFoxholeMapSettings:()=>({enabled:true,regionKeys:['aHex','bHex']}),
 });
 const adapter=factory({app:{},viewport:{},before:{},runtime:{projectStore:{settings:{}}},viewMode:()=> '3d',nodeCount:()=>0,zoom:()=>1,pointer:()=>null,interacting:()=>false,suppressGrid(){},cameraTo(){}});
 try{
  const progress={completed:1,total:2,unit:'regions'};
  world.options.onStatus({phase:'Loading regions 1/2',progress,error:'b: resource unavailable',retryableFailed:true});
  assert.equal(jobs.size,1,'the live neighbor continues to report progress');
  assert.equal(toasts.length,1,'the failed region is visible before its neighbor settles');
  assert.match(toasts[0].message,/resource unavailable.*Select to retry/);
  world.options.onStatus({phase:'Loading regions 1/2',progress,error:'b: resource unavailable',retryableFailed:true});
  assert.equal(toasts.length,1,'repeated progress frames do not stack error toasts');
  world.options.onStatus({phase:'error',error:'b: resource unavailable',retryableFailed:true});
  assert.equal(jobs.size,0);assert.equal(toasts.length,1,'the terminal transition reuses the error');
  toasts[0].onClick();assert.equal(world.retries,1);
  world.options.onStatus({phase:'Loading regions 1/2',progress,error:'b: resource unavailable',retryableFailed:true});
  assert.equal(toasts.length,2,'a failed retry can be reported again');
  world.options.onStatus({phase:'Loading regions 1/2',progress});
  assert.deepEqual(dismissed,['toast-2'],'error clears when its failed region is no longer selected');
  assert.equal(jobs.size,1,'remaining region still loads');
  assert.equal(toasts[1].onClick(),false,'removed-region retry is inert');
 }finally{adapter.destroy();}
});
