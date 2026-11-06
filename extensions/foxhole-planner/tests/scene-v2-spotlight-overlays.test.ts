import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixiejs/extension-sdk/scene-v2';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import { FOXHOLE_DEBUG_SPOTLIGHTS_SETTING_ID } from '../src/scene-v2-spotlight-overlays.ts';

const asset = { entityId: 'structure', revision: 1, components: [{ ownerId: 'nixie.foxhole-planner',
    componentId: 'asset', version: 1, definitionAvailable: true,
    data: { catalogId: 'foxhole.structures', assetId: 'atgunait2' } }] };

test('debug spotlights render actual catalog lights independent of nighttime, with no bounds changes', () => {
    const render = (enabled: boolean) => parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(asset,
        { contractVersion: 1, entities: [asset], settings: { [FOXHOLE_DEBUG_SPOTLIGHTS_SETTING_ID]: enabled,
            'foxhole.ranges.nighttime': false, 'foxhole.ranges.poweredSpotlights': false } }));
    const off = render(false), on = render(true);
    assert.equal(off.root.children.some(node => node.id === 'structure-debug-spotlights'), false);
    const group = on.root.children.find(node => node.id === 'structure-debug-spotlights');
    assert.ok(group && group.kind === 'group');
    assert.equal(group.presentation?.excludeFromBounds, true);
    assert.ok(group.children.length >= 1);
    assert.deepEqual(on.selectionGeometry, off.selectionGeometry);
});

test('debug spotlights stay hidden for destroyed and packaged structures', () => {
    for (const mode of ['destroyed', 'packaged']) {
        const subject = { ...asset, components: [...asset.components, { ownerId: 'nixie.foxhole-planner',
            componentId: 'appearance', version: 1, definitionAvailable: true, data: { [mode]: true } }] };
        const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(subject,
            { contractVersion: 1, entities: [subject], settings: { [FOXHOLE_DEBUG_SPOTLIGHTS_SETTING_ID]: true } }));
        assert.equal(plan.root.children.some(node => node.id === 'structure-debug-spotlights'), false);
    }
});
