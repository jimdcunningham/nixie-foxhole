import {WIDTH,HEIGHT} from './terrain-tools.mjs';
export function bakeOutputSize(width=4096){if(![2048,4096].includes(+width))throw Error('Unsupported bake width');return{width:+width,height:Math.round(+width*1776/2048)};}
export function bakeTiles(width,height,{limit=2048,gutter=16}={}){
 const nx=Math.ceil(width/limit),ny=Math.ceil(height/limit),tiles=[];
 for(let row=0;row<ny;row++)for(let col=0;col<nx;col++){
  const x=Math.floor(col*width/nx),y=Math.floor(row*height/ny),w=Math.floor((col+1)*width/nx)-x,h=Math.floor((row+1)*height/ny)-y,rw=w+gutter*2,rh=h+gutter*2;
  const worldWidth=WIDTH*rw/width,worldHeight=HEIGHT*rh/height,size=Math.max(worldWidth,worldHeight*rw/rh)/2,frameWidth=size*2,frameHeight=frameWidth*rh/rw;
  const innerWidth=WIDTH*w/width,innerHeight=HEIGHT*h/height;
  tiles.push({x,y,width:w,height:h,renderWidth:rw,renderHeight:rh,orthographicSize:size,center:[-WIDTH/2+(x+w/2)/width*WIDTH,HEIGHT/2-(y+h/2)/height*HEIGHT],crop:{x:(1-innerWidth/frameWidth)*rw,y:(1-innerHeight/frameHeight)*rh,width:innerWidth/frameWidth*rw*2,height:innerHeight/frameHeight*rh*2}});
 }return tiles;
}

// Small edge-aware denoise followed by restrained unsharp detail recovery.
// Alpha is copied exactly; large color jumps (road/roof silhouettes) are excluded.
export function cleanupBakePixels(input,width,height,onProgress=()=>{}){
 const smooth=new Uint8ClampedArray(input.length),output=new Uint8ClampedArray(input.length),cross=[[-1,0],[1,0],[0,-1],[0,1]];
 for(let y=0;y<height;y++){
  for(let x=0;x<width;x++){const i=(y*width+x)*4;let r=input[i]*2,g=input[i+1]*2,b=input[i+2]*2,weight=2;
   if(input[i+3])for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy||x+dx<0||y+dy<0||x+dx>=width||y+dy>=height)continue;const k=((y+dy)*width+x+dx)*4;if(!input[k+3])continue;const delta=Math.max(Math.abs(input[k]-input[i]),Math.abs(input[k+1]-input[i+1]),Math.abs(input[k+2]-input[i+2])),range=Math.max(0,1-delta/48),w=range*range*(dx&&dy ? .7 : 1);r+=input[k]*w;g+=input[k+1]*w;b+=input[k+2]*w;weight+=w;}
   smooth[i]=input[i]*.2+r/weight*.8;smooth[i+1]=input[i+1]*.2+g/weight*.8;smooth[i+2]=input[i+2]*.2+b/weight*.8;smooth[i+3]=input[i+3];
  }if(y%64===0)onProgress(Math.round(y/height*85));
 }
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;for(let c=0;c<3;c++){let sum=smooth[i+c]*2,w=2;for(const [dx,dy]of cross){if(x+dx<0||y+dy<0||x+dx>=width||y+dy>=height)continue;const k=((y+dy)*width+x+dx)*4;if(!smooth[k+3])continue;sum+=smooth[k+c];w++;}output[i+c]=smooth[i+c]+Math.max(-4,Math.min(4,(smooth[i+c]-sum/w)*.18));}output[i+3]=input[i+3];}
 onProgress(100);return output;
}


