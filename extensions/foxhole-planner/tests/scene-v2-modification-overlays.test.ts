import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixiejs/extension-sdk/scene-v2';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import { FOXHOLE_MODIFICATION_SLOTS_SETTING_ID } from '../src/scene-v2-modification-overlays.ts';

const asset = { entityId: 'structure', revision: 1, components: [{ ownerId: 'nixie.foxhole-planner',
    componentId: 'asset', version: 1, definitionAvailable: true,
    data: { catalogId: 'foxhole.structures', assetId: 'artilleryait1' } }] };

test('modification slot setting renders real catalog slot anchors without changing bounds', () => {
    const render = (enabled: boolean) => parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(asset,
        { contractVersion: 1, entities: [asset], settings: { [FOXHOLE_MODIFICATION_SLOTS_SETTING_ID]: enabled } }));
    const off = render(false), on = render(true);
    assert.equal(off.root.children.some(node => node.id === 'structure-modification-slots'), false);
    const group = on.root.children.find(node => node.id === 'structure-modification-slots');
    assert.ok(group && group.kind === 'group');
    assert.equal(group.experimentalPresentation?.excludeFromBounds, true);
    assert.ok(group.children.length >= 4);
    assert.ok(group.children.some(node => node.kind === 'group' && node.x === -80 && node.y === 0));
    assert.deepEqual(on.experimentalSelectionGeometry, off.experimentalSelectionGeometry);
});

test('modification slot overlay honors destroyed and packaged appearances', () => {
    for (const mode of ['destroyed', 'packaged']) {
        const subject = { ...asset, components: [...asset.components, { ownerId: 'nixie.foxhole-planner',
            componentId: 'appearance', version: 1, definitionAvailable: true, data: { [mode]: true } }] };
        const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(subject,
            { contractVersion: 1, entities: [subject], settings: { [FOXHOLE_MODIFICATION_SLOTS_SETTING_ID]: true } }));
        assert.equal(plan.root.children.some(node => node.id === 'structure-modification-slots'), false);
    }
});
