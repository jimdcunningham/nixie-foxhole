import {planes} from './terrain-tools.mjs';
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const smooth=t=>t*t*t*(t*(t*6-15)+10);
function clipSegment(a,b,margin){
 let lo=0,hi=1;
 for(const [nx,nz,c]of planes){const limit=c-margin*Math.hypot(nx,nz),da=nx*a[0]+nz*a[2]-limit,db=nx*b[0]+nz*b[2]-limit;if(da>0&&db>0)return null;if((da>0)!==(db>0)){const t=da/(da-db);if(da>0)lo=Math.max(lo,t);else hi=Math.min(hi,t);}}
 return lo<=hi?[mix(a,b,lo),mix(a,b,hi)]:null;
}
export function constrainCamera(point,margin=24){
 const p=[...point];for(let pass=0;pass<4;pass++)for(const [a,b,c]of planes){const excess=a*p[0]+b*p[2]-c+margin*Math.hypot(a,b);if(excess>0){const length=a*a+b*b;p[0]-=a*excess/length;p[2]-=b*excess/length;}}return p;
}
export function arcPath(points){
 const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+distance(points[i-1],points[i]));
 return{points,lengths,length:lengths.at(-1),at(d){d=clamp(d,0,lengths.at(-1));let lo=0,hi=lengths.length-1;while(lo+1<hi){const mid=(lo+hi)>>1;if(lengths[mid]<d)lo=mid;else hi=mid;}return mix(points[lo],points[hi],(d-lengths[lo])/Math.max(1e-8,lengths[hi]-lengths[lo]));}};
}
function choose(rows,weight,rng){let total=0;const weights=rows.map(x=>{const w=weight(x);total+=w;return w;});let n=rng()*total;for(let i=0;i<rows.length;i++){n-=weights[i];if(n<=0)return rows[i];}return rows.at(-1);}
export function buildRoadNetwork(source,{joinRadius=3,margin=15}={}){
 const nodes=[],edges=[],buckets=new Map(),seen=new Set();
 function node(point){const gx=Math.floor(point[0]/joinRadius),gz=Math.floor(point[2]/joinRadius);let nearest=null,best=joinRadius;
  for(let x=gx-1;x<=gx+1;x++)for(let z=gz-1;z<=gz+1;z++)for(const n of buckets.get(x+','+z)||[]){const d=distance(n.point,point);if(d<best&&Math.abs(n.point[1]-point[1])<2){best=d;nearest=n;}}
  if(nearest)return nearest;const n={id:nodes.length,point,edges:[]};nodes.push(n);const key=gx+','+gz;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(n);return n;
 }
 function add(points,curve){if(points.length<2)return;const path=arcPath(points);if(path.length<3)return;const a=node(points[0]),b=node(points.at(-1));if(a===b)return;
  const middle=path.at(path.length/2),key=[Math.min(a.id,b.id),Math.max(a.id,b.id),...middle.map(v=>Math.round(v*2))].join(':');if(seen.has(key))return;seen.add(key);
  const edge={id:edges.length,a,b,path,source:curve.id,mesh:curve.mesh,visits:0};edges.push(edge);a.edges.push(edge);b.edges.push(edge);
 }
 for(const curve of source.curves){let run=[];for(let i=1;i<curve.points.length;i++){
  const segment=clipSegment(curve.points[i-1],curve.points[i],margin);if(!segment){add(run,curve);run=[];continue;}
  if(run.length&&distance(run.at(-1),segment[0])>.01){add(run,curve);run=[];}if(!run.length)run.push(segment[0]);if(distance(run.at(-1),segment[1])>.001)run.push(segment[1]);
 }add(run,curve);}
 const components=[];for(const n of nodes){if(n.component!==undefined||!n.edges.length)continue;const id=components.length,queue=[n],members=new Set();n.component=id;while(queue.length){const cur=queue.pop();for(const e of cur.edges){members.add(e);const other=e.a===cur?e.b:e.a;if(other.component===undefined){other.component=id;queue.push(other);}}}components.push({edges:[...members],length:[...members].reduce((s,e)=>s+e.path.length,0)});}
 const candidates=edges.filter(e=>components[e.a.component].length>=100),eligible=candidates.length?candidates:edges;
 function route(rng=Math.random,origin=[0,0,0],spread=true){if(!eligible.length)return null;let best=null;
  for(let attempt=0;attempt<10;attempt++){
   const distant=spread?eligible.filter(e=>Math.hypot(e.path.points[0][0]-origin[0],e.path.points[0][2]-origin[2])>=250):[];
   let e=choose(distant.length?distant:eligible,x=>Math.sqrt(x.path.length)/(1+x.visits*3),rng),from=rng()<.5?e.a:e.b;
   const points=[],used=new Set(),ids=[],goal=350+rng()*400;let length=0,lastDirection=null;
   while(e&&used.size<300){used.add(e.id);ids.push(e.id);const forward=e.a===from,part=forward?e.path.points:[...e.path.points].reverse();for(const p of part)if(!points.length||distance(points.at(-1),p)>.001)points.push(p);length+=e.path.length;
    const end=forward?e.b:e.a,prev=part[Math.max(0,part.length-4)],tip=part.at(-1),norm=Math.hypot(tip[0]-prev[0],tip[2]-prev[2])||1;lastDirection=[(tip[0]-prev[0])/norm,(tip[2]-prev[2])/norm];if(length>=goal)break;
    const options=end.edges.filter(x=>!used.has(x.id));e=options.length?choose(options,x=>{const q=x.a===end?x.path.points[Math.min(3,x.path.points.length-1)]:x.path.points[Math.max(0,x.path.points.length-4)],dx=q[0]-end.point[0],dz=q[2]-end.point[2],l=Math.hypot(dx,dz)||1;return(.15+Math.max(0,(dx*lastDirection[0]+dz*lastDirection[1])/l))/(1+x.visits);},rng):null;from=end;
   }
   if(points.length<2)continue;const result={...arcPath(points),edgeIds:ids,source:edges[ids[0]].mesh};if(!best||result.length>best.length)best=result;if(result.length>=160)break;
  }
  if(best)for(const id of best.edgeIds)edges[id].visits++;return best;
 }
 return{nodes,edges,components,route,info:{nativeCurves:source.curves.length,edges:edges.length,connectedAreas:components.length,roadMetres:edges.reduce((s,e)=>s+e.path.length,0),largestConnectedMetres:Math.max(0,...components.map(c=>c.length))}};
}

