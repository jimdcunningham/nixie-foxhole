import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
/** Stage only the reachable baked delivery set, then replace the root index last. */
export async function publishBakedWorld({source,target}){
 const index=JSON.parse(await fs.readFile(path.join(source,'index.json'),'utf8'));if(index.version!==1||!index.packed)throw Error('Only packed render-ready regions can be published');
 const resources=new Map();for(const entry of Object.values(index.regions))for(const resource of entry.resources)resources.set(resource.path,resource);
 for(const resource of resources.values()){
  if(!/^(blobs|packs)\/[a-f0-9]{64}\.(bin|json\.gz)$/.test(resource.path))throw Error('Unsafe world resource path');
  const bytes=await fs.readFile(path.join(source,resource.path)),hash=createHash('sha256').update(bytes).digest('hex');if(hash!==resource.hash||bytes.length!==resource.bytes)throw Error('World resource integrity failure');
  const destination=path.join(target,resource.path);await fs.mkdir(path.dirname(destination),{recursive:true});try{await fs.writeFile(destination,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;const existing=await fs.readFile(destination);if(createHash('sha256').update(existing).digest('hex')!==hash)throw Error('Existing immutable world resource is corrupt');}
 }
 await fs.mkdir(target,{recursive:true});const temporary=path.join(target,'index.'+process.pid+'.tmp');await fs.writeFile(temporary,JSON.stringify(index));await fs.rename(temporary,path.join(target,'index.json'));
 return {regions:Object.keys(index.regions).length,resources:resources.size,bytes:[...resources.values()].reduce((sum,r)=>sum+r.bytes,0)};
}
