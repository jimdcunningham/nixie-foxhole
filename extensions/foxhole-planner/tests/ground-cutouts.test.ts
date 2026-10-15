import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNixieExperimentalSpatialPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import assets from '../src/scene-v2-assets-node.ts';
import { structuralGroundCutouts } from '../src/scene-v2-ground-cutouts.ts';
import { renderSpatialTrench } from '../src/scene-v2-spatial-trench.ts';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';

const area = (cuts: ReturnType<typeof structuralGroundCutouts>) => cuts.reduce((sum, {polygon:p}) => sum + Math.abs(p.reduce((v,x,i) => i%2 ? v : v+x*p[(i+3)%p.length]!-p[(i+2)%p.length]!*p[i+1]!,0))/2,0);
test('ground openings use native floor shapes and occupied approaches without projection padding', () => {
    assert.equal(area(structuralGroundCutouts(assets.trencht1!,new Set())),320*96);
    assert.equal(area(structuralGroundCutouts(assets.fortt3!,new Set())),160*160);
    assert.equal(area(structuralGroundCutouts(assets.fortcornert1!,new Set())),160*160-96*96/2);
    assert.ok(Math.abs(area(structuralGroundCutouts(assets.fortcornert1!,new Set(['angle'])))-19200)<1e-6);
    for(const id of ['trenchintt1','trenchintt2','trenchintt3']) {
        assert.equal(area(structuralGroundCutouts(assets[id]!,new Set())),96*96);
        assert.equal(area(structuralGroundCutouts(assets[id]!,new Set(['front']))),96*96+32*96);
    }
    const tags=['front','frontright','right','backright','back','backleft','left','frontleft'];
    for(const id of ['trenchempt1','trenchempt2','trenchempt3'])for(let mask=0;mask<256;mask++) {
        const groundCutouts=structuralGroundCutouts(assets[id]!,new Set(tags.filter((_,i)=>mask&(1<<i))));
        assert.ok(groundCutouts.length>0);
        parseNixieExperimentalSpatialPlanV1({contractVersion:1,supplementModel:true,nodes:[],groundCutouts});
    }
    assert.deepEqual(structuralGroundCutouts(assets.facilityrefineryoil!,new Set()),[]);
    assert.deepEqual(structuralGroundCutouts({...assets.fortt3!,model:undefined},new Set()),[]);
});
test('ground cutouts cross the actual structural renderer alongside visibility and model clipping', () => {
    for(const id of ['trencht1','trencht2','trencht3','trenchintt1','trenchempt3','fortt3','fortcornert1','fortbaset2']) {
        const entity={entityId:'preview',revision:1,components:[{ownerId:'nixie.foxhole-planner',componentId:'asset',version:1,definitionAvailable:true,data:{catalogId:'foxhole.structures',assetId:id}}]};
        const rendered=renderFoxholeSceneV2Entity(entity,{contractVersion:1,entities:[entity],settings:{'foxhole.structure.hideRoofs':true}});
        assert.ok(rendered.experimentalSpatial?.groundCutouts?.length,id);
        parseNixieExperimentalSpatialPlanV1(rendered.experimentalSpatial);
    }
});
test('connector excavations match the independently rotated native floor and remain when floors are hidden', () => {
    for(const id of ['trenchconnectort1','trenchconnectort2','trenchconnectort3'])for(const mask of [0,1,2,3]) {
        const entity={entityId:'preview',revision:1,components:[]};
        const data={foxholeKey:id,startX:-100,startY:0,startRotation:-.5,endX:100,endY:30,endRotation:.5,startZ:5,endZ:25,minLength:80,maxLength:256,minRadius:0,maxRadius:0,maxBuffer:0,curveT:1,blueprint:false,startAttachmentNodeId:mask&1?'a':undefined,endAttachmentNodeId:mask&2?'b':undefined};
        const plan=renderSpatialTrench(entity,data,assets[id]!)!;
        const floor=plan.nodes.find(n=>n.id==='trench-floor');
        assert.ok(floor?.kind==='model-path'); assert.deepEqual(plan.groundCutouts![0]!.polygon,floor.clipPolygons![0]);
        const hidden=renderSpatialTrench(entity,data,assets[id]!,{'foxhole.structure.hideFloors':true})!;
        assert.deepEqual(hidden.groundCutouts!.map(c=>c.polygon),plan.groundCutouts!.map(c=>c.polygon));
        parseNixieExperimentalSpatialPlanV1(hidden);
    }
});
