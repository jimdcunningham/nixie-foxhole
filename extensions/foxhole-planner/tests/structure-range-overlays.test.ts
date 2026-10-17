import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import assets from '../src/scene-v2-assets-node.ts';
import { foxholeStructureRangeCommands, renderFoxholeStructureRangeOverlays } from '../src/scene-v2-structure-range-overlays.ts';
import { isFoxholeStructureRangeVisible } from '../src/structure-range-settings.ts';

test('range visibility separates persistent and selected-only overlays without enlarging body bounds', () => {
    const asset = { ...assets.artilleryait1!, ranges: [{ type: 'killboxArty', max: 50, min: 10, arc: 45 }] };
    const before = structuredClone(asset);
    const selected = renderFoxholeStructureRangeOverlays(asset, {}, { destroyed: false, packaged: false });
    assert.equal(selected[0]?.id, 'selected-structure-ranges');
    assert.deepEqual(selected[0]?.experimentalPresentation, { contractVersion: 1, excludeFromBounds: true, selectionOnly: true });
    assert.equal(selected[0]?.kind === 'group' && selected[0].children[0]?.experimentalPresentation?.groundOverlay, true);
    const always = renderFoxholeStructureRangeOverlays(asset, { 'foxhole.ranges.artillery': true }, { destroyed: false, packaged: false });
    assert.equal(always[0]?.id, 'structure-ranges');
    assert.equal(renderFoxholeStructureRangeOverlays(asset, { 'foxhole.ranges.selectionOnly': false }, { destroyed: false, packaged: false }).length, 0);
    assert.equal(renderFoxholeStructureRangeOverlays(asset, {}, { destroyed: true, packaged: false }).length, 0);
    assert.equal(renderFoxholeStructureRangeOverlays(asset, {}, { destroyed: false, packaged: true }).length, 0);
    assert.doesNotThrow(() => parseNixieExtensionRenderPlanV1({ schemaVersion: 1, root: { id: 'root', kind: 'group', children: always } }));
    assert.deepEqual(asset, before);
});
test('annular circles, partial sweeps, overlap-only and reach bands retain their drawing semantics', () => {
    assert.ok(foxholeStructureRangeCommands({ type: 'garrison', min: 10, max: 30 })?.fill.some(command => command.op === 'cut'));
    assert.ok(foxholeStructureRangeCommands({ type: 'garrison', min: 10, max: 30, arc: 45 })?.fill.some(command => command.op === 'arc'));
    assert.equal(foxholeStructureRangeCommands({ type: 'overlap', overlap: 20 })?.overlapOnly, true);
    assert.ok(foxholeStructureRangeCommands({ type: 'killbox', max: 30, reach: 40 })?.stroke.some(command => command.op === 'stroke' && command.width === 320));
    assert.equal(foxholeStructureRangeCommands({ type: 'intel' }), null);
    assert.equal(isFoxholeStructureRangeVisible({ type: 'killbox', max: 30 }, {}, true, true), false);
    assert.equal(isFoxholeStructureRangeVisible({ type: 'killbox', max: 30 }, { 'foxhole.debug.ranges.vehicleWeapons': true }, true, true), true);
    assert.equal(isFoxholeStructureRangeVisible({ type: 'killbox', max: 30 }, { 'foxhole.ranges.defense.smallArms': true }, false), true);
});

