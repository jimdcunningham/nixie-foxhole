import test from 'node:test';import assert from 'node:assert/strict';
import {summarizeTerrainTransfers} from '../../extensions/foxhole/app/plugins/foxhole/nixie/map/region-scene-controller.mjs';
test('aggregate shared transfers once and keep unavailable timing explicit',()=>{
 const shared={id:'shared',kind:'observed',bytes:1500},unknown={id:'private',kind:'unknown'};
 const rows=[{state:{terrainTransfers:{events:[shared,unknown]}}},{state:{terrainTransfers:{events:[shared,{id:'cached',kind:'http-cache',bytes:0}]}}}];
 assert.deepEqual(summarizeTerrainTransfers(rows),{bytes:1500,observed:1,unknown:1,cached:1});
});
