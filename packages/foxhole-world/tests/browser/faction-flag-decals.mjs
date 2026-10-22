// Serve with the world Vite harness and a <pre> status element.
// Run backend=webgl/webgpu with and without frame=host.
import {Application,Texture,BufferImageSource} from 'pixi.js';
import {View3D,Camera3D,Container3D,Geometry3D,Mesh3D,BatchedMesh3D,Matrix4,RenderPassBit,Material3D,AmbientLight} from '@pixi/3d';
import '@pixi/3d/webgpu';import '@pixi/3d/webgl';
import {SurfaceDecalPass,surfaceDecalMaterial,factionFlagPassMask} from '../../authoring/surface-decal-pass.mjs';
import {applyRegionFrame} from '../../runtime/spatial-frame.mjs';
const output=document.querySelector('pre'),params=new URLSearchParams(location.search),backend=params.get('backend')||'webgl',framed=params.get('frame')==='host',errors=[];
try{
 let webgpu;if(backend==='webgpu'){const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice({requiredFeatures:['indirect-first-instance']});device.addEventListener('uncapturederror',e=>errors.push(e.error.message));webgpu={gpu:{adapter,device}};}
 const app=new Application();await app.init({width:600,height:400,resolution:1,autoStart:false,antialias:false,preference:backend,webgpu,background:0x222222});document.body.append(app.canvas);
 const view=new View3D({width:600,height:400,camera:new Camera3D({mode:'orthographic',near:.1,far:100}),environment:null,toneMapping:'none',passes:[new SurfaceDecalPass()]});app.stage.addChild(view);view.camera.orthographicSize=4;view.camera.position.set(0,0,5);view.camera.lookAt({x:0,y:0,z:0});view.root.addChild(new AmbientLight({intensity:1}));
 const root=new Container3D();view.root.addChild(root);
 const quad=(width,height,z,material,x=0,y=0)=>{const mesh=new Mesh3D({geometry:new Geometry3D({positions:new Float32Array([-width/2,-height/2,0,width/2,-height/2,0,width/2,height/2,0,-width/2,height/2,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]),uvs:new Float32Array([0,1,1,1,1,0,0,0]),indices:new Uint16Array([0,1,2,0,2,3])}),material,castShadow:false});mesh.position.set(x,y,z);root.addChild(mesh);return mesh;};
 const wall=quad(5,3,-.05,new Material3D({baseColor:0xaaaaaa,roughness:1}));
 const pixels=new Uint8Array(4*4*4);for(let y=0;y<4;y++)for(let x=0;x<4;x++)pixels.set([255,255,255,x<2&&y<2?0:255],(y*4+x)*4);
 const cloth=new Material3D({baseColor:0x2468e0,baseColorTexture:new Texture({source:new BufferImageSource({resource:pixels,width:4,height:4,format:'rgba8unorm',autoGenerateMipmaps:false,scaleMode:'nearest'})}),roughness:1,doubleSided:true,alphaMode:'mask',alphaCutoff:.3333});
 const flagSource=quad(2,2,0,cloth),decal=quad(5,3,.02,surfaceDecalMaterial(new Material3D({baseColor:0x55bb22,roughness:1,alphaMode:'blend'}))),foreground=quad(.4,.4,.2,new Material3D({baseColor:0xe02020,roughness:1}),.5,-.5);
 const flag=new BatchedMesh3D({size:1});flagSource.visible=false;flag.setGeometryAt(0,flagSource.geometry);flag.setMaterialAt(0,cloth);flag.setMatrixAt(0,new Matrix4());flag.setItemActive(0,RenderPassBit.OPAQUE);root.addChild(flag);
 if(framed){applyRegionFrame({root,materials:[],terrainPass:{}},{x:100000,y:-200000,scale:32});view.camera.near=3.2;view.camera.far=3200;view.camera.orthographicSize=128;view.camera.position.set(100000,200160,0);view.camera.lookAt({x:100000,y:200000,z:0},{x:0,y:0,z:1});}
 const read=async()=>{app.render();app.render();let data;
  if(backend==='webgl'){const gl=app.renderer.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,null);data=new Uint8Array(600*400*4);gl.readPixels(0,0,600,400,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;}
  const device=webgpu.gpu.device,target=app.renderer.renderTarget.getGpuRenderTarget(app.renderer.renderTarget.rootRenderTarget).canvasTextures[0],stride=Math.ceil(600*4/256)*256,buffer=device.createBuffer({size:stride*400,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:target},{buffer,bytesPerRow:stride},{width:600,height:400});device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const source=new Uint8Array(buffer.getMappedRange());data=new Uint8Array(600*400*4);for(let y=0;y<400;y++)data.set(source.subarray(y*stride,y*stride+600*4),y*600*4);buffer.unmap();buffer.destroy();if(target.format.startsWith('bgra'))for(let i=0;i<data.length;i+=4){const r=data[i];data[i]=data[i+2];data[i+2]=r;}return data;
 };
 // The reflected Z-up host frame mirrors screen X for this front-facing camera.
 const sample=(data,x,y)=>{if(framed)x=600-x;const row=backend==='webgl'?399-y:y;return Array.from(data.slice((row*600+x)*4,(row*600+x)*4+3));};
 const samples=data=>({cloth:sample(data,350,150),cutout:sample(data,250,150),wall:sample(data,450,200),occluder:sample(data,350,250)});
 const before=samples(await read());flag.setItemActive(0,factionFlagPassMask(cloth));flag.invalidate(0);const after=samples(await read());
 const delta=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
 if(before.cloth[1]<before.cloth[2]+50||after.cloth[2]<after.cloth[1]+50)throw Error('Flag must cover the projected decal: '+JSON.stringify({before,after}));
 for(const key of ['cutout','wall','occluder'])if(delta(before[key],after[key])>1)throw Error('Flag surface pass changed '+key+': '+JSON.stringify({before,after}));
 if(after.cutout[1]<after.cutout[2]+50||after.wall[1]<after.wall[2]+50||after.occluder[0]<after.occluder[1]+50)throw Error('Missing cutout, wall decal or foreground occlusion: '+JSON.stringify({before,after}));
 view.passes=[...view.passes];const rebuilt=samples(await read());view.unload();const reloaded=samples(await read());for(const key of Object.keys(after))if(delta(after[key],rebuilt[key])>1||delta(after[key],reloaded[key])>1)throw Error('Graph rebuild changed '+key);
 if(webgpu)await webgpu.gpu.device.queue.onSubmittedWorkDone();if(errors.length)throw Error(errors.join('\n'));
 output.textContent=JSON.stringify({verified:true,backend,frame:framed?'host':'native',before,after,rebuilt,reloaded,errors},null,2);document.title='Faction Flag Decals Verified '+backend;
}catch(error){output.textContent=error.stack+'\n'+errors.join('\n');document.title='Faction Flag Decals Failed';}
