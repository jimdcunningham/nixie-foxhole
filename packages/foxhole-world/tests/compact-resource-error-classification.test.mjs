import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fetchCompactResource,WorldResourceError} from '../runtime/compact-cache.mjs';
const body=new TextEncoder().encode('expected source'),hash=createHash('sha256').update(body).digest('hex');
const ref={path:`content/raw/${hash}/asset.bin`,hash,decodedHash:hash,bytes:body.length};
const unavailableCache={open:async()=>{throw Error('cache unavailable');}};
async function run(fetcher){return fetchCompactResource('https://classification.test/',ref,{cachesApi:unavailableCache,fetcher});}
test('only known HTTP, network, and digest failures get typed recoverable errors',async()=>{
 for(const [fetcher,kind]of [[async()=>new Response('',{status:404}),'unavailable'],[async()=>{throw TypeError('network down');},'unavailable'],[async()=>new Response('wrong'),'integrity']]){
  await assert.rejects(run(fetcher),error=>error instanceof WorldResourceError&&error.kind===kind);
 }
});
test('abort, allocation and unexpected fetch errors are not classified recoverable',async()=>{
 for(const error of [Object.assign(Error('cancelled'),{name:'AbortError'}),RangeError('allocation failed'),Error('unexpected fault')]){
  await assert.rejects(run(async()=>{throw error;}),received=>!(received instanceof WorldResourceError)&&received.cause===error);
 }
});
