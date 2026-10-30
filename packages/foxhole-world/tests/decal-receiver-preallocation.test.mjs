import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,Matrix3,Vector3,Quaternion} from 'three';
import {attribute,flattenDecalReceiver} from '../authoring/decal-recipe-codec.mjs';

// The original conversion is the reference for exact replay hashes.
function reference(j,buffers){
 const p=[],n=[],ix=[],reflect=new Matrix4().makeScale(1,1,-1);
 function visit(index,parent){
  const node=j.nodes[index],local=node.matrix?new Matrix4().fromArray(node.matrix):new Matrix4().compose(new Vector3(...(node.translation||[0,0,0])),new Quaternion(...(node.rotation||[0,0,0,1])),new Vector3(...(node.scale||[1,1,1]))),m=parent.clone().multiply(local),normal=new Matrix3().getNormalMatrix(m);
  if(node.mesh!==undefined)for(const primitive of j.meshes[node.mesh].primitives){
   if(/lightbeam|lightcone|lanternbeam/i.test(j.materials?.[primitive.material]?.name||''))continue;
   const positions=attribute(j,buffers,primitive.attributes.POSITION),normals=primitive.attributes.NORMAL===undefined?null:attribute(j,buffers,primitive.attributes.NORMAL),indices=attribute(j,buffers,primitive.indices),base=p.length/3;
   for(let i=0;i<positions.length;i+=3){const v=new Vector3(...positions.subarray(i,i+3)).applyMatrix4(m),vn=new Vector3(...(normals?normals.subarray(i,i+3):[0,1,0])).applyMatrix3(normal).normalize();p.push(v.x,v.y,v.z);n.push(vn.x,vn.y,vn.z);}
   for(let k=0;k<indices.length;k+=3)ix.push(base+indices[k],base+indices[k+(m.determinant()<0?2:1)],base+indices[k+(m.determinant()<0?1:2)]);
  }
  for(const child of node.children||[])visit(child,m);
 }
 for(const index of j.scenes[j.scene||0].nodes)visit(index,reflect);
 return {p:new Float32Array(p),n:new Float32Array(n),ix:new Uint32Array(ix)};
}

function fixture(){
 const position=new Float32Array([0.125,-2,3, 4.5,0.25,-7, -0.75,3,0]),normal=new Int16Array([0,32767,0, 16384,16384,0, -32767,0,0]),index=new Uint16Array([0,1,2]);
 const buffers=[new Uint8Array(position.buffer),new Uint8Array(normal.buffer),new Uint8Array(index.buffer)];
 const accessors=[{bufferView:0,componentType:5126,count:3,type:'VEC3'},{bufferView:1,componentType:5122,count:3,type:'VEC3',normalized:true},{bufferView:2,componentType:5123,count:3,type:'SCALAR'}];
 const bufferViews=buffers.map((data,buffer)=>({buffer,byteOffset:0,byteLength:data.byteLength}));
 const mesh={primitives:[{attributes:{POSITION:0,NORMAL:1},indices:2},{attributes:{POSITION:0},indices:2},{attributes:{POSITION:0,NORMAL:1},indices:2,material:0}]};
 const nodes=[{translation:[2,4,-1],scale:[-2,0.5,3],children:[1]},{mesh:0,rotation:[0,Math.sin(Math.PI/8),0,Math.cos(Math.PI/8)]},{mesh:0,matrix:new Matrix4().makeTranslation(-4,1,8).toArray()}];
 return {j:{accessors,bufferViews,meshes:[mesh],nodes,materials:[{name:'lightbeam hidden'}],scenes:[{nodes:[0,2]}]},buffers};
}

test('preallocated receiver output exactly matches transformed, mirrored and repeated primitives',()=>{
 const {j,buffers}=fixture(),expected=reference(j,buffers),actual=flattenDecalReceiver(j,buffers);
 for(const key of ['p','n','ix'])assert.deepEqual(new Uint8Array(actual[key].buffer),new Uint8Array(expected[key].buffer),key);
 assert.equal(actual.p.length,36);assert.equal(actual.ix.length,12);
 // The parent negative scale cancels the source coordinate reflection; the
 // other root remains reflected, so they must use opposite triangle winding.
 assert.deepEqual([...actual.ix],[0,1,2,3,4,5,6,8,7,9,11,10]);
});

test('receiver supports empty scenes and shared mesh instances',()=>{
 const {j,buffers}=fixture();j.scenes[0].nodes=[];
 const empty=flattenDecalReceiver(j,buffers);assert.equal(empty.p.length,0);assert.equal(empty.n.length,0);assert.equal(empty.ix.length,0);
 j.scenes[0].nodes=[2,2];const expected=reference(j,buffers),actual=flattenDecalReceiver(j,buffers);
 for(const key of ['p','n','ix'])assert.deepEqual(new Uint8Array(actual[key].buffer),new Uint8Array(expected[key].buffer),key);
});
