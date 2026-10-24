// Load through the world browser harness from an HTML page with a <pre>.
// backend=webgl/webgpu and frame=host/native exercise the actual water shader.
import {Application,Texture,BufferImageSource} from 'pixi.js';
import {View3D,Camera3D,Container3D,Mesh3D,CubeGeometry,Material3D,AmbientLight,DirectionalLight} from '@pixi/3d';
import '@pixi/3d/webgpu';import '@pixi/3d/webgl';
import {createNativeWaterMaterial} from '../../authoring/native-water-material.mjs';
import {prepareWaterSurfaceDepth} from '../../runtime/water-surface-depth.mjs';
import {framedMaterialBits,applyRegionFrame} from '../../runtime/spatial-frame.mjs';
const status=document.querySelector('pre'),q=new URLSearchParams(location.search),backend=q.get('backend')||'webgl',framed=q.get('frame')!=='native',errors=[];
try{
 let webgpu;if(backend==='webgpu'){const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice({requiredFeatures:['indirect-first-instance']});device.addEventListener('uncapturederror',e=>errors.push(e.error.message));webgpu={gpu:{adapter,device}};}
 const width=800,height=600,app=new Application();await app.init({width,height,preference:backend,webgpu,antialias:false,useBackBuffer:true,autoStart:false});document.body.append(app.canvas);
 const camera=new Camera3D({near:.1,far:1000000}),view=new View3D({width,height,camera,environment:null,toneMapping:'aces'});app.stage.addChild(view);prepareWaterSurfaceDepth(view);
 const sun=new DirectionalLight({color:0xfff5eb,intensity:4.5});sun.lookAt(framed?{x:0,y:0,z:-1}:{x:0,y:-1,z:0},framed?{x:0,y:1,z:0}:{x:0,y:0,z:1});view.root.addChild(sun,new AmbientLight({intensity:2}));
 const tex=rgba=>new Texture({source:new BufferImageSource({resource:new Uint8Array(rgba),width:1,height:1,format:'rgba8unorm',autoGenerateMipmaps:false})}),normal=tex([128,128,255,255]),blank=tex([0,0,0,255]),encoded=Math.round((-20+128)/256*65535),bed=tex([encoded>>8,encoded&255,0,255]);
 const colors={'Body Color':{R:.024,G:.029,B:.028},'Depth Colour':{R:.054,G:.09,B:.076},EdgeColour01:{R:.218,G:.216,B:.229},FresnelFakeSSS:{R:.069,G:.089,B:.076}};
 let {material}=await createNativeWaterMaterial({region:'fixture',json:async id=>id.endsWith('boat-stencils.json')?[]:{textures:{waveLarge:'normal',waveSmall:'normal',foam:'blank',modulation:'blank',clouds:'blank'},material:{colors}},texture:async id=>id.endsWith('terrain-height.png')?bed:id==='normal'?normal:blank});material.data.waterReflectionStrength=0;
 if(framed){const old=material;material=new old.constructor({doubleSided:true,extraBits:framedMaterialBits(old._extraBits)});for(const key in old.data)if(!key.startsWith('_')){const v=old.data[key];if(typeof v==='number'||ArrayBuffer.isView(v)||Array.isArray(v))material.data[key]=ArrayBuffer.isView(v)?v.slice():v;}for(const key in old.textures)if(old.textures[key]?.source)material.textures[key]=old.textures[key];material.state.depthMask=old.state.depthMask;old.destroy();}
 const board=new Container3D();view.root.addChild(board);const water=new Mesh3D({geometry:new CubeGeometry({width:12000,height:.01,depth:12000}),material});water.position.y=-.005;board.addChild(water);const ground=new Mesh3D({geometry:new CubeGeometry({width:12000,height:1,depth:12000}),material:new Material3D({baseColor:0x29352a,roughness:1})});ground.position.y=-20.5;board.addChild(ground);
 if(framed)applyRegionFrame({root:board,materials:[material],terrainPass:{}},{x:10000,y:20000,scale:32});
 const world=(x,y,z)=>framed?{x:x*32+10000,y:z*32-20000,z:y*32}:{x,y,z};
 function aim(mode,size,tilt=0){const scale=framed?32:1;camera.mode=mode;const p=world(0,size,size*tilt);camera.position.set(p.x,p.y,p.z);camera.lookAt(world(0,0,0),framed?{x:0,y:1,z:0}:{x:0,y:0,z:-1});camera.orthographicSize=size*scale;camera.near=.1*scale;camera.far=size*scale*20;}
 async function pixels(){app.render();app.render();if(backend==='webgl'){const gl=app.renderer.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,null);const bytes=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return bytes;}
  const device=webgpu.gpu.device,target=app.renderer.renderTarget.getGpuRenderTarget(app.renderer.renderTarget.rootRenderTarget).canvasTextures[0],stride=Math.ceil(width*4/256)*256,buffer=device.createBuffer({size:stride*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:target},{buffer,bytesPerRow:stride},{width,height});device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const source=new Uint8Array(buffer.getMappedRange()),bytes=new Uint8Array(width*height*4);for(let y=0;y<height;y++)bytes.set(source.subarray(y*stride,y*stride+width*4),y*width*4);buffer.unmap();buffer.destroy();if(target.format.startsWith('bgra'))for(let i=0;i<bytes.length;i+=4){const r=bytes[i];bytes[i]=bytes[i+2];bytes[i+2]=r;}return bytes;
 }
 function stats(bytes){const sum=[0,0,0];let white=0;for(let y=250;y<350;y++)for(let x=350;x<450;x++){const i=(y*width+x)*4;for(let c=0;c<3;c++)sum[c]+=bytes[i+c];if(bytes[i]>230&&bytes[i+1]>230&&bytes[i+2]>230)white++;}return{mean:sum.map(n=>n/10000),whiteFraction:white/10000};}
 const results=[],sizes=[20,80,200,800,2000];
 for(const mode of ['orthographic','perspective'])for(const ponds of [false,true])for(const size of sizes){
  material.data.hasPonds=Number(ponds);water.position.y=ponds ? .005 : -.005;aim(mode,size);const lit=stats(await pixels());sun.intensity=0;const noSun=stats(await pixels());sun.intensity=4.5;
  const sunlight=Math.max(...lit.mean.map((v,i)=>v-noSun.mean[i])),result={mode,ponds,size,...lit,sunlight};results.push(result);
  if(lit.whiteFraction>.01||Math.max(...lit.mean)>180)throw Error('Water loses its colour in the noon highlight: '+JSON.stringify(results));
  if(sunlight<10)throw Error('Water must retain sunlight at every zoom: '+JSON.stringify(results));
 }
 // A resolved, moving wave field catches fixes that suppress glare by making
 // the entire water material rough. No generated assets are needed by this fixture.
 const waveBytes=new Uint8Array(64*64*4);
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){
  const u=x/64*Math.PI*2,v=y/64*Math.PI*2,i=(y*64+x)*4;
  const nx=.16*Math.sin(u*3+Math.sin(v*2)),nz=.16*Math.cos(v*2+Math.sin(u));
  waveBytes[i]=Math.round((nx+1)*127.5);waveBytes[i+1]=Math.round((nz+1)*127.5);waveBytes[i+2]=255;waveBytes[i+3]=255;
 }
 const waves=new Texture({source:new BufferImageSource({resource:waveBytes,width:64,height:64,format:'rgba8unorm',autoGenerateMipmaps:true})});waves.source.style.addressMode='repeat';
 material.textures.waveLarge=waves;material.data.hasPonds=0;water.position.y=-.015;aim('orthographic',20);
 material.data.waterTime=0;const waveStart=await pixels();material.data.waterTime=8;const waveEnd=await pixels();
 function detail(bytes){const values=[];for(let y=200;y<400;y++)for(let x=300;x<500;x++)values.push(bytes[(y*width+x)*4+1]);values.sort((a,b)=>a-b);return values[Math.floor(values.length*.9)]-values[Math.floor(values.length*.1)];}
 const waveContrast=detail(waveStart);let waveMotion=0;for(let y=200;y<400;y++)for(let x=300;x<500;x++){const i=(y*width+x)*4+1;waveMotion+=Math.abs(waveStart[i]-waveEnd[i]);}waveMotion/=40000;
 if(waveContrast<3||waveContrast>12||waveMotion<1)throw Error('Top-down orthographic water must retain subtle animated ripples: '+JSON.stringify({waveContrast,waveMotion}));
 const tinted=stats(waveStart),sourceBits=material._extraBits;
 // Compare with the unenhanced palette under identical light and wave normals.
 const neutralBody='bodyColor = mix(material.waterBody.rgb,material.waterShallow.rgb,shallows);albedo = mix(bodyColor*(1.0-transmitWater)*1.2,material.waterFoamColor.rgb,foam);';
 material._extraBits=[...sourceBits,{name:'waterSourceTintControl',gl:{fragment:{material:neutralBody}},gpu:{fragment:{material:neutralBody}}}];material._invalidateDescriptor();water.invalidate();material.data.waterTime=0;const neutral=stats(await pixels());
 const colorGain=(tinted.mean[1]-tinted.mean[0])-(neutral.mean[1]-neutral.mean[0]);
 const luminance=rgb=>rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722,brightnessChange=Math.abs(luminance(tinted.mean)-luminance(neutral.mean));
 if(colorGain<8||brightnessChange>5)throw Error('Water must retain its tint without boosting brightness: '+JSON.stringify({tinted,neutral,colorGain,brightnessChange}));
 material._extraBits=[...sourceBits,{name:'waterRoughnessRegressionControl',gl:{fragment:{material:'roughness = 0.48;'}},gpu:{fragment:{material:'roughness = 0.48;'}}}];material._invalidateDescriptor();water.invalidate();material.data.waterTime=0;const blurredContrast=detail(await pixels());
 if(waveContrast<blurredContrast*1.5)throw Error('Water wave contrast is no better than the roughness workaround: '+JSON.stringify({waveContrast,blurredContrast}));
 material._extraBits=sourceBits;material._invalidateDescriptor();water.invalidate();
 // Other projections keep the full wave relief; tilt changes it smoothly in
 // orthographic views. Inspect rendered normals independently of sun alignment.
 aim('perspective',20);const perspectiveContrast=detail(await pixels());
 if(perspectiveContrast<12||waveContrast>perspectiveContrast*.4)throw Error('Perspective waves must remain fuller than top-down orthographic ripples: '+JSON.stringify({waveContrast,perspectiveContrast}));
 const normalGL='finalColor = vec3(normal.x*0.5+0.5);',normalGpu='finalColor = vec3<f32>(normal.x*0.5+0.5);';
 material._extraBits=[...sourceBits,{name:'waterNormalDetailProbe',gl:{fragment:{end:normalGL}},gpu:{fragment:{end:normalGpu}}}];material._invalidateDescriptor();water.invalidate();
 const normalRelief=[];
 for(const [mode,tilt] of [['orthographic',0],['orthographic',.6],['orthographic',3],['perspective',0]]){aim(mode,20,tilt);normalRelief.push(detail(await pixels()));}
 const [overhead,angled,lowAngle,perspective]=normalRelief;
 if(overhead<1||angled<overhead*1.5||lowAngle<angled*1.2||perspective<overhead*3||Math.abs(lowAngle-perspective)>perspective*.4)throw Error('Wave relief must follow orthographic tilt in native water coordinates: '+JSON.stringify(normalRelief));
 material._extraBits=sourceBits;material._invalidateDescriptor();water.invalidate();
 if(webgpu)await webgpu.gpu.device.queue.onSubmittedWorkDone();if(errors.length)throw Error(errors.join('\n'));aim('orthographic',80);await pixels();status.textContent=JSON.stringify({verified:true,backend,framed,projections:['orthographic','perspective'],surfaces:['river','pond'],widthsMetres:sizes,cases:results.length,worstWhiteFraction:Math.max(...results.map(r=>r.whiteFraction)),brightestMean:Math.max(...results.flatMap(r=>r.mean)),minimumSunlight:Math.min(...results.map(r=>r.sunlight)),waveContrast,waveMotion,blurredContrast,colorGain,brightnessChange,perspectiveContrast,normalRelief,errors},null,2);document.title='Water Specular Verified '+backend;
}catch(e){status.textContent=e.stack+'\n'+errors.join('\n');document.title='Water Specular Failed';}
