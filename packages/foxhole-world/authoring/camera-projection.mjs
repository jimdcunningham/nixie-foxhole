// Match the target plane without moving the camera. Pixi beta zoom divides
// perspective FOV but multiplies the orthographic half-width.
export function setProjection(camera, mode) {
 if(camera.mode===mode)return;
 const halfFov=camera.fov*Math.PI/360;
 camera.zoom=mode==='orthographic'
  ?Math.tan(halfFov/camera.zoom)/Math.tan(halfFov)
  :halfFov/Math.atan(Math.tan(halfFov)*camera.zoom);
 camera.mode=mode;
}
export function syncProjection(camera,target,width,height){
 if(camera.mode!=='orthographic')return;
 const distance=Math.hypot(camera.position.x-target.x,camera.position.y-target.y,camera.position.z-target.z);
 camera.orthographicSize=Math.max(.01,distance*Math.tan(camera.fov*Math.PI/360)*width/height);
}
export function orthographicHeight(camera,width,height){
 return camera.mode==='orthographic'?2*camera.orthographicSize*camera.zoom*height/width:null;
}
