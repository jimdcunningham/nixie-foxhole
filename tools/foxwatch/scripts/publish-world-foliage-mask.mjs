import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {packFoliageAlpha} from '../../../packages/foxhole-world/prepare-foliage-alpha.mjs';
import {nativeCutoutRules} from '../../../packages/foxhole-world/authoring/native-cutout-rules.mjs';
const repo=path.resolve(import.meta.dirname,'../../..'),require=createRequire(path.join(repo,'packages/foxhole-world/package.json')),sharp=require('sharp');
const get=name=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1];};
const input=get('--input'),nativeTextures=get('--native-textures');
if(Boolean(input)===Boolean(nativeTextures))throw Error('Pass --input with a focused material export or --native-textures with an extracted texture root.');
const assets=get('--assets')||path.join(repo,'packages/extensions/foxhole/public/foxhole/assets');
const names=(get('--materials')??'BirchBushSmall').split(',');
const rules=names.map(name=>{
    const rule=nativeCutoutRules.find(rule=>path.basename(rule.material,'.uasset')===name);
    if(!rule)throw Error('Unknown native cutout material '+name);
    return rule;
});
const rows=input?JSON.parse(await fs.readFile(path.join(input,'material-source.json'),'utf8')):[];
const read=async name=>{
    if(nativeTextures)return fs.readFile(path.join(nativeTextures,name.replace(/^War\/Content\//,'').split('.')[0]+'.png'));
    const row=rows.find(r=>r.path===name);
    if(!row)throw Error('Missing native texture '+name);
    return fs.readFile(path.join(input,row.file));
};
const descriptor=path.join(repo,'packages/foxhole-world/authoring/native-foliage-masks.json');
const {materials}=JSON.parse(await fs.readFile(descriptor,'utf8'));
const byMaterial=new Map(materials.map(row=>[row.material,row]));
for(const {material,albedo,source,channel,cutoff,resizeMask} of rules){
    const rgba=await packFoliageAlpha(await read(albedo),await read(source),channel,resizeMask);
    const bytes=await sharp(rgba).webp({lossless:true}).toBuffer(),hash=createHash('sha256').update(bytes).digest('hex');
    const resource={path:'content/raw/'+hash+'/asset.webp',hash,decodedHash:hash,bytes:bytes.length};
    const file=path.join(assets,'world',resource.path);
    await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(file,bytes);
    byMaterial.set(material,{material,albedo,source,channel:'RGBA'[channel],cutoff,resource});
}
await fs.writeFile(descriptor,JSON.stringify({version:1,materials:[...byMaterial.values()]},null,2)+'\n');
console.log(JSON.stringify(rules.map(rule=>byMaterial.get(rule.material)),null,2));
