import test from 'node:test';
import assert from 'node:assert/strict';
import {completeLoadTasks} from '../runtime/load-tasks.mjs';

test('parallel region loading drains pending work before resource cleanup on failure',async()=>{
 let release,finished=false;
 const error=new Error('invalid texture');
 const pending=new Promise(resolve=>{release=()=>{finished=true;resolve('terrain');};});
 const group=completeLoadTasks([Promise.reject(error),pending]);
 await Promise.resolve();
 assert.equal(finished,false);
 release();
 await assert.rejects(group,e=>e===error);
 assert.equal(finished,true);
});

test('parallel region load results retain stage order',async()=>{
 let release;
 const first=new Promise(resolve=>{release=resolve;});
 const group=completeLoadTasks([first,Promise.resolve('models')]);
 release('terrain');
 assert.deepEqual(await group,['terrain','models']);
});
