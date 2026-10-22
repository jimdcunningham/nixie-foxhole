export function renderSize(mode,width,height,dpr=1){
 if(mode==='viewport')return{width:Math.max(1,Math.round(width)),height:Math.max(1,Math.round(height)),resolution:Math.max(.25,dpr||1)};
 return{width:1280,height:720,resolution:mode==='2'?2:1};
}
