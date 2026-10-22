import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Adopt immutable compact inputs into FoxWatch's cache, without re-extraction or duplicate disk blocks. */
export async function adoptPreparedSource(source,target){
 source=await fs.realpath(source);const sourceRoot=path.dirname(source);target=path.resolve(target);
 if(source===target||target.startsWith(source+path.sep))throw Error('Prepared adoption requires a separate directory');
 const dependencyBytes=await fs.readFile(path.join(source,'dependency-bundles/manifest.json')),recipeBytes=await fs.readFile(path.join(source,'recipe-rollout/manifest.json'));
 const manifest=JSON.parse(dependencyBytes),recipes=JSON.parse(recipeBytes);
 await fs.mkdir(path.join(target,'blobs'),{recursive:true});
 for(const section of ['dependency-bundles','recipe-rollout']){
  await fs.mkdir(path.join(target,'viewer',section),{recursive:true});
  await fs.cp(path.join(source,section,'regions'),path.join(target,'viewer',section,'regions'),{recursive:true});
 }
 await fs.writeFile(path.join(target,'viewer/dependency-bundles/manifest.json'),dependencyBytes);
 await fs.writeFile(path.join(target,'viewer/recipe-rollout/manifest.json'),recipeBytes);
 let linkedBytes=0,copiedBytes=0,reusedBytes=0,resources=0;
 async function adopt(file,dest,expected,bytes){
  const actual=await fs.realpath(file);if(!actual.startsWith(sourceRoot+path.sep)||!dest.startsWith(target+path.sep))throw Error('Unsafe prepared resource');
  const raw=await fs.readFile(actual);if(raw.length!==bytes||hash(raw)!==expected)throw Error('Prepared resource integrity failure: '+expected);
  try{const current=await fs.readFile(dest);if(hash(current)!==expected)throw Error('Existing adopted resource is corrupt');reusedBytes+=bytes;return;}catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.mkdir(path.dirname(dest),{recursive:true});
  try{await fs.link(actual,dest);linkedBytes+=bytes;}catch(error){if(!['EXDEV','EPERM','EACCES','ENOTSUP'].includes(error.code))throw error;await fs.copyFile(actual,dest);copiedBytes+=bytes;}
  resources++;
 }
 for(const [digest,row]of Object.entries(manifest.blobs)){
  // Expanded reference buffers are verified recipe baselines, not publication inputs.
  if(row.profiles?.length&&!row.profiles.some(p=>p==='initial'||p==='options'))continue;
  if(row.entry.recipeFile)continue;
  const e=row.entry,file=e.dependencyFile?path.resolve(source,e.dependencyFile):path.resolve(source,'../blobs',digest),dest=e.dependencyFile?path.resolve(target,'viewer',e.dependencyFile):path.join(target,'blobs',digest);
  await adopt(file,dest,digest,row.bytes);
 }
 for(const [digest,entry]of Object.entries(recipes.content))await adopt(path.resolve(source,entry.file),path.resolve(target,'viewer',entry.file),digest,entry.bytes);
 const result={version:1,regions:manifest.regions,resources,linkedBytes,copiedBytes,reusedBytes,dependencyHash:hash(dependencyBytes),recipeHash:hash(recipeBytes)};
 await fs.writeFile(path.join(target,'prepared-source.json'),JSON.stringify(result,null,2));return result;
}