test('spatial coverage retains existing category, selection, vehicle and nighttime settings', () => {
    const appearance = { destroyed: false, packaged: false };
    for (const [type, setting] of [['supply', 'foxhole.ranges.supply'], ['intel', 'foxhole.ranges.intel'],
        ['killbox', 'foxhole.ranges.rifle'], ['killboxAT', 'foxhole.ranges.antiTank'], ['killboxArty', 'foxhole.ranges.artillery']] as const) {
        const asset = { ...assets.mgait2!, ranges: [{ type, max: 50, arc: 45 }] };
        const variants: Record<string, boolean>[] = [{}, { [setting]: true }, { 'foxhole.ranges.selectionOnly': false },
            { [setting]: true, 'foxhole.ranges.selectionOnly': false }, { [setting]: true, 'foxhole.ranges.nighttime': true }];
        for (const settings of variants) {
            const groups = renderFoxholeStructureRangeOverlays(asset, settings, appearance);
            assert.equal(groups.length > 0, isFoxholeStructureRangeVisible(asset.ranges[0]!, settings, true, false), `${type}:${JSON.stringify(settings)}`);
            for (const group of groups) {
                assert.equal(group.kind === 'group' && group.children[0]?.experimentalPresentation?.groundOverlay, true);
                assert.equal(group.experimentalPresentation?.selectionOnly, !isFoxholeStructureRangeVisible(asset.ranges[0]!, settings, false, false));
            }
            assert.doesNotThrow(() => parseNixieExtensionRenderPlanV1({ schemaVersion: 1, root: { id: 'root', kind: 'group', children: groups } }));
        }
    }
});

import { renderFoxholeStructureFiringVolumes, createFoxholeStructureFiringEnvelopes } from '../src/scene-v2-structure-range-overlays.ts';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';

test('source-backed mounted envelopes use ground-aligned height and existing category/selection gates', () => {
    const asset = assets.tankettec!, appearance = { destroyed: false, packaged: false };
    const settings = { 'foxhole.debug.ranges.vehicleWeapons': true };
    assert.equal(renderFoxholeStructureFiringVolumes(asset,{},appearance).length,0);
    const selected = renderFoxholeStructureFiringVolumes(asset,settings,appearance);
    assert.equal(selected.length,1);
    assert.ok(selected[0]?.kind === 'angular-envelope');
    assert.deepEqual(selected[0].yaw,[-45,45]);
    assert.deepEqual(selected[0].pitch,[-15,15]);
    assert.equal(selected[0]!.selectionOnly,true);
    assert.ok(Math.abs(selected[0]!.origin[2] - (asset.ranges![0]!.firingVolume!.origin[2]*32+asset.model!.blueprintOrigin!.z))<1e-8);
    assert.ok(selected[0]!.origin[2]>0,'mount follows the model ground reference');
    assert.equal(renderFoxholeStructureFiringVolumes(asset,{...settings,'foxhole.ranges.selectionOnly':false},appearance).length,0);
    assert.equal(renderFoxholeStructureFiringVolumes(asset,{...settings,'foxhole.ranges.antiTank':true},appearance)[0]!.selectionOnly,false);
    assert.deepEqual(renderFoxholeStructureFiringVolumes(asset,{...settings,'foxhole.ranges.nighttime':true},appearance),selected,'manned vehicles retain the existing night exception');
    assert.equal(renderFoxholeStructureFiringVolumes(asset,settings,{destroyed:true,packaged:false}).length,0);
    assert.equal(renderFoxholeStructureFiringVolumes(asset,settings,{destroyed:false,packaged:true}).length,0);
    assert.equal(renderFoxholeStructureFiringVolumes({...asset, ranges:[{type:'intel',max:80}]},settings,appearance).length,0);
    assert.equal(renderFoxholeStructureFiringVolumes({...asset,ranges:[{type:'killbox',max:35}]},settings,appearance).length,0,'range-only data does not invent a volume');
    const entity = {entityId:'test',revision:1,components:[{ownerId:'nixie.foxhole-planner',componentId:'asset',version:1,definitionAvailable:true,data:{catalogId:'foxhole.structures',assetId:'tankettec'}}]};
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity,{contractVersion:1,entities:[entity],settings}));
    assert.deepEqual(plan.experimentalSpatial?.volumes,selected);
    assert.equal(plan.experimentalSpatial?.supplementModel,true);
});


