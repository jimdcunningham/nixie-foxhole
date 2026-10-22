import {WIDTH,HEIGHT} from './terrain-tools.mjs';

// Camera3D.orthographicSize is half the horizontal span. Reserve the same
// screen-space padding on all sides and include the walls' outer lip.
export function topDownFrame(width,height,{padding=.08}={}){
 if(!(width>0&&height>0)||!(padding>=0&&padding<.5))throw new Error('Invalid top-down frame');
 const inset=Math.min(width,height)*padding;
 const size=Math.max(WIDTH*1.003/(1-2*inset/width),HEIGHT*1.003*(width/height)/(1-2*inset/height))/2;
 return{orthographicSize:size,worldWidth:size*2,worldHeight:size*2*height/width,paddingPixels:inset,position:[0,3000,0],target:[0,0,0]};
}

// Remove camera-fit padding before flipping the bake into the shipped map's
// north-up coordinates. Both A/B images then span the same canonical bounds.
export function mapBakeCrop(frame,width,height){
 return{x:(1-WIDTH/frame.worldWidth)*width/2,y:(1-HEIGHT/frame.worldHeight)*height/2,width:WIDTH/frame.worldWidth*width,height:HEIGHT/frame.worldHeight*height};
}
