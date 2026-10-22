import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
const repo=path.resolve(import.meta.dirname,'../../..'),require=createRequire(path.join(repo,'packages/foxhole-world/package.json')),sharp=require('sharp');
const get=name=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1];},input=get('--clouds');if(!input)throw Error('Pass --clouds with the native FX/Textures/CloudShapes PNG export.');
const bytes=await sharp(input).webp({lossless:true}).toBuffer(),hash=createHash('sha256').update(bytes).digest('hex'),file='shared/smoke/'+hash+'.webp',assets=get('--assets')||path.join(repo,'packages/extensions/foxhole/public/foxhole/assets');
await fs.mkdir(path.dirname(path.join(assets,file)),{recursive:true});await fs.writeFile(path.join(assets,file),bytes);
await fs.writeFile(path.join(repo,'packages/foxhole-world/authoring/native-smoke-texture.json'),JSON.stringify({version:1,path:file,sha256:hash,source:'War/Content/FX/Textures/CloudShapes.CloudShapes'},null,2)+'\n');console.log(file);