test('AI uses firing cones with the existing category, selection and nighttime settings', () => {
    const asset=assets.mgait2!, appearance={destroyed:false,packaged:false};
    const cone=renderFoxholeStructureFiringVolumes(asset,{},appearance)[0];
    assert.ok(cone?.kind==='cone');
    assert.equal(cone.halfAngle,45);
    assert.equal(cone.selectionOnly,true);
    assert.equal(cone.clipCylinder,undefined);
    assert.equal(renderFoxholeStructureFiringVolumes(asset,{'foxhole.ranges.selectionOnly':false},appearance).length,0);
    assert.equal(renderFoxholeStructureFiringVolumes(asset,{'foxhole.ranges.rifle':true},appearance)[0]!.selectionOnly,false);
    const night={'foxhole.ranges.nighttime':true,'foxhole.ranges.poweredSpotlights':true};
    const powered=renderFoxholeStructureFiringVolumes(asset,night,appearance)[0]!;
    assert.deepEqual(powered.clipCylinder,{center:[0,0],radius:15*1.33*32});
    assert.equal(powered.maxRadius,cone.maxRadius,'nighttime clips visibility, not weapon range');
    assert.equal(renderFoxholeStructureFiringVolumes(asset,{...night,'foxhole.ranges.poweredSpotlights':false},appearance)[0]!.clipCylinder!.radius,15*32);
    for(const [codeName,type] of [['ArtilleryAIT1','killboxArty'],['CoastalGun','killboxAT'],['AANavalTurret','killboxAA']]){
        const exception={...asset,codeName,ranges:asset.ranges!.map(range=>({...range,type}))};
        assert.equal(createFoxholeStructureFiringEnvelopes(exception,night,appearance)[0]!.clipCylinder,undefined);
    }
    assert.equal(renderFoxholeStructureFiringVolumes(asset,night,{destroyed:true,packaged:false}).length,0);
    assert.equal(renderFoxholeStructureFiringVolumes(asset,night,{destroyed:false,packaged:true}).length,0);
    const entity={entityId:'ai',revision:1,components:[{ownerId:'nixie.foxhole-planner',componentId:'asset',version:1,definitionAvailable:true,data:{catalogId:'foxhole.structures',assetId:'mgait2'}}]};
    const plan=parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity,{contractVersion:1,entities:[entity],settings:night}));
    assert.deepEqual(plan.experimentalSpatial?.volumes,[powered]);
});


test('AI artillery cones retain minimum ranges and the nighttime exception',()=>{
    for(const id of ['artilleryait1','artilleryait2','artilleryait3']){
        const cone=createFoxholeStructureFiringEnvelopes(assets[id]!,{'foxhole.ranges.nighttime':true},{destroyed:false,packaged:false})[0];
        assert.ok(cone?.kind==='cone');assert.equal(cone.halfAngle,60);assert.equal(cone.minRadius,25*32);
        assert.equal(cone.clipCylinder,undefined);
    }
});


test('unresolved weapon positions keep ground coverage without inventing a 3D muzzle', () => {
    const asset=assets.mgait2!, appearance={destroyed:false,packaged:false};
    const unknown={...asset,ranges:asset.ranges!.map(range=>({...range,firingVolume:{...range.firingVolume!,originSource:'firing-component' as const,coverage:undefined}}))};
    assert.deepEqual(renderFoxholeStructureFiringVolumes(unknown,{},appearance),[]);
    assert.ok(renderFoxholeStructureRangeOverlays(unknown,{},appearance).length>0);
});

