import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {worldModelLayer} from './authoring/world-model-layers.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const contentPath=/^content\/(br|raw)\/([a-f0-9]{64})\/asset\.[a-z0-9]+$/;
const dependencies=text=>[...text.matchAll(/(?:\.\.\/\.\.\/|content\/)(br|raw)\/([a-f0-9]{64})\/asset(\.[a-z0-9]+)/g)].map(m=>`content/${m[1]}/${m[2]}/asset${m[3]}`);
export async function bundleCompactWorld({source,target,regions=['deadlands'],decodedBudget=4*1024**2,onProgress=()=>{}}){
 if(!source||!target||!Number.isSafeInteger(decodedBudget)||decodedBudget<1||decodedBudget>4*1024**2)throw Error('Invalid compact bundle configuration');
 source=await fs.realpath(source);target=path.resolve(target);
 // Resolve existing ancestors before creating anything, including junction aliases.
 let ancestor=target;const tail=[];for(;;){try{ancestor=await fs.realpath(ancestor);break;}catch(error){if(error.code!=='ENOENT')throw error;tail.unshift(path.basename(ancestor));ancestor=path.dirname(ancestor);}}
 target=path.join(ancestor,...tail);const relative=path.relative(source,target);
 if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('Bundle candidates must use a separate output directory outside the source');
 const index=JSON.parse(await fs.readFile(path.join(source,'index.json'))),selected=new Set(regions==='all'||regions.length===1&&regions[0]==='all'?Object.keys(index.regions):regions);
 if(!selected.size||[...selected].some(id=>!index.regions[id]))throw Error('Select valid compact bundle regions');
 await fs.mkdir(target,{recursive:true});if((await fs.readdir(target)).length)throw Error('Bundle candidate output directory must be empty');
 const records=new Map(),manifests=new Map();
 const read=async ref=>{if(!contentPath.test(ref.path)||!ref.path.includes(ref.hash))throw Error('Invalid world source');const encoded=await fs.readFile(path.join(source,ref.path));if(encoded.length!==ref.bytes||sha(encoded)!==ref.hash)throw Error('World source receipt differs');const bytes=ref.encoding==='br'?brotliDecompressSync(encoded):encoded;if(sha(bytes)!==ref.decodedHash)throw Error('World decoded receipt differs');return bytes;};
 const json=async ref=>JSON.parse(await read(ref));
 for(const [id,entry] of Object.entries(index.regions)){
  const manifest=await json(entry.manifest);if(manifest.bundles)throw Error('Prepare bundles from the canonical unbundled index');
  const local=new Map();for(const ref of manifest.physicalResources){let record=records.get(ref.path);if(!record){record={ref,regions:new Set(),roles:new Set(),dependencies:null};records.set(ref.path,record);}else if(record.ref.decodedHash!==ref.decodedHash)throw Error('Conflicting world receipt');record.regions.add(id);local.set(ref.path,record);}
  const modelRoles=new Map(),addModel=(name,role)=>{if(!name)return;const absolute=manifest.resources[name]?name:id+'/'+name;let set=modelRoles.get(absolute);if(!set){set=new Set();modelRoles.set(absolute,set);}set.add(role);};
  const world=manifest.resources[id+'/world.json'];const lod=manifest.resources[id+'/lod-manifest.json'];
  if(world?.resource){const data=await json(world.resource),levels=lod?.resource?(await json(lod.resource)).assets:{};for(const proto of data.prototypes||[]){const role='models:'+worldModelLayer(proto);addModel(proto.file,role+':base');for(const level of levels[proto.file]?.levels||[])addModel(level.file,role+':lod'+level.index);}}
  const tags=new Map(),tag=(ref,role)=>{if(!ref?.path||!local.has(ref.path))return;let set=tags.get(ref.path);if(!set){set=new Set();tags.set(ref.path,set);}for(const value of Array.isArray(role)?role:[role])set.add(value);};
  for(const [name,resource] of Object.entries(manifest.resources)){
   const logical=name.startsWith(id+'/')?name.slice(id.length+1):name;let role;
   if(modelRoles.has(name))role=[...modelRoles.get(name)];
   else if(/^terrain-live\/weather\//.test(logical))role='weather';
   else if(/^terrain-live\//.test(logical))role='terrain:'+(/normal-/.test(logical)?'normal':/albedo-/.test(logical)?'color':'weights');
   else if(/^terrain(?:\.|-)/.test(logical))role='terrain:geometry';
   else if(/^(?:roads\/|world-fixes\/(?:details|decals|rails|road-shoulders)\/)/.test(logical))role='roads';
   else if(/^(?:water-source\/|water-graph\/|water-)/.test(logical))role='water';
   else if(/^(?:weather\/|terrain-live\/weather\/)/.test(logical))role='weather';
   else if(/^sky-source\//.test(logical))role='sky';
   // Unknown resources stay independent instead of crossing a layer boundary.
   if(!role)continue;
   tag(resource.resource,role);
   for(const slice of resource.slices||[]){tag(slice.resource,Array.isArray(role)?role:role+':full');for(const [tier,variant] of Object.entries(slice.tiers||{}))tag(variant.resource,Array.isArray(role)?role:role+':tier'+tier);}
  }
  for(const group of Object.values(manifest.recipes||{}))for(const ref of Object.values(group.parts||{}))tag(ref,'roads');
  // Propagate layer ownership through rewritten glTF/cubemap dependencies.
  const queue=[...tags.keys()];for(let at=0;at<queue.length;at++){const file=queue[at],record=local.get(file),roles=tags.get(file);if(/\.(json|gltf|cubemap)$/.test(file)&&record.dependencies===null)record.dependencies=dependencies((await read(record.ref)).toString());for(const child of record.dependencies||[]){if(!local.has(child))throw Error('Undeclared bundle dependency');const before=tags.get(child)?.size||0;tag(local.get(child).ref,[...roles]);if(tags.get(child).size>before)queue.push(child);}}
  for(const [file,roles] of tags)for(const role of roles)local.get(file).roles.add(role);
  if(selected.has(id))manifests.set(id,{manifest,entry});onProgress({phase:'classify-bundles',region:id});
 }
 const groups=new Map();for(const record of records.values()){
  if(!record.roles.size||![...record.regions].some(id=>selected.has(id)))continue;
  const owners=[...record.regions].sort(),identity=JSON.stringify([owners.length===1?['only',owners[0]]:['shared',owners[0]],[...record.roles].sort()]);let group=groups.get(identity);if(!group){group=[];groups.set(identity,group);}group.push(record);
 }
 const stored=new Map(),copied=new Set();
 const store=async(bytes,extension='.bin')=>{const decodedHash=sha(bytes),key=decodedHash+extension;if(stored.has(key))return stored.get(key);const encoded=brotliCompressSync(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:5}}),hash=sha(encoded),relative=`content/br/${hash}/asset${extension}`,file=path.join(target,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,encoded);const ref={path:relative,hash,bytes:encoded.length,encoding:'br',decodedHash,decodedBytes:bytes.length};stored.set(key,ref);return ref;};
 const candidate={...index,regions:{}};
 for(const [id,{manifest,entry}] of [...manifests].sort(([a],[b])=>a.localeCompare(b))){
  const chosen=[];
  // Pack only this region's closure. A shared ownership family is not permission
  // to fetch other regions' resources. Identical archives still deduplicate.
  for(const [identity,allRecords] of [...groups].sort(([a],[b])=>a.localeCompare(b))){let rows=[],size=0;
   const flush=async()=>{if(rows.length>1){const bytes=Buffer.concat(rows.map(r=>r.bytes));let offset=0;const entries=rows.map(({record,bytes})=>{const entry={path:record.ref.path,decodedHash:record.ref.decodedHash,encoding:record.ref.encoding||'raw',offset,bytes:bytes.length};offset+=bytes.length;return entry;});chosen.push({resource:await store(bytes),entries,usage:JSON.parse(identity),regions:[...rows[0].record.regions].filter(region=>rows.every(r=>r.record.regions.has(region))).sort()});}rows=[];size=0;};
   for(const record of allRecords.filter(r=>r.regions.has(id)).sort((a,b)=>[...a.regions].sort().join().localeCompare([...b.regions].sort().join())||a.ref.path.localeCompare(b.ref.path))){const encoded=await fs.readFile(path.join(source,record.ref.path));if(encoded.length!==record.ref.bytes||sha(encoded)!==record.ref.hash)throw Error('Changed bundle input');let bytes;try{bytes=record.ref.encoding==='br'?brotliDecompressSync(encoded,{maxOutputLength:decodedBudget}):encoded;}catch(error){if(error.code==='ERR_BUFFER_TOO_LARGE')continue;throw error;}if(bytes.length>decodedBudget)continue;if(sha(bytes)!==record.ref.decodedHash)throw Error('Changed decoded bundle input');if(size&&size+bytes.length>decodedBudget)await flush();rows.push({record,bytes});size+=bytes.length;}await flush();
  }
  manifest.bundles={version:1,decodedBudget,groups:chosen};
  for(const ref of [entry.manifest,...manifest.physicalResources]){if(copied.has(ref.path))continue;const output=path.join(target,ref.path);await fs.mkdir(path.dirname(output),{recursive:true});await fs.copyFile(path.join(source,ref.path),output);copied.add(ref.path);}
  const physical=new Map(manifest.physicalResources.map(ref=>[ref.path,ref]));for(const group of chosen)physical.set(group.resource.path,group.resource);manifest.physicalResources=[...physical.values()];
  const receipt=await store(Buffer.from(JSON.stringify(manifest)),'.json'),packed=new Set(chosen.flatMap(group=>group.entries.map(e=>e.path)));
  candidate.regions[id]={...entry,manifest:receipt,downloadBytes:receipt.bytes+manifest.physicalResources.reduce((n,r)=>n+r.bytes,0),bundleDownloadBytes:receipt.bytes+manifest.physicalResources.filter(r=>!packed.has(r.path)).reduce((n,r)=>n+r.bytes,0)};
  onProgress({phase:'bundled-region',region:id,bundles:chosen.length,bundledResources:packed.size,standaloneResources:manifest.physicalResources.length-chosen.length-packed.size,encodedBytes:candidate.regions[id].bundleDownloadBytes});
 }
 await fs.writeFile(path.join(target,'index.json'),JSON.stringify(candidate));return candidate;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const get=name=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1];};
 await bundleCompactWorld({source:get('--source'),target:get('--target'),regions:(get('--regions')||'deadlands').split(','),onProgress:value=>console.log(JSON.stringify(value))});
}
