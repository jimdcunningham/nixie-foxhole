import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveFoxholeMapIconPreviewAsset as resolve} from '../app/plugins/foxhole/nixie/map/icon-preview.ts';
test('public town-base markers resolve their actual tier and destroyed state without a layout',()=>{
 for(const tier of [1,2,3]){assert.equal(resolve(55+tier,'townbase1'),`townbase${tier}`);assert.equal(resolve(55+tier,'townbase1',4),`destroyedtownbase${tier}`);}
});
test('ambiguous safe-house and relic markers require matching resident building identity',()=>{
 assert.equal(resolve(35,'townclargegarrisongs1'),null);
 assert.equal(resolve(35,'townclargegarrisongs1',0,'towncmedgarrisong2'),'towncmedgarrisong2');
 assert.equal(resolve(35,'townclargegarrisongs1',0,'factory'),null);
 assert.equal(resolve(45,'relicbase1'),null);
 assert.equal(resolve(45,'relicbase1',0,'destroyedrelicbase3'),'destroyedrelicbase3');
 assert.equal(resolve(11,'hospital'),'hospital');
});
