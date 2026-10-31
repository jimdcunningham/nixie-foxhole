import assert from 'node:assert/strict';
import test from 'node:test';
import {createTerrainMapImageSource} from '../runtime/terrain-map-image.mjs';

test('custom coverage avoids default downloads and missing coverage falls back',async()=>{
 let defaults=0;const source=createTerrainMapImageSource({loadDefault:async()=>{defaults++;return 'default';},initial:async()=> 'mod'});
 assert.equal(await source.read(),'mod');assert.equal(defaults,0);source.set(undefined);assert.equal(await source.read(),'default');source.set(async()=>null);assert.equal(await source.read(),'default');assert.equal(defaults,2);
});
test('changing or disabling a mod while an image loads returns only the current choice',async()=>{
 let resolve;const source=createTerrainMapImageSource({loadDefault:async()=> 'default',initial:()=>new Promise(r=>resolve=r)});const pending=source.read();source.set(async()=> 'replacement');resolve('old');assert.equal(await pending,'replacement');source.set(undefined);assert.equal(await source.read(),'default');
});
test('retired sources stop before returning a late borrowed image',async()=>{
 const controller=new AbortController();let resolve;const source=createTerrainMapImageSource({signal:controller.signal,loadDefault:async()=> 'default',initial:()=>new Promise(r=>resolve=r)});const pending=source.read();controller.abort();resolve('late');await assert.rejects(pending,{name:'AbortError'});
});
