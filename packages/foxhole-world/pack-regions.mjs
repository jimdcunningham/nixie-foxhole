import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';

/** Pack by actual region membership so a first region never downloads unrelated content. */
export async function packBakedRegions(root,{limit=8*1024*1024}={}){
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),index=JSON.parse(await fs.readFile(path.join(root,'index.json'),'utf8')),scenes=new Map(),membership=new Map();
 const references=value=>{const result=[];const visit=v=>{if(!v||typeof v!=='object')return;if(v.path?.startsWith('blobs/')&&v.hash&&Number.isSafeInteger(v.bytes))result.push(v);for(const [key,child]of Object.entries(v))if(key!=='pack')visit(child);};visit(value);return result;};
 for(const [id,entry]of Object.entries(index.regions)){
  const encoded=await fs.readFile(path.join(root,entry.manifest.path));if(hash(encoded)!==entry.manifest.hash)throw Error('Invalid region manifest');
  const scene=JSON.parse(gunzipSync(encoded));scenes.set(id,scene);
  for(const ref of references(scene)){let item=membership.get(ref.path);if(!item){item={...ref,regions:new Set()};membership.set(ref.path,item);}item.regions.add(id);}
 }
 const groups=new Map();for(const ref of membership.values()){const key=[...ref.regions].sort().join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(ref);}
 const lookup=new Map();await fs.mkdir(path.join(root,'packs'),{recursive:true});
 for(const group of groups.values()){
  group.sort((a,b)=>a.path.localeCompare(b.path));let chunk=[],bytes=0;
  const flush=async()=>{if(!chunk.length)return;const buffers=await Promise.all(chunk.map(async ref=>{const bytes=await fs.readFile(path.join(root,ref.path));if(bytes.length!==ref.bytes||hash(bytes)!==ref.hash)throw Error('Invalid baked resource');return bytes;})),buffer=Buffer.concat(buffers),digest=hash(buffer),pack={path:'packs/'+digest+'.bin',hash:digest,bytes:buffer.length};
   await fs.writeFile(path.join(root,pack.path),buffer);let offset=0;for(const ref of chunk){lookup.set(ref.path,{pack,offset});offset+=ref.bytes;}chunk=[];bytes=0;};
  for(const ref of group){if(bytes&&bytes+ref.bytes>limit)await flush();chunk.push(ref);bytes+=ref.bytes;}await flush();
 }
 for(const [id,scene]of scenes){
  const resources=new Map();for(const ref of references(scene)){const packed=lookup.get(ref.path);Object.assign(ref,packed);resources.set(packed.pack.path,packed.pack);}
  const encoded=gzipSync(Buffer.from(JSON.stringify(scene)),{level:9}),digest=hash(encoded),manifest={path:'blobs/'+digest+'.json.gz',hash:digest,bytes:encoded.length};await fs.writeFile(path.join(root,manifest.path),encoded);resources.set(manifest.path,manifest);
  index.regions[id]={...index.regions[id],manifest,resources:[...resources.values()],downloadBytes:[...resources.values()].reduce((sum,r)=>sum+r.bytes,0)};
 }
 const unique=new Map();for(const entry of Object.values(index.regions))for(const resource of entry.resources)unique.set(resource.path,resource);
 index.bytes=[...unique.values()].reduce((sum,ref)=>sum+ref.bytes,0);index.packed=true;
 const temp=path.join(root,'index.'+process.pid+'.tmp');await fs.writeFile(temp,JSON.stringify(index));await fs.rename(temp,path.join(root,'index.json'));
 return {regions:scenes.size,resources:unique.size,bytes:index.bytes};
}
