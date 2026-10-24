import test from 'node:test';
import assert from 'node:assert/strict';
import {worldModelLayer,normalizeWorldModelLayers} from '../authoring/world-model-layers.mjs';
import {modelCells} from '../runtime/model-cells.mjs';
import {effectOwnerLayer} from '../authoring/world-effect-policy.mjs';
import {chooseLod} from '../authoring/distance-lod.mjs';
const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,10,0,10,1];
const proto=(name,category,path)=>({name,category,path,kind:'environment',placements:[{actor:name,matrix}]});
test('native rock and foliage meshes override coarse blueprint prop categories',()=>{
 for(const name of ['RockShorlineCliff','RockWestgateLayer3','ShorelineRocks_03','Boulder01'])assert.equal(worldModelLayer(proto('RockCluster_C/StaticMesh','structures','War/Content/Meshes/Environment/Props/'+name+'.uasset')),'rocks');
 assert.equal(worldModelLayer(proto('BPUnderwaterMountain02_C/StaticMesh','structures','War/Content/Meshes/Environment/Props/RockShorlineMountain02.uasset')),'rocks');
 assert.equal(worldModelLayer(proto('Wall_C/Ivy','structures','War/Content/Meshes/Environment/Foliage/Ivy12.uasset')),'vegetation');
 for(const name of ['BirchSilver_1','Fir02','FirSnow01','Pine01Ruined','DeadTree03','TreeTrunk02','SilverBirchBare','PoplarTreeBush02'])assert.equal(worldModelLayer(proto(name,'vegetation')),'trees');
 for(const name of ['BeechShrub02_2','GrassPlantFernA_01','Ivy11','Mushroom_02'])assert.equal(worldModelLayer(proto(name,'vegetation')),'vegetation');
 for(const name of ['CoverStreetlamp1d','RocketBattery','StoneBridge'])assert.equal(worldModelLayer(proto(name,'structures')),'structures');
 assert.equal(worldModelLayer({...proto('RockFactory','structures'),kind:'building'}),'building');
});
test('classification is immutable and streaming partitions match effect ownership',()=>{
 const rock=proto('RockCluster_C/StaticMesh','structures','War/Content/Meshes/Environment/Props/RockShorlineCliff.uasset'),tree=proto('BirchSilver_1','vegetation'),bush=proto('BeechShrub02_2','vegetation'),prop=proto('Crate','structures'),data={prototypes:[rock,tree,bush,prop]},normalized=normalizeWorldModelLayers(data);
 assert.notEqual(normalized,data);assert.equal(rock.category,'structures');assert.equal(tree.category,'vegetation');assert.equal(normalized.prototypes[2],bush);assert.equal(normalizeWorldModelLayers(data),normalized);assert.equal(normalizeWorldModelLayers(normalized),normalized);
 for(const [category,p]of [['rocks',rock],['trees',tree],['vegetation',bush],['structures',prop]]){
  assert.deepEqual(modelCells(data,category).flatMap(c=>c.data.prototypes.map(p=>p.name)),[p.name]);
  assert.equal(effectOwnerLayer({actor:p.name,system:'fixture'},{worldData:data}),category);
 }
});
test('the independent tree layer retains the vegetation LOD proximity policy',()=>{
 const camera={distance:150,radius:1,height:800,fov:45};
 assert.equal(chooseLod({...camera,category:'trees'}),chooseLod({...camera,category:'vegetation'}));
 assert.notEqual(chooseLod({...camera,category:'trees'}),chooseLod({...camera,category:'structures'}));
});

test('native building families override coarse prop categories for whole blueprint assemblies',()=>{
 for(const name of ['TownCSmallS1_C/HouseMesh','TownWMedS2_C/RoofMesh','TownWGreenhouseS1_C/StaticMesh',
  'UniqueWWarehouseG3_C/HouseMesh','UniqueWWarehouseG3_C/Tire03','UniqueWWarehouseS2_C/StaticMesh4',
  'UniqueWChurchG1_C/$Catalog','UniqueWCoalPlantG1_C/$Catalog','UniqueWTrainStationG1_C/$Catalog',
  'BPGarrisonBarn_C/StaticMesh','BPDestroyedGarrisonFishHut_C/StaticMesh','BPRVT1Room_C/StaticMesh',
  'BPAircraftFactory_C/$Catalog','BPAircraftDepot_C/$Catalog','BPVehicleFactory_C/$Catalog',
  'BPConstructionYard_C/$Catalog','BPEngineeringCenter_C/$Catalog','BPMassProduction_C/$Catalog',
  'House02Roof_C/StaticMesh','BombStorage03_C/StaticMesh','Shack_04Snow_C/StaticMesh']){
  assert.equal(worldModelLayer(proto(name,'structures')), 'building', name);
 }
 for(const name of ['Barn2','BarnSouth','Lighthouse','TownWLargeShedSouth','TownWMedShed1','Shack_01','Shack_05','Shanty08',
  'Outhouse_02','CampTent','CanvasTent07','CanvasTentDestroyed','MedicalTent01','HuntersTent01',
  'UniqueWChurchG1RoofDestroyed','UniqueWBellTowerG1RoofDamaged']){
  assert.equal(worldModelLayer(proto('StaticMeshActor','structures',`War/Content/Meshes/Environment/Props/${name}.${name}`)), 'building', name);
 }
});

