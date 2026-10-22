import test from 'node:test';
import assert from 'node:assert/strict';
import {Container3D,Matrix4,PointLight,SpotLight} from '@pixi/3d';
import {catalogLightPart,createCatalogLightBudget,catalogLightBudgetFor} from '../runtime/catalog-lights.mjs';

const entry=(parent,x,type='point')=>({...catalogLightPart(type==='spot'?new SpotLight({intensity:3,range:5,coneAngle:37,penumbra:.25}):new PointLight({intensity:3,range:5}),new Matrix4().fromArray([1,0,0,0,0,1,0,0,0,0,1,0,x,2,3,1])),parent,active:true});
const lights=root=>root.children.filter(n=>n instanceof PointLight||n instanceof SpotLight);

test('one bounded pool selects across regions and reuses lights on camera movement',()=>{
 let clock=0;const budget=createCatalogLightBudget({limit:2,now:()=>clock}),a=new Container3D(),b=new Container3D(),one=budget.register(),two=budget.register();
 one.add(entry(a,0));one.add(entry(a,10,'spot'));two.add(entry(b,100));two.add(entry(b,110));
 budget.update([0,2,3]);assert.equal(budget.metrics.candidates,4);assert.equal(budget.metrics.active,2);assert.equal(lights(a).filter(l=>l.visible).length,2);assert.equal(lights(b).length,0);
 const pool=[...lights(a)];assert.equal(pool[1].coneAngle,37);assert.equal(pool[1].penumbra,.25);assert.ok(pool.every(l=>!l.castShadow));
 clock=250;budget.update([100,2,3]);assert.equal(lights(b).filter(l=>l.visible).length,2);assert.equal(lights(b)[0],pool[0]);assert.equal(budget.metrics.active,2);
 b.visible=false;two.invalidate();budget.update([100,2,3]);assert.equal(lights(b).filter(l=>l.visible).length,0);assert.equal(lights(a).filter(l=>l.visible).length,2);
 one.destroy();a.destroy({children:true});assert.equal(budget.metrics.active,0);b.visible=true;budget.update([100,2,3],undefined,true);assert.equal(budget.metrics.active,2,'surviving region can reuse the pool');
 two.destroy();two.destroy();assert.equal(budget.metrics.active,0);assert.ok(pool.every(l=>l.destroyed));assert.equal(lights(b).length,0);b.destroy();
});

test('board frame scales light positions, radius and inverse-square intensity',()=>{
 const budget=createCatalogLightBudget(),root=new Container3D(),owner=budget.register({frame:{x:1000,y:2000,scale:32}}),e=owner.add(entry(root,4,'spot'));
 assert.deepEqual([e.x,e.y,e.z],[1128,-1904,64]);assert.equal(e.worldRange,160);assert.equal(e.worldIntensity,3072);
 budget.update([1128,-1904,64]);const light=lights(root)[0];assert.deepEqual([light.position.x,light.position.y,light.position.z],[4,2,3]);assert.equal(light.range,160);assert.equal(light.intensity,3072);
 e.active=false;owner.invalidate();budget.update([1128,-1904,64]);assert.equal(budget.metrics.active,0);owner.destroy();root.destroy();
});

test('frustum tests include light radius, and selection is throttled between changes',()=>{
 let clock=0;const budget=createCatalogLightBudget({limit:1,now:()=>clock}),root=new Container3D(),owner=budget.register(),near=owner.add(entry(root,0)),other=owner.add(entry(root,100));
 const planes=new Float32Array([1,0,0,-20,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1]);
 budget.update([0,2,3],planes);assert.equal(lights(root)[0].position.x,100,'out-of-view light does not consume the budget');
 budget.update([0,2,3]);assert.equal(lights(root)[0].position.x,100,'camera-only changes wait for selection interval');
 clock=201;budget.update([0,2,3]);assert.equal(lights(root)[0].position.x,0);
 near.active=false;owner.invalidate();budget.update([0,2,3]);assert.equal(lights(root)[0].position.x,100,'visibility changes select immediately');
 other.active=false;owner.destroy();root.destroy();
});

test('renderers share a budget only within their own renderer lifetime',()=>{
 const a={},b={};assert.equal(catalogLightBudgetFor(a),catalogLightBudgetFor(a));assert.notEqual(catalogLightBudgetFor(a),catalogLightBudgetFor(b));
});


test('unchanged selection does not republish light transforms or visibility on every selection tick',()=>{
 let clock=0;const budget=createCatalogLightBudget({now:()=>clock}),root=new Container3D(),owner=budget.register();owner.add(entry(root,0));budget.update([0,2,3]);
 const lamp=lights(root)[0];let visibility=0,attachments=0;lamp.on('visibleChanged',()=>visibility++);root.on('childAdded',()=>attachments++);
 for(let i=0;i<10;i++){clock+=250;budget.update([0,2,3]);}
 assert.equal(visibility,0);assert.equal(attachments,0);assert.equal(lights(root)[0],lamp);owner.destroy();root.destroy();
});
