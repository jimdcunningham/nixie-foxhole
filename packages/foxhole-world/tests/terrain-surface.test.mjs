import test from 'node:test';
import assert from 'node:assert/strict';
import {terrainSurfaceSampler} from '../authoring/terrain-surface.mjs';

function fixture(components) {
 const source=[], meta={components:[]};
 for(const {origin=[0,0],u=[1,0],v=[0,1],heights=[0,2,3,9]} of components){
  meta.components.push({name:'Landscape '+meta.components.length,size:2,offset:source.length/3});
  for(let y=0;y<2;y++)for(let x=0;x<2;x++)source.push(origin[0]+u[0]*x+v[0]*y,heights[y*2+x],origin[1]+u[1]*x+v[1]*y);
 }
 return terrainSurfaceSampler(meta,new Float32Array(source));
}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<0.0001,`${actual} != ${expected}`);

test('terrain height follows rendered triangles with fractional origins, rotation, reflection and scale',()=>{
 for(const [u,v] of [[[1,0],[0,-1]],[[0,2],[-3,0]],[[2,1],[-1,2]]]){
  const origin=[107.25,-59.375],sample=fixture([{origin,u,v}]);
  for(const [x,y,height] of [[.2,.3,1.3],[.8,.6,5],[0,0,0],[1,1,9]])close(sample(origin[0]+u[0]*x+v[0]*y,origin[1]+u[1]*x+v[1]*y),height);
 }
});

test('overlapping landscapes resolve the visible upper surface independently of export order',()=>{
 const upper={origin:[.25,.5],heights:[3,3,3,3]},lower={origin:[0,0],heights:[-250,-250,-250,-250]};
 for(const layers of [[upper,lower],[lower,upper]]){
  const sample=fixture(layers);close(sample(.5,.7),3);close(sample(.1,.1),-250);assert.equal(sample(2,2),null);
 }
});

test('terrain queries do not invent ground across component gaps or outside the landscape',()=>{
 const sample=fixture([{origin:[-65,-65]},{origin:[65,65]}]);
 close(sample(-64.8,-64.7),1.3);close(sample(65.2,65.3),1.3);
 for(const [x,z]of [[0,0],[-66,-65],[NaN,0],[Infinity,0]])assert.equal(sample(x,z),null);
});

test('pitched landscapes query the real projected triangles rather than an affine approximation',()=>{
 const source=new Float32Array([0,0,0, 1,2,0, 0,3,1, 1.2,9,1.4]);
 const sample=terrainSurfaceSampler({components:[{name:'Tilted',size:2,offset:0}]},source);
 close(sample(.3,.5),2.1);
 close(sample((1+1.2+0)/3,(0+1.4+1)/3),(2+9+3)/3);
 assert.equal(sample(1.3,1.3),null);
});

