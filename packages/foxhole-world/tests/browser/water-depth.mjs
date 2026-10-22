// Load from an HTML page with <pre>Checking water depth...</pre> via the world
// Vite harness. Run backend=webgl/webgpu with and without frame=host.
import {prepareWaterSurfaceDepth} from '../../runtime/water-surface-depth.mjs';
import {SafeSsaoEffect} from '../../authoring/safe-ssao.mjs';
import {framedMaterialBits,applyRegionFrame} from '../../runtime/spatial-frame.mjs';
import {Application,Texture,BufferImageSource} from 'pixi.js';
import {View3D,Camera3D,Container3D,Mesh3D,CubeGeometry,Material3D,AmbientLight} from '@pixi/3d';
import '@pixi/3d/webgpu';import '@pixi/3d/webgl';
import {createNativeWaterMaterial} from '../../authoring/native-water-material.mjs';
const status=document.querySelector('pre'),backend=new URLSearchParams(location.search).get('backend')||'webgl',framed=new URLSearchParams(location.search).get('frame')==='host',errors=[];
try{
 let webgpu;if(backend==='webgpu'){const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice({requiredFeatures:['indirect-first-instance']});device.addEventListener('uncapturederror',e=>errors.push(e.error.message));webgpu={gpu:{adapter,device}};}
 const app=new Application();await app.init({width:900,height:650,preference:backend,antialias:false,useBackBuffer:true,autoStart:false,webgpu,background:0x15252a});document.body.append(app.canvas);
 const view=new View3D({width:900,height:650,camera:new Camera3D({mode:'orthographic',near:.1,far:10000}),environment:null,toneMapping:'none'});app.stage.addChild(view);prepareWaterSurfaceDepth(view);view.camera.position.set(0,10,15);view.camera.lookAt({x:0,y:0,z:0});view.root.addChild(new AmbientLight({intensity:1}));
 // Declare RGBA explicitly: BufferImageSource defaults to BGRA on WebGPU.
 const tex=rgba=>new Texture({source:new BufferImageSource({resource:new Uint8Array(rgba),width:1,height:1,format:'rgba8unorm',autoGenerateMipmaps:false})}),normal=tex([128,128,0,255]),blank=tex([0,0,0,255]);
 const height=Math.round((-8+128)/256*65535),bed=tex([height>>8,height&255,0,255]);
 const colors={'Body Color':{R:.025,G:.06,B:.055},'Depth Colour':{R:.08,G:.14,B:.1},EdgeColour01:{R:.6,G:.6,B:.5},FresnelFakeSSS:{R:.1,G:.1,B:.1}};
 let {material}=await createNativeWaterMaterial({region:'fixture',json:async id=>id.endsWith('boat-stencils.json')?[]:{textures:{waveLarge:'normal',waveSmall:'normal',foam:'blank',modulation:'blank',clouds:'blank'},material:{colors}},texture:async id=>id.endsWith('terrain-height.png')?bed:id==='normal'?normal:blank});material.data.waterReflectionStrength=0;material.data.waveStrength=0;
 if(framed){const original=material;material=new original.constructor({doubleSided:true,extraBits:framedMaterialBits(original._extraBits)});
  for(const key in original.data)if(!key.startsWith('_')){const value=original.data[key];if(typeof value==='number'||ArrayBuffer.isView(value)||Array.isArray(value))material.data[key]=ArrayBuffer.isView(value)?value.slice():value;}
  material.state.depthMask=original.state.depthMask;
  for(const key in original.textures)if(original.textures[key]?.source)material.textures[key]=original.textures[key];original.destroy();
 }
 const probe={name:'waterDepthProbe',gl:{fragment:{end:'finalColor=vec3(waterDepth/20.0,opticalDepth/max(waterDepth,.001),abs(viewDir.y));'}},gpu:{fragment:{end:'finalColor=vec3<f32>(waterDepth/20.0,opticalDepth/max(waterDepth,0.001),abs(viewDir.y));'}}};material._extraBits.push(probe);
 const water=new Mesh3D({geometry:new CubeGeometry({width:6000,height:.01,depth:6000}),material});water.position.y=-.005;view.root.addChild(water);
 const ground=new Mesh3D({geometry:new CubeGeometry({width:6000,height:1,depth:6000}),material:new Material3D({baseColor:0xffffff,roughness:1})});ground.position.y=-8.5;view.root.addChild(ground);
 const cliff=new Mesh3D({geometry:new CubeGeometry({width:6,height:6,depth:6}),material:ground.material});cliff.position.set(1,-4,0);cliff.visible=false;view.root.addChild(cliff);
 if(framed){const board=new Container3D();view.root.addChild(board);board.addChild(water,ground,cliff);applyRegionFrame({root:board,materials:[material],terrainPass:{}},{x:0,y:0,scale:32});view.camera.near=3.2;view.camera.far=320000;view.camera.position.set(0,480,320);view.camera.lookAt({x:0,y:0,z:0},{x:0,y:0,z:1});}
 // WebGL needs the backbuffer for the opaque colour copy, and direct screen
 // readback because stage extraction is empty in the pinned renderer beta.
 const renderPixels=async()=>{
  app.render();app.render();
  if(backend==='webgl'){
   const gl=app.renderer.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,null);const bytes=new Uint8Array(900*650*4);
   gl.readPixels(0,0,900,650,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return bytes;
  }
  // Capture the submitted screen texture before presentation replaces it.
  // Stage extraction rerenders post effects and can mask validation failures.
  const device=webgpu.gpu.device,target=app.renderer.renderTarget.getGpuRenderTarget(app.renderer.renderTarget.rootRenderTarget).canvasTextures[0];
  const stride=Math.ceil(900*4/256)*256,buffer=device.createBuffer({size:stride*650,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();
  encoder.copyTextureToBuffer({texture:target},{buffer,bytesPerRow:stride},{width:900,height:650});device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);const source=new Uint8Array(buffer.getMappedRange()),pixels=new Uint8Array(900*650*4);
  for(let y=0;y<650;y++)pixels.set(source.subarray(y*stride,y*stride+900*4),y*900*4);
  buffer.unmap();buffer.destroy();
  if(target.format.startsWith('bgra'))for(let i=0;i<pixels.length;i+=4){const r=pixels[i];pixels[i]=pixels[i+2];pixels[i+2]=r;}
  return pixels;
 };
 const sample=(pixels,x)=>Array.from(pixels.slice((325*900+x)*4,(325*900+x)*4+3));
 const results=[];
 for(const size of [20,1200]){view.camera.orthographicSize=size*(framed?32:1);const pixels=await renderPixels();results.push({orthographicSize:size,center:sample(pixels,450),offCenter:sample(pixels,700)});}
 if(webgpu)await webgpu.gpu.device.queue.onSubmittedWorkDone();
 const expected=results[0].center;
 for(const result of results)for(const pixel of [result.center,result.offCenter])if(Math.abs(pixel[0]-expected[0])>1||pixel[1]<253)throw Error('Water depth changed with orthographic zoom or screen position: '+JSON.stringify(results));
 for(const result of results)for(const pixel of [result.center,result.offCenter])if(Math.abs(pixel[2]-expected[2])>1)throw Error('Orthographic view direction changed: '+JSON.stringify(results));
 // Compare actual water color over white and black seabeds, without probe output.
 material._extraBits=material._extraBits.filter(bit=>bit!==probe);material._invalidateDescriptor();water.invalidate();
 const transmission=[];
 for(const depth of [8,.25]){const encoded=Math.round((-depth+128)/256*65535);bed.source.resource.set([encoded>>8,encoded&255,0,255]);bed.source.update();ground.position.y=-depth-.5;
  for(const size of [20,1200]){view.camera.orthographicSize=size*(framed?32:1);ground.material.baseColor=0xffffff;const white=sample(await renderPixels(),700);ground.material.baseColor=0;const black=sample(await renderPixels(),700);const contrast=Math.max(...white.map((v,i)=>Math.abs(v-black[i])));transmission.push({depth,orthographicSize:size,contrast,white,black});}
 }
 for(const sample of transmission)if(sample.depth===8?sample.contrast>20:sample.contrast<40)throw Error('Unexpected seabed visibility: '+JSON.stringify(transmission));
 if(webgpu)await webgpu.gpu.device.queue.onSubmittedWorkDone();
 // Isolate postprocess leakage: a solid water colour must hide seabed AO.
 material._extraBits.push({name:'solidWaterOcclusionProbe',gl:{fragment:{end:'finalColor=vec3(.5);'}},gpu:{fragment:{end:'finalColor=vec3<f32>(0.5);'}}});material._invalidateDescriptor();water.invalidate();
 ground.position.y=-8.5;view.camera.orthographicSize=20*(framed?32:1);
 view.passes=[new SafeSsaoEffect({radius:3*(framed?32:1),maxDistance:5*(framed?32:1),intensity:1,power:1.25,bias:.02,samples:32,resolution:'inherit'})];
 const difference=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]-b[i+c])))>1)n++;return n;};
 const occlusion=[];
 for(const mode of ['orthographic','perspective']){view.camera.mode=mode;
  for(const writesDepth of [false,true]){const previous=material;material=new previous.constructor({doubleSided:true,extraBits:previous._extraBits});
   for(const key in previous.data)if(!key.startsWith('_')){const v=previous.data[key];if(typeof v==='number'||ArrayBuffer.isView(v)||Array.isArray(v))material.data[key]=ArrayBuffer.isView(v)?v.slice():v;}
   for(const key in previous.textures)if(previous.textures[key]?.source)material.textures[key]=previous.textures[key];material.state.depthMask=writesDepth;water.material=material;previous.destroy();cliff.visible=false;const flat=await renderPixels();cliff.visible=true;const raised=await renderPixels();const changedPixels=difference(flat,raised);occlusion.push({mode,writesDepth,changedPixels});if(writesDepth?changedPixels!==0:changedPixels<50)throw Error('Submerged terrain leaked into water AO: '+JSON.stringify(occlusion));}
 }
 view.passes=[...view.passes];await renderPixels();view.unload();await renderPixels();
 if(webgpu)await webgpu.gpu.device.queue.onSubmittedWorkDone();
 if(errors.length)throw Error(errors.join('\n'));
 status.textContent=JSON.stringify({verified:true,backend,frame:framed?'host':'native',encoding:'R=physical depth / 20m, G=optical / physical depth, B=vertical view cosine',results,transmission,occlusion,errors},null,2);document.title='Water Depth Verified '+backend;
}catch(e){status.textContent=e.stack+'\n'+errors.join('\n');document.title='Water Depth Probe Failed';}
