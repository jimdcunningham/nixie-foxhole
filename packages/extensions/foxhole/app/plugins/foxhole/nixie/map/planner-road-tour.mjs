const clonePose=pose=>({position:{...pose.position},target:{...pose.target}});
export const nativeTourPose=(pose,position)=>({position:[(pose.position.x-position.x)/32,pose.position.z/32,(pose.position.y+position.y)/32],target:[(pose.target.x-position.x)/32,pose.target.z/32,(pose.target.y+position.y)/32]});
export const plannerTourPose=(pose,position)=>{const convert=p=>({x:p[0]*32+position.x,y:p[2]*32-position.y,z:p[1]*32});return{position:convert(pose.position),target:convert(pose.target)};};

/** Camera automation publishes control availability only. Frame/route telemetry
 * belongs to canvas diagnostics and never invalidates the sidebar during a tour. */
export function createPlannerRoadTour({canvas,getRegions,getOptions,readPose,writePose,setCameraShake,viewMode,onStatus,hidden=()=>document.hidden,now=()=>performance.now()}){
 let tour=null,record=null,saved=null,generation=0,loading=false,error=null,lastUi=-Infinity,disposed=false,published=null,shaking=false,lastShakeStrength=null;
 const liveRecord=()=>record&&getRegions().some(r=>r.id===record.id&&r.scene===record.scene);
 function publish(force=false){const time=now();if(!force&&time-lastUi<500)return;lastUi=time;
  const regions=getRegions(),canRun=viewMode()==='3d'&&readPose()?.projection==='perspective'&&regions.length>0,state=loading?'loading':tour?.state||'idle',region=record?.id||'',canRestore=!!saved,canShake=viewMode()==='3d'&&typeof setCameraShake==='function';
  const same=published&&published.canRun===canRun&&published.canShake===canShake&&published.shaking===shaking&&published.state===state&&published.region===region&&published.error===error&&published.canRestore===canRestore&&published.regions.length===regions.length&&regions.every((r,i)=>published.regions[i].id===r.id&&published.regions[i].label===(r.label||r.id));
  if(same)return;
  published={attached:true,canRun,canShake,shaking,regions:regions.map(r=>({id:r.id,label:r.label||r.id})),state,region,error,canRestore};onStatus(published);
 }
 function syncShake(){const strength=shaking?1:0;if(strength!==lastShakeStrength){lastShakeStrength=strength;setCameraShake?.(strength);}}
 function stopShake(){if(!shaking)return;shaking=false;syncShake();publish(true);}
 function toggleCameraShake(){if(disposed||viewMode()!=='3d'||!setCameraShake)return;shaking=!shaking;syncShake();publish(true);}
 function pause(){if(loading){stop();return;}if(tour?.state==='running'){tour.pause();writePose(null);publish(true);}}
 function stop(restore=false){generation++;loading=false;tour?.stop();tour=null;record=null;writePose(null);if(restore&&saved){writePose(saved);writePose(null);saved=null;}publish(true);}
 async function start(){
  if(disposed||loading)return;if(tour?.state==='running'){pause();return;}
  const pose=readPose();if(viewMode()!=='3d'||pose?.projection!=='perspective'){error='Switch to 3D perspective to start the road tour.';publish(true);return;}
  if(tour?.state==='paused'&&liveRecord()){tour.start(nativeTourPose(pose,record.position));writePose(plannerTourPose(tour.pose,record.position));publish(true);return;}
  const options=getOptions(),regions=getRegions(),requested=regions.find(r=>r.id===options.region);
  const selected=requested||regions.toSorted((a,b)=>Math.hypot(pose.target.x-a.position.x,pose.target.y+a.position.y)-Math.hypot(pose.target.x-b.position.x,pose.target.y+b.position.y))[0];
  if(!selected){error='Wait for selected region terrain to become ready.';publish(true);return;}
  const token=++generation;loading=true;error=null;record=selected;saved=clonePose(pose);publish(true);
  try{const next=await selected.scene.createRoadTour();if(disposed||token!==generation)return;if(!liveRecord()){stop();return;}
   const current=readPose();if(!current||viewMode()!=='3d'){stop();return;}tour=next;tour.speed=options.speed;tour.view=options.view;
   if(!tour.start(nativeTourPose(current,selected.position))){tour=null;error='No connected road route is available in this region.';}else writePose(plannerTourPose(tour.pose,selected.position));
  }catch(reason){if(token===generation){tour=null;error=reason instanceof Error?reason.message:String(reason);}}
  finally{if(token===generation){loading=false;publish(true);}}
 }
 function next(){if(tour&&liveRecord()){const pose=readPose();if(pose){tour.next(nativeTourPose(pose,record.position));writePose(plannerTourPose(tour.pose,record.position));publish(true);}}else void start();}
 const escape=e=>{if(e.key==='Escape'&&(shaking||loading||tour?.state==='running'||tour?.state==='paused')){stopShake();stop();}};
 canvas.addEventListener('nixie-camera-navigation',pause);canvas.addEventListener('pointerdown',pause,{capture:true});canvas.addEventListener('wheel',pause,{capture:true,passive:true});const keyboard=canvas.ownerDocument||canvas;keyboard.addEventListener('keydown',escape);
 publish(true);
 return {start,pause,next,toggleCameraShake,stop:()=>stop(),restore:()=>stop(true),
  diagnostics(){const s=tour?.snapshot?.(),shake=shaking?['camera: handheld motion']:[];return [...shake,...(loading?['tour: preparing native roads']:s?[`tour:${tour.state}  route:${s.routeNumber}  ${Math.round(s.routeProgressMetres||0)}/${Math.round(s.routeMetres||0)} m  ${s.phase}`]:[])];},
  update(deltaMS){if(disposed)return;if(shaking&&viewMode()!=='3d')stopShake();syncShake();if((loading||tour)&&(!liveRecord()||viewMode()!=='3d'||readPose()?.projection!=='perspective')){stop();return;}if(hidden()){publish();return;}if(tour?.state==='running'){
    const options=getOptions();tour.speed=options.speed;tour.view=options.view;if(options.view!=='variety')tour.viewStyle=options.view;
    const pose=tour.update(deltaMS/1000);if(pose)writePose(plannerTourPose(pose,record.position));
   }publish();},
  destroy(){if(disposed)return;stopShake();stop();disposed=true;canvas.removeEventListener('nixie-camera-navigation',pause);canvas.removeEventListener('pointerdown',pause,{capture:true});canvas.removeEventListener('wheel',pause,{capture:true});keyboard.removeEventListener('keydown',escape);}
 };
}
