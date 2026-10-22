import test from 'node:test';
import assert from 'node:assert/strict';
import {Geometry3D} from '@pixi/3d';
import {createTerrainExcavations} from '../authoring/terrain-excavations.mjs';
const prism=(x0,x1,z0,z1,y0=-1,y1=1)=>[y0,y1].flatMap(y=>[[x0,y,z0],[x1,y,z0],[x1,y,z1],[x0,y,z1]]);
function ground(slope=0){return new Geometry3D({positions:new Float32Array([-5,-5*slope,-5,5,5*slope,-5,5,5*slope,5,-5,-5*slope,5]),normals:new Float32Array(Array.from({length:4},()=>[-slope,1,0]).flat()),uvs:new Float32Array([0,0,1,0,1,1,0,1]),indices:new Uint32Array([0,2,1,0,3,2]),quantizeNormals:false});}
function area(g){if(!g)return 0;const p=g.attributes.aPosition.buffer.data,ix=g.indexBuffer.data;let sum=0;for(let i=0;i<ix.length;i+=3){const a=ix[i]*3,b=ix[i+1]*3,c=ix[i+2]*3;sum+=Math.abs((p[b]-p[a])*(p[c+2]-p[a+2])-(p[b+2]-p[a+2])*(p[c]-p[a]))/2;}return sum;}
test('terrain excavation preserves exact outside surfaces, UVs and source positions and restores on clear',()=>{
 const g=ground(),original=g.indexBuffer.data,positions=g.attributes.aPosition.buffer.data.slice(),cut=createTerrainExcavations(g);
 try{assert.equal(cut.set([prism(-1,1,-1,1)]),true);assert.ok(Math.abs(area(g)+area(cut.geometry)-96)<1e-5);assert.deepEqual(g.attributes.aPosition.buffer.data,positions);
  const p=cut.geometry.attributes.aPosition.buffer.data,uv=cut.geometry.attributes.aUV.buffer.data;for(let i=0;i<p.length/3;i++){assert.ok(Math.abs(uv[i*2]-(p[i*3]+5)/10)<1e-6);assert.ok(Math.abs(uv[i*2+1]-(p[i*3+2]+5)/10)<1e-6);}
  const replacement=cut.geometry,buffer=replacement.attributes.aPosition.buffer;assert.equal(cut.set([prism(-1,1,-1,1)]),false);assert.equal(cut.geometry,replacement);
  cut.set([]);assert.equal(g.indexBuffer.data,original);assert.equal(cut.geometry,null);assert.equal(buffer.destroyed,true);assert.equal(area(g),100);
 }finally{cut.destroy();g.destroy(true);}
});
test('excavation intersects sloped terrain in XYZ and ignores volumes above or below it',()=>{
 const g=ground(.25),cut=createTerrainExcavations(g);
 try{cut.set([prism(-1,1,-1,1,.1,.3)]);assert.ok(Math.abs(area(g)+area(cut.geometry)-98.8)<1e-4);
  cut.set([prism(-1,1,-1,1,4,5)]);assert.equal(cut.geometry,null);assert.equal(area(g),100);
  cut.set([prism(-1,1,-1,1,-5,-4)]);assert.equal(cut.geometry,null);
 }finally{cut.destroy();g.destroy(true);}
});
test('overlapping excavation volumes subtract their union and moving a hole releases old triangles',()=>{
 const g=ground(),original=g.indexBuffer.data,cut=createTerrainExcavations(g);
 try{cut.set([prism(0,2,0,2),prism(1,3,1,3)]);assert.ok(Math.abs(area(g)+area(cut.geometry)-93)<1e-4);
  cut.set([prism(100,101,100,101)]);assert.equal(cut.geometry,null);assert.equal(g.indexBuffer.data,original);
 }finally{cut.destroy();g.destroy(true);}
});

test('excavated road transitions retain both interpolated material channels and packed source normals',()=>{
 const base=ground(),p=base.attributes.aPosition.buffer.data,uv=base.attributes.aUV.buffer.data;
 const colors=new Float32Array(Array.from({length:4},(_,i)=>[p[i*3],p[i*3+2],0,1]).flat());
 const g=new Geometry3D({positions:p.slice(),normals:base.attributes.aNormal.buffer.data.slice(),uvs:uv.slice(),colors,colors1:colors.slice(),indices:base.indexBuffer.data.slice()}),cut=createTerrainExcavations(g);
 try{cut.set([prism(-1,1,-1,1)]);const result=cut.geometry,positions=result.attributes.aPosition.buffer.data;for(const name of ['aColor','aColor1']){const values=result.attributes[name].buffer.data;for(let i=0;i<positions.length/3;i++){assert.ok(Math.abs(values[i*4]-positions[i*3])<1e-5);assert.ok(Math.abs(values[i*4+1]-positions[i*3+2])<1e-5);}}assert.equal(result.attributes.aNormal.buffer.data[1],1);
 }finally{cut.destroy();g.destroy(true);base.destroy(true);}
});
