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
export async function exportWorld({input,regions,output=path.join(repo,'tools/foxwatch/tmp/world-baked'),format='compact',assets=path.join(repo,'packages/extensions/foxhole/public/foxhole/assets/world'),chromium,nativeTextures,terrainSourceMaxSize,terrainColorQuality,terrainNormalQuality,detailTextureMaxSize,detailColorQuality,detailNormalQuality,detailOrmQuality,transportTextureMaxSize,transportColorQuality,transportNormalQuality,transportOrmQuality,transportOrmQuantizationStep,worldNormalMaxSize,worldNormalQuality,worldColorMaxSize,worldColorCutoutMaxSize,worldColorQuality,weatherTextureMaxSize,weatherColorQuality,weatherNormalQuality,weatherDataQuantizationStep,waterTextureMaxSize,waterNormalQuality,waterDataQuantizationStep,waterWaveQuantizationStep}={}){
 if(!input)throw Error('A prepared region source is required. Configure FOXWATCH_WORLD_INPUT or pass --world-input.');
 if(nativeTextures)await prepareNativeFoliageMasks({input,textureRoot:nativeTextures});
 if(format==='compact')return publishCompactWorld({input,target:assets,regions,terrainSourceMaxSize,terrainColorQuality,terrainNormalQuality,detailTextureMaxSize,detailColorQuality,detailNormalQuality,detailOrmQuality,transportTextureMaxSize,transportColorQuality,transportNormalQuality,transportOrmQuality,transportOrmQuantizationStep,worldNormalMaxSize,worldNormalQuality,worldColorMaxSize,worldColorCutoutMaxSize,worldColorQuality,weatherTextureMaxSize,weatherColorQuality,weatherNormalQuality,weatherDataQuantizationStep,waterTextureMaxSize,waterNormalQuality,waterDataQuantizationStep,waterWaveQuantizationStep,onProgress:state=>console.log(JSON.stringify(state))});
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
 const args=process.argv.slice(2),get=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];},getNumber=name=>{const value=get(name);return value===undefined?undefined:Number(value);},getCap=name=>{const value=get(name);return value==='none'?null:value===undefined?undefined:Number(value);};
 await exportWorld({nativeTextures:get('--world-native-textures')||process.env.FOXWATCH_WORLD_NATIVE_TEXTURES,format:get('--world-format')||'compact',input:get('--world-input')||process.env.FOXWATCH_WORLD_INPUT,regions:get('--world-regions')?.split(',').filter(Boolean),output:get('--world-output'),assets:get('--world-assets'),chromium:process.env.FOXWATCH_CHROMIUM,terrainSourceMaxSize:getNumber('--terrain-source-max-size'),terrainColorQuality:getNumber('--terrain-color-quality'),terrainNormalQuality:getNumber('--terrain-normal-quality'),detailTextureMaxSize:getCap('--detail-texture-max-size'),detailColorQuality:getNumber('--detail-color-quality'),detailNormalQuality:getNumber('--detail-normal-quality'),detailOrmQuality:getNumber('--detail-orm-quality'),transportTextureMaxSize:getCap('--transport-texture-max-size'),transportColorQuality:getNumber('--transport-color-quality'),transportNormalQuality:getNumber('--transport-normal-quality'),transportOrmQuality:getNumber('--transport-orm-quality'),transportOrmQuantizationStep:getCap('--transport-orm-quantization-step'),worldNormalMaxSize:getCap('--world-normal-max-size'),worldNormalQuality:getNumber('--world-normal-quality'),worldColorMaxSize:getCap('--world-color-max-size'),worldColorCutoutMaxSize:getNumber('--world-color-cutout-max-size'),worldColorQuality:getNumber('--world-color-quality'),weatherTextureMaxSize:getCap('--weather-texture-max-size'),weatherColorQuality:getNumber('--weather-color-quality'),weatherNormalQuality:getNumber('--weather-normal-quality'),weatherDataQuantizationStep:getNumber('--weather-data-quantization-step'),waterTextureMaxSize:getCap('--water-texture-max-size'),waterNormalQuality:getNumber('--water-normal-quality'),waterDataQuantizationStep:getNumber('--water-data-quantization-step'),waterWaveQuantizationStep:getCap('--water-wave-quantization-step')});
}
