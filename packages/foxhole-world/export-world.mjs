import fs from 'node:fs/promises';
import {publishCompactWorld} from './publish-compact.mjs';
import {prepareNativeFoliageMasks} from './prepare-foliage-alpha.mjs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {startWorldBakeServer} from './bake-service.mjs';
import {startBakeBrowser,bakeRegions} from './headless-baker.mjs';
import {packBakedRegions} from './pack-regions.mjs';
import {reusePreparedTerrainTextures} from './reuse-prepared-textures.mjs';
import {publishBakedWorld} from './publish-world.mjs';
const here=import.meta.dirname,repo=path.resolve(here,'../..');
export async function exportWorld({input,regions,output=path.join(repo,'tools/foxwatch/tmp/world-baked'),format='compact',assets=path.join(repo,'packages/extensions/foxhole/public/foxhole/assets/world'),chromium,nativeTextures}={}){
 if(!input)throw Error('A prepared region source is required. Configure FOXWATCH_WORLD_INPUT or pass --world-input.');
 if(nativeTextures)await prepareNativeFoliageMasks({input,textureRoot:nativeTextures});
 if(format==='compact')return publishCompactWorld({input,target:assets,regions,onProgress:state=>console.log(JSON.stringify(state))});
 if(format!=='baked-candidate')throw Error('Unsupported world export format');
 const prepared=JSON.parse(await fs.readFile(path.join(input,'viewer/dependency-bundles/manifest.json'),'utf8'));
 const selected=regions?.length?regions:[];
 const ids=selected.length?selected:(await fs.readdir(path.join(input,'viewer/dependency-bundles/regions'))).filter(f=>f.endsWith('.json')).map(f=>f.slice(0,-5));
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(here,'build-authoring.mjs')],{cwd:repo,windowsHide:true,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('World renderer build failed')));});
 const service=await startWorldBakeServer({input,output}),browser=await startBakeBrowser({executable:chromium});
 try{
  for(const id of ids){console.log('Baking '+id);await bakeRegions({service,browser,regions:[id]});await reusePreparedTerrainTextures({worldDirectory:output,preparedViewerDirectory:path.join(input,'viewer'),blobDirectory:path.join(input,'blobs'),region:id});}
  await packBakedRegions(output);const result=await publishBakedWorld({source:output,target:assets});console.log(JSON.stringify(result));return result;
 }finally{await browser.close();await service.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.join(here,'export-world.mjs')){
 const args=process.argv.slice(2),get=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
 await exportWorld({nativeTextures:get('--world-native-textures')||process.env.FOXWATCH_WORLD_NATIVE_TEXTURES,format:get('--world-format')||'compact',input:get('--world-input')||process.env.FOXWATCH_WORLD_INPUT,regions:get('--world-regions')?.split(',').filter(Boolean),output:get('--world-output'),assets:get('--world-assets'),chromium:process.env.FOXWATCH_CHROMIUM});
}
