import {applyRegionFrame} from '../../runtime/spatial-frame.mjs';
import {Application} from 'pixi.js';
import {View3D,Camera3D,Container3D,Mesh3D,CubeGeometry,Material3D,AmbientLight,DirectionalLight,RenderPassBit} from '@pixi/3d';
import '@pixi/3d/webgpu';import '@pixi/3d/webgl';
import {createCompactProvider} from '../../runtime/compact-provider.mjs';
import {loadWorldModels} from '../../authoring/world-models.mjs';
import {prepareVegetationWindShadows} from '../../runtime/vegetation-wind-shadows.mjs';
import {createVegetationWind} from '../../authoring/vegetation-wind.mjs';
const status=document.querySelector('pre'),errors=[],backend=new URLSearchParams(location.search).get('backend')||'webgpu',framed=new URLSearchParams(location.search).get('frame')==='host';
try{
 let webgpu;if(backend==='webgpu'){const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice({requiredFeatures:['indirect-first-instance']});device.addEventListener('uncapturederror',e=>errors.push(e.error.message));webgpu={gpu:{adapter,device}};}
 const app=new Application();await app.init({width:900,height:650,preference:backend,antialias:true,autoStart:false,webgpu,background:0x56604d});document.body.append(app.canvas);
 const view=new View3D({width:900,height:650,camera:new Camera3D({near:framed?3.2:.1,far:framed?2560:80,fov:40}),toneMapping:'aces',environment:{skyColor:0xe2e4cf,groundColor:0x535b40,intensity:.6},shadowQuality:'medium'});app.stage.addChild(view);prepareVegetationWindShadows(view);view.camera.position.set(3.7,2.8,5);view.camera.lookAt({x:0,y:1,z:0});
 view.root.addChild(new AmbientLight({intensity:.3}));const sun=new DirectionalLight({castShadow:true,intensity:3});sun.position.set(6,10,5);sun.lookAt({x:0,y:0,z:0});view.root.addChild(sun);
 const ground=new Mesh3D({geometry:new CubeGeometry({width:15,height:.1,depth:15}),material:new Material3D({baseColor:0x8a8663,roughness:1})});ground.position.y=-.1;view.root.addChild(ground);
 const base=new URL('/world/',location.href),index=await fetch(new URL('index.json',base)).then(r=>r.json()),provider=await createCompactProvider({baseUrl:base.href,entry:index.regions.terminus,signal:new AbortController().signal}),data=await provider.json('terminus/world.json'),native=data.prototypes.find(p=>p.name==='Bush01');
 if(!native)throw Error('Missing representative native bush');const wind=createVegetationWind(framed?{frame:{scale:32}}:{}),root=new Container3D();view.root.addChild(root);
 const world=await loadWorldModels({region:'terminus',root,windMaterials:wind,worldData:{prototypes:[{...native,placements:Array.from({length:49},(_,i)=>({matrix:[1,0,0,0,0,1,0,0,0,0,1,0,(i%7-3)*3,0,(Math.floor(i/7)-3)*3,1]}))}]},visibilityData:data,optimize:false,status(){},json:provider.json,assetUrl:provider.url,loadModel:provider.model,teamAt:()=> 'NONE'});
 if(world.counts.failed.length)throw Error(JSON.stringify(world.counts.failed));
 if(framed){const board=new Container3D();view.root.addChild(board);board.addChild(root,ground);sun.position.set(192,160,320);sun.lookAt({x:0,y:0,z:0},{x:0,y:0,z:1});applyRegionFrame({root:board,materials:[],terrainPass:{}},{x:0,y:0,scale:32});}
 const setCamera=(x=0,z=0)=>{view.camera.position.set(...(framed?[(19+x)*32,(24+z)*32,17*32]:[19+x,17,24+z]));view.camera.lookAt(framed?{x:x*32,y:z*32,z:0}:{x,y:0,z},framed?{x:0,y:0,z:1}:{x:0,y:1,z:0});};
 setCamera();ground.scale.set(3,1,3);
 const pixels=async(time,enabled,directionDeg=20,strength=1)=>{wind.setEnabled(enabled);wind.update(time,{directionDeg,strength});app.render();app.render();let bytes;
  // The WebGL View3D draws into the screen target; extracting the stage into a
  // new offscreen target returns transparent pixels in this pinned beta.
  if(backend==='webgl'){const gl=app.renderer.gl,previous=gl.getParameter(gl.FRAMEBUFFER_BINDING);gl.bindFramebuffer(gl.FRAMEBUFFER,null);bytes=new Uint8Array(900*650*4);gl.readPixels(0,0,900,650,gl.RGBA,gl.UNSIGNED_BYTE,bytes);gl.bindFramebuffer(gl.FRAMEBUFFER,previous);}
  else bytes=(await app.renderer.extract.pixels({target:app.stage})).pixels.slice();
  if(!bytes.some(v=>v!==0)){if(webgpu)await webgpu.gpu.device.queue.onSubmittedWorkDone();throw Error('Empty renderer readback '+JSON.stringify({errors}));}return bytes;
 };
 // Ignore one 8-bit color step of raster/lighting roundoff. A disabled GPU
 // draw varied by at most two summed RGB steps across two of 585,000 pixels.
 const difference=(a,b)=>{let changed=0;for(let i=0;i<a.length;i+=4)if(Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>1)changed++;return changed;};
 const moving=difference(await pixels(0,true),await pixels(2,true)),still=difference(await pixels(0,false),await pixels(2,false));
 if(moving<50||still!==0||errors.length)throw Error(JSON.stringify({moving,still,errors}));
 // Isolate ground receivers: foliage is visible only to the shadow pass.
 for(const batch of world.batches)for(let i=0;i<batch.items.length;i++)batch.setItemActive(i,RenderPassBit.SHADOW);
 const shadowAtRest=await pixels(0,true),versions=world.batches.map(b=>b.batch.drawLists[RenderPassBit.SHADOW].commandList.dirtyId);
 const movingShadows=difference(shadowAtRest,await pixels(2,true)),shadowCommandsRebuilt=world.batches.filter((b,i)=>b.batch.drawLists[RenderPassBit.SHADOW].commandList.dirtyId!==versions[i]).length;
 const stillShadows=difference(await pixels(0,false),await pixels(2,false)),calmShadows=difference(await pixels(0,true,20,0),await pixels(2,true,20,0));
 if(shadowCommandsRebuilt)throw Error('Wind rebuilt cached shadow commands');
 view.passes=[...view.passes];
 const rebuiltShadowPixels=difference(await pixels(0,true),await pixels(2,true));
 view.unload();
 const reloadedShadowPixels=difference(await pixels(0,true),await pixels(2,true));
 if(rebuiltShadowPixels<50||reloadedShadowPixels<50)throw Error(JSON.stringify({rebuiltShadowPixels,reloadedShadowPixels}));
 if(movingShadows<50||stillShadows!==0||calmShadows!==0||errors.length)throw Error(JSON.stringify({movingShadows,stillShadows,calmShadows,errors}));
 for(const batch of world.batches)for(let i=0;i<batch.items.length;i++)batch.setItemActive(i,RenderPassBit.OPAQUE|RenderPassBit.SHADOW);
 // An advection invariant checked against actual rendered native foliage:
 // translating camera and plants by windSpeed*dt must preserve the gust pose.
 // Disable flutter and shadows here so they cannot mask a wrong field.
 const materials=[...new Set(world.batches.flatMap(b=>b.items.map(i=>i.material)))],shapes=materials.map(m=>Array.from(m.data.foliageShape));
 materials.forEach((m,i)=>m.data.foliageShape=[...shapes[i].slice(0,3),0]);sun.castShadow=false;ground.visible=false;
 const transport=[];
 for(const directionDeg of [20,200]){
  const angle=directionDeg*Math.PI/180,dx=Math.cos(angle)*10,dz=-Math.sin(angle)*10;
  const base=await pixels(0,true,directionDeg),stationary=await pixels(2,true,directionDeg);
  root.position.set(dx,0,dz);setCamera(dx,dz);
  const advected=await pixels(2,true,directionDeg),changed=difference(base,stationary),residual=difference(base,advected);
  transport.push({directionDeg,changedStationaryPixels:changed,changedTransportedPixels:residual});
  if(changed<50||residual>Math.max(40,changed*.08))throw Error('Gust front failed to travel downwind: '+JSON.stringify(transport));
  root.position.set(0,0,0);setCamera();
 }
 const calm=difference(await pixels(0,true,20,0),await pixels(2,true,20,0));if(calm!==0||errors.length)throw Error(JSON.stringify({calm,errors}));
 materials.forEach((m,i)=>m.data.foliageShape=shapes[i]);sun.castShadow=true;ground.visible=true;
 if(webgpu)await webgpu.gpu.device.queue.onSubmittedWorkDone();if(errors.length)throw Error(errors.join('\n'));
 status.textContent=JSON.stringify({verified:true,backend,frame:framed?'host':'native',changedAnimatedPixels:moving,changedDisabledPixels:still,changedCalmPixels:calm,changedShadowPixels:movingShadows,shadowCommandsRebuilt,rebuiltShadowPixels,reloadedShadowPixels,changedDisabledShadowPixels:stillShadows,changedCalmShadowPixels:calmShadows,transport,residentWindMaterials:wind.size,errors},null,2);document.title='Vegetation Wind Verified '+backend;
 let time=2;wind.setEnabled(true);app.ticker.add(t=>{time+=t.deltaMS/1000;wind.update(time,{directionDeg:20,strength:1});});app.start();
}catch(error){status.textContent=error.stack+'\n'+errors.join('\n');document.title='Vegetation Wind Failed '+backend;}
