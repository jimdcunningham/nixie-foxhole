import {Application} from 'pixi.js';
import {View3D,Camera3D,Container3D,Mesh3D,CubeGeometry,Material3D,AmbientLight,DirectionalLight} from '@pixi/3d';
import '@pixi/3d/webgpu';import '@pixi/3d/webgl';
import {createCompactProvider} from '../../runtime/compact-provider.mjs';
import {loadWorldModels} from '../../authoring/world-models.mjs';
import {createVegetationWind} from '../../authoring/vegetation-wind.mjs';
const status=document.querySelector('pre'),errors=[],backend=new URLSearchParams(location.search).get('backend')||'webgpu';
try{
 let webgpu;if(backend==='webgpu'){const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice({requiredFeatures:['indirect-first-instance']});device.addEventListener('uncapturederror',e=>errors.push(e.error.message));webgpu={gpu:{adapter,device}};}
 const app=new Application();await app.init({width:900,height:650,preference:backend,antialias:true,autoStart:false,webgpu,background:0x56604d});document.body.append(app.canvas);
 const view=new View3D({width:900,height:650,camera:new Camera3D({near:.1,far:80,fov:40}),toneMapping:'aces',environment:{skyColor:0xe2e4cf,groundColor:0x535b40,intensity:.6},shadowQuality:'medium'});app.stage.addChild(view);view.camera.position.set(3.7,2.8,5);view.camera.lookAt({x:0,y:1,z:0});
 view.root.addChild(new AmbientLight({intensity:.3}));const sun=new DirectionalLight({castShadow:true,intensity:3});sun.position.set(6,10,5);sun.lookAt({x:0,y:0,z:0});view.root.addChild(sun);
 const ground=new Mesh3D({geometry:new CubeGeometry({width:15,height:.1,depth:15}),material:new Material3D({baseColor:0x8a8663,roughness:1})});ground.position.y=-.1;view.root.addChild(ground);
 const base=new URL('/world/',location.href),index=await fetch(new URL('index.json',base)).then(r=>r.json()),provider=await createCompactProvider({baseUrl:base.href,entry:index.regions.terminus,signal:new AbortController().signal}),data=await provider.json('terminus/world.json'),native=data.prototypes.find(p=>p.name==='Bush01');
 if(!native)throw Error('Missing representative native bush');const wind=createVegetationWind(),root=new Container3D();view.root.addChild(root);
 const world=await loadWorldModels({region:'terminus',root,windMaterials:wind,worldData:{prototypes:[{...native,placements:[{matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}]}]},visibilityData:data,optimize:false,status(){},json:provider.json,assetUrl:provider.url,loadModel:provider.model,teamAt:()=> 'NONE'});
 if(world.counts.failed.length)throw Error(JSON.stringify(world.counts.failed));
 const pixels=async(time,enabled)=>{wind.setEnabled(enabled);wind.update(time,{directionDeg:20,strength:1});app.render();let bytes;
  // The WebGL View3D draws into the screen target; extracting the stage into a
  // new offscreen target returns transparent pixels in this pinned beta.
  if(backend==='webgl'){const gl=app.renderer.gl,previous=gl.getParameter(gl.FRAMEBUFFER_BINDING);gl.bindFramebuffer(gl.FRAMEBUFFER,null);bytes=new Uint8Array(900*650*4);gl.readPixels(0,0,900,650,gl.RGBA,gl.UNSIGNED_BYTE,bytes);gl.bindFramebuffer(gl.FRAMEBUFFER,previous);}
  else bytes=(await app.renderer.extract.pixels({target:app.stage})).pixels.slice();
  if(!bytes.some(v=>v!==0))throw Error('Empty renderer readback');return bytes;
 };
 const difference=(a,b)=>{let changed=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2])changed++;return changed;};
 const moving=difference(await pixels(0,true),await pixels(2,true)),still=difference(await pixels(0,false),await pixels(2,false));
 if(moving<50||still!==0||errors.length)throw Error(JSON.stringify({moving,still,errors}));
 status.textContent=JSON.stringify({verified:true,backend,changedAnimatedPixels:moving,changedDisabledPixels:still,residentWindMaterials:wind.size,errors},null,2);document.title='Vegetation Wind Verified '+backend;
 let time=2;wind.setEnabled(true);app.ticker.add(t=>{time+=t.deltaMS/1000;wind.update(time,{directionDeg:20,strength:1});});app.start();
}catch(error){status.textContent=error.stack+'\n'+errors.join('\n');document.title='Vegetation Wind Failed '+backend;}
