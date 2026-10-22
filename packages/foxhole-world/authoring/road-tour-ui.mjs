import {RoadTour,buildRoadNetwork,buildClearanceSampler} from './road-tour.mjs';
import {mapPoint} from './terrain-tools.mjs';
export function createRoadPreview({app,view,orbit,readContext,setMode,resetFrames,resumeRendering,beforeRun=()=>{}}){
 const $=id=>document.getElementById(id);let tour=null,labels=[],movingFrames=[],uiTime=0,setupMs=0;
 const pose=()=>({position:[view.camera.position.x,view.camera.position.y,view.camera.position.z],target:[orbit.target.x,orbit.target.y,orbit.target.z]});
 function snapshot(){if(!tour)return{state:'unavailable'};const s=tour.snapshot(),sorted=[...movingFrames].sort((a,b)=>a-b),mean=movingFrames.reduce((a,b)=>a+b,0)/Math.max(1,movingFrames.length);return{...s,movingFps:mean?1000/mean:null,movingP95Ms:sorted[Math.floor(sorted.length*.95)]??null,movingMaxMs:sorted.at(-1)??null,movingFrameSamples:movingFrames.length,setupMs};}
 function ui(force=false){const now=performance.now();if(!force&&now-uiTime<500)return;uiTime=now;const context=readContext(),state=tour?.state,blocked=context.busy||context.benchmarking||!tour;
  $('tourToggle').disabled=blocked;$('tourNext').disabled=blocked;$('tourStop').disabled=!tour||state==='idle';
  $('tourToggle').textContent=state==='running'&&!context.paused?'Pause Tour':state==='paused'||state==='running'?'Resume Tour':'Start Road Tour';
  if(!tour){$('tourReadout').textContent='Ready after the region loads.';return;}
  if(state==='idle'){$('tourReadout').textContent=`${(tour.network.info.roadMetres/1000).toFixed(1)} km of native road curves\nRandom routes · Smooth flyovers`;return;}
  const s=snapshot();let nearest=null,d=Infinity;for(const l of labels){const dx=l.point[0]-(s.target?.[0]??0),dz=l.point[1]-(s.target?.[2]??0),distance=dx*dx+dz*dz;if(distance<d){d=distance;nearest=l.text;}}
  const stateText=context.paused?'Rendering paused':state==='paused'?'Tour paused':s.phase==='flyover'?'Flying to the next road':'Following the road';
  $('tourReadout').textContent=`${stateText} · ${s.view[0].toUpperCase()+s.view.slice(1)}\nRoute ${s.routeNumber} · ${Math.round(s.routeProgressMetres)} / ${Math.round(s.routeMetres)} m\n${nearest?'Near '+nearest+' · ':''}${s.visitedAreas} areas visited\nTour ${s.movingFps?.toFixed(1)??'—'} FPS · p95 ${s.movingP95Ms?.toFixed(1)??'—'} ms`;
 }
 function suspendOrbit(){const before=pose(),damping=orbit.enableDamping;orbit.enabled=false;orbit.enableDamping=false;orbit.update();orbit.enableDamping=damping;view.camera.position.set(...before.position);orbit.target.set(...before.target);view.camera.lookAt({x:before.target[0],y:before.target[1],z:before.target[2]});}
 function pause(){if(tour?.state==='running'){tour.pause();orbit.enabled=true;setMode('road-tour-paused');ui(true);}}
 function stop(){tour?.stop();orbit.enabled=true;setMode('manual');ui(true);}
 function run(next=false){const context=readContext();if(!tour||context.busy||context.benchmarking)return;
  if(tour.state==='running'&&!next&&!context.paused){pause();return;}
  beforeRun();if(context.paused)resumeRendering();suspendOrbit();if(tour.state==='idle')movingFrames=[];
  tour.speed=+$('tourSpeed').value;tour.view=$('tourView').value;
  const success=next?tour.next(pose()):tour.state==='running'?true:tour.start(pose());
  if(!success){orbit.enabled=true;$('tourReadout').textContent='No connected road route is available.';return;}
  setMode('road-tour');resetFrames();ui(true);
 }
 $('tourToggle').onclick=()=>run();$('tourNext').onclick=()=>run(true);$('tourStop').onclick=stop;
 $('tourSpeed').onchange=()=>{if(tour)tour.speed=+$('tourSpeed').value;ui(true);};
 $('tourView').onchange=()=>{if(tour){tour.view=$('tourView').value;if(tour.view!=='variety')tour.viewStyle=tour.view;}ui(true);};
 app.canvas.addEventListener('pointerdown',pause,{capture:true});app.canvas.addEventListener('wheel',pause,{capture:true,passive:true});
 document.addEventListener('keydown',e=>{if(readContext().fixedCamera)return;if(e.target.closest?.('input,select,textarea,[contenteditable]'))return;if(e.code==='Space'&&!e.target.closest?.('button')){e.preventDefault();run();}else if(e.code==='KeyN'){e.preventDefault();run(true);}else if(e.code==='Escape'){e.preventDefault();stop();}});
 return{
  prepare(source,world,terrain,metadata){const start=performance.now(),network=buildRoadNetwork(source);tour=new RoadTour(network,{terrain,clearance:buildClearanceSampler(world.clearanceBatches||world.batches,terrain)});tour.speed=+$('tourSpeed').value;tour.view=$('tourView').value;labels=metadata.labels.filter(x=>x.mapMarkerType==='Major').map(x=>({text:x.text,point:mapPoint(x.x,x.y)}));movingFrames=[];setupMs=performance.now()-start;ui(true);},
  reset(){stop();tour=null;labels=[];movingFrames=[];ui(true);},stop,pause,refresh:()=>ui(true),snapshot,
  update(dt,frameMs){const context=readContext();if(tour?.state!=='running'){ui();return false;}if(context.busy||context.benchmarking||context.paused||document.hidden){ui();return true;}
   const p=tour.update(dt);if(p){view.camera.position.set(...p.position);orbit.target.set(...p.target);view.camera.lookAt({x:p.target[0],y:p.target[1],z:p.target[2]});}
   if(frameMs>0&&Number.isFinite(frameMs)){movingFrames.push(frameMs);if(movingFrames.length>900)movingFrames.shift();}ui();return true;
  }
 };
}
