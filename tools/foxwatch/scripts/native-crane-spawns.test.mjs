import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeCraneSpawns} from './native-crane-spawns.mjs';

test('native crane table uses blueprint identities and rejects conflicting component transforms',()=>{
 const spawn={name:'CraneSpawnLocationComponent',structureId:'staticcrane',x:100,y:200,z:300,rotation:90};
 const manifest={assets:[{id:'refinery',craneSpawns:[spawn]},{id:'unused'}]},index={Targets:{refinery:['War/Content/Blueprints/Structures/BPRefinery.uasset']}};
 assert.deepEqual(nativeCraneSpawns(manifest,index).blueprints,{BPRefinery_C:[spawn]});
 manifest.assets.push({id:'duplicate',craneSpawns:[{...spawn,x:500}]});index.Targets.duplicate=index.Targets.refinery;
 assert.throws(()=>nativeCraneSpawns(manifest,index),/Conflicting native crane/);
});
