import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRegionShell,corners,edges,REGION_SHELL_FLOOR,REGION_SHELL_THICKNESS} from '../authoring/region-shell.mjs';

const shell=()=>buildRegionShell({summary:{source:'fixture'}});
test('shell retains the original map floor and adds outward walls, caps and a solid floor',()=>{
 const {positions:p,normals:n,summary}=shell();
 assert.equal(REGION_SHELL_FLOOR,-220);
 assert.equal(summary.floor,-220);
 assert.equal(summary.bottom,summary.floor-REGION_SHELL_THICKNESS);
 assert.ok(REGION_SHELL_THICKNESS>0);
 const points=Array.from({length:p.length/3},(_,i)=>Array.from(p.slice(i*3,i*3+3)));
 for(const [i,e] of edges.entries()){
  const outer=points.filter(v=>Math.abs((v[0]-e.a[0])*e.nx+(v[2]-e.a[1])*e.nz-REGION_SHELL_THICKNESS)<.001);
  assert.ok(outer.some(v=>v[1]===45),`wall ${i} has an outer top edge`);
  assert.ok(outer.some(v=>v[1]===summary.bottom),`wall ${i} reaches the underside`);
 }
 for(const [x,z] of corners)assert.ok(points.some(p=>p[0]===x&&p[1]===45&&p[2]===z),'inner footprint stays exact');
 assert.ok(points.some((v,i)=>v[1]===summary.floor&&n[i*3+1]===1),'floor has an upward surface');
 assert.ok(points.some((v,i)=>v[1]===summary.bottom&&n[i*3+1]===-1),'floor has a separate underside');
});

test('solid shell is closed with consistently wound nondegenerate faces and positive volume',()=>{
 const {positions:p,normals:n,indices}=shell(),boundaries=new Map();let volume=0;
 const vertex=i=>Array.from(p.slice(i*3,i*3+3));
 for(let i=0;i<indices.length;i+=3){
  const ids=Array.from(indices.slice(i,i+3)),[a,b,c]=ids.map(vertex),ab=b.map((v,k)=>v-a[k]),ac=c.map((v,k)=>v-a[k]);
  const cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
  assert.ok(Math.hypot(...cross)>0);
  assert.ok(cross.reduce((sum,v,k)=>sum+v*n[ids[0]*3+k],0)>0,'winding matches face normal');
  volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
  for(let k=0;k<3;k++){const v=vertex(ids[k]).join(','),w=vertex(ids[(k+1)%3]).join(','),key=[v,w].sort().join('|');const entry=boundaries.get(key)??{count:0,direction:0};entry.count++;entry.direction+=v<w?1:-1;boundaries.set(key,entry);}
 }
 for(const edge of boundaries.values()){assert.equal(edge.count,2,'every edge has two adjacent faces');assert.equal(edge.direction,0,'adjacent faces traverse the shared edge in opposite directions');}
 const area=6*1092*945/2;
 assert.ok(volume>area*REGION_SHELL_THICKNESS,'enclosed volume includes the floor and walls');
});

test('wall and floor index partitions preserve the complete solid shell',()=>{
 const value=shell(),combined=[...value.floorIndices,...value.wallIndices.flatMap(v=>[...v])].sort((a,b)=>a-b);
 assert.equal(value.wallIndices.length,6);assert.equal(value.floorIndices.length,36);
 assert.deepEqual(combined,[...value.indices].sort((a,b)=>a-b));
});
