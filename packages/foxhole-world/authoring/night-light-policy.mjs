import{dayLighting}from'./day-night.mjs';import{inHex}from'./terrain-tools.mjs';
export function lightKind(name){if(/^TownWindowGlass(?:Translucent)?$|^StorageFacilityWindows$/i.test(name))return'window';if(/^LanternEmissive(?::.*)?$|^HangingLantern$|^LampGlass$/i.test(name))return'lantern';return null;}
export function eligibleNightPrototype(name){return !/rubble|ruin|destroyed|relic/i.test(name);}
export const nightAmount=hour=>1-dayLighting(hour).daylight;
export function maskPixel(name,r,g,b,a=255){if(a<80)return 0;if(name==='HangingLantern')return Math.max(0,Math.min(1,(Math.min(r-140,g-115,r-b-22))/35));if(name==='StorageFacilityWindows')return Math.max(0,Math.min(1,(Math.min(g,b)-r-4)/15));return Math.max(0,Math.min(1,(r+g+b)/3/180));}
function sampleMask(mask,u,v){if(!mask)return 1;mask.bytes??=Uint8Array.from(atob(mask.data),c=>c.charCodeAt(0));const x=Math.min(mask.size-1,Math.floor(((u%1+1)%1)*mask.size)),y=Math.min(mask.size-1,Math.floor(((v%1+1)%1)*mask.size));return mask.bytes[y*mask.size+x]/255;}
// Weld by position to keep UV seams from splitting one bulb/window into lights.
export function emitterShapes(vertices,indices,config){
 const parents=[],keys=new Map(),weld=new Map(),triangles=[];const find=i=>parents[i]===i?i:(parents[i]=find(parents[i]));
 for(let i=0;i<indices.length;i+=3){const ids=Array.from(indices.slice(i,i+3)),vs=ids.map(id=>vertices[id]),u=vs.reduce((s,v)=>s+v[6],0)/3,v=vs.reduce((s,v)=>s+v[7],0)/3;if(sampleMask(config.mask,u,v)<.12&&!vs.some(v=>sampleMask(config.mask,v[6],v[7])>.5))continue;
  const welds=ids.map(id=>{if(weld.has(id))return weld.get(id);const key=vertices[id].slice(0,3).map(v=>Math.round(v*100)).join('/');let n=keys.get(key);if(n===undefined){n=parents.length;parents.push(n);keys.set(key,n);}weld.set(id,n);return n;});for(let k=1;k<3;k++)parents[find(welds[k])]=find(welds[0]);triangles.push({ids,weld:welds[0]});
 }
 const groups=new Map();for(const t of triangles){const key=find(t.weld);if(!groups.has(key))groups.set(key,new Set());for(const id of t.ids)groups.get(key).add(id);}
 const raw=[...groups.values()].map(ids=>{const vs=[...ids].map(i=>vertices[i]),min=[0,1,2].map(a=>Math.min(...vs.map(v=>v[a]))),max=[0,1,2].map(a=>Math.max(...vs.map(v=>v[a]))),center=min.map((v,a)=>(v+max[a])/2),normal=[0,1,2].map(a=>vs.reduce((s,v)=>s+v[a+3],0)),len=Math.hypot(...normal)||1;return{center,normal:normal.map(v=>v/len),kind:config.kind};});
 const fixtures=[];for(const shape of raw){const near=fixtures.find(f=>Math.hypot(...f.center.map((v,i)=>v-shape.center[i]))<(config.kind==='window'?1.5:.7)&&(config.kind!=='window'||f.normal.reduce((s,v,i)=>s+v*shape.normal[i],0)>.9));if(near){const n=near.panes||1;near.center=near.center.map((v,i)=>(v*n+shape.center[i])/(n+1));near.panes=n+1;}else fixtures.push({...shape,panes:1});}return fixtures;
}
export function placeEmitter(shape,m,category,name){const c=shape.center,p=[m[0]*c[0]+m[4]*c[1]+m[8]*c[2]+m[12],m[1]*c[0]+m[5]*c[1]+m[9]*c[2]+m[13],m[2]*c[0]+m[6]*c[1]+m[10]*c[2]+m[14]],n=shape.normal;
 // Inverse-transpose normal, including mirrored/nonuniform instance transforms.
 const a=[m[0],m[1],m[2]],b=[m[4],m[5],m[6]],d=[m[8],m[9],m[10]],cross=(u,v)=>[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],bc=cross(b,d),dc=cross(d,a),ab=cross(a,b),det=a.reduce((s,v,i)=>s+v*bc[i],0);if(Math.abs(det)<1e-8)return null;const normal=[0,1,2].map(i=>(bc[i]*n[0]+dc[i]*n[1]+ab[i]*n[2])/det),length=Math.hypot(...normal)||1;for(let i=0;i<3;i++){normal[i]/=length;if(shape.kind==='window')p[i]+=normal[i]*.35;}
 if(!p.every(Number.isFinite)||!inHex(p[0],p[2]))return null;return{position:p,normal,kind:shape.kind,category,name,range:shape.kind==='window'?11:12,intensity:shape.kind==='window'?100:150};
}
export function selectEmitters(emitters,{position,target,visible,project,width,height,previous=new Set(),limit=24}){
 const result=[];for(const e of emitters){if(!visible(e.category))continue;const p=project(e.position);if(!p||p.x<-.1*width||p.x>1.1*width||p.y<-.1*height||p.y>1.1*height)continue;const toCamera=e.position.map((v,i)=>position[i]-v);if(e.kind==='window'&&e.normal.reduce((sum,v,i)=>sum+v*toCamera[i],0)<0)continue;const d=Math.hypot(...toCamera),focus=Math.hypot(...e.position.map((v,i)=>v-target[i])),score=(d*.3+focus*.7)*(previous.has(e)? .8:1);result.push({e,score});}result.sort((a,b)=>a.score-b.score);const chosen=[],owners=new Map();for(const {e}of result){const owner=e.owner||e;if((owners.get(owner)||0)>=4)continue;chosen.push(e);owners.set(owner,(owners.get(owner)||0)+1);if(chosen.length===limit)break;}return chosen;
}
