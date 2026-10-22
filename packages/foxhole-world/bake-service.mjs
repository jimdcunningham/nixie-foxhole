import http from 'node:http';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createBakeStore} from './bake-store.mjs';
import {createPreparedSource} from './prepared-source.mjs';
const mime={'.html':'text/html','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.gz':'application/octet-stream','.bin':'application/octet-stream','.png':'image/png','.webp':'image/webp'};
export async function startWorldBakeServer({input,output,port=0,sourceUrl}={}){
 const here=import.meta.dirname,store=createBakeStore(output),prepared=input?await createPreparedSource(input):null,states=new Map(),source=sourceUrl?new URL(sourceUrl):null;
 if(source&&!['127.0.0.1','localhost','[::1]'].includes(source.hostname))throw Error('Generation source must be local');
 async function file(req,res,file,root){file=await fs.realpath(file);root=await fs.realpath(root);if(!file.startsWith(root+path.sep))throw Error('Invalid viewer resource');const stat=await fs.stat(file),immutable=file.includes(path.sep+'content'+path.sep);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':immutable?'public, max-age=31536000, immutable':'no-cache',...(file.includes(path.sep+'content'+path.sep+'br'+path.sep)?{'Content-Encoding':'br'}:{})});if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);}
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');
   if(req.method==='POST'&&url.pathname.startsWith('/__bake/')){
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)throw Error('Foreign bake origin');
    const chunks=[];let length=0;for await(const part of req){length+=part.length;if(length>1024**3)throw Error('Bake resource exceeds limit');chunks.push(part);}const body=Buffer.concat(chunks);
    if(url.pathname==='/__bake/status'){const state=JSON.parse(body);if(!/^[a-z0-9]+$/.test(state.region))throw Error('Invalid region');states.set(state.region,state);res.end('ok');return;}
    const details=JSON.parse(url.searchParams.get('details')||'null');
    if(url.pathname==='/__bake/blob'&&details?.version!==3)throw Error('The bake capture version changed. Restart this capture.');
    const result=url.pathname==='/__bake/blob'?await store.blob(body,details):await store.region(JSON.parse(body));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return;
   }
   const name=url.pathname==='/world.html'?'world.html':url.pathname.startsWith('/ab-built/')?url.pathname.slice('/ab-built/'.length):null;
   if(name&&!name.includes('..')){try{await file(req,res,path.join(here,'dist',name),path.join(here,'dist'));return;}catch(e){if(e.code!=='ENOENT')throw e;}}
   if(url.pathname.startsWith('/world/')){await file(req,res,path.join(output,url.pathname.slice('/world/'.length)),output);return;}
   if(prepared&&await prepared(req,res))return;
   if(source){const upstream=await fetch(new URL(req.url,source));res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('Content-Type')||'application/octet-stream','Cache-Control':upstream.headers.get('Cache-Control')||'no-store'});res.end(Buffer.from(await upstream.arrayBuffer()));return;}
   res.writeHead(404);res.end('Undeclared generation resource');
  }catch(error){console.error(error);if(!res.headersSent)res.writeHead(500);res.end(String(error.stack||error));}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {server,states,url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}
