import {PointLight,SpotLight} from '@pixi/3d';

const budgets=new WeakMap();
export function catalogLightBudgetFor(renderer){
 let budget=budgets.get(renderer);
 if(!budget){budget=createCatalogLightBudget();budgets.set(renderer,budget);}
 return budget;
}

// Snapshot before the temporary Model3D is destroyed. The authored transform,
// colour, photometric intensity and spot cone remain independent of mesh batches.
export function catalogLightPart(light,matrix){
 return {matrix,type:light.type,color:light.color.toArray().slice(0,3),intensity:light.intensity,
  range:light.range,coneAngle:light.coneAngle,penumbra:light.penumbra};
}

export function createCatalogLightBudget({limit=24,intervalMS=200,now=()=>performance.now()}={}){
 const owners=new Set(),selected=[],pool=[],bound=[];
 const metrics={candidates:0,active:0,budget:limit};
 let camera,planes,last=-Infinity,dirty=true;
 function visible(node){for(let p=node;p;p=p.parent)if(p.visible===false||p.destroyed)return false;return true;}
 function inView(e){if(!planes||!e.worldRange)return true;for(let i=0;i<24;i+=4)if(planes[i]*e.x+planes[i+1]*e.y+planes[i+2]*e.z+planes[i+3]<-e.worldRange)return false;return true;}
 function select(){
  selected.length=0;metrics.candidates=0;
  for(const owner of owners)for(const e of owner.entries){
   metrics.candidates++;
   if(!e.active||!visible(e.parent)||!inView(e))continue;
   e.score=(e.x-camera[0])**2+(e.y-camera[1])**2+(e.z-camera[2])**2;
   // Fixed-size insertion avoids sorting/allocating a world-sized array on tours.
   let i=0;while(i<selected.length&&selected[i].score<=e.score)i++;
   if(i>=limit)continue;selected.splice(i,0,e);if(selected.length>limit)selected.pop();
  }
  for(let i=0;i<limit;i++){
   const e=selected[i];let slot=pool[i];
   if(!e){bound[i]=undefined;if(slot)for(const light of Object.values(slot)){light.visible=false;light.removeFromParent();}continue;}
   if(bound[i]===e&&slot?.[e.type]?.parent===e.parent)continue;
   bound[i]=e;if(!slot)pool[i]=slot={};
   for(const light of Object.values(slot))light.visible=false;
   let light=slot[e.type];
   if(!light)slot[e.type]=light=e.type==='spot'?new SpotLight({castShadow:false}):new PointLight();
   if(light.parent!==e.parent)e.parent.addChild(light);light.label='Catalog Light';
   e.matrix.decompose(light.position,light.quaternion,light.scale);
   light.color.setValue(e.color);light.intensity=e.worldIntensity;light.range=e.worldRange;
   if(e.type==='spot'){light.coneAngle=e.coneAngle;light.penumbra=e.penumbra;}
   light.visible=true;
  }
  metrics.active=selected.length;dirty=false;
 }
 function update(position,frustum,force=false){
  if(position){camera=position;planes=frustum;}
  if(!camera)return;
  const t=now();if(force||dirty||t-last>=intervalMS){select();last=t;}
 }
 return {metrics,update,invalidate(){dirty=true;},register({frame}={}){
  const owner={entries:[]};let disposed=false;owners.add(owner);dirty=true;
  return {add(entry){
   const m=entry.matrix.elements,s=frame?.scale||1,scale=Math.max(Math.hypot(m[0],m[1],m[2]),Math.hypot(m[4],m[5],m[6]),Math.hypot(m[8],m[9],m[10]))*s;
   const x=m[12],y=m[13],z=m[14];
   Object.assign(entry,{x:frame?x*s+frame.x:x,y:frame?z*s-frame.y:y,z:frame?y*s:z,
    worldRange:entry.range*scale,worldIntensity:entry.intensity*scale*scale});
   owner.entries.push(entry);dirty=true;return entry;
  },invalidate(){dirty=true;},destroy(){
   if(disposed)return;disposed=true;owners.delete(owner);dirty=true;
   // Remove pooled children before their owning layer is destroyed.
   for(const slot of pool)for(const light of Object.values(slot)){light.removeFromParent();light.visible=false;}
   if(!owners.size){for(const slot of pool)for(const light of Object.values(slot))light.destroy();pool.length=0;selected.length=0;metrics.active=metrics.candidates=0;camera=undefined;}
   else update(undefined,undefined,true);
  }};
 }};
}