test('building classification preserves standalone props, infrastructure and natural mesh overrides',()=>{
 for(const name of ['HouseLantern','MetalLightBarn','MetalTroughBarn','TownRubble01Flat','TownSidewalk01',
  'BPBulwarkWall01_C/StaticMesh',
  'BPResourceFieldProxy_C/$Catalog','BPCoverStreetlamp1a_C/StaticMesh','WoodBarrel_01']){
  assert.equal(worldModelLayer(proto(name,'structures')), 'structures', name);
 }
 assert.equal(worldModelLayer(proto('UniqueWWarehouseG3_C/Ivy','structures','War/Content/Meshes/Environment/Foliage/Ivy12.uasset')), 'vegetation');
 assert.equal(worldModelLayer(proto('TownWMedS1_C/Rock','structures','War/Content/Meshes/Environment/Props/RockShorlineCliff.uasset')), 'rocks');
 assert.equal(worldModelLayer(proto('TownWMedS1_C/Road','infrastructure')), 'infrastructure');
});

test('promoted buildings share normalization, streaming and effect ownership without changing native kind or placements',()=>{
 const house=proto('UniqueWWarehouseG3_C/HouseMesh','structures'),roof=proto('UniqueWWarehouseG3_C/RoofMesh','structures'),crate=proto('Crate','structures');
 roof.placements=[{actor:house.name,matrix}];
 const data={prototypes:[house,roof,crate]},normalized=normalizeWorldModelLayers(data);
 assert.equal(house.category,'structures');assert.equal(house.kind,'environment');
 assert.equal(normalized.prototypes[0].category,'building');assert.equal(normalized.prototypes[0].kind,'environment');
 assert.equal(normalized.prototypes[0].placements,house.placements);
 assert.equal(normalizeWorldModelLayers(data),normalized);assert.equal(normalizeWorldModelLayers(normalized),normalized);
 assert.deepEqual(modelCells(data,'building').flatMap(c=>c.data.prototypes.map(p=>p.name)),[house.name,roof.name]);
 assert.deepEqual(modelCells(data,'structures').flatMap(c=>c.data.prototypes.map(p=>p.name)),[crate.name]);
 assert.equal(effectOwnerLayer({actor:house.name,system:'fixture'},{worldData:data}), 'building');
});

test('transport owns complete native bridge, rail, dock, runway and canal assemblies',()=>{
 for(const name of ['BPConcreteBridge_C/BridgeMesh','BPConcreteBridgeNoBlocker_C/BridgeMesh',
  'BPDrawbridgeA_C/SideAProxy','BPDrawbridgeC_C/SideBProxy','BPTrainBridgeA_C/TrimMesh',
  'BPTrainBridgeC_C/SideAColumn','BPPlatformBridge_C/StaticMesh7','BPTrenchBridge_C/TrenchBridgeRamp3',
  'BridgeStoneBox_C/StaticMesh','BridgeStoneRamp_C/BridgeStoneStepRamp02',
  'BPNoVisRailTrackSpline_C/BackSwitchMesh','BPPreplacedRailTrackSplineBiarc_C/FrontSwitchMesh',
  'BPPreplacedRailTrackSplineFoundation_C/BackSwitchMesh','BPRailTrackSpline_C/FrontSwitchMesh',
  'BPRailTrackSplineFoundation_C/BackSwitchMesh','BPRailBumper_C/StaticMesh',
  'TrainCar01BP_C/StaticMesh','TrainCar02BP_C/TrainCar01',
  'BPLoadingDock_C/Rope01','BPLoadingDock02_C/Bollard','BPAircraftRunwayT1_C/$Catalog',
  'BPCanalStair02_600-Overgrown_C/StaticMesh','CanalPillar3TallSouth_C/StaticMesh',
  'CanalWall1eVines2_C/StaticMesh','StoneWallCanal02Moss_C/StaticMesh']){
  assert.equal(worldModelLayer(proto(name,'structures')),'infrastructure',name);
 }
});

