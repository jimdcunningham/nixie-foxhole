import fs from 'node:fs/promises';
import path from 'node:path';
import {createReadStream} from 'node:fs';
const mime={'.json':'application/json','.gltf':'model/gltf+json','.glb':'model/gltf-binary','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.cubemap':'application/json'};
const validRegion=id=>typeof id==='string'&&/^[a-z0-9]+$/.test(id);
export async function createPreparedSource(root){
 root=await fs.realpath(root);const viewer=path.join(root,'viewer');
 const dependencies=JSON.parse(await fs.readFile(path.join(viewer,'dependency-bundles/manifest.json'),'utf8'));
 const recipes=JSON.parse(await fs.readFile(path.join(viewer,'recipe-rollout/manifest.json'),'utf8'));
 async function send(req,res,file,headers={}){
  file=await fs.realpath(file);if(!file.startsWith(root+path.sep))throw Error('Resource outside prepared source');const stat=await fs.stat(file);
  res.writeHead(200,{'Content-Length':stat.size,'Cache-Control':'public, max-age=31536000, immutable','Content-Type':mime[path.extname(file)]||'application/octet-stream',...headers});
  if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);
 }
 return async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),name=url.pathname;
  if(name==='/__asset_ab/manifest'){const id=url.searchParams.get('region');if(!validRegion(id))throw Error('Invalid region');await send(req,res,path.join(viewer,'dependency-bundles/regions',id+'.json'),{'Content-Type':'application/json','Cache-Control':'no-cache'});return true;}
  const delivery=name.match(/^\/__delivery_blob\/([a-f0-9]{64})\/asset(\.[a-z0-9]+)$/);
  if(delivery){const row=dependencies.blobs[delivery[1]],entry=row?.entry;if(!entry)throw Error('Undeclared prepared resource');const file=entry.dependencyFile?path.resolve(viewer,entry.dependencyFile):path.join(root,'blobs',delivery[1]);let type=mime[delivery[2]]||'application/octet-stream';if(delivery[2]==='.png'){const handle=await fs.open(file,'r'),head=Buffer.alloc(4);try{await handle.read(head,0,4,0);}finally{await handle.close();}type=head.toString()==='RIFF'?'image/webp':'image/png';}await send(req,res,file,{'Content-Type':type,'X-Asset-Codec':entry.codec,...(entry.codec.includes('brotli')?{'Content-Encoding':'br'}:{})});return true;}
  const index=name.match(/^\/__recipe_index\/([a-z0-9]+)$/);if(index){await send(req,res,path.join(viewer,'recipe-rollout/regions',index[1]+'.json'));return true;}
  const recipe=name.match(/^\/__recipe_content\/([a-f0-9]{64})$/);if(recipe){const entry=recipes.content[recipe[1]];if(!entry)throw Error('Undeclared recipe');await send(req,res,path.resolve(viewer,entry.file),{'Content-Type':entry.json?'application/json':'application/octet-stream','Content-Encoding':'br'});return true;}
  const pack=name.match(/^\/__dependency_pack\/([a-f0-9]{64})\.json$/);if(pack){await send(req,res,path.join(viewer,'dependency-bundles/packs',pack[1]+'.json'));return true;}
  return false;
 };
}
