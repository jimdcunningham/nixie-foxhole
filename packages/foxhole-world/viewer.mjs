import {setProjection,syncProjection,orthographicHeight} from './authoring/camera-projection.mjs';
import {Application} from 'pixi.js';
import {View3D,Camera3D,DirectionalLight,AmbientLight} from '@pixi/3d';
import '@pixi/3d/webgl';import '@pixi/3d/webgpu';
import {OrbitCamera} from '@pixi/3d/extras';
import {loadCompactRegion} from './runtime/load-compact-region.mjs';
import {loadBakedRegion} from './runtime/load-region.mjs';
import {SafeSsaoEffect} from './authoring/safe-ssao.mjs';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),base=params.get('assets')||'../world/',backend=params.get('backend')||'webgpu',framed=params.has('frame');
// Pixi beta OrbitCamera does not forward its up axis to camera.lookAt.
class RegionCamera3D extends Camera3D {lookAt(target,up=framed?{x:0,y:0,z:1}:{x:0,y:1,z:0}){super.lookAt(target,up);}}
let gpuContext;
if(backend==='webgpu'){const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});if(!adapter?.features.has('indirect-first-instance'))throw Error('WebGPU indirect drawing is unavailable');const device=await adapter.requestDevice({requiredFeatures:['indirect-first-instance'],requiredLimits:{maxBufferSize:Math.min(adapter.limits.maxBufferSize,1024**3)}});gpuContext={adapter,device};}
const app=new Application();await app.init({canvas:$('canvas'),resizeTo:window,resolution:1,antialias:true,background:0x172329,preference:backend,...(gpuContext?{webgpu:{gpu:gpuContext}}:{})});
const view=new View3D({width:innerWidth,height:innerHeight,autoResize:true,toneMapping:'aces',exposure:1,shadowQuality:'high',camera:new RegionCamera3D({near:framed?16:.5,far:framed?512000:16000,fov:45}),environment:{skyColor:0xc4d4db,groundColor:0x464333,intensity:.75,up:framed?{x:0,y:0,z:1}:{x:0,y:1,z:0}}});app.stage.addChild(view);const defaultEnvironment=view.environment;
const sun=new DirectionalLight({intensity:7,color:0xfffaf1,castShadow:true,shadow:{cascades:3,maxDistance:framed?128000:4000,lambda:.65,update:'manual',bias:.00015,normalBias:framed?3.84:.12}}),fill=new AmbientLight({color:0xe4ecf2,intensity:.12});
const map=([x,y,z])=>framed?[x*32,-z*32,y*32]:[x,y,z];sun.position.set(...map([-650,1100,500]));sun.lookAt({x:0,y:0,z:0},framed?{x:0,y:0,z:1}:{x:0,y:1,z:0});view.root.addChild(sun,fill);
const orbit=new OrbitCamera({view,up:framed?{x:0,y:0,z:1}:{x:0,y:1,z:0},autoUpdate:false,enableDamping:true,minDistance:framed?224:7,maxDistance:framed?224000:7000,target:{x:0,y:0,z:0}});
const ao=new SafeSsaoEffect({radius:framed?38.4:1.2,maxDistance:framed?24.96:.78,intensity:1,power:1.25,bias:.02,samples:32,resolution:'inherit'});
const index=await fetch(new URL('index.json',new URL(base,location.href)),{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('Region index '+r.status);return r.json();});
$('region').replaceChildren(...Object.entries(index.regions).map(([id,entry])=>Object.assign(document.createElement('option'),{value:id,textContent:entry.name||id})));
$('region').value=params.get('region')||Object.keys(index.regions)[0];$('backend').value=backend;
let current,abort,loading=false,errors=[],times=[],last=0,readyAt=0,loadStarted=0,firstSubmitMs=null,firstDrawCpuMs=null,pendingFirstDraw=false;
const render=app.renderer.render.bind(app.renderer);app.renderer.render=(...args)=>{const begin=performance.now();const result=render(...args);if(pendingFirstDraw){firstSubmitMs=performance.now()-loadStarted;firstDrawCpuMs=performance.now()-begin;pendingFirstDraw=false;}return result;};
const overview=()=>{view.camera.position.set(...map([1200,1450,1800]));orbit.target.set(0,0,0);view.camera.lookAt({x:0,y:0,z:0});sun.refreshShadows();};overview();
async function load(id){
 abort?.abort();abort=new AbortController();const own=abort;loading=true;loadStarted=performance.now();firstSubmitMs=null;firstDrawCpuMs=null;if(current){view.passes=[];view.environment=defaultEnvironment;current.destroy();current=null;}app.start();errors=[];$('error').textContent='';times=[];
 try{const region=await (index.format==='compact-recipes-v1'?loadCompactRegion:loadBakedRegion)({baseUrl:new URL(base,location.href).href,entry:index.regions[id],signal:own.signal,renderer:app.renderer,prepareTerrain:source=>{if(app.renderer.gpu)app.renderer.texture.initSource(source);},...(framed?{frame:{x:0,y:0,scale:32}}:{}),onProgress:state=>$('status').textContent=state.phase});if(own.signal.aborted){region.destroy();return;}region.prepareFirstFrame?.(app.renderer);current=region;if(region.environment)view.environment=region.environment;view.root.addChild(region.root);view.passes=[...region.passes,...(index.format==='compact-recipes-v1'?[]:[ao])];overview();readyAt=performance.now();pendingFirstDraw=true;loading=false;last=0;app.start();const next=new URL(location.href);next.searchParams.set('region',id);history.replaceState(null,'',next);$('status').textContent='Ready';}
 catch(error){if(own.signal.aborted)return;errors.push(String(error.stack||error));$('error').textContent=String(error.message||error);loading=false;app.start();}
}
app.ticker.add(()=>{syncProjection(view.camera,orbit.target,innerWidth,innerHeight);orbit.update();if(current){const p=view.camera.position,s=framed?32:1,position=framed?[p.x/s,p.z/s,-p.y/s]:[p.x,p.y,p.z];current.update({camera:{position,height:innerHeight,fov:45,orthographicHeight:orthographicHeight(view.camera,innerWidth,innerHeight)/s}});}const now=performance.now();if(last&&!loading){times.push(now-last);if(times.length>300)times.shift();}last=now;const fps=times.length?1000*times.length/times.reduce((a,b)=>a+b,0):0;$('metrics').textContent=current?`${fps.toFixed(1)} FPS\n${(current.metrics.downloadBytes/1048576).toFixed(1)} MiB downloaded\n${current.metrics.cacheHits} cached inputs\nPrepared in ${(current.metrics.readyMs/1000).toFixed(2)} s\n${current.scene.counts.placements.toLocaleString()} models\n${errors.length} errors`:'Preparing region…';});
window.addEventListener('error',e=>errors.push(e.message));
gpuContext?.device.addEventListener('uncapturederror',e=>{app.stop();if(errors.length<12&&!errors.includes(e.error.message))errors.push(e.error.message);$('error').textContent=errors[0]||e.error.message;});
$('region').onchange=()=>load($('region').value);$('reload').onclick=()=>load($('region').value);$('overview').onclick=overview;
$('backend').onchange=()=>{const url=new URL(location.href);url.searchParams.set('backend',$('backend').value);location.href=url.href;};
$('town').onclick=()=>{const site=current?.sites?.find(s=>/TownBase/.test(s.name));if(!site)return;const [x,y,z]=site.matrix.slice(12,15);view.camera.position.set(...map([x+50,y+45,z+65]));orbit.target.set(...map([x,y+4,z]));view.camera.lookAt(orbit.target);sun.refreshShadows();};
$('projection').onclick=()=>{const orthographic=view.camera.mode!=='orthographic';setProjection(view.camera,orthographic?'orthographic':'perspective');syncProjection(view.camera,orbit.target,innerWidth,innerHeight);$('projection').textContent=orthographic?'Perspective':'Orthographic';};
window.bakedWorldProbe={pause:()=>app.stop(),snapshot:()=>({ready:!!current&&!loading,metrics:current?.metrics,counts:current?.scene.counts,errors:[...errors],fps:times.length?1000*times.length/times.reduce((a,b)=>a+b,0):0,firstSubmitMs,firstDrawCpuMs}),focusAt(position,target){view.camera.position.set(...position);orbit.target.set(...target);view.camera.lookAt(orbit.target);sun.refreshShadows();},reload:()=>load($('region').value)};
if(params.get('autoload')==='0'){app.stop();$('status').textContent='Choose a region, then select Load Region.';}else await load($('region').value);
