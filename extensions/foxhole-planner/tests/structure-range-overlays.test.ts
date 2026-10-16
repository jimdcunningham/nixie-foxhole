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
    assert.deepEqual(selected[0]?.experimentalPresentation, { contractVersion: 1, groundOverlay: true, excludeFromBounds: true, selectionOnly: true });
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
                assert.equal(group.experimentalPresentation?.groundOverlay, true);
                assert.equal(group.experimentalPresentation?.selectionOnly, !isFoxholeStructureRangeVisible(asset.ranges[0]!, settings, false, false));
            }
            assert.doesNotThrow(() => parseNixieExtensionRenderPlanV1({ schemaVersion: 1, root: { id: 'root', kind: 'group', children: groups } }));
        }
    }
});

import { renderFoxholeStructureFiringVolumes } from '../src/scene-v2-structure-range-overlays.ts';
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
        assert.equal(renderFoxholeStructureFiringVolumes(exception,night,appearance)[0]!.clipCylinder,undefined);
    }
    assert.equal(renderFoxholeStructureFiringVolumes(asset,night,{destroyed:true,packaged:false}).length,0);
    assert.equal(renderFoxholeStructureFiringVolumes(asset,night,{destroyed:false,packaged:true}).length,0);
    const entity={entityId:'ai',revision:1,components:[{ownerId:'nixie.foxhole-planner',componentId:'asset',version:1,definitionAvailable:true,data:{catalogId:'foxhole.structures',assetId:'mgait2'}}]};
    const plan=parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity,{contractVersion:1,entities:[entity],settings:night}));
    assert.deepEqual(plan.experimentalSpatial?.volumes,[powered]);
});


test('AI artillery cones retain minimum ranges and the nighttime exception',()=>{
    for(const id of ['artilleryait1','artilleryait2','artilleryait3']){
        const cone=renderFoxholeStructureFiringVolumes(assets[id]!,{'foxhole.ranges.nighttime':true},{destroyed:false,packaged:false})[0];
        assert.ok(cone?.kind==='cone');assert.equal(cone.halfAngle,60);assert.equal(cone.minRadius,25*32);
        assert.equal(cone.clipCylinder,undefined);
    }
});


test('unresolved weapon positions keep ground coverage without inventing a 3D muzzle', () => {
    const asset=assets.mgait2!, appearance={destroyed:false,packaged:false};
    const unknown={...asset,ranges:asset.ranges!.map(range=>({...range,firingVolume:{...range.firingVolume!,originSource:'firing-component' as const}}))};
    assert.deepEqual(renderFoxholeStructureFiringVolumes(unknown,{},appearance),[]);
    assert.ok(renderFoxholeStructureRangeOverlays(unknown,{},appearance).length>0);
});
