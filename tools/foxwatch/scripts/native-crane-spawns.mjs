import {readFile,writeFile} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {pathToFileURL} from 'node:url';

// Use the same native components that append posed cranes to catalog render scenes.
export function nativeCraneSpawns(manifest,index){
 const blueprints={};
 for(const asset of manifest.assets){
  if(!asset.craneSpawns?.length)continue;
  const targets=index.Targets[asset.id];
  if(!targets?.length)throw Error('Missing crane owner blueprint: '+asset.id);
  for(const target of targets){
   const name=basename(target,'.uasset')+'_C',spawns=structuredClone(asset.craneSpawns);
   if(spawns.some(s=>s.structureId!=='staticcrane'||!['x','y','z','rotation'].every(k=>Number.isFinite(s[k]))))throw Error('Unsupported crane spawn: '+asset.id);
   if(blueprints[name]&&JSON.stringify(blueprints[name])!==JSON.stringify(spawns))throw Error('Conflicting native crane components: '+name);
   blueprints[name]=spawns;
  }
 }
 return {version:1,source:'FoxWatch native CraneSpawnLocationComponent transforms, matching catalog render scenes',blueprints:Object.fromEntries(Object.entries(blueprints).sort(([a],[b])=>a.localeCompare(b)))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const root=resolve(import.meta.dirname,'../../..'),input=resolve(root,'tools/foxwatch/tmp');
 const manifest=JSON.parse(await readFile(resolve(input,'foxwatch-manifest.v1.json'),'utf8'));
 const index=JSON.parse(await readFile(resolve(input,'foxwatch-blueprint-target-index.v1.json'),'utf8'));
 const output=resolve(root,'packages/foxhole-world/authoring/native-crane-spawns.json');
 await writeFile(output,JSON.stringify(nativeCraneSpawns(manifest,index),null,2)+'\n');
 console.log('Updated '+output);
}
