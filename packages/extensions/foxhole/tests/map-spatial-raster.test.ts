import test from 'node:test';
import assert from 'node:assert/strict';
import { Graphics } from 'pixi.js';
import { rasterizeSpatialMapGraphics } from '../app/plugins/foxhole/nixie/map/spatial-activity-raster.mjs';
test('spatial artwork preserves original stroke styles, transformed heat circles and region framing',()=>{
 const line=new Graphics().moveTo(10,20).lineTo(30,40).stroke({width:8,color:0xff4000,alpha:.4,cap:'round',join:'round'});
 const circle=new Graphics().save().transform(2,0,0,2,50,60).circle(0,0,512).fill({color:0xffaa00,alpha:.2}).restore();
 const calls:unknown[][]=[];const context:any={
  clearRect(...args:unknown[]){calls.push(['clear',...args]);},setTransform(...args:unknown[]){calls.push(['frame',...args]);},
  save(){},restore(){},beginPath(){},closePath(){},moveTo(){},lineTo(){},
  transform(...args:unknown[]){calls.push(['transform',...args]);},arc(...args:unknown[]){calls.push(['circle',...args]);},
  stroke(){calls.push(['stroke',this.strokeStyle,this.globalAlpha,this.lineWidth,this.lineCap,this.lineJoin]);},
  fill(){calls.push(['fill',this.fillStyle,this.globalAlpha]);},
  getImageData(){return{data:new Uint8ClampedArray(512*512*4)};},
 };
 const pixels=rasterizeSpatialMapGraphics([line,circle],{left:100,top:200,width:2048,height:1024,blur:2,createCanvas:()=>({getContext:()=>context})});
 assert.equal(pixels.length,512*512*4);
 assert.ok(calls.some(c=>JSON.stringify(c)===JSON.stringify(['frame',.25,0,0,.5,-25,-100])));
 assert.ok(calls.some(c=>JSON.stringify(c)===JSON.stringify(['stroke','#ff4000',.4,8,'round','round'])));
 assert.ok(calls.some(c=>c[0]==='circle'));assert.ok(calls.some(c=>c[0]==='transform'));
 assert.equal(context.filter,'blur(2px)');assert.equal(line.context.instructions.length,1);assert.equal(circle.context.instructions.length,1);
 line.destroy();circle.destroy();
});

test('camera frames and heat pulses reuse cached artwork while war changes invalidate only the changed image',async()=>{
 const {readFileSync}=await import('node:fs');const {stripTypeScriptTypes}=await import('node:module');const {runInNewContext}=await import('node:vm');
 const source=readFileSync(new URL('../app/plugins/foxhole/nixie/map/renderer.ts',import.meta.url),'utf8');
 const methods=source.slice(source.indexOf('    private spatialFrontImage:'),source.indexOf('    private updateGridFollowTarget('));
 let rasters=0,pulse=.4;const settings={spatialWorldData:true,frontline:true,frontAlt:false,hotspots:true};
 const Capture=runInNewContext(stripTypeScriptTypes('class Capture {\n'+methods+'\n}\nCapture'),{FOXHOLE_REGION_WIDTH:2048,FOXHOLE_REGION_HEIGHT:1776,performance:{now:()=>1},rasterizeSpatialMapGraphics:()=>{rasters++;return new Uint8ClampedArray(4);}});
 const capture=new Capture(),view={region:{key:'test'},container:{x:1024,y:888},activityHeatSignature:'heat1',activityHeatIntensity:.7,revealOrder:0,subregionHeatGraphics:{visible:true}};
 Object.assign(capture,{context:{readMapSettings:()=>settings},regionViews:[view],grid:{x:0,y:0},gridSublines:{x:0,y:0,visible:false},frontlineRenderSignature:'front1',computeRegionHeatPulse:()=>pulse});
 const first=capture.getSpatialPlanningOverlays('test');assert.equal(rasters,2);
 pulse=.6;const second=capture.getSpatialPlanningOverlays('test');assert.equal(rasters,2);assert.equal(first.frontImage,second.frontImage);assert.equal(first.heatImage,second.heatImage);assert.equal(second.heatAlpha,.6);
 capture.frontlineRenderSignature='front2';capture.getSpatialPlanningOverlays('test');assert.equal(rasters,3);
 view.activityHeatSignature='heat2';capture.getSpatialPlanningOverlays('test');assert.equal(rasters,4);
 settings.spatialWorldData=false;capture.getSpatialPlanningOverlays('test');assert.equal(rasters,4);
});
