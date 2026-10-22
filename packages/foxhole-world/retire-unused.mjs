import fs from 'node:fs/promises';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Explicit local bundle cleanup: quarantine old immutable content outside the served assets. */
export async function retireUnusedWorldContent({target,retired}){
 const root=await fs.realpath(target),destination=path.resolve(retired);
 if(destination===root||destination.startsWith(root+path.sep))throw Error('Retired content must be outside the served world directory');
 const index=JSON.parse(await fs.readFile(path.join(root,'index.json'),'utf8'));
 if(index.version!==1||index.format!=='compact-recipes-v1')throw Error('Unsupported world index');
 const live=new Set();
 for(const region of Object.values(index.regions)){
  if(!/^content\/br\/[a-f0-9]{64}\/asset\.json$/.test(region.manifest.path))throw Error('Invalid manifest path');
  const packed=await fs.readFile(path.join(root,region.manifest.path));if(sha(packed)!==region.manifest.hash)throw Error('Invalid region manifest');
  const manifest=JSON.parse(brotliDecompressSync(packed));
  for(const ref of [...manifest.physicalResources,region.manifest]){
   if(!/^content\/(br|raw)\/[a-f0-9]{64}\/asset\.[a-z0-9]+$/.test(ref.path))throw Error('Invalid content reference');
   live.add(ref.path);await fs.access(path.join(root,ref.path));
  }
 }
 const candidates=[];
 async function walk(directory){for(const entry of await fs.readdir(path.join(root,directory),{withFileTypes:true})){
  const relative=directory+'/'+entry.name;if(entry.isSymbolicLink())throw Error('Content directory contains a link');
  if(entry.isDirectory())await walk(relative);else if(!live.has(relative)){
   if(!/^content\/(br|raw)\/[a-f0-9]{64}\/asset\.[a-z0-9]+$/.test(relative))throw Error('Unexpected content filename');
   const actual=await fs.realpath(path.join(root,relative));if(!actual.startsWith(root+path.sep))throw Error('Content escapes world directory');
   candidates.push({relative,actual,bytes:(await fs.stat(actual)).size});
  }
 }}
 await walk('content');await fs.mkdir(path.dirname(destination),{recursive:true});await fs.mkdir(destination);
 for(const {relative,actual}of candidates){const output=path.join(destination,relative);await fs.mkdir(path.dirname(output),{recursive:true});await fs.rename(actual,output);}
 return {files:candidates.length,bytes:candidates.reduce((n,e)=>n+e.bytes,0),retired:destination};
}
