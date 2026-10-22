import test from 'node:test';
import assert from 'node:assert/strict';
import {framedMaterialBits,applyRegionFrame} from '../runtime/spatial-frame.mjs';
import {nativeWaterBit} from '../authoring/native-water-bit.mjs';
let rendererAvailable=true;try{import.meta.resolve('@pixi/3d');}catch{rendererAvailable=false;}

test('region frames preserve metre scale and War API orientation away from the world origin',{skip:!rendererAvailable},async()=>{
 const {Container3D}=await import('@pixi/3d');
 for(const frame of [{x:0,y:0,scale:32},{x:-104832,y:60480,scale:32},{x:52416,y:-151200,scale:32}]){
  const root=new Container3D(),material={data:{}},terrainPass={};
  try{
   applyRegionFrame({root,materials:[material],terrainPass},frame);
   for(const point of [[0,0,0],[1,0,0],[0,1,0],[0,0,1],[-1092,-220,945]]){
    const p=root.toGlobal({x:point[0],y:point[1],z:point[2]}),expected=[frame.x+point[0]*frame.scale,-frame.y+point[2]*frame.scale,point[1]*frame.scale];
    for(const [i,key]of ['x','y','z'].entries())assert.ok(Math.abs(p[key]-expected[i])<.01);
    const native=[(p.x-frame.x)/frame.scale,p.z/frame.scale,(p.y+frame.y)/frame.scale];
    native.forEach((v,i)=>assert.ok(Math.abs(v-point[i])<.0001));
   }
   assert.equal(material.data.foxholeFrame,terrainPass.frame);
  }finally{root.destroy();}
 }
});

test('native and framed shader variants have distinct cache identities without mutating source bits',()=>{
 const bit={name:'boundary',gpu:{fragment:{material:'let p=input.vPosition;'}},gl:{fragment:{material:'vec3 p=vPosition;'}}};
 const material=framedMaterialBits([bit]),terrain=framedMaterialBits([bit],'terrain');
 assert.equal(bit.name,'boundary');assert.equal(bit.gpu.fragment.material,'let p=input.vPosition;');
 assert.equal(new Set([bit.name,...material.map(b=>b.name),...terrain.map(b=>b.name)]).size,7);
 assert.match(material[1].gpu.fragment.material,/material.foxholeFrame/);
});
test('framed water projects host coordinates while retaining metre-based depth absorption',()=>{
 const bit=framedMaterialBits([nativeWaterBit])[1];
 for(const backend of ['gpu','gl']){
  assert.doesNotMatch(bit[backend].header,/material\.foxholeFrame/);
  assert.match(bit[backend].header,/screenUVFromWorld\(foxholeNativeToWorld\(p,foxholeFrame\)\)/);
  assert.match(bit[backend].header,/return abs\([^;]+\)\/foxholeFrame.z;/);
  assert.match(bit[backend].fragment.material,/foxholeNativeViewDepth/);
  assert.match(bit[backend].fragment.material,/foxholeNativeToWorld\(refractedPoint,material.foxholeFrame\)/);
 }
});
test('cached attribute readers preserve strided positions and normalized normals and colours',{skip:!rendererAvailable},async()=>{
 const {attributeReader}=await import('../authoring/world-models.mjs');
 const bytes=new Uint8Array(48),view=new DataView(bytes.buffer);
 view.setFloat32(4,1.25,true);view.setFloat32(8,-2.5,true);view.setFloat32(12,3.75,true);view.setFloat32(28,9.5,true);
 const positions={attributes:{aPosition:{format:'float32x3',offset:4,stride:24,buffer:{data:bytes}}}};
 const p=attributeReader(positions,'aPosition',3,[0,0,0]);assert.deepEqual([p(0,0),p(0,1),p(0,2),p(1,0)],[1.25,-2.5,3.75,9.5]);
 const data=new Int16Array([-32768,0,32767,0]),normal=attributeReader({attributes:{aNormal:{format:'snorm16x4',buffer:{data}}}},'aNormal',3,[0,1,0]);
 assert.deepEqual([normal(0,0),normal(0,1),normal(0,2)],[-1,0,1]);
 const c=attributeReader({attributes:{aColor:{format:'unorm8x4',buffer:{data:new Uint8Array([0,64,128,255])}}}},'aColor',4,[1,1,1,1]);
 assert.deepEqual([c(0,0),c(0,1),c(0,2),c(0,3)],[0,64/255,128/255,1]);
});

