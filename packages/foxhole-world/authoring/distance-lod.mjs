import {MESH3D_LANE_VISIBILITY} from '@pixi/3d';
import {uploadLodVisibility} from './lod-visibility-upload.mjs';
export function chooseLod({distance,radius,height,fov,category,cover,previous=0,tinyCover=true,orthographicHeight=null}){
 return chooseLodValues(distance,radius,orthographicHeight?height/orthographicHeight:height/(2*Math.tan(fov*Math.PI/360)),category,cover,previous,tinyCover,!!orthographicHeight);
}
function chooseLodValues(distance,radius,projection,category,cover,previous,tinyCover,orthographic=false){ const near=(category==='vegetation'||category==='trees')?120:180,d=Math.max(0,distance-radius),diameter=2*radius*projection/(orthographic?1:Math.max(1,distance));
 // Small ground-cover cards need detail according to their on-screen size,
 // including orthographic views. The tree proximity floor would otherwise keep
 // a nine-pixel grass tuft at full geometry throughout the nearest 130 metres.
 if(cover){
  if(tinyCover&&d>Math.max(2,radius*4)&&diameter<(previous===-1?.95:.7))return -1;
  let level=diameter>=48?0:diameter>=16?1:2;
  if(previous===0&&diameter>40)level=0;
  if(previous===1&&diameter>14&&diameter<55)level=1;
  if(previous===2&&diameter<19)level=2;
  return level;
 }
 if(d<near+10)return 0;
 if(previous===0&&d<near+25)return 0;
 let level=diameter>=100?0:diameter>=30?1:2;
 if(d<near*2)level=Math.min(1,level);
 if(previous===0&&diameter>85)level=0;
 if(previous===1&&diameter>26&&diameter<115)level=1;
 if(previous===2&&diameter<35&&d>=near*2)level=2;
 return level;
}
// The pinned Pixi 3D beta has no slot-visibility setter. Keep its CPU field and
// GPU visibility lane in sync, without changing pass membership or rebuilding
// draw commands. Both WebGL replay and WebGPU compaction consume these fields.
export function setLodSlotVisible(batch,index,visible,dirty){
 const item=batch.items[index],value=visible?1:0;if(item._worldVisible===value)return;
 const store=batch.batch.storeBuffer,row=item._storeIndex;
 if(store.stride!==24||MESH3D_LANE_VISIBILITY!==19)throw Error('Unsupported Pixi 3D slot layout');
 item._worldVisible=value;store.u32Data[row*store.stride+MESH3D_LANE_VISIBILITY]=value;
 const span=dirty.get(batch);if(span){span[0]=Math.min(span[0],row);span[1]=Math.max(span[1],row);span[2].push(row);}else dirty.set(batch,[row,row,[row]]);
}
function flush(dirty){for(const [batch,[min,max,rows]]of dirty){uploadLodVisibility(batch.batch.storeBuffer,min,max,rows);batch.batch._visibilityDirtyId++;}}
export function createDistanceLod(records,sourceTriangles){
 // Building/catalog-only cells have no authored native LOD. Keep their report,
 // but do not allocate selection scratch or inspect the moving camera.
 if(!records.length){
  const report={mode:'native',eligiblePlacements:0,full:0,medium:0,distant:0,subpixelCover:0,sourceTriangles,selectedTriangles:sourceTriangles,changedPlacements:0,selectionCpuMs:0,note:'No native LOD candidates; source geometry retained.'};
  return {update:({full=false}={})=>{report.mode=full?'full':'native';return false;},snapshot:()=>report};
 }
 const dirty=new Map(),activeBatches=new Map(),counts=[0,0,0];let lastTime=-Infinity,hasPosition=false,lastX=0,lastY=0,lastZ=0,lastSpan=null,lastHeight=null,lastProjection=null,lastFull=null,lastTinyCover=null,report={},fixedTriangles=sourceTriangles;
 for(const r of records){for(const s of r.levels[0]){setLodSlotVisible(s.batch,s.index,true,dirty);if(!activeBatches.has(s.batch))activeBatches.set(s.batch,s.batch.size);}r.level=0;r.triangles=r.levels.map(slots=>slots.reduce((sum,s)=>sum+s.triangles,0));fixedTriangles-=r.triangles[0];for(const level of [1,2])for(const s of r.levels[level]){setLodSlotVisible(s.batch,s.index,false,dirty);if(!activeBatches.has(s.batch))activeBatches.set(s.batch,0);}}
 flush(dirty);for(const [b,count]of activeBatches)b.visible=count>0;
 function update({position,height,fov,orthographicHeight=null,full=false,tinyCover=true,now=performance.now(),force=false}){
  // Scalar camera state avoids per-cell arrays and string keys on every frame.
  const projectionKey=orthographicHeight?'orthographic':fov,sameView=height===lastHeight&&projectionKey===lastProjection&&full===lastFull&&tinyCover===lastTinyCover,scaleChanged=orthographicHeight&&Math.abs(orthographicHeight-(lastSpan||0))>.01,moved=hasPosition?Math.hypot(position[0]-lastX,position[1]-lastY,position[2]-lastZ):Infinity;
  if(!force&&sameView&&(full||moved<.01&&!scaleChanged||now-lastTime<150&&moved<5))return false;
  const started=performance.now(),projection=orthographicHeight?height/orthographicHeight:height/(2*Math.tan(fov*Math.PI/360));dirty.clear();counts.fill(0);let hidden=0,selectedTriangles=fixedTriangles,changed=0;
  for(const r of records){const dx=r.center[0]-position[0],dy=r.center[1]-position[1],dz=r.center[2]-position[2],distance=Math.sqrt(dx*dx+dy*dy+dz*dz),level=full?0:chooseLodValues(distance,r.radius,projection,r.category,r.cover,r.level,tinyCover,!!orthographicHeight);
   if(level!==r.level){for(let l=0;l<3;l++)for(const s of r.levels[l]){setLodSlotVisible(s.batch,s.index,l===level,dirty);{let count=activeBatches.get(s.batch)||0;if(r.level===l)count--;if(level===l)count++;activeBatches.set(s.batch,count);}}r.level=level;changed++;}
   if(level<0)hidden++;else{counts[level]++;selectedTriangles+=r.triangles[level];}
  }
  flush(dirty);for(const [b,count]of activeBatches)b.visible=count>0;lastTime=now;lastHeight=height;lastProjection=projectionKey;lastFull=full;lastTinyCover=tinyCover;lastSpan=orthographicHeight;lastX=position[0];lastY=position[1];lastZ=position[2];hasPosition=true;report={mode:full?'full':'native',eligiblePlacements:records.length,full:counts[0],medium:counts[1],distant:counts[2],subpixelCover:hidden,sourceTriangles,selectedTriangles,changedPlacements:changed,selectionCpuMs:performance.now()-started,note:'Selected resident triangle candidates before frustum culling; nearby source geometry and native texture resolutions retained.'};return changed>0;
 }
 return{update,snapshot:()=>report};
}
