import {RenderPassBit} from '@pixi/3d';

// Keep the full meshes; explicitly cull small batches which auto draws untested.

export function modelCullMode(mode,size){return mode==='balanced'?(size<=300?'cpu':'gpu'):mode;}

export function setModelCulling(world,mode){for(const b of world.batches)b.cull=modelCullMode(mode,b.size);}

export function modelCullSummary(world){

 const s={batches:0,parts:0,unculledAutoParts:0,unculledAutoTriangles:0,byProducer:{},note:'Resident counts and auto-bypass counts, not GPU survivors.'};

 for(const b of world?.batches||[]){s.batches++;s.parts+=b.size;s.byProducer[b.cull]=(s.byProducer[b.cull]||0)+b.size;for(const bit of [RenderPassBit.OPAQUE,RenderPassBit.TRANSPARENT]){const list=b.batch.drawLists[bit];if(!list||list.view.count>300)continue;s.unculledAutoParts+=list.view.count;for(let i=0;i<list.view.count;i++)s.unculledAutoTriangles+=list.view.items[list.view.indices[i]].geometry.indexBuffer.data.length/3;}}

 return s;

}

export function timingSummary(samples){const sorted=[...samples].sort((a,b)=>a-b);return{samples:samples.length,medianMs:sorted[Math.floor(sorted.length/2)]??null,p95Ms:sorted[Math.floor(sorted.length*.95)]??null};}

export function installPerformanceProbe({app,view,orbit,world,stats,setCulling,getCulling,resetFrames,status,save,ready,preview,setBusy}){

 const $=id=>document.getElementById(id),samples=[];let active=false,moving=false,elapsed=0,motionStart=0,base=null;

 const render=app.renderer.render.bind(app.renderer);app.renderer.render=(...args)=>{const t=performance.now();try{return render(...args);}finally{samples.push(performance.now()-t);if(samples.length>600)samples.shift();}};

 app.ticker.add(()=>{if(!moving)return;elapsed=(performance.now()-motionStart)/1000;const a=elapsed*.12,c=Math.cos(a),s=Math.sin(a),dx=base.position[0]-base.target[0],dz=base.position[2]-base.target[2];view.camera.position.set(base.target[0]+dx*c-dz*s,base.position[1],base.target[2]+dx*s+dz*c);view.camera.lookAt({x:base.target[0],y:base.target[1],z:base.target[2]});},null,5);

 $('culling').onchange=()=>{setCulling($('culling').value);resetFrames();};

 $('cullBench').onclick=async()=>{if(active||!ready())return;active=true;setBusy(true);$('cullBench').disabled=true;preview.stop();const previous=getCulling(),position=[view.camera.position.x,view.camera.position.y,view.camera.position.z],target=[orbit.target.x,orbit.target.y,orbit.target.z],results=[];orbit.enabled=false;

  try{for(const motion of [false,true])for(const mode of ['auto','balanced','cpu','gpu']){moving=false;view.camera.position.set(...position);view.camera.lookAt({x:target[0],y:target[1],z:target[2]});base={position,target};elapsed=0;motionStart=performance.now();$('culling').value=mode;setCulling(mode);moving=motion;status(`Measuring ${mode} culling · ${motion?'moving':'stationary'} camera…`);await new Promise(r=>setTimeout(r,1500));resetFrames();samples.length=0;await new Promise(r=>setTimeout(r,4500));results.push({name:`culling-${mode}-${motion?'moving':'stationary'}`,...stats()});$('results').textContent=results.map(r=>`${r.name}: ${r.fps.toFixed(1)} FPS · CPU ${r.renderCpu.medianMs?.toFixed(1)} ms`).join('\n');}await save('world',{results});status('Culling benchmark saved; camera and settings restored.');}

  finally{moving=false;active=false;setBusy(false);$('cullBench').disabled=false;$('culling').value=previous;setCulling(previous);view.camera.position.set(...position);orbit.target.set(...target);view.camera.lookAt({x:target[0],y:target[1],z:target[2]});orbit.enabled=true;resetFrames();}

 };

 $('cullValidate').onclick=async()=>{

  if(active||!ready())return;active=true;setBusy(true);preview.stop();$('cullValidate').disabled=true;const previous=getCulling();app.stop();

  try{const canvas=document.createElement('canvas');canvas.width=app.canvas.width;canvas.height=app.canvas.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});

   const capture=()=>{app.render();ctx.drawImage(app.canvas,0,0);return ctx.getImageData(0,0,canvas.width,canvas.height).data;};

   status('Comparing full drawing against frustum culling…');setCulling('off');const before=capture();setCulling(previous==='off'?'balanced':previous);const after=capture();let changed=0,maxDelta=0,totalDelta=0;for(let i=0;i<before.length;i+=4){let delta=0;for(let c=0;c<3;c++)delta=Math.max(delta,Math.abs(before[i+c]-after[i+c]));if(delta>3)changed++;maxDelta=Math.max(maxDelta,delta);totalDelta+=delta;}

   const result={name:'culling-image-validation',width:canvas.width,height:canvas.height,changedPixelsAbove3:changed,totalPixels:before.length/4,maxChannelDelta:maxDelta,meanMaxChannelDelta:totalDelta/(before.length/4),note:'Same camera, water time, full source meshes and shadow casters; only frustum culling changes. Canvas pixels exclude HTML controls.',...stats()};$('results').textContent=JSON.stringify({changedPixelsAbove3:changed,totalPixels:before.length/4,maxChannelDelta:maxDelta,meanMaxChannelDelta:result.meanMaxChannelDelta},null,2);await save('world',{results:[result]});status(`Culling image comparison: ${changed.toLocaleString()} pixels differ by more than 3/255.`);

  }catch(e){status('Culling comparison failed: '+e.message);console.error(e);}finally{setCulling(previous);app.start();active=false;setBusy(false);$('cullValidate').disabled=false;resetFrames();}

 };

 return{cpu:()=>timingSummary(samples),active:()=>active,reset:()=>{samples.length=0;}};

}

