import test from 'node:test';import assert from 'node:assert/strict';
import {prepareSpatialTrenchScene,spatialTrenchProfile} from './spatial-trench-profiles.mjs';
test('trench profiles include absent sample prototypes and retain canonical transforms without editing inputs',async()=>{
 const input={scene:{roots:[{name:'FloorQuadrilateralCover',unrealLocationCentimeters:[0,0,-160]}]},assets:{meshes:[],materials:[]},spatialLayerGroups:{old:'old'}},asset={id:'trenchconnectort3',renderLayers:[{i:'piece-wall'}]};
 const prototype={scene:{roots:[{id:'wall',name:'wall',meshId:'wall',unrealLocationCentimeters:[0,0,0],children:[]}]},assets:{meshes:[{id:'wall',sourcePath:'wall.glb'}],materials:[]}};
 const prepared=await prepareSpatialTrenchScene(asset,input,async()=>prototype);assert.equal(prepared.scene.roots.length,2);assert.equal(input.scene.roots.length,1);assert.equal(prepared.scene.roots[0].unrealLocationCentimeters[2],-160);assert.equal(prepared.scene.roots[1].unrealLocationCentimeters[2],0);assert.equal(prototype.assets.meshes[0].id,'wall');
 const groups=Object.fromEntries(Object.values(prepared.spatialTrenchParts).map(key=>[key,key]));
 const document={nodes:Object.values(groups).map((name,index)=>({name,mesh:index})),meshes:[{},{}]};
 const profile=spatialTrenchProfile(prepared,document,{semanticGroups:groups});assert.equal(profile.parts.floor.meshIndex,1);
 await assert.rejects(()=>prepareSpatialTrenchScene(asset,input,async()=>undefined),/Missing trench spatial prototype/);
});

test('wall, roof and defense prototypes inherit their distinct authored heights',async()=>{
 const asset={id:'trenchconnectort3',renderLayers:[{i:'piece-wall'},{i:'piece-trencht3roofsurface'},{i:'piece-trenchconnectorsandbagsangledspline01'}]};
 const input={scene:{roots:[{name:'FloorQuadrilateralCover',unrealLocationCentimeters:[0,0,-160]},{name:'BPTrenchConnectorRoofModSlot',unrealLocationCentimeters:[0,0,-120]},{name:'Common:LeftDefenseModSlot',unrealLocationCentimeters:[0,0,20]}]},assets:{meshes:[],materials:[]}};
 const part={scene:{roots:[{id:'mesh',meshId:'mesh',unrealLocationCentimeters:[0,0,0]}]},assets:{meshes:[{id:'mesh'}],materials:[]}};
 const prepared=await prepareSpatialTrenchScene(asset,input,async()=>part);
 assert.deepEqual(prepared.scene.roots.map(node=>node.unrealLocationCentimeters[2]),[-160,-120,20,0]);
});


test('raw extraction and published trench layers load the same canonical prototypes',async()=>{
 const input={scene:{roots:[{name:'FloorQuadrilateralCover',unrealLocationCentimeters:[0,0,-160]}]},assets:{meshes:[],materials:[]}};
 const part={scene:{roots:[{id:'mesh',meshId:'mesh',children:[]}]},assets:{meshes:[{id:'mesh'}],materials:[]}};
 for(const tier of [1,2,3])for(const layer of [{id:'piece-wall',componentName:'Wall'},{i:'piece-wall',cn:'Wall'}]){
  const id='trenchconnectort'+tier,paths=[];
  const available=new Map([[id+'/components/piece-wall.scene.json',part],['trencht'+tier+'/components/floor.scene.json',part]]);
  const result=await prepareSpatialTrenchScene({id,renderLayers:[layer]},input,async path=>{paths.push(path);return available.get(path);});
  assert.deepEqual(paths,[...available.keys()]);
  assert.deepEqual(Object.keys(result.spatialTrenchParts),['piece-wall','floor']);
 }
});


test('absent declared components need no prototype, but native pieces and present components do',async()=>{
 const input={scene:{roots:[{name:'FloorQuadrilateralCover',unrealLocationCentimeters:[0,0,-160]},{name:'Common:WallBack'}]},assets:{meshes:[],materials:[]}};
 const part={scene:{roots:[{id:'mesh',meshId:'mesh',children:[]}]},assets:{meshes:[{id:'mesh'}],materials:[]}};
 const absent={id:'dirtback',componentName:'DirtBack'},present={id:'wallback',componentName:'WallBack'},native={id:'piece-roof',componentName:'mesh:Roof'};
 const prepare=(layers,load)=>prepareSpatialTrenchScene({id:'trenchconnectort3',renderLayers:layers},input,load);
 const load=async path=>path.endsWith('/floor.scene.json')?part:undefined;
 const result=await prepare([absent],load);
 assert.deepEqual(Object.keys(result.spatialTrenchParts),['floor']);
 for(const layer of [present,native])await assert.rejects(()=>prepare([layer],load),/Missing trench spatial prototype/);
 await assert.rejects(()=>prepare([absent],async()=>undefined),/Missing trench spatial prototype: trencht3/);
});
