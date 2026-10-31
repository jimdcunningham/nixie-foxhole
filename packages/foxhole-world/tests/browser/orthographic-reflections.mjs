// Browser regression: build with esbuild, serve beside an HTML page with <pre>.
// Tests the shared Nixie policy on WebGL/WebGPU with sun, sky, metals and close zoom.
import {Application,Texture,BufferImageSource,CubeTexture} from 'pixi.js';
import {View3D,Camera3D,Container3D,Mesh3D,CubeGeometry,Material3D,AmbientLight,DirectionalLight} from '@pixi/3d';
import '@pixi/3d/webgpu';import '@pixi/3d/webgl';
import {framedMaterialBits,applyRegionFrame} from '../../runtime/spatial-frame.mjs';
const status=document.querySelector('pre'),q=new URLSearchParams(location.search),backend=q.get('backend')||'webgl',framed=true,errors=[];
try{
 let webgpu;if(backend==='webgpu'){const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice({requiredFeatures:['indirect-first-instance']});device.addEventListener('uncapturederror',e=>errors.push(e.error.message));webgpu={gpu:{adapter,device}};}
 const width=640,height=480,app=new Application();await app.init({width,height,preference:backend,webgpu,antialias:false,autoStart:false});document.body.append(app.canvas);
 const camera=new Camera3D({near:.1,far:1000000}),view=new View3D({width,height,camera,environment:null,toneMapping:'aces'});app.stage.addChild(view);
 const sun=new DirectionalLight({intensity:4.5});sun.lookAt(framed?{x:0,y:0,z:-1}:{x:0,y:-1,z:0},framed?{x:0,y:1,z:0}:{x:0,y:0,z:1});view.root.addChild(sun,new AmbientLight({intensity:2}));
 const tex=rgba=>new Texture({source:new BufferImageSource({resource:new Uint8Array(rgba),width:1,height:1,format:'rgba8unorm',autoGenerateMipmaps:false})});
 const sky=CubeTexture.from({faces:Object.fromEntries(['right','left','top','bottom','front','back'].map(face=>[face,tex([255,255,255,255])]))});view.environment=sky;
 const material=new Material3D({baseColor:0x191912,roughness:.1,metallic:0,normalTexture:tex([128,128,255,255]),normalScale:.95,doubleSided:true,alpha:.9,alphaMode:'blend',extraBits:framedMaterialBits([])});
 const board=new Container3D();view.root.addChild(board);const water=new Mesh3D({geometry:new CubeGeometry({width:12000,height:.01,depth:12000}),material});water.position.y=-.005;board.addChild(water);
 if(framed)applyRegionFrame({root:board,materials:[material],terrainPass:{}},{x:10000,y:20000,scale:32});
 const world=(x,y,z)=>framed?{x:x*32+10000,y:z*32-20000,z:y*32}:{x,y,z};
 function aim(mode,size,tilt=0){camera.mode=mode;const p=world(0,size,size*tilt);camera.position.set(p.x,p.y,p.z);camera.lookAt(world(0,0,0),framed?{x:0,y:1,z:0}:{x:0,y:0,z:-1});camera.orthographicSize=size*(framed?32:1);}
 async function pixels(){app.render();app.render();if(backend==='webgl'){const gl=app.renderer.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,null);const bytes=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return bytes;}
  const device=webgpu.gpu.device,target=app.renderer.renderTarget.getGpuRenderTarget(app.renderer.renderTarget.rootRenderTarget).canvasTextures[0],stride=Math.ceil(width*4/256)*256,buffer=device.createBuffer({size:stride*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:target},{buffer,bytesPerRow:stride},{width,height});device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const source=new Uint8Array(buffer.getMappedRange()),bytes=new Uint8Array(width*height*4);for(let y=0;y<height;y++)bytes.set(source.subarray(y*stride,y*stride+width*4),y*width*4);buffer.unmap();buffer.destroy();if(target.format.startsWith('bgra'))for(let i=0;i<bytes.length;i+=4){const r=bytes[i];bytes[i]=bytes[i+2];bytes[i+2]=r;}return bytes;}
 function stats(bytes){const sum=[0,0,0];let white=0;for(let y=190;y<290;y++)for(let x=270;x<370;x++){const i=(y*width+x)*4;for(let c=0;c<3;c++)sum[c]+=bytes[i+c];if(bytes[i]>230&&bytes[i+1]>230&&bytes[i+2]>230)white++;}return{mean:sum.map(n=>n/10000),whiteFraction:white/10000};}
 const prepared=material.getPrimaryDescriptor,raw=Material3D.prototype.getPrimaryDescriptor,baseline=[];material.getPrimaryDescriptor=raw;water.invalidate();
 for(const mode of ['orthographic','perspective']){aim(mode,80);baseline.push({mode,...stats(await pixels())});}
 if(Math.max(...baseline.map(r=>r.whiteFraction))<.1)throw Error('Fixture did not reproduce the sun washout: '+JSON.stringify(baseline));
 material.getPrimaryDescriptor=prepared;water.invalidate();const results=[];
 for(const mode of ['orthographic','perspective'])for(const size of [20,80,200,800])for(const tilt of [0,.6,3]){aim(mode,size,tilt);const lit=stats(await pixels());sun.intensity=0;const dark=stats(await pixels());sun.intensity=4.5;const sunlight=Math.max(...lit.mean.map((v,i)=>v-dark.mean[i]));if(mode==='perspective'){material.getPrimaryDescriptor=raw;water.invalidate();const control=stats(await pixels());material.getPrimaryDescriptor=prepared;water.invalidate();if(lit.mean.some((v,i)=>Math.abs(v-control.mean[i])>1))throw Error('Perspective appearance changed');}results.push({mode,size,tilt,...lit,sunlight});if(mode==='orthographic'&&tilt===0&&(lit.whiteFraction>.01||Math.max(...lit.mean)>210))throw Error('Puddle washes out: '+JSON.stringify(results));if(sunlight<3)throw Error('Puddle lost sunlight: '+JSON.stringify(results));}

 // Keep close-zoom orthographic rays independent of eye height. A dark metal
 // must remain readable when it becomes diffuse rather than turn black.
 const close=[];
 for(const metal of [0,1]){material.metallic=metal;for(const height of [2,20,200]){
  aim('orthographic',80);const p=world(0,height,0);camera.position.set(p.x,p.y,p.z);camera.lookAt(world(0,0,0),{x:0,y:1,z:0});const result=stats(await pixels());close.push({metal,height,...result});if(result.whiteFraction>.01||Math.max(...result.mean)>180||Math.max(...result.mean)<10)throw Error('Close orthographic reflection/metal regression: '+JSON.stringify(close));
 }}material.metallic=0;
if(webgpu)await webgpu.gpu.device.queue.onSubmittedWorkDone();if(errors.length)throw Error(errors.join('\n'));aim('orthographic',80);await pixels();status.textContent=JSON.stringify({verified:true,backend,framed,baseline,cases:results.length,close,worstTopDownWhiteFraction:Math.max(...results.filter(r=>r.mode==='orthographic'&&r.tilt===0).map(r=>r.whiteFraction)),brightestMean:Math.max(...results.flatMap(r=>r.mean)),minimumSunlight:Math.min(...results.map(r=>r.sunlight)),errors},null,2);document.title='Orthographic Reflections Verified '+backend;
}catch(e){status.textContent=e.stack+'\n'+errors.join('\n');document.title='Orthographic Reflections Failed';}
