// Load through the world browser harness from an HTML page with a <pre>.
// Check backend=webgl/webgpu and frame=host/native; both projections run automatically.
import {Application,Texture,BufferImageSource} from 'pixi.js';
import {View3D,Camera3D,Container3D,Mesh3D,Geometry3D,CubeGeometry,Material3D,AmbientLight} from '@pixi/3d';
import '@pixi/3d/webgpu';import '@pixi/3d/webgl';
import {createNativeWaterMaterial} from '../../authoring/native-water-material.mjs';
import {LiveTerrainPass} from '../../authoring/live-terrain.mjs';
import {prepareWaterSurfaceDepth} from '../../runtime/water-surface-depth.mjs';
import {framedMaterialBits,applyRegionFrame} from '../../runtime/spatial-frame.mjs';
const status=document.querySelector('pre'),q=new URLSearchParams(location.search),backend=q.get('backend')||'webgl',framed=q.get('frame')!=='native',errors=[];
try{
 let webgpu;if(backend==='webgpu'){const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice({requiredFeatures:['indirect-first-instance']});device.addEventListener('uncapturederror',e=>errors.push(e.error.message));webgpu={gpu:{adapter,device}};}
 const app=new Application();await app.init({width:960,height:640,preference:backend,antialias:false,useBackBuffer:true,autoStart:false,webgpu,background:0x12191b});document.body.append(app.canvas);
 const camera=new Camera3D({mode:'orthographic',near:.1,far:10000}),view=new View3D({width:960,height:640,camera,environment:null,toneMapping:'aces'});app.stage.addChild(view);prepareWaterSurfaceDepth(view);view.root.addChild(new AmbientLight({intensity:1}));
 const board=new Container3D();view.root.addChild(board);
 function geometry(rects){const p=[],n=[],uv=[],ix=[];for(const [x0,x1,z0,z1,y]of rects){const b=p.length/3;p.push(x0,y,z0,x1,y,z0,x1,y,z1,x0,y,z1);n.push(0,1,0,0,1,0,0,1,0,0,1,0);uv.push(0,0,1,0,1,1,0,1);ix.push(b,b+2,b+1,b,b+3,b+2);}return new Geometry3D({positions:new Float32Array(p),normals:new Float32Array(n),uvs:new Float32Array(uv),indices:new Uint32Array(ix),quantizeNormals:false});}
 const terrain=new LiveTerrainPass();if(framed)terrain.frame=new Float32Array([12000,25000,32,0]);view.passes=[terrain];await terrain.load('fixture',geometry([[-240,-10,700,940,15],[-10,240,700,940,-80]]),{surface:'plain',status(){}});const planning=terrain.planning;
 const tex=rgba=>new Texture({source:new BufferImageSource({resource:new Uint8Array(rgba),width:1,height:1,format:'rgba8unorm',autoGenerateMipmaps:false})}),normal=tex([128,128,0,255]),blank=tex([0,0,0,255]);
 const colors={'Body Color':{R:.025,G:.06,B:.055},'Depth Colour':{R:.08,G:.14,B:.1},EdgeColour01:{R:.6,G:.6,B:.5},FresnelFakeSSS:{R:.1,G:.1,B:.1}};
 let {material}=await createNativeWaterMaterial({region:'fixture',json:async id=>id.endsWith('boat-stencils.json')?[]:{textures:{waveLarge:'normal',waveSmall:'normal',foam:'blank',modulation:'blank',clouds:'blank'},material:{colors}},texture:async id=>id==='normal'?normal:blank,extraBits:[planning.waterBit]});
 material.data.waterReflectionStrength=0;material.data.waveStrength=0;
 if(framed){const original=material;material=new original.constructor({doubleSided:true,extraBits:framedMaterialBits(original._extraBits)});for(const key in original.data)if(!key.startsWith('_')){const v=original.data[key];if(typeof v==='number'||ArrayBuffer.isView(v)||Array.isArray(v))material.data[key]=ArrayBuffer.isView(v)?v.slice():v;}for(const key in original.textures)if(original.textures[key]?.source)material.textures[key]=original.textures[key];material.state.depthMask=original.state.depthMask;original.destroy();}
 planning.bindWater(material);
 const water=new Mesh3D({geometry:geometry([[-240,240,700,940,0]]),material});board.addChild(water);
 const cover=new Mesh3D({geometry:new CubeGeometry({width:45,height:50,depth:45}),material:new Material3D({baseColor:0x808080,roughness:1})});cover.position.set(70,25,850);board.addChild(cover);
 if(framed)applyRegionFrame({root:board,materials:[material],terrainPass:terrain},{x:12000,y:-25000,scale:32});
 const world=(x,y,z)=>framed?{x:x*32+12000,y:z*32+25000,z:y*32}:{x,y,z};
 function aim(mode){camera.mode=mode;const p=world(0,650,1150);camera.position.set(p.x,p.y,p.z);camera.lookAt(world(0,0,825),framed?{x:0,y:0,z:1}:{x:0,y:1,z:0});camera.orthographicSize=550*(framed?32:1);camera.near=framed?3.2:.1;camera.far=framed?320000:10000;}
 function update(rdz,items=[]){terrain.setPlanningOverlays({rdz,topo:false},{items});planning.bindWater(material);app.render();app.render();}
 async function pixels(){app.render();app.render();if(backend==='webgl'){const gl=app.renderer.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,null);const b=new Uint8Array(960*640*4);gl.readPixels(0,0,960,640,gl.RGBA,gl.UNSIGNED_BYTE,b);return b;}
  const device=webgpu.gpu.device,target=app.renderer.renderTarget.getGpuRenderTarget(app.renderer.renderTarget.rootRenderTarget).canvasTextures[0],stride=3840,buffer=device.createBuffer({size:stride*640,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:target},{buffer,bytesPerRow:stride},{width:960,height:640});device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const b=new Uint8Array(buffer.getMappedRange()).slice();buffer.unmap();buffer.destroy();if(target.format.startsWith('bgra'))for(let i=0;i<b.length;i+=4){const r=b[i];b[i]=b[i+2];b[i+2]=r;}return b;
 }
 function sample(b,p){const s=view.worldToScreen(world(...p)),x=Math.round(s.x),y=backend==='webgl'?639-Math.round(s.y):Math.round(s.y),i=(y*960+x)*4;return Array.from(b.slice(i,i+3));}
 const delta=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i]))),results=[];
 async function verify(){results.length=0;for(const mode of ['orthographic','perspective']){aim(mode);update(false);const off=await pixels();terrain.setPlanningOverlays({topo:true});planning.bindWater(material);const topo=await pixels();update(true);const on=await pixels();const items=Array.from({length:300},(_,i)=>({iconType:20,x:(i===0?150:-200+i*.1)/2184+.5,y:.5-850/1890}));update(true,items);const exempt=await pixels();const waterP=[150,0,850],landP=[-150,15,850],interiorP=[150,0,740],coverP=[70,50,850];const result={mode,water:delta(sample(off,waterP),sample(on,waterP)),land:delta(sample(off,landP),sample(on,landP)),interior:delta(sample(off,interiorP),sample(on,interiorP)),cover:delta(sample(off,coverP),sample(on,coverP)),topo:delta(sample(off,waterP),sample(topo,waterP)),exemption:delta(sample(off,waterP),sample(exempt,waterP)),colors:{off:sample(off,waterP),on:sample(on,waterP),exempt:sample(exempt,waterP)},maskHeight:planning.source.height};results.push(result);if(result.water<10||result.land<10||result.interior>1||result.cover>1||result.topo>1||result.exemption>1||result.maskHeight!==5)throw Error('RDZ checks failed: '+JSON.stringify(results));}
  if(webgpu)await webgpu.gpu.device.queue.onSubmittedWorkDone();if(errors.length)throw Error(errors.join('\n'));aim('orthographic');update(true,[{iconType:20,x:150/2184+.5,y:.5-850/1890}]);status.textContent=JSON.stringify({verified:true,backend,framed,results,errors},null,2);document.title='RDZ Water Verified '+backend;
 }
 await verify();
}catch(e){status.textContent=e.stack+'\n'+errors.join('\n');document.title='RDZ Probe Failed';}
