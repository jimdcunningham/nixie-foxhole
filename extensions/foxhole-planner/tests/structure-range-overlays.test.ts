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
