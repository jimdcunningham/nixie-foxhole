import {GeometryAtlasPool} from '@pixi/3d';
const installed=new WeakSet();
/** Private adapter for @pixi/3d beta.2: retire atlas growth buffers after submit.
 * Growth versions the shared pool, so every View3D invalidates old draw bundles
 * before replaying them. The current frame may still reference replaced buffers;
 * defer destruction until all postrender hooks (including GPU submission) finish.
 */
export function prepareAtlasRetirement(renderer,{pools=()=>[GeometryAtlasPool.from({rebaseIndices:false}),GeometryAtlasPool.from({rebaseIndices:true})],defer=queueMicrotask}={}){
 if(!renderer?.runners?.postrender||installed.has(renderer))return;
 installed.add(renderer);let scheduled=false;
 renderer.runners.postrender.add({postrender(){
  if(scheduled)return;scheduled=true;
  defer(()=>{scheduled=false;
   for(const pool of pools())for(const atlas of Object.values(pool._atlases||{})){
    const geometries=atlas._retiredGeometries?.splice(0)||[],buffers=atlas._retiredBuffers?.splice(0)||[];
    for(const geometry of geometries)geometry.destroy(false);
    for(const buffer of buffers)buffer.destroy();
   }
  });
 }});
}