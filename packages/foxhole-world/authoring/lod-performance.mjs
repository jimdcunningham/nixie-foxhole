export function installLodPerformance({app,view,orbit,preview,stats,ready,setBusy,resetFrames,resizeRendering,camera,status,save,refreshShadows}){
 const $=id=>document.getElementById(id);let active=false,sweep=null;
 app.ticker.add(()=>{if(!sweep)return;const a=(performance.now()-sweep.start)/1000*.12,c=Math.cos(a),s=Math.sin(a),dx=sweep.position[0]-sweep.target[0],dz=sweep.position[2]-sweep.target[2];view.camera.position.set(sweep.target[0]+dx*c-dz*s,sweep.position[1],sweep.target[2]+dx*s+dz*c);view.camera.lookAt({x:sweep.target[0],y:sweep.target[1],z:sweep.target[2]});},null,5);
 $('lodBench').onclick=async()=>{
  if(active||!ready())return;active=true;setBusy(true);preview.stop();$('lodBench').disabled=true;
  const previous={resolution:$('resolution').value,lod:$('lodMode').value,position:[view.camera.position.x,view.camera.position.y,view.camera.position.z],target:[orbit.target.x,orbit.target.y,orbit.target.z]},results=[];
  try{$('resolution').value='2';resizeRendering();for(const moving of [false,true])for(const name of ['overview','wide-forest'])for(const detail of ['full','native']){
   sweep=null;camera(name);orbit.enabled=false;$('lodMode').value=detail;refreshShadows();const position=[view.camera.position.x,view.camera.position.y,view.camera.position.z],target=[orbit.target.x,orbit.target.y,orbit.target.z];if(moving)sweep={position,target,start:performance.now()};
   status(`Measuring ${name} / ${detail} / ${moving?'moving':'stationary'} at 2560 x 1440…`);await new Promise(r=>setTimeout(r,1500));resetFrames();await new Promise(r=>setTimeout(r,4000));results.push({name:`lod-${name}-${detail}-${moving?'moving':'stationary'}`,...stats()});$('results').textContent=results.map(r=>`${r.name}: ${r.fps.toFixed(1)} FPS · ${(r.distanceLod.selectedTriangles/1e6).toFixed(1)}M candidate triangles`).join('\n');
  }await save('world',{results});status('Distance LOD benchmark saved; view and resolution restored.');}
  finally{sweep=null;$('resolution').value=previous.resolution;$('lodMode').value=previous.lod;resizeRendering();view.camera.position.set(...previous.position);orbit.target.set(...previous.target);view.camera.lookAt({x:previous.target[0],y:previous.target[1],z:previous.target[2]});orbit.enabled=true;refreshShadows();active=false;setBusy(false);$('lodBench').disabled=false;resetFrames();}
 };
 $('lodImage').onclick=async()=>{
  if(active||!ready())return;active=true;setBusy(true);preview.stop();const previous=$('lodMode').value;app.stop();
  try{const canvas=document.createElement('canvas');canvas.width=app.canvas.width;canvas.height=app.canvas.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});const capture=detail=>{$('lodMode').value=detail;refreshShadows();app.render();ctx.drawImage(app.canvas,0,0);return ctx.getImageData(0,0,canvas.width,canvas.height).data;};const full=capture('full'),native=capture('native');let changed=0,centerChanged=0,maxDelta=0;const x0=canvas.width*.25,x1=canvas.width*.75,y0=canvas.height*.25,y1=canvas.height*.75;
   for(let p=0;p<full.length/4;p++){const at=p*4,delta=Math.max(Math.abs(full[at]-native[at]),Math.abs(full[at+1]-native[at+1]),Math.abs(full[at+2]-native[at+2]));maxDelta=Math.max(maxDelta,delta);if(delta>3){changed++;const x=p%canvas.width,y=Math.floor(p/canvas.width);if(x>=x0&&x<x1&&y>=y0&&y<y1)centerChanged++;}}
   const result={name:'lod-image-comparison',changedPixelsAbove3:changed,centerChangedPixelsAbove3:centerChanged,totalPixels:full.length/4,maxChannelDelta:maxDelta,...stats()};$('results').textContent=JSON.stringify({changedPixelsAbove3:changed,centerChangedPixelsAbove3:centerChanged,totalPixels:full.length/4,maxChannelDelta:maxDelta},null,2);await save('world',{results:[result]});status(`LOD comparison: ${changed} changed pixels; ${centerChanged} in the center quarter.`);
  }finally{$('lodMode').value=previous;refreshShadows();app.start();active=false;setBusy(false);resetFrames();}
 };
 return{active:()=>active};
}