test('rocket salvos use independent firing-ready muzzle origins and calibrated source pitch', () => {
    const appearance={destroyed:false,packaged:false};
    const settings={'foxhole.debug.ranges.vehicleWeapons':true};
    for(const [id,count,physicalPitch,span,requiresDeployment] of [
        ['armoredcar2multiw',10,15,10,true],['truckmultic',16,26,6,true],['gunboat2c',6,20,15,false],
    ] as const) {
        const asset=assets[id]!;
        const range=asset.ranges!.find(range=>range.firingVolume?.payloadPose)!;
        const source=range.firingVolume!;
        assert.ok(source.source==='mount-dynamic-data');
        assert.equal(source.muzzleOrigins?.length,count,id);
        assert.equal(source.payloadPose?.requiresDeployment,requiresDeployment,id);
        assert.equal(source.minPitch,0,'source frame already includes firing-ready elevation');
        assert.ok(Math.abs(source.maxPitch-span)<0.01,id);
        const [x,y,z,w]=source.orientation;
        assert.ok(Math.abs(Math.asin(2*(x*z-w*y))*180/Math.PI-physicalPitch)<0.01,id);
        const all=createFoxholeStructureFiringEnvelopes(asset,settings,appearance);
        const volumes=all.filter(volume=>volume.id.includes('-muzzle-'));
        assert.equal(volumes.length,count,id);
        assert.equal(new Set(volumes.map(volume=>volume.origin.join(','))).size,count,id);
        assert.ok(Math.abs(Math.pow(1-volumes[0]!.alpha,count)-0.9)<1e-12,'salvo opacity compounds');
        assert.ok(volumes.every(volume=>volume.selectionOnly));
        assert.deepEqual(createFoxholeStructureFiringEnvelopes(asset,{...settings,'foxhole.ranges.nighttime':true},appearance),all);
        assert.deepEqual(createFoxholeStructureFiringEnvelopes(asset,{},appearance),[]);
        assert.deepEqual(createFoxholeStructureFiringEnvelopes(asset,settings,{destroyed:true,packaged:false}),[]);
        assert.deepEqual(createFoxholeStructureFiringEnvelopes(asset,settings,{destroyed:false,packaged:true}),[]);
        volumes.forEach((volume,index)=>source.muzzleOrigins![index]!.forEach((value,axis)=>{
            const offset=asset.model!.blueprintOrigin?.[(['x','y','z'] as const)[axis]!]??0;
            assert.ok(Math.abs(volume.origin[axis]!-(value*32+offset))<1e-7,id);
        }));
        assert.doesNotThrow(()=>parseNixieExtensionRenderPlanV1({schemaVersion:1,root:{id:'root',kind:'group',children:[]},
            experimentalSpatial:{contractVersion:1,nodes:[],supplementModel:true,volumes:all}}));
    }
    const truck=assets.truckmultic!;
    assert.deepEqual([truck.ranges![0]!.min,truck.ranges![0]!.max],[375,500],'2D coverage changed');
    assert.equal(truck.ranges![0]!.firingVolume!.payloadPose!.inputPitch,65,'native animation input was rewritten as a physical angle');
});

test('direct-fire ground coverage uses component range frames and physical sight origins without duplicate spatial fills', () => {
    const appearance = { destroyed: false, packaged: false };
    for (const id of ['riflepillbox','mgpillbox','atpillbox','isgpillbox','rifleait1','rifleait2','rifleait3','mgait1','mgait2','mgait3','atgunait1','atgunait2','atgunait3']) {
        const asset = assets[id]!, before = structuredClone(asset);
        const volumes = renderFoxholeStructureFiringVolumes(asset, { 'foxhole.structure.lineOfSight': true }, appearance);
        assert.ok(volumes.length, id);
        const range = asset.ranges!.find(range => range.firingVolume?.source === 'ai-turret')!;
        const source = range.firingVolume!;
        assert.deepEqual(volumes[0]!.groundProjection!.lineOfSightOrigin, source.origin.map((v,i) => v * 32 + (asset.model!.blueprintOrigin?.[(['x','y','z'] as const)[i]!] ?? 0)), id);
        const groups = renderFoxholeStructureRangeOverlays(asset, {}, appearance);
        const node = groups.flatMap(group => group.kind === 'group' ? group.children : []).find(node => node.id === `structure-range-${asset.ranges!.indexOf(range)}`)!;
        assert.equal(node.experimentalPresentation?.groundOverlay, false, id);
        assert.deepEqual(asset, before);
    }
    for (const id of ['artilleryait1','truckmultic']) {
        const asset = assets[id]!, settings = { 'foxhole.debug.ranges.vehicleWeapons': true };
        const volumes = renderFoxholeStructureFiringVolumes(asset, settings, appearance);
        assert.ok(volumes.every(volume => !volume.id.includes('-muzzle-')), id + ' must not show a straight salvo volume');
        const groups = renderFoxholeStructureRangeOverlays(asset, settings, appearance);
        assert.ok(groups.flatMap(group => group.kind === 'group' ? group.children : []).some(node => node.experimentalPresentation?.groundOverlay), id);
    }
});

