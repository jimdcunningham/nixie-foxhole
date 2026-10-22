// Serve using the world Vite harness; run both backends and frame=host.
import {Application,Texture} from 'pixi.js';
import {View3D,Camera3D,Container3D} from '@pixi/3d';
import '@pixi/3d/webgl';import '@pixi/3d/webgpu';
import {buildNativeParticleEmitter} from '../../authoring/native-particle-runtime.mjs';
import {applyRegionFrame} from '../../runtime/spatial-frame.mjs';
const output=document.querySelector('pre'),params=new URLSearchParams(location.search),backend=params.get('backend')||'webgl',framed=params.get('frame')==='host',errors=[];
try{
 let webgpu;if(backend==='webgpu'){const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice({requiredFeatures:['indirect-first-instance']});device.addEventListener('uncapturederror',e=>errors.push(e.error.message));webgpu={gpu:{adapter,device}};}
 const app=new Application();await app.init({width:600,height:400,resolution:1,autoStart:false,antialias:false,preference:backend,webgpu,background:0});document.body.append(app.canvas);
 const view=new View3D({width:600,height:400,camera:new Camera3D({mode:'orthographic',near:.1,far:100}),environment:null,toneMapping:'none'});app.stage.addChild(view);view.camera.orthographicSize=4;
 const root=new Container3D();view.root.addChild(root);
 const p=buildNativeParticleEmitter({region:'fixture',placement:{actor:'chimney',name:'smoke',system:'War/Content/FX/smokestack.smokestack',matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]},emitter:{name:'ParticleSpriteEmitter_3',material:'SmokeStacks',count:2,rate:[.2,.2],lifetime:[10,10],location:[[0,0,0],[0,0,0]],origin:[0,0,0],velocity:[[0,0,0],[0,0,0]],acceleration:[[0,0,0],[0,0,0]],size:[[100,100,100],[100,100,100]],color:[[1,1,1],[1,1,1]],alpha:[.5,.5]},material:{color:[1,1,1],opacity:1},texture:Texture.WHITE,particleHex:{name:'fixture',gpu:{},gl:{}},frame:framed?{scale:32}:undefined});root.addChild(p);
 for(let i=0;i<2;i++){p.setParticleAt(i,0,0,i?1:-1,framed?64:2,0,i?0xffffff:0,.5);p.setParticle(i,{aBirth:0,aLife:10,aVel:{x:0,y:0,z:0}});}p.uniforms.uParticleTime=0;
 if(framed){applyRegionFrame({root,materials:[],terrainPass:{}},{x:100000,y:-200000,scale:32});view.camera.near=3.2;view.camera.far=3200;view.camera.orthographicSize=128;}
 function camera(sign){view.camera.position.set(framed?100000:0,framed?200000+160*sign:0,framed?0:5*sign);view.camera.lookAt(framed?{x:100000,y:200000,z:0}:{x:0,y:0,z:0},framed?{x:0,y:0,z:1}:{x:0,y:1,z:0});}
  const read=async()=>{app.render();app.render();let data;
  if(backend==='webgl'){const gl=app.renderer.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,null);data=new Uint8Array(600*400*4);gl.readPixels(0,0,600,400,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;}
  const device=webgpu.gpu.device,target=app.renderer.renderTarget.getGpuRenderTarget(app.renderer.renderTarget.rootRenderTarget).canvasTextures[0],stride=Math.ceil(600*4/256)*256,buffer=device.createBuffer({size:stride*400,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:target},{buffer,bytesPerRow:stride},{width:600,height:400});device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const source=new Uint8Array(buffer.getMappedRange());data=new Uint8Array(600*400*4);for(let y=0;y<400;y++)data.set(source.subarray(y*stride,y*stride+600*4),y*600*4);buffer.unmap();buffer.destroy();if(target.format.startsWith('bgra'))for(let i=0;i<data.length;i+=4){const r=data[i];data[i]=data[i+2];data[i+2]=r;}return data;
 };

 const sample=data=>data[(200*600+300)*4],results=[];
 // Looking from the back exposes the old spawn-order failure: the far white
 // puff must not cover a nearer dark puff. Then reverse the camera.
 camera(-1);const old=sample(await read());
 for(const sign of [-1,1,-1]){camera(sign);const planes=new Float32Array(24);if(framed)planes[21]=-sign;else planes[22]=-sign;p.nativeDepthSort.update({planes},framed?{scale:32}:undefined);const value=sample(await read()),expected=sign<0?64:128;if(Math.abs(value-expected)>2)throw Error('Incorrect animated particle order: '+JSON.stringify({old,sign,value,expected,order:p.nativeDepthSort.order}));results.push({sign,value,expected});}
 if(old<120)throw Error('Fixture did not expose the old spawn ordering: '+old);
 camera(1);p.setParticle(1,{aVel:{x:0,y:0,z:-2}});p.upload();p.uniforms.uParticleTime=2;p.nativeDepthSort.update({direction:[0,0,-1]});const moved=sample(await read());if(Math.abs(moved-64)>2)throw Error('Animated centre sorting failed: '+moved);
 view.passes=[...view.passes];const rebuilt=sample(await read());view.unload();const reloaded=sample(await read());if(Math.abs(rebuilt-64)>2||Math.abs(reloaded-64)>2)throw Error('Rebuild lost sorted smoke');
 if(webgpu)await webgpu.gpu.device.queue.onSubmittedWorkDone();if(errors.length)throw Error(errors.join('\n'));
 output.textContent=JSON.stringify({verified:true,backend,frame:framed?'host':'native',old,results,moved,rebuilt,reloaded,errors},null,2);document.title='Smoke Compositing Verified '+backend;
}catch(error){output.textContent=error.stack+'\n'+errors.join('\n');document.title='Smoke Compositing Failed';}