test('actual Westgate factory and seaport anchors coincide with their normalized live-war icons',async()=>{
 const {Container3D,Geometry3D,Mesh3D,Material3D}=await import('@pixi/3d');
 const root=new Container3D(),geometry=new Geometry3D({positions:new Float32Array([0,0,0,1,0,0,0,0,1]),indices:new Uint32Array([0,1,2])}),material=new Material3D(),mesh=new Mesh3D({geometry,material});root.addChild(mesh);
 const frame={x:-157248,y:30240,scale:32};applyRegionFrame({root,materials:[],terrainPass:{}},frame);
 for(const [native,x,y]of [[[671.90936,7.198982,135.69344],.8076508,.42820454],[[172.08063,2.0381393,-387.5522],.5787915,.7050541]]){
  const point=root.toGlobal({x:native[0],y:native[1],z:native[2]});
  assert.ok(Math.abs(point.x-(frame.x+(x-.5)*2184*32))<.01);assert.ok(Math.abs(point.y-(-frame.y+(.5-y)*1890*32))<.01);
 }
 assert.deepEqual([...geometry.indexBuffer.data],[0,1,2],'source winding stays unchanged');assert.deepEqual([...mesh.geometry.indexBuffer.data],[0,2,1]);
 root.destroy({children:true});assert.notEqual(geometry.destroyed,true);geometry.destroy(true);material.destroy();
});

test('incremental frame preparation reflects each old and arriving geometry exactly once',async()=>{
 const {createRegionFramePreparation}=await import('../runtime/spatial-frame.mjs');const {Container3D,Geometry3D,Mesh3D,Material3D}=await import('@pixi/3d');
 const root=new Container3D(),geometry=new Geometry3D({positions:new Float32Array([0,0,0,1,0,0,0,0,1]),indices:new Uint32Array([0,1,2])}),material=new Material3D();
 const prepare=createRegionFramePreparation({root,materials:[material],terrainPass:{}},{scale:32});
 const first=root.addChild(new Mesh3D({geometry,material}));prepare.prepare(first);const reflected=first.geometry;
 const second=root.addChild(new Mesh3D({geometry,material}));prepare.prepare(second);prepare.prepare();prepare.prepare();
 assert.equal(first.geometry,reflected);assert.equal(second.geometry,reflected);assert.deepEqual([...reflected.indexBuffer.data],[0,2,1]);assert.deepEqual([...geometry.indexBuffer.data],[0,1,2]);
 root.destroy({children:true});assert.notEqual(geometry.destroyed,true);geometry.destroy(true);material.destroy();
});

test('preparing arriving batches never invalidates unchanged resident slots',async()=>{
 const {createRegionFramePreparation}=await import('../runtime/spatial-frame.mjs');const {Container3D,Geometry3D,Material3D,BatchedMesh3D,Matrix4}=await import('@pixi/3d');
 const root=new Container3D(),g=new Geometry3D({positions:new Float32Array([0,0,0,1,0,0,0,0,1]),indices:new Uint32Array([0,1,2])}),m=new Material3D();
 const batch=root.addChild(new BatchedMesh3D({size:2}));for(let i=0;i<2;i++){batch.setGeometryAt(i,g);batch.setMaterialAt(i,m);batch.setMatrixAt(i,new Matrix4());}
 const p=createRegionFramePreparation({root,materials:[],terrainPass:{}},{scale:32});p.prepare();let writes=0;const set=batch.setGeometryAt.bind(batch);batch.setGeometryAt=(i,g)=>{writes++;set(i,g);};
 p.prepare();p.prepare();assert.equal(writes,0);root.destroy({children:true});g.destroy(true);m.destroy();
});

test('host LOD derived from prepared geometry is not reflected again on later publications',async()=>{
 const {createRegionFramePreparation}=await import('../runtime/spatial-frame.mjs');
 const {Container3D,Geometry3D,Material3D,BatchedMesh3D}=await import('@pixi/3d');
 const root=new Container3D(),source=new Geometry3D({positions:new Float32Array([0,0,0,1,0,0,0,0,1]),indices:new Uint32Array([0,1,2])}),material=new Material3D();
 const batch=root.addChild(new BatchedMesh3D({size:1,label:'Catalog fixture'}));batch.setGeometryAt(0,source);batch.setMaterialAt(0,material);
 const p=createRegionFramePreparation({root,materials:[],terrainPass:{}},{scale:32});p.prepare();const framed=batch.items[0].geometry;
 const derived=new Geometry3D({positions:new Float32Array(source.positions),indices:new Uint32Array(framed.indexBuffer.data)});
 Object.defineProperty(derived,Symbol.for('nixie.spatial.derived-geometry-source'),{value:framed});
 batch.setGeometryAt(0,derived);let writes=0;const set=batch.setGeometryAt.bind(batch);batch.setGeometryAt=(slot,next)=>{writes++;return set(slot,next);};
 try{
  for(let i=0;i<200;i++)p.prepare();
  assert.equal(writes,0,'arriving cell preparation must not turn the installed host LOD into another reflected source');
  assert.ok(batch.items[0].geometry===derived);
  assert.deepEqual([...derived.indexBuffer.data],[0,2,1]);
 }finally{root.destroy({children:true});derived.destroy(true);source.destroy(true);material.destroy();}
});
