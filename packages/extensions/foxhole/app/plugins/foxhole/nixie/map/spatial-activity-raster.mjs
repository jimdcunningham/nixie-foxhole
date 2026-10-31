import {DOMAdapter} from 'pixi.js';

// Reuse the map's existing Graphics paths and styles instead of recreating war
// analytics in the world renderer. Only cached artwork changes reach Canvas2D.
export function rasterizeSpatialMapGraphics(graphics,{left=0,top=0,width,height,size=512,blur=0,createCanvas=()=>DOMAdapter.get().createCanvas(size,size)}={}){
 const canvas=createCanvas();canvas.width=size;canvas.height=size;
 const context=canvas.getContext('2d',{willReadFrequently:true});
 if(!context)throw Error('Map overlay rasterization needs a 2D canvas.');
 context.clearRect(0,0,size,size);
 context.setTransform(size/width,0,0,size/height,-left*size/width,-top*size/height);
 if(blur)context.filter=`blur(${blur}px)`;
 for(const graphic of graphics)for(const instruction of graphic.context.instructions){
  if(instruction.action!=='fill'&&instruction.action!=='stroke')continue;
  const {style,path}=instruction.data;
  context.globalAlpha=style.alpha;
  const color='#'+(style.color&0xffffff).toString(16).padStart(6,'0');
  context.fillStyle=color;context.strokeStyle=color;
  for(const primitive of path.shapePath.shapePrimitives){
   context.save();const matrix=primitive.transform;
   if(matrix)context.transform(matrix.a,matrix.b,matrix.c,matrix.d,matrix.tx,matrix.ty);
   context.beginPath();const shape=primitive.shape;
   if(shape.type==='polygon'){
    const points=shape.points;if(points.length){context.moveTo(points[0],points[1]);for(let i=2;i<points.length;i+=2)context.lineTo(points[i],points[i+1]);if(shape.closePath)context.closePath();}
   }else if(shape.type==='circle')context.arc(shape.x,shape.y,shape.radius,0,Math.PI*2);
   else if(shape.type==='ellipse')context.ellipse(shape.x,shape.y,shape.halfWidth,shape.halfHeight,0,0,Math.PI*2);
   else if(shape.type==='rectangle')context.rect(shape.x,shape.y,shape.width,shape.height);
   else throw Error('Unsupported map overlay shape: '+shape.type);
   if(instruction.action==='stroke'){context.lineWidth=style.width;context.lineCap=style.cap;context.lineJoin=style.join;context.miterLimit=style.miterLimit;context.stroke();}
   else context.fill();
   context.restore();
  }
 }
 return context.getImageData(0,0,size,size).data;
}
