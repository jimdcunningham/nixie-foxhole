import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import assets from '../src/scene-v2-assets-node.ts';
import { sampleTextureMesh } from './helpers/sample-texture-mesh.ts';
import { FOXHOLE_STRUCTURE_RENDER_LANES } from '../src/render-lanes.ts';

const oppositePostSlots = {
    FrontDefenseModSlot: 'FrontLeftDefenseModSlot',
    FrontLeftDefenseModSlot: 'LeftDefenseModSlot',
    LeftDefenseModSlot: 'BackLeftDefenseModSlot',
    BackLeftDefenseModSlot: 'BackDefenseModSlot',
    BackDefenseModSlot: 'BackRightDefenseModSlot',
    BackRightDefenseModSlot: 'RightDefenseModSlot',
    RightDefenseModSlot: 'FrontRightDefenseModSlot',
    FrontRightDefenseModSlot: 'FrontDefenseModSlot',
};

test('emplacement barbed wire connects both authored post positions and preserves both post angles', () => {
    for (const tier of [1, 2, 3]) {
        const assetId = `trenchempt${tier}`;
        const asset = assets[assetId];
        for (const [slotId, endSlotId] of Object.entries(oppositePostSlots)) {
            const slot = asset.modifications[slotId], end = asset.modifications[endSlotId];
            const visual = slot.variants.barbedwire;
            const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
                entityId: 'emplacement', revision: 1, components: [
                    { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1,
                        definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId } },
                    { ownerId: 'nixie.foxhole-planner', componentId: 'modification', version: 1,
                        definitionAvailable: true, data: { selections: [{ slotId, variantId: 'barbedwire' }] } },
                ],
            }));
            const node = plan.root.children.find(candidate => candidate.id === 'modification-1');
            assert.ok(node && (node.kind === 'sprite' || node.kind === 'mesh'));
            const at = (x: number, y: number) => {
                if (node.kind === 'mesh') {
                    const u = 0.5 + (x - visual.offsetX) / visual.width;
                    const v = 0.5 + (y - visual.offsetY) / visual.height;
                    return sampleTextureMesh(node, u, v);
                }
                const localX = x - visual.offsetX, localY = y - visual.offsetY;
                return { x: (node.x ?? 0) + localX * Math.cos(node.rotation ?? 0) - localY * Math.sin(node.rotation ?? 0),
                    y: (node.y ?? 0) + localX * Math.sin(node.rotation ?? 0) + localY * Math.cos(node.rotation ?? 0) };
            };
            const startPost = at(0, 0), endPost = at(105.6, 0.32);
            assert.ok(Math.hypot(startPost.x - slot.x, startPost.y - slot.y) < 1e-5);
            assert.ok(Math.hypot(endPost.x - end.x, endPost.y - end.y) < 1e-3, `${assetId}/${slotId} misses the second post`);
            const postTip = at(0, 10);
            assert.ok(Math.abs(postTip.x - startPost.x + Math.sin(slot.rotation) * 10) < 1e-5);
            assert.ok(Math.abs(postTip.y - startPost.y - Math.cos(slot.rotation) * 10) < 1e-5);
            const endPostTip = at(105.6, 10.32);
            assert.ok(Math.abs(endPostTip.x - endPost.x + Math.sin(end.rotation) * 10) < 1e-5, `${assetId}/${slotId} has the wrong far-post angle`);
            assert.ok(Math.abs(endPostTip.y - endPost.y - Math.cos(end.rotation) * 10) < 1e-5);
            for (const y of [-10, 0, 10]) {
                const wireStart = at(6, y), wireEnd = at(99.6, y);
                for (const fraction of [0.25, 0.5, 0.75]) {
                    const point = at(6 + (99.6 - 6) * fraction, y);
                    const expected = { x: wireStart.x + (wireEnd.x - wireStart.x) * fraction,
                        y: wireStart.y + (wireEnd.y - wireStart.y) * fraction };
                    assert.ok(Math.hypot(point.x - expected.x, point.y - expected.y) < 1e-5, `${assetId}/${slotId} wire must stay straight`);
                }
            }
            assert.equal(node.laneId, 'foxhole:structure:trench-defense');
        }
    }
});

test('emplacement sandbags span both attachment positions above roofs, walls and vehicles', () => {
    for (const tier of [1, 2, 3]) {
        const assetId = `trenchempt${tier}`, asset = assets[assetId];
        for (const [slotId, endSlotId] of Object.entries(oppositePostSlots)) {
            const slot = asset.modifications[slotId], end = asset.modifications[endSlotId];
            const visual = slot.variants.sandbags;
            const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
                entityId: 'emplacement', revision: 1, components: [
                    { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1,
                        definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId } },
                    { ownerId: 'nixie.foxhole-planner', componentId: 'modification', version: 1,
                        definitionAvailable: true, data: { selections: [{ slotId, variantId: 'sandbags' }] } },
                ],
            }));
            const node = plan.root.children.find(candidate => candidate.id === 'modification-1');
            assert.ok(node?.kind === 'mesh', `${assetId}/${slotId} must span both sandbag attachments`);
            const at = (x: number, y: number) => sampleTextureMesh(node,
                0.5 + (x - visual.offsetX) / visual.width, 0.5 + (y - visual.offsetY) / visual.height);
            const startPoint = at(0, 0), endPoint = at(105.6, 0);
            assert.ok(Math.hypot(startPoint.x - slot.x, startPoint.y - slot.y) < 1e-5);
            assert.ok(Math.hypot(endPoint.x - end.x, endPoint.y - end.y) < 1e-3);
            for (const y of [-10, 0, 10]) {
                const a = at(0, y), b = at(105.6, y);
                for (const t of [0.25, 0.5, 0.75]) {
                    const point = at(105.6 * t, y);
                    assert.ok(Math.hypot(point.x - a.x - (b.x - a.x) * t,
                        point.y - a.y - (b.y - a.y) * t) < 1e-5);
                }
            }
            assert.equal(node.laneId, FOXHOLE_STRUCTURE_RENDER_LANES.trenchDefense.laneId);
        }
    }
    for (const lane of [FOXHOLE_STRUCTURE_RENDER_LANES.floor, FOXHOLE_STRUCTURE_RENDER_LANES.base,
        FOXHOLE_STRUCTURE_RENDER_LANES.roof, FOXHOLE_STRUCTURE_RENDER_LANES.corners,
        FOXHOLE_STRUCTURE_RENDER_LANES.upperModification, FOXHOLE_STRUCTURE_RENDER_LANES.vehicle]) {
        assert.ok(FOXHOLE_STRUCTURE_RENDER_LANES.trenchDefense.laneOrder > lane.laneOrder, `defense mods must render above ${lane.label}`);
    }
});
