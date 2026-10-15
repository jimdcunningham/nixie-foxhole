import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {runAssetGenerationStages} from './asset-generation-stages.mjs';

test('CPU export starts before GPU rendering and the publication barrier waits for both',async()=>{
 const events=[];let finishExport,finishRender;
 const work=runAssetGenerationStages({export3D:()=>{events.push('3d');return new Promise(resolve=>finishExport=resolve);},render2D:()=>{events.push('2d');return new Promise(resolve=>finishRender=resolve);}}).then(()=>events.push('ready'));
 await Promise.resolve();assert.deepEqual(events,['3d','2d']);finishRender();await Promise.resolve();assert.equal(events.includes('ready'),false);
 finishExport();await work;assert.equal(events.at(-1),'ready');
});
test('one failed stage cannot publish while its peer is still producing cached outputs',async()=>{
 let finishRender;let settled=false;
 const work=runAssetGenerationStages({export3D:()=>Promise.reject(Error('packing failed')),render2D:()=>new Promise(resolve=>finishRender=resolve)}).catch(error=>{settled=true;return error;});
 await Promise.resolve();await Promise.resolve();assert.equal(settled,false);finishRender();assert.match((await work).message,/failed/);
});
test('refresh starts export from raw extraction metadata and publication does not invoke Blender',async()=>{
 const source=await readFile(new URL('../run-foxwatch.mjs',import.meta.url),'utf8');
 const refresh=source.match(/if \(command === 'refresh'\) \{([\s\S]*?)\n\}/)[1];
 assert.ok(refresh.indexOf('commitDeepExtractionCache')<refresh.indexOf('runAssetGenerationStages'));
 assert.match(refresh,/--catalog.*rawFoxWatchManifestPath/);
 const publish=source.match(/if \(command === 'publish-manifest'\) \{([\s\S]*?)\n\}/)[1];
 assert.doesNotMatch(publish,/publish-spatial-models/);
});
