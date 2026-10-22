import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
const repo=path.resolve(import.meta.dirname,'../../..'),require=createRequire(path.join(repo,'packages/foxhole-world/package.json')),sharp=require('sharp');
const get=name=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1];},input=get('--input');
if(!input)throw Error('Pass --input with a focused material-textures export of HangingFlagColonialA and HangingFlagWardensA.');
const assets=get('--assets')||path.join(repo,'packages/extensions/foxhole/public/foxhole/assets'),rows=JSON.parse(await fs.readFile(path.join(input,'material-source.json'),'utf8')),textures={};
for(const [team,name]of Object.entries({COLONIALS:'HangingFlagColonialA',WARDENS:'HangingFlagWardensA'})){
 const row=rows.find(r=>r.path==='War/Content/Textures/Structures/'+name+'.'+name);if(!row)throw Error('Missing native flag texture '+name);
 const bytes=await sharp(path.join(input,row.file)).webp({lossless:true}).toBuffer(),hash=createHash('sha256').update(bytes).digest('hex'),file='shared/flags/'+hash+'.webp';
 await fs.mkdir(path.dirname(path.join(assets,file)),{recursive:true});await fs.writeFile(path.join(assets,file),bytes);textures[team]={path:file,sha256:hash,source:row.path};
}
await fs.writeFile(path.join(repo,'packages/foxhole-world/authoring/native-flag-textures.json'),JSON.stringify({version:1,textures},null,2)+'\n');
console.log(JSON.stringify(textures,null,2));
