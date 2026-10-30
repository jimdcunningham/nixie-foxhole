import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {completeLoadTasks} from '../runtime/load-tasks.mjs';

const source=readFileSync(new URL('../runtime/load-compact-region.mjs',import.meta.url),'utf8');
const implementation=source.match(/async function weather\(taskSignal\)\{[\s\S]*?\n \}/)?.[0];
assert.ok(implementation,'the loader exposes its weather task');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const calls=[],weatherTextures={},packed={name:'packed'};let packs=0;
 const context={region:'deadlands',completeLoadTasks,weatherTextures,packedWeather:null,
  texture:(path,repeat)=>new Promise((resolve,reject)=>calls.push({path,repeat,resolve,reject})),
  packWeatherSurfaceTextures:(snow,mask)=>{packs++;assert.equal(snow.id,'snow');assert.equal(mask.id,'mask');return packed;}};
 const weather=runInNewContext('('+implementation+')',context),controller=new AbortController();
 return {calls,weatherTextures,packed,controller,weather,get packs(){return packs;}};
}
test('weather loads two textures at a time and publishes only complete results',async()=>{
 const f=fixture(),pending=f.weather(f.controller.signal);await tick();
 assert.equal(f.calls.length,2);assert.deepEqual(f.calls.map(c=>c.path.split('/').at(-1)),['snow.png','normal.png']);assert.deepEqual(f.weatherTextures,{});
 f.calls[0].resolve({id:'snow'});await tick();assert.equal(f.calls.length,3);assert.match(f.calls[2].path,/mask\.png$/);
 f.calls[1].resolve({id:'normal'});await tick();assert.equal(f.calls.length,4);assert.match(f.calls[3].path,/noise\.png$/);
 f.calls[2].resolve({id:'mask'});f.calls[3].resolve({id:'noise'});await pending;
 assert.equal(f.packs,1);assert.equal(f.weatherTextures.weatherSnow,f.packed);assert.equal(f.weatherTextures.weatherBump.id,'normal');assert.equal(f.weatherTextures.weatherMask.id,'mask');assert.equal(f.weatherTextures.weatherNoise.id,'noise');assert.ok(f.calls.every(c=>c.repeat===true));
});
test('weather waits for in-flight siblings before reporting failure',async()=>{
 const f=fixture(),pending=f.weather(f.controller.signal),rejected=assert.rejects(pending,/texture failed/);let finished=false;void pending.catch(()=>{finished=true;});await tick();
 f.calls[0].reject(new Error('texture failed'));await tick();assert.equal(finished,false);assert.equal(f.calls.length,2);
 f.calls[1].resolve({id:'normal'});await rejected;assert.equal(f.calls.length,2);assert.equal(f.packs,0);assert.deepEqual(f.weatherTextures,{});
});
test('weather abort drains started reads without publishing textures',async()=>{
 const f=fixture(),pending=f.weather(f.controller.signal),rejected=assert.rejects(pending,{name:'AbortError'});await tick();
 f.controller.abort();f.calls[0].resolve({id:'snow'});await tick();assert.equal(f.calls.length,2);f.calls[1].resolve({id:'normal'});await rejected;
 assert.equal(f.packs,0);assert.deepEqual(f.weatherTextures,{});
});