test('AI coverage uses its component frame while physical muzzle metadata stays independent', () => {
    const original = assets.mgpillbox!;
    const asset = {...original,ranges:[{type:'killboxMG',arc:35,min:4,max:30,firingVolume:{source:'ai-turret' as const,coneHalfAngle:35,
        originSource:'muzzle-component' as const,origin:[2,0,1.1] as [number,number,number],orientation:[0,0,0,1] as [number,number,number,number],
        coverage:{origin:[0,0,0] as [number,number,number],orientation:[0,0,Math.SQRT1_2,Math.SQRT1_2] as [number,number,number,number]}}}]};
    const before=structuredClone(asset);
    const volume=renderFoxholeStructureFiringVolumes(asset,{}, {destroyed:false,packaged:false})[0]!;
    const offset=asset.model!.blueprintOrigin!;
    assert.deepEqual(volume.origin,[offset.x,offset.y,offset.z]);
    assert.deepEqual(volume.orientation,[0,0,Math.SQRT1_2,Math.SQRT1_2]);
    assert.equal(volume.minRadius,128);assert.equal(volume.maxRadius,960);
    assert.deepEqual(asset,before,'rendering must not rewrite source muzzle metadata');
});


test('pillbox inner clearance remains four metres in daytime and at midnight in every view',()=>{
    for(const id of ['riflepillbox','mgpillbox','atpillbox','isgpillbox']) {
        const asset=assets[id]!,range=asset.ranges!.find(range=>range.firingVolume?.source==='ai-turret')!;
        assert.equal(range.min,4,id);
        for(const night of [false,true]) {
            const volume=renderFoxholeStructureFiringVolumes(asset,{'foxhole.ranges.nighttime':night},{destroyed:false,packaged:false})[0]!;
            assert.equal(volume.minRadius,128,id);assert.equal(volume.maxRadius,range.max!*32,id);
            assert.deepEqual(volume.clipCylinder,night?{center:[0,0],radius:480}:undefined,id);
            const commands=foxholeStructureRangeCommands(range,night?15:null)!;
            assert.ok(commands.fill.some(command=>(command.op==='arc'||command.op==='circle')&&command.radius===128),id+' missing inner boundary');
            assert.ok(commands.fill.some(command=>(command.op==='arc'||command.op==='circle')&&command.radius===(night?480:range.max!*32)),id+' incorrect night cap');
        }
    }
    for(const id of ['rifleait1','rifleait2','rifleait3','mgait1','mgait2','mgait3','atgunait1','atgunait2','atgunait3'])
        assert.equal(assets[id]!.ranges![0]!.min??0,0,id+' must not inherit pillbox clearance');
    assert.equal(assets.artilleryait1!.ranges![0]!.min,25,'existing artillery minimum must survive');
});


test('existing Line of Sight preference controls model occlusion without changing range geometry', () => {
    const asset = assets.mgpillbox!, appearance = { destroyed: false, packaged: false };
    const off = renderFoxholeStructureFiringVolumes(asset, {}, appearance)[0]!;
    assert.deepEqual(off.groundProjection, {});
    assert.deepEqual(renderFoxholeStructureFiringVolumes(asset, { 'foxhole.structure.lineOfSight': false }, appearance)[0], off);
    const on = renderFoxholeStructureFiringVolumes(asset, { 'foxhole.structure.lineOfSight': true }, appearance)[0]!;
    assert.ok(on.groundProjection!.lineOfSightOrigin);
    assert.deepEqual({ ...on, groundProjection: {} }, off);
    const entity = { entityId: 'ai', revision: 1, components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId: 'mgpillbox' } }] };
    for (const enabled of [false, true]) {
        const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity, { contractVersion: 1, entities: [entity], settings: { 'foxhole.structure.lineOfSight': enabled } }));
        assert.equal(Boolean(plan.experimentalSpatial!.volumes![0]!.groundProjection!.lineOfSightOrigin), enabled);
    }
});
