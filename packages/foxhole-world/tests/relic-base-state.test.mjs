import test from 'node:test';import assert from 'node:assert/strict';
import {Container3D,parseGltf} from '@pixi/3d';
import {catalogWorldPlacements,catalogAssetsFor,selectCatalogWorld} from '../authoring/catalog-world-policy.mjs';
import {loadRegionCatalog} from '../runtime/load-region-catalog.mjs';
const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,606,2,409.5,1];
const catalog={assets:Object.fromEntries([1,2,3].flatMap(n=>['relicbase'+n,'destroyedrelicbase'+n]).map(asset=>[asset,{path:'types/structures/'+asset+'/'+asset+'.glb',offsetX:0,offsetY:0,offsetZ:0}]))};
const world={prototypes:[1,2,3].map(n=>({name:'BPDestroyedRelicBase'+n+'_C/$Catalog',category:'structures',catalogBinding:{kind:'fixed',asset:'destroyedrelicbase'+n},placements:[{actor:'relic'+n,matrix}]}))};
const placements=catalogWorldPlacements(world,catalog),state=(flags,teamId='COLONIALS')=>({items:[{iconType:45,x:.5+606/2184,y:.5-409.5/1890,flags,teamId}]});
test('all three authored relic shapes follow public build-site flags, not ownership or internal flags',()=>{
 assert.equal(catalogAssetsFor(placements).length,6);
 for(const flags of [0,8,32])for(const team of ['NONE','WARDENS','COLONIALS'])assert.deepEqual([...selectCatalogWorld(placements,state(flags,team)).values()],['relicbase1','relicbase2','relicbase3']);
 for(const flags of [4,12,36])assert.deepEqual([...selectCatalogWorld(placements,state(flags)).values()],['destroyedrelicbase1','destroyedrelicbase2','destroyedrelicbase3']);
 assert.deepEqual([...selectCatalogWorld(placements,null).values()],['destroyedrelicbase1','destroyedrelicbase2','destroyedrelicbase3']);
 assert.deepEqual([...selectCatalogWorld(placements,{items:[]}).values()],['destroyedrelicbase1','destroyedrelicbase2','destroyedrelicbase3']);
 assert.equal(selectCatalogWorld(placements,state(0),()=>false).size,0);
 const distant=state(0);distant.items[0].x+=.1;assert.equal(selectCatalogWorld(placements,distant).get(0),'destroyedrelicbase1');
});
test('catalog relic batches switch intact and ruined meshes live without reloading resources',async()=>{
 const positions=new Float32Array([0,0,0,1,0,0,0,1,0]),source=await parseGltf({asset:{version:'2.0'},buffers:[{byteLength:positions.byteLength}],bufferViews:[{buffer:0,byteLength:positions.byteLength}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],materials:[{name:'Body'},{name:'WaterMeasurement:parameter-light',emissiveFactor:[1,1,1]}],meshes:[{primitives:[{attributes:{POSITION:0},material:0},{attributes:{POSITION:0},material:1}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0},[positions.buffer]);
 const root=new Container3D(),loads=[],scene=await loadRegionCatalog({baseUrl:'https://assets.test/world/',catalog,layers:{structures:root},placements:[placements[0]],getWarState:()=>state(8),loadModel:async url=>{loads.push(url);return source;}});
 assert.deepEqual(scene.summary.byAsset,{relicbase1:1});assert.ok(scene.batches.every(b=>b.size===1),'Unreal helper light cards must not render or cast shadows');
 const active=()=>scene.batches.filter(b=>b.items[0]._lastRenderPass).map(b=>b.label);
 assert.deepEqual(active(),['Catalog relicbase1']);scene.setWarState(state(4));assert.deepEqual(active(),['Catalog destroyedrelicbase1']);scene.setWarState(state(0,'NONE'));assert.deepEqual(active(),['Catalog relicbase1']);assert.equal(loads.length,2);
 scene.destroy();root.destroy();source.destroy();
});
