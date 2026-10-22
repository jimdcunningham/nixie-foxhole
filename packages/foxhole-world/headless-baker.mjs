import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/** Dedicated build worker profile; never attaches to the user's browser session. */
export async function startBakeBrowser({executable=process.env.FOXWATCH_CHROMIUM,profile}={}){
 const candidates=[executable,process.env.ProgramFiles&&path.join(process.env.ProgramFiles,'Google/Chrome/Application/chrome.exe'),process.env['ProgramFiles(x86)']&&path.join(process.env['ProgramFiles(x86)'],'Microsoft/Edge/Application/msedge.exe'),'/usr/bin/chromium','/usr/bin/google-chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
 executable=null;for(const file of candidates)if(await fs.stat(file).then(s=>s.isFile()).catch(()=>false)){executable=file;break;}
 if(!executable)throw Error('FoxWatch baking requires a Chromium executable. Set FOXWATCH_CHROMIUM on the generation worker.');
 const root=profile||await fs.mkdtemp(path.join(os.tmpdir(),'foxwatch-world-browser-'));await fs.mkdir(root,{recursive:true});
 const child=spawn(executable,['--headless=new','--remote-debugging-port=0','--user-data-dir='+root,'--no-first-run','--no-default-browser-check','--window-size=1280,720','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',data=>{stderr=(stderr+data).slice(-4000);});let launchError;child.on('error',error=>{launchError=error;});
 let port;
 for(let i=0;i<300;i++){if(launchError)throw launchError;if(child.exitCode!==null)throw Error('Bake browser exited: '+stderr);const file=await fs.readFile(path.join(root,'DevToolsActivePort'),'utf8').catch(()=>null);if(file){port=Number(file.split('\n')[0]);break;}await wait(100);}
 if(!port){child.kill();throw Error('Bake browser did not become ready');}
 const info=await fetch('http://127.0.0.1:'+port+'/json/version').then(r=>r.json()),socket=new WebSocket(info.webSocketDebuggerUrl),pending=new Map();let next=0;
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',({data})=>{const message=JSON.parse(data);if(!message.id)return;const entry=pending.get(message.id);if(!entry)return;pending.delete(message.id);if(message.error)entry.reject(Error(message.error.message));else entry.resolve(message.result);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 return {async open(url){const {targetId}=await send('Target.createTarget',{url,background:true});return ()=>send('Target.closeTarget',{targetId});},async close(){try{await send('Browser.close');}catch{}socket.close();if(child.exitCode===null)child.kill();if(!profile)await fs.rm(root,{recursive:true,force:true}).catch(()=>{});}};
}

export async function bakeRegions({service,regions,timeoutMs=30*60*1000,browser}){
 const results=[];
 for(const region of regions){
  const started=performance.now();service.states.delete(region);
  const url=new URL('/world.html',service.url);for(const [key,value]of Object.entries({region,backend:'webgl',assetVariant:'B',generationBake:'1'}))url.searchParams.set(key,value);
  const close=await browser.open(url.href);
  try{while(true){const state=service.states.get(region);if(state?.phase==='error')throw Error(region+': '+state.error);if(state?.phase==='complete'){results.push({...state,seconds:(performance.now()-started)/1000});break;}if(performance.now()-started>timeoutMs)throw Error(region+' exceeded its generation timeout');await wait(500);}}finally{await close();}
 }
 return results;
}
