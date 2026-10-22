import {SurfaceDecalPass,surfaceDecalMaterial} from '../../authoring/surface-decal-pass.mjs';
import {Application,Texture,Rectangle} from 'pixi.js';
import {View3D,Camera3D,Container3D,Geometry3D,FlatMaterial,Mesh3D,BatchedMesh3D,Matrix4,RenderPassBit} from '@pixi/3d';
import '@pixi/3d/webgl';
import '@pixi/3d/webgpu';
import {loadWorldDetails} from '../../authoring/world-details.mjs';

// Bundle this fixture for a browser. It checks actual shader output, not a CPU
// copy of the colour conversion, and exercises the renderer's transparency pass.
const output=document.querySelector('pre');
const results=[];
const encode=x=>255*(x<=0.0031308?12.92*x:1.055*x**(1/2.4)-0.055);
const hexBit={name:'smokeTestBoundary',gpu:{fragment:{material:''}},gl:{fragment:{material:''}}};
window.addEventListener('error',event=>{output.textContent+='\nERROR: '+event.message;});
async function run(backend){
 let gpuContext;
 if(backend==='webgpu'){
  const adapter=await navigator.gpu.requestAdapter();
  const device=await adapter.requestDevice({requiredFeatures:adapter.features.has('indirect-first-instance')?['indirect-first-instance']:[]});
  device.addEventListener('uncapturederror',event=>{output.textContent+='\nGPU ERROR: '+event.error.message;});
  gpuContext={adapter,device};
 }
 const app=new Application();
 await app.init({width:96,height:96,resolution:1,background:0x000000,autoStart:false,antialias:false,preference:backend,...(gpuContext?{webgpu:{gpu:gpuContext}}:{})});
 document.body.append(app.canvas);
 const view=new View3D({width:96,height:96,autoResize:false,toneMapping:'none',camera:new Camera3D({near:0.1,far:100,fov:45})});
 view.passes=[new SurfaceDecalPass()];app.stage.addChild(view);view.camera.position.set(0,0,10);view.camera.lookAt({x:0,y:0,z:0});
 async function sample(){const {pixels}=app.renderer.extract.pixels({target:app.stage,frame:new Rectangle(0,0,96,96),resolution:1});return [...pixels.slice((48*96+48)*4,(48*96+48)*4+4)];}
 async function smoke({linear=1,curve=1,alpha=1,z=3}={}){
  const root=new Container3D();view.root.addChild(root);
  const constant=value=>({Values:[value],EntryCount:1,EntryStride:1});
  const effects={materials:{smoke:{file:'white',color:[1,1,1],opacity:1}},placements:[{actor:'chimney',name:'Smoke',system:'smoke',visible:true,autoActivate:true,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,z,1]}],emitters:{smoke:[{name:'smoke'+curve,material:'smoke',count:1,acceleration:[[0,0,0],[0,0,0]],location:[[0,0,0],[0,0,0]],origin:[0,0,0],velocity:[[0,0,0],[0,0,0]],size:[[500,500,500],[500,500,500]],lifetime:[2,2],color:[[linear,linear,linear],[linear,linear,linear]],alpha:[alpha,alpha],curves:{color:constant(curve)}}]}};
  await loadWorldDetails({region:'deadlands',root,json:async path=>path.endsWith('details/render.json')?{chunks:[],coverage:[]}:path.endsWith('details/materials.json')?{}:path.endsWith('effects/render.json')?effects:{materials:{},placements:[]},zipped:async()=>new ArrayBuffer(0),texture:async()=>Texture.WHITE,hexBit});
  return root;
 }
 function pane(root,z,alpha=0.8,color=0xff0000,batch=false){const geometry=new Geometry3D({positions:new Float32Array([-4,-4,0,4,-4,0,4,4,0,-4,4,0]),uvs:new Float32Array([0,0,1,0,1,1,0,1]),indices:new Uint32Array([0,1,2,0,2,3])});const material=new FlatMaterial({baseColor:color,alpha,alphaMode:alpha===1?'opaque':'blend',doubleSided:true});const mesh=new Mesh3D({geometry,material});mesh.position.z=z;if(batch)surfaceDecalMaterial(material);if(batch===true){const group=new BatchedMesh3D({size:1,cull:'none',label:'surface decal batch'});group.setGeometryAt(0,geometry);group.setMaterialAt(0,material);const matrix=new Matrix4();matrix.elements[14]=z;group.setMatrixAt(0,matrix);group.setItemActive(0,material._passBit);root.addChild(group);}else root.addChild(mesh);return {geometry,material};}
 async function check(name,options,expected,panel){const root=await smoke(options),background=pane(root,-1,1,0x000000),receiver=options.receiver&&pane(root,options.receiver-0.001,1,0x00ff00),resource=panel&&pane(root,...panel);const pixel=await sample();const pass=expected.every((v,i)=>Math.abs(v-pixel[i])<=2);results.push({backend,name,pass,pixel,expected:expected.map(Math.round)});output.textContent=JSON.stringify(results,null,2);root.destroy({children:true});resource?.geometry.destroy(true);resource?.material.destroy();receiver?.geometry.destroy(true);receiver?.material.destroy();background.geometry.destroy(true);background.material.destroy();}
 await check('native dark smoke uses display encoding',{linear:0.78,curve:0.03},[encode(0.78*0.03),encode(0.78*0.03),encode(0.78*0.03)]);
 await check('middle grey and white curve remain correct',{linear:0.18},[encode(0.18),encode(0.18),encode(0.18)]);
 await check('alpha remains linear coverage',{linear:0.78,curve:0.03,alpha:0.5},[encode(0.78*0.03)*0.5,encode(0.78*0.03)*0.5,encode(0.78*0.03)*0.5]);
 await check('transparent surface behind smoke stays behind',{},[255,255,255],[0,0.8]);
 await check('transparent surface in front stays in front',{},[255,51,51],[5,0.8]);
 await check('opaque surface in front still depth-occludes smoke',{},[255,0,0],[5,1]);
 await check('opaque surface behind does not hide smoke',{},[255,255,255],[0,1]);
 await check('batched surface decal behind smoke stays behind',{},[255,255,255],[0,0.8,0xff0000,true]);
 await check('surface decal retains its alpha beneath thin smoke',{alpha:0.5},[229.5,127.5,127.5],[0,0.8,0xff0000,true]);
 await check('surface decal still renders when smoke is clear',{alpha:0},[204,0,0],[0,0.8,0xff0000,true]);
 await check('standalone road decal behind smoke stays behind',{},[255,255,255],[0,0.8,0xff0000,'mesh-decal']);
 await check('decal on a foreground receiver still occludes smoke',{receiver:5},[204,51,0],[5,0.8,0xff0000,true]);
 app.destroy(true);
}
try{await run('webgl');await run('webgpu');document.title=results.every(row=>row.pass)?'Smoke Checks Passed':'Smoke Checks Failed';output.textContent=JSON.stringify({passed:results.filter(row=>row.pass).length,total:results.length,results},null,2);}catch(error){output.textContent+='\nERROR: '+error.stack;document.title='Smoke Checks Failed';}
