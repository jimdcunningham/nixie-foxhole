import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {assignBlueprintMaterials,nativePuddleMaterial} from './blueprint-materials.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const key=value=>String(value||'').replaceAll('\\','/').toLowerCase();
export async function prepareBlueprintMaterials({input,native,regions,pak,importer,blueprints:selectedBlueprints}){
 const root=await fs.realpath(input),viewer=path.join(root,'viewer'),manifestFile=path.join(viewer,'dependency-bundles/manifest.json');
 const manifest=JSON.parse(await fs.readFile(manifestFile)),receipts=[];
 async function read(digest){
  const row=manifest.blobs[digest];if(!row)throw Error('Missing prepared dependency '+digest);
  const file=await fs.realpath(row.entry.dependencyFile?path.resolve(viewer,row.entry.dependencyFile):path.join(root,'blobs',digest));
  if(!file.startsWith(root+path.sep))throw Error('Prepared dependency escapes source');
  const bytes=await fs.readFile(file);if(bytes.length!==row.bytes||hash(bytes)!==digest)throw Error('Prepared dependency integrity failure');
  return row.entry.codec.includes('brotli')?brotliDecompressSync(bytes):bytes;
 }
 for(const name of (await fs.readdir(path.join(viewer,'dependency-bundles/regions'))).sort()){
  if(!name.endsWith('.json')||(regions&&!regions.includes(name.slice(0,-5))))continue;
  const file=path.join(viewer,'dependency-bundles/regions',name),receipt=JSON.parse(await fs.readFile(file)),logical=receipt.region+'/world.json';
  if(receipt.resources[logical])receipts.push({file,receipt,logical,world:JSON.parse(await read(receipt.resources[logical].blob))});
 }
 await fs.mkdir(native,{recursive:true});
 function probe(mode){const result=spawnSync('dotnet',[importer,pak,mode,native],{stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw Error('Native blueprint inspection failed');}
 if(pak){
  const names=[...new Set(receipts.flatMap(r=>r.world.prototypes.map(p=>p.name.split('/')[0]).filter(n=>n.endsWith('_C')).map(n=>n.slice(0,-2))))].filter(name=>!selectedBlueprints||selectedBlueprints.includes(name));
  await fs.writeFile(path.join(native,'blueprint-names.json'),JSON.stringify(names));probe('blueprint-materials');
 }
 const blueprints=JSON.parse(await fs.readFile(path.join(native,'blueprint-materials.json'))),byClass=new Map();
 for(const row of blueprints){const name=key(path.posix.basename(row.path,'.uasset')+'_C');if(byClass.has(name))throw Error('Ambiguous native blueprint '+name);byClass.set(name,row);}
 if(pak){const names=[...new Set(blueprints.flatMap(r=>r.components.flatMap(c=>c.MaterialOverrides||[])).map(m=>path.posix.basename(m.MaterialPath,'.uasset')))];await fs.writeFile(path.join(native,'material-names.json'),JSON.stringify(names));probe('materials');}
 const nativeRows=JSON.parse(await fs.readFile(path.join(native,'material-inspection.json'))).materials;
 const library=new Map(),documents=new Map();
 for(const {receipt}of receipts)for(const [logical,entry]of Object.entries(receipt.resources))if(logical.endsWith('.gltf')){
  if(documents.has(entry.blob))continue;const doc=JSON.parse(await read(entry.blob));documents.set(entry.blob,doc);
  for(const material of doc.materials||[])if(material.extras?.foxholeMaterialSource)library.set(key(material.extras.foxholeMaterialSource),{doc,material});
 }
 for(const row of nativeRows){const material=nativePuddleMaterial(row);if(material)library.set(key(row.path),{doc:{},material});}
 const added=new Map(),updates=[];let assignments=0,prototypes=0;
 async function store(bytes,logical,region,entry){
  const compressed=brotliCompressSync(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:6}}),digest=hash(compressed);
  await fs.writeFile(path.join(root,'blobs',digest),compressed,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  let row=added.get(digest);if(!row){row={bytes:compressed.length,regions:[],profiles:['initial'],ids:[],entry:{...entry,codec:'brotli',blob:digest,bytes:compressed.length,sourceHash:hash(bytes),dependencyFile:undefined,quality:6}};added.set(digest,row);}
  if(!row.ids.includes(logical))row.ids.push(logical);if(!row.regions.includes(region))row.regions.push(region);return row.entry;
 }
 for(const row of receipts){let changed=false;
  for(const prototype of row.world.prototypes){
   const slash=prototype.name.indexOf('/');if(slash<0||!prototype.file)continue;
   const blueprint=byClass.get(key(prototype.name.slice(0,slash))),component=blueprint?.components.find(c=>c.ComponentName===prototype.name.slice(slash+1)&&key(c.MeshPath)===key(prototype.path));
   if(!component?.MaterialOverrides?.length)continue;
   const original=row.receipt.region+'/'+prototype.file,entry=row.receipt.resources[original];if(!entry)throw Error('Missing blueprint prepared model '+original);
   const doc=structuredClone(documents.get(entry.blob)||JSON.parse(await read(entry.blob)));
   const count=assignBlueprintMaterials(doc,component.MaterialOverrides,source=>library.get(key(source)));if(!count)continue;
   // A component variant shares all original geometry/image URIs. Never replace
   // the mesh's default logical model, which other blueprints may still use.
   const bytes=Buffer.from(JSON.stringify(doc)),suffix=hash(bytes).slice(0,16),relative=prototype.file.replace(/(?:\.materials-[a-f0-9]+)?\.gltf$/,'.materials-'+suffix+'.gltf'),logical=row.receipt.region+'/'+relative;
   row.receipt.resources[logical]=await store(bytes,logical,row.receipt.region,entry);prototype.file=relative;
   prototype.materialAssignments=component.MaterialOverrides.map(m=>({index:m.Index,source:m.MaterialPath}));
   for(const assignment of component.MaterialOverrides){prototype.materials??=[];const material=library.get(key(assignment.MaterialPath)).material;prototype.materials[assignment.Index]={name:material.name,source:assignment.MaterialPath,diffuse:null,masked:material.alphaMode==='MASK'};}
   assignments+=count;prototypes++;changed=true;
  }
  if(changed){row.receipt.resources[row.logical]=await store(Buffer.from(JSON.stringify(row.world)),row.logical,row.receipt.region,row.receipt.resources[row.logical]);updates.push(row);}
 }
 if(updates.length){for(const [digest,row]of added)manifest.blobs[digest]=row;await fs.writeFile(manifestFile,JSON.stringify(manifest));for(const row of updates)await fs.writeFile(row.file,JSON.stringify(row.receipt));}
 return {regions:updates.map(r=>r.receipt.region),prototypes,assignments};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.join(import.meta.dirname,'prepare-blueprint-materials.mjs')){
 const args=process.argv.slice(2),get=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
 const input=get('--input'),native=get('--native');if(!input||!native)throw Error('Pass --input <prepared root> --native <inspection folder>');
 console.log(JSON.stringify(await prepareBlueprintMaterials({input,native,regions:get('--regions')?.split(','),blueprints:get('--blueprints')?.split(','),pak:get('--pak'),importer:get('--importer')||path.join(import.meta.dirname,'importer/bin/Debug/net8.0/Importer.dll')})));
}
