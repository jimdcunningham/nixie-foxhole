import {Matrix4} from '@pixi/3d';
import nativeSpawns from './native-crane-spawns.json' with {type:'json'};

// Legacy world recipes retain actor roots but omit non-mesh spawn components.
// These native component transforms are shared by the matching catalog scenes.
export function craneSpawnPlacements(data,blueprints=nativeSpawns.blueprints){
 const actors=new Set(),placements=[];
 for(const prototype of data.prototypes){
  const type=prototype.name.split('/')[0],spawns=blueprints[type];if(!spawns)continue;
  for(const row of prototype.placements){
   const key=type+':'+(row.actor||row.name||row.matrix.join(','));if(actors.has(key))continue;actors.add(key);
   for(const spawn of spawns){
    if(spawn.structureId!=='staticcrane')throw Error('Unsupported native crane type: '+spawn.structureId);
    const yaw=(spawn.rotation||0)*Math.PI/180,c=Math.cos(yaw),s=Math.sin(yaw);
    const local=new Matrix4().fromArray([c,0,-s,0,0,1,0,0,s,0,c,0,(spawn.x||0)/100,(spawn.z||0)/100,-(spawn.y||0)/100,1]);
    const matrix=new Matrix4().fromArray(row.matrix).multiply(local);
    placements.push({actor:row.actor||row.name||type,name:spawn.name,structureId:spawn.structureId,matrix:Array.from(matrix.elements)});
   }
  }
 }
 return placements;
}