// Conservative transformed model bounds supplement terrain clearance. This is
// camera navigation data only: it never culls or changes rendered geometry.
export function buildClearanceSampler(batches,terrain,{cell=16}={}){
 const minX=-1104,minZ=-960,nx=Math.ceil(2240/cell),nz=Math.ceil(1936/cell),stride=nx+1,cells=new Float32Array(stride*(nz+1));
 for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){let h=0;for(const dx of [-8,0,8])for(const dz of [-8,0,8])h=Math.max(h,terrain(minX+x*cell+dx,minZ+z*cell+dz)??0);cells[z*stride+x]=h;}
 for(const batch of batches)for(let i=0;i<batch.size;i++){
  const box=batch.items[i].geometry.bounds3D,m=batch.matrices.data.subarray(batch.matrices.offset+i*batch.matrices.stride,batch.matrices.offset+i*batch.matrices.stride+16),c=[(box.min.x+box.max.x)/2,(box.min.y+box.max.y)/2,(box.min.z+box.max.z)/2],h=[(box.max.x-box.min.x)/2,(box.max.y-box.min.y)/2,(box.max.z-box.min.z)/2];
  const center=[0,1,2].map(a=>m[a]*c[0]+m[4+a]*c[1]+m[8+a]*c[2]+m[12+a]),extent=[0,1,2].map(a=>Math.abs(m[a])*h[0]+Math.abs(m[4+a])*h[1]+Math.abs(m[8+a])*h[2]);
  if(!center.every(Number.isFinite)||!extent.every(Number.isFinite))continue;
  for(let x=Math.max(0,Math.floor((center[0]-extent[0]-minX)/cell));x<=Math.min(nx,Math.ceil((center[0]+extent[0]-minX)/cell));x++)for(let z=Math.max(0,Math.floor((center[2]-extent[2]-minZ)/cell));z<=Math.min(nz,Math.ceil((center[2]+extent[2]-minZ)/cell));z++)cells[z*stride+x]=Math.max(cells[z*stride+x],center[1]+extent[1]);
 }
 // Spread height outward so the camera starts climbing before a roof or cliff,
 // then interpolate the conservative envelope instead of jumping between cells.
 const step=cell*.7;
 for(let z=0;z<=nz;z++){for(let x=1;x<=nx;x++)cells[z*stride+x]=Math.max(cells[z*stride+x],cells[z*stride+x-1]-step);for(let x=nx-1;x>=0;x--)cells[z*stride+x]=Math.max(cells[z*stride+x],cells[z*stride+x+1]-step);}
 for(let x=0;x<=nx;x++){for(let z=1;z<=nz;z++)cells[z*stride+x]=Math.max(cells[z*stride+x],cells[(z-1)*stride+x]-step);for(let z=nz-1;z>=0;z--)cells[z*stride+x]=Math.max(cells[z*stride+x],cells[(z+1)*stride+x]-step);}
 return(x,z)=>{const gx=clamp((x-minX)/cell,0,nx-1e-6),gz=clamp((z-minZ)/cell,0,nz-1e-6),ix=Math.floor(gx),iz=Math.floor(gz),fx=gx-ix,fz=gz-iz,at=iz*stride+ix;
  return Math.max(terrain(x,z)??0,(cells[at]*(1-fx)+cells[at+1]*fx)*(1-fz)+(cells[at+stride]*(1-fx)+cells[at+stride+1]*fx)*fz);};
}
export const tourViews={close:{height:24,trail:38},scenic:{height:48,trail:70},high:{height:105,trail:125}};
export class RoadTour{
 constructor(network,{terrain,clearance=terrain,random=Math.random}={}){this.network=network;this.terrain=terrain;this.clearance=clearance;this.random=random;this.state='idle';this.speed=12;this.view='variety';this.routeNumber=0;this.totalMetres=0;this.seconds=0;this.visited=new Set();this.route=null;this.pose=null;this.viewStyle='scenic';}
 safe(position){const p=[...position];p[1]=Math.max(p[1],(this.clearance(p[0],p[2])??0)+8);return p;}
 desired(){const d=this.distance,p=this.route.at(d),a=this.route.at(d+22),b=this.route.at(d-18),len=Math.hypot(a[0]-b[0],a[2]-b[2])||1,dir=[(a[0]-b[0])/len,(a[2]-b[2])/len],style=tourViews[this.view==='variety'?this.viewStyle:this.view],side=Math.sin(this.distance/120)*style.trail*.2;
  const position=constrainCamera([p[0]-dir[0]*style.trail+dir[1]*side,p[1]+style.height,p[2]-dir[1]*style.trail-dir[0]*side]);
  const target=[a[0],Math.max(a[1],this.terrain(a[0],a[2])??a[1])+3,a[2]];return{position:this.safe(position),target};
 }
 next(pose=this.pose){if(!pose)return false;const route=this.network.route(this.random,pose.target,true);if(!route)return false;this.route=route;this.distance=0;this.routeNumber++;
  if(this.view==='variety'){const options=Object.keys(tourViews).filter(x=>x!==this.viewStyle);this.viewStyle=options[Math.floor(this.random()*options.length)];}else this.viewStyle=this.view;
  const end=this.desired();this.transition={from:{position:[...pose.position],target:[...pose.target]},to:end,time:0,duration:clamp(distance(pose.position,end.position)/100,5,13)};this.pose={position:[...pose.position],target:[...pose.target]};this.state='running';return true;
 }
 start(pose){if(this.state==='paused'){this.pose={position:[...pose.position],target:[...pose.target]};const end=this.desired();this.transition={from:this.pose,to:end,time:0,duration:clamp(distance(pose.position,end.position)/100,3,13)};this.state='running';return true;}return this.next(pose);}
 pause(){if(this.state==='running')this.state='paused';}
 stop(){this.state='idle';this.transition=null;}
 update(seconds){if(this.state!=='running')return this.pose;const dt=clamp(seconds,0,.1);this.seconds+=dt;
  if(this.transition){const t=this.transition;t.time+=dt;const alpha=clamp(t.time/t.duration,0,1),e=smooth(alpha),position=mix(t.from.position,t.to.position,e);position[1]+=Math.sin(Math.PI*e)*Math.min(150,distance(t.from.position,t.to.position)*.12);this.pose={position:this.safe(position),target:mix(t.from.target,t.to.target,e)};if(alpha===1)this.transition=null;return this.pose;}
  const before=this.distance;this.distance=Math.min(this.route.length,this.distance+this.speed*dt);this.totalMetres+=this.distance-before;const desired=this.desired(),alpha=1-Math.exp(-dt*2);
  this.pose={position:this.safe(mix(this.pose.position,desired.position,alpha)),target:mix(this.pose.target,desired.target,alpha)};
  const p=this.route.at(this.distance);this.visited.add(Math.floor(p[0]/200)+','+Math.floor(p[2]/200));if(this.distance>=this.route.length)this.next(this.pose);return this.pose;
 }
 snapshot(){return{state:this.state,phase:this.transition?'flyover':'following',routeNumber:this.routeNumber,view:this.view==='variety'?this.viewStyle:this.view,speedMetresPerSecond:this.speed,routeMetres:this.route?.length??0,routeProgressMetres:this.distance??0,totalRoadMetres:this.totalMetres,activeSeconds:this.seconds,visitedAreas:this.visited.size,network:this.network.info,camera:this.pose?.position,target:this.pose?.target};}
}
