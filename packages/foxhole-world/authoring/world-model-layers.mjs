// Classify native meshes consistently even when a blueprint exports them as props.
export const worldModelLayers=['building','structures','rocks','trees','vegetation','infrastructure'];
export const isVegetationLayer=category=>category==='trees'||category==='vegetation';
// Audited native building families include static scenery, blueprint assemblies,
// and catalog markers. Classify an assembly by its owner so roofs and fixtures
// stay with the building, rather than testing each component mesh in isolation.
const townBuildings=/^(?:Town[CW](?:ExtraSmall|Small|Med|Large|Greenhouse)|Unique[CW](?:Church|BellTower|CoalPlant|Pub|TrainStation|Warehouse|WaterMill|WindMill))/i;
const smallBuildings=/^(?:Barn(?:[0-9]|South|$)|Shack[_0-9]|Shanty[0-9]|House[0-9]|Lighthouse(?:[0-9]|$)|Outhouse[_0-9]|(?:Camp|Canvas|Medical|Hunters)Tent(?:[0-9]|Destroyed|$)|BombStorage[0-9])/i;
const nativeBuildings=/^BP(?:(?:Destroyed)?(?:Garrison(?:Barn|(?:House)?FishHut)|RelicBase|Keep|ObservationTower)|RVT[123]Room|Factory|Refinery|StorageFacility|Seaport|Hospital|MassProduction|VehicleFactory|AircraftDepot|AircraftFactory|ConstructionYard|EngineeringCenter|TownBase)(?:[0-9_]|$)/i;
const buildingFamily=name=>{name=name.replace(/_C$/i,'');return townBuildings.test(name)||smallBuildings.test(name)||nativeBuildings.test(name);};
// Keep a bridge or dock's reused beams, planks and fixtures with its owner.
const transportAssemblies=/^(?:BP(?:ConcreteBridge(?:NoBlocker)?|Drawbridge[A-Z]|TrainBridge[A-Z]|PlatformBridge|TrenchBridge|(?:NoVis|Preplaced)?RailTrackSpline(?:Biarc|Foundation)?|RailBumper|LoadingDock[0-9]*|AircraftRunwayT[0-9]+)|BridgeStone(?:Box|Ramp)|TrainCar[0-9]+BP)(?:_|$)/i;
const canalAssemblies=/^(?:(?:BP)?Canal(?:Pillar|Wall|Stair)[0-9]|StoneWallCanal(?:[0-9_]|Moss|$))/i;
const transportMeshes=/^(?:Bridge(?:Broken|Medium|StoneStep|$)|DamBridge[0-9T]|DrawBridgeDestroyed|TrainBridge(?:End|Section)|TrenchBridge(?:Body|Ramp)|WoodSmallBridgePath|Railroad[_0-9]|RailBumper(?:[0-9_]|$)|SK_RailTrackSwitch(?:[0-9_]|$)|RoadGreatMarch|SingleRoadBrick[0-9]|Train(?:Car|Flat)[0-9]|TrainPlatform(?:Block|Ramp)[0-9]|(?:Loading|Landing)Dock(?:[0-9_]|$))/i;
const walkwayMeshes=/^WetlandsWalkway(?:Planks|Ramp)?[0-9]/i;
// Native glacier/ice shelves are natural formations, including blueprint chunks.
const rockMeshes=/^(?:(?:UnderWater)?Rock(?!et)|ShorelineRocks|SnowRocks(?:[0-9_]|$)|Cliff|Boulder|IcePlatform(?:Sharp|Soft)_)/i;
export function worldModelLayer(prototype){
 if(prototype.kind==='building')return 'building';
 const mesh=(prototype.path||prototype.name||'').split('/').at(-1).split('.')[0];
 if(prototype.category==='rocks'||rockMeshes.test(mesh))return 'rocks';
 if(/^(?:DeadTree|FallenTree|Tree(?:Trunk|Stump|_|[0-9]|$)|Stump|Birch|SilverBirch|Pine|Fir(?:[0-9]|Snow|Dead|$)|PoplarTree|BeechTree|OakTree|Willow)/i.test(mesh))return 'trees';
 if(prototype.category==='vegetation'||/\/Foliage\//i.test(prototype.path||''))return 'vegetation';
 if(prototype.category==='structures'){
  const owner=(prototype.name||'').split('/')[0];
  if(buildingFamily(owner)||buildingFamily(mesh))return 'building';
  if(transportAssemblies.test(owner)||canalAssemblies.test(owner)||transportMeshes.test(mesh)||walkwayMeshes.test(owner)||(!(prototype.name||'').includes('/')&&walkwayMeshes.test(mesh)))return 'infrastructure';
 }
 return prototype.category;
}
const normalized=new WeakMap();
export function normalizeWorldModelLayers(data){
 if(normalized.has(data))return normalized.get(data);
 let changed=false;const prototypes=data.prototypes.map(p=>{const category=worldModelLayer(p);if(p.kind==='building'||category===p.category)return p;changed=true;return {...p,category};});
 const result=changed?{...data,prototypes}:data;normalized.set(data,result);normalized.set(result,result);return result;
}
