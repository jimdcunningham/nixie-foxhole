import test from 'node:test';import assert from 'node:assert/strict';
import {catalogMapAssetsAt} from '../authoring/catalog-world-policy.mjs';
const row=(asset,x=0,z=0)=>({kind:'fixed',asset,actor:asset,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,x,0,z,1]});
test('icon identity reads only matching resident placements and preserves ambiguity',()=>{
 const rows=[row('towncmedgarrisong2',10,-20),row('factory',100,200)];
 assert.deepEqual(catalogMapAssetsAt(rows,null,10,-20),['towncmedgarrisong2']);
 assert.deepEqual(catalogMapAssetsAt(rows,null,13,-20),[]);
 assert.deepEqual(catalogMapAssetsAt(rows,null,10,-20,()=>false),[]);
 assert.deepEqual(catalogMapAssetsAt([...rows,row('other',10,-20)],null,10,-20),['towncmedgarrisong2','other']);
 assert.deepEqual(catalogMapAssetsAt(rows,null,NaN,0),[]);
});
