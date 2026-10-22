import {WIDTH,HEIGHT} from './terrain-tools.mjs';
import {topDownFrame} from './topdown-view.mjs';
import {bakeTiles} from './bake-quality.mjs';

export async function captureMapBake({app,view,sun,width,height,onProgress=()=>{},tileLimit=2048}){
 const frame=topDownFrame(2048,1776,{padding:0});app.renderer.resize(2048,1776,2);view.camera.mode='orthographic';view.camera.zoom=1;view.camera.orthographicSize=frame.orthographicSize;view.camera.position.set(0,3000,0);view.camera.lookAt({x:0,y:0,z:0},{x:0,y:0,z:-1});
 // Fit and cache the shadows for the complete region before changing tile
 // cameras. Reuse these same cascades so adjacent tiles share their lighting.
 sun.refreshShadows();app.render();app.render();
 const bitmap=document.createElement('canvas');bitmap.width=width;bitmap.height=height;const ctx=bitmap.getContext('2d'),tiles=bakeTiles(width,height,{limit:tileLimit});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 for(let i=0;i<tiles.length;i++){
  const tile=tiles[i];onProgress(`Rendering tile ${i+1} / ${tiles.length}…`);app.renderer.resize(tile.renderWidth,tile.renderHeight,2);view.camera.orthographicSize=tile.orthographicSize;view.camera.position.set(tile.center[0],3000,tile.center[1]);view.camera.lookAt({x:tile.center[0],y:0,z:tile.center[1]},{x:0,y:0,z:-1});app.render();app.render();
  const c=tile.crop;ctx.save();ctx.translate(tile.x,tile.y+tile.height);ctx.scale(1,-1);ctx.drawImage(app.canvas,c.x,c.y,c.width,c.height,0,0,tile.width,tile.height);ctx.restore();await new Promise(requestAnimationFrame);
 }
 ctx.globalCompositeOperation='destination-in';ctx.beginPath();for(const [x,z]of [[-1092,0],[-546,945],[546,945],[1092,0],[546,-945],[-546,-945]])ctx.lineTo(width/2+x/WIDTH*width,height/2-z/HEIGHT*height);ctx.closePath();ctx.fill();ctx.globalCompositeOperation='source-over';
 return{bitmap,details:{width,height,renderResolution:2,equivalentRenderWidth:width*2,equivalentRenderHeight:height*2,maxTileRenderWidth:Math.max(...tiles.map(t=>t.renderWidth*2)),maxTileRenderHeight:Math.max(...tiles.map(t=>t.renderHeight*2)),tiles:tiles.length,tileGutterPixels:16,antialias:'2x supersampling with overlapping tiles',frame}};
}

export async function finishMapBake(bitmap,finish,onProgress=()=>{}){
 let canvas=bitmap;
 if(finish==='clean'){
  const data=bitmap.getContext('2d').getImageData(0,0,bitmap.width,bitmap.height),worker=new Worker(new URL('./bake-cleanup-worker.mjs',import.meta.url),{type:'module'});
  const pixels=await new Promise((resolve,reject)=>{worker.onmessage=({data})=>{if(data.error){worker.terminate();reject(Error(data.error));}else if(data.pixels){worker.terminate();resolve(new Uint8ClampedArray(data.pixels));}else onProgress(`Cleaning bake · ${data.progress}%`);};worker.onerror=e=>{worker.terminate();reject(Error(e.message));};worker.postMessage({width:bitmap.width,height:bitmap.height,pixels:data.data.buffer},[data.data.buffer]);});
  canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').putImageData(new ImageData(pixels,canvas.width,canvas.height),0,0);
 }
 return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG encoding failed.')),'image/png'));
}
