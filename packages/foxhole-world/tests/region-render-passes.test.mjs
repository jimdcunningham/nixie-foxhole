import test from 'node:test';
import assert from 'node:assert/strict';
import {combineRegionPasses} from '../../extensions/foxhole/app/plugins/foxhole/nixie/map/region-render-passes.mjs';
test('many regions use one pass registration while every visible region draws and all graph resources retire',()=>{
 const rendered=[],prepared=[],destroyed=[],owners=Array.from({length:53},(_,i)=>({enabled:true,stage:'afterOpaque',visible:true,build(graph){const owner=this;graph.addPass({name:'native-terrain-surface',condition(){return owner.visible;},prepare(){prepared.push(i);},render(){rendered.push(i);},destroy(){destroyed.push(i);}});}}));
 const group=combineRegionPasses(owners),passes=[];group.build({addPass:pass=>passes.push(pass)},{});
 assert.equal(passes.length,1);owners[3].visible=false;assert.equal(passes[0].condition({}),true);passes[0].prepare({});passes[0].render({});
 assert.equal(rendered.length,52);assert.equal(rendered.includes(3),false);assert.deepEqual(prepared,rendered);
 owners.forEach(owner=>owner.visible=false);assert.equal(passes[0].condition({}),false);
 passes[0].destroy();assert.equal(destroyed.length,53);
 assert.equal(combineRegionPasses([owners[0]]),owners[0]);
});
