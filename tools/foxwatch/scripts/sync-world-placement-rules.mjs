import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const root=resolve(import.meta.dirname,'../../..'),run=promisify(execFile),assets=resolve(root,'packages/extensions/foxhole/public/foxhole/assets');
const maps=JSON.parse(await readFile(resolve(assets,'maps/map-data.v1.json'),'utf8')).maps,index=JSON.parse(await readFile(resolve(assets,'world/index.json'),'utf8'));
const aliases={callahanspassagehex:'callahans',deadlandshex:'deadlands',lochmorhex:'lochmor',fishermansrowhex:'fishermans',weatheredexpansehex:'weathered'};
const regionId=key=>aliases[key.toLowerCase()]||key.replace(/Hex$/i,'').toLowerCase();
const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7).split(','),pak=process.env.FOXWATCH_PAK_PATH||resolve(root,'tools/foxwatch/local/installs/public/a/game/War/Content/Paks');
const targets=Object.keys(maps).map(map=>({map,id:regionId(map)})).filter(r=>index.regions[r.id]&&(!only||only.includes(r.id)));
const importer=resolve(root,'packages/foxhole-world/importer/Importer.csproj');await run('dotnet',['build',importer,'--no-restore','--verbosity','quiet'],{windowsHide:true});
const dir=resolve(root,'tools/foxwatch/tmp/world-placement-rules');await mkdir(dir,{recursive:true});
let next=0;const regions={};await Promise.all(Array.from({length:2},async()=>{while(next<targets.length){const {map,id}=targets[next++],file=resolve(dir,id+'.json');const {stdout}=await run('dotnet',[resolve(root,'packages/foxhole-world/importer/bin/Debug/net8.0/Importer.dll'),pak,'placement-rules',map,file],{windowsHide:true,maxBuffer:1024*1024});regions[id]=JSON.parse(await readFile(file,'utf8'));console.log(stdout.trim());}}));
const output=resolve(root,'packages/foxhole-world/authoring/native-placement-rules.json');
if(only){try{const old=JSON.parse(await readFile(output,'utf8'));Object.assign(regions,Object.fromEntries(Object.entries(old.regions).filter(([id])=>!regions[id])));}catch(e){if(e.code!=='ENOENT')throw e;}}
await writeFile(output,JSON.stringify({version:1,source:'Native map StructureLayerComponent masks and attached actor ownership',regions:Object.fromEntries(Object.entries(regions).sort(([a],[b])=>a.localeCompare(b)))},null,2)+'\n');console.log('Updated '+targets.length+' regions in '+output);