test('standalone transport meshes are recognized without stealing reused planks or building fixtures',()=>{
 for(const name of ['Bridge','BridgeBroken','BridgeMediumMiddle02','BridgeStoneStepLedge','DamBridgeT01',
  'DrawBridgeDestroyed','TrainBridgeSection','TrainBridgeEnd','TrenchBridgeRamp','WoodSmallBridgePath',
  'Railroad_03','RailBumper','SK_RailTrackSwitch','RoadGreatMarchEnd01','SingleRoadBrick02',
  'TrainCar02','TrainFlat01','TrainPlatformBlock02','TrainPlatformRamp01','LoadingDock02','LandingDock',
  'WetlandsWalkway06','WetlandsWalkwayPlanks03','WetlandsWalkwayRamp01']){
  assert.equal(worldModelLayer(proto('StaticMeshActor','structures',`War/Content/Meshes/Environment/Props/${name}.uasset`)),'infrastructure',name);
 }
 for(const name of ['Crate','Rope01','SteelBeam01','CoverBollard1c','Wagon02','ModularVehiclesShellv1',
  'TruckDamagedWar','BridgeLadder','RailroadSign','RoadSign','TrainStationClock','StoneWall02Pile']){
  assert.equal(worldModelLayer(proto(name,'structures')),'structures',name);
 }
 assert.equal(worldModelLayer(proto('CastleFence3_C/StaticMesh','structures','War/Content/Meshes/Environment/Props/WetlandsWalkwayPlanks07.uasset')),'structures');
 assert.equal(worldModelLayer(proto('UniqueWTrainStationG1_C/StaticMesh','structures','War/Content/Meshes/Environment/Props/Railroad_03.uasset')),'building');
 assert.equal(worldModelLayer({...proto('BPAircraftRunwayT1_C/$Catalog','structures'),kind:'building'}),'building');
 assert.equal(worldModelLayer(proto('BPPlatformBridge_C/Rock','structures','War/Content/Meshes/Environment/Props/RockShorlineCliff.uasset')),'rocks');
 assert.equal(worldModelLayer(proto('BPPlatformBridge_C/Ivy','structures','War/Content/Meshes/Environment/Foliage/Ivy12.uasset')),'vegetation');
});

test('transport normalization, streaming and effects share ownership without mutating sources',()=>{
 const deck=proto('BPPlatformBridge_C/StaticMesh','structures'),beam=proto('BPPlatformBridge_C/StaticMesh7','structures'),prop=proto('Crate','structures');
 beam.placements=[{actor:deck.name,matrix}];
 const data={prototypes:[deck,beam,prop]},normalized=normalizeWorldModelLayers(data);
 assert.equal(deck.category,'structures');assert.equal(normalized.prototypes[0].category,'infrastructure');
 assert.equal(normalized.prototypes[0].placements,deck.placements);
 assert.equal(normalizeWorldModelLayers(data),normalized);assert.equal(normalizeWorldModelLayers(normalized),normalized);
 assert.deepEqual(modelCells(data,'infrastructure').flatMap(c=>c.data.prototypes.map(p=>p.name)),[deck.name,beam.name]);
 assert.deepEqual(modelCells(data,'structures').flatMap(c=>c.data.prototypes.map(p=>p.name)),[prop.name]);
 assert.equal(effectOwnerLayer({actor:deck.name,system:'fixture'},{worldData:data}),'infrastructure');
});


test('natural ice, snow rocks and underwater rocks follow Rocks rather than coarse Props',()=>{
 for(const name of ['IcePlatformSharp_01','IcePlatformSharp_08','IcePlatformSoft_01','IcePlatformSoft_09','SnowRocks','UnderWaterRockShorelineLarge']){
  assert.equal(worldModelLayer(proto('StaticMeshActor','structures',`War/Content/Meshes/Environment/Props/${name}.${name}`)),'rocks',name);
 }
 for(const owner of ['BPIcePlatform01_C/StaticMesh9','BPIcePlatform01Static_C/StaticMesh','BPIcePlatform02_C/IcePlatformSharp_01','BPIcePlatform03_C/StaticMesh','CaveIceRoofLore_C/StaticMesh6']){
  assert.equal(worldModelLayer(proto(owner,'structures','War/Content/Meshes/Environment/Props/IcePlatformSoft_03.uasset')),'rocks',owner);
 }
 for(const name of ['IceBox','IcePlatformSupport','PlatformPeice01','BrokenRockStoneWall1_C/Brick1h','DamagedStoneWall1','Gravestone01','Cairns2','RocketBattery']){
  assert.equal(worldModelLayer(proto(name,'structures')),'structures',name);
 }
});

test('ice formations share immutable normalization, streaming partitions and effect ownership',()=>{
 const ice=proto('BPIcePlatform02_C/StaticMesh9','structures','War/Content/Meshes/Environment/Props/IcePlatformSharp_03.uasset'),prop=proto('PlatformPeice01','structures'),data={prototypes:[ice,prop]},normalized=normalizeWorldModelLayers(data);
 assert.equal(ice.category,'structures');assert.equal(normalized.prototypes[0].category,'rocks');assert.equal(normalized.prototypes[0].placements,ice.placements);
 assert.equal(normalizeWorldModelLayers(data),normalized);assert.equal(normalizeWorldModelLayers(normalized),normalized);
 assert.deepEqual(modelCells(data,'rocks').flatMap(c=>c.data.prototypes.map(p=>p.name)),[ice.name]);
 assert.deepEqual(modelCells(data,'structures').flatMap(c=>c.data.prototypes.map(p=>p.name)),[prop.name]);
 assert.equal(effectOwnerLayer({actor:ice.name,system:'fixture'},{worldData:data}),'rocks');
});
