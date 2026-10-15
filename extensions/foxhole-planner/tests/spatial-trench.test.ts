import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNixieExperimentalSpatialPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import assets from '../src/scene-v2-assets-node.ts';
import { renderSpatialTrench } from '../src/scene-v2-spatial-trench.ts';
import { structuralModelClips, triangulateStructureRegion } from '../src/scene-v2-structural-clips.ts';
const entity = { entityId: 'trench', revision: 1, components: [] };
const data = (id: string) => ({ foxholeKey: id, startX: 10, startY: 20, startRotation: -.5, endX: 210, endY: 50, endRotation: .5, startZ: 5, endZ: 25, minLength: 80, maxLength: 256, minRadius: 0, maxRadius: 0, maxBuffer: 0, curveT: 1, blueprint: false });
test('all trench tiers preserve rotated native pieces, connected end geometry and selected modifications', () => {
    for (const id of ['trenchconnectort1', 'trenchconnectort2', 'trenchconnectort3'])
        for (const length of [80, 160, 256])
            for (const mask of [0, 1, 2, 3]) {
                const asset = assets[id]!, input = { ...data(id), endX: 10 + length, endY: 20, startAttachmentNodeId: mask & 1 ? 'a' : undefined, endAttachmentNodeId: mask & 2 ? 'b' : undefined };
                const before = structuredClone(input), plan = renderSpatialTrench(entity, input, asset)!;
                parseNixieExperimentalSpatialPlanV1(plan);
                assert.ok(plan.nodes.length <= 64);
                assert.deepEqual(input, before);
                const floor = plan.nodes.find(n => n.id === 'trench-floor');
                assert.ok(floor?.kind === 'model-path' && floor.clipPolygons?.[0]!.length! >= 8);
                const mods = Object.entries(asset.modifications).flatMap(([slotId, slot]) => Object.entries(slot.variants).filter(([, variant]) => !variant.isUpgrade).map(([variantId]) => ({ slotId, variantId })));
                for (const selection of mods) {
                    const modified = { ...entity, components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'modification', version: 1, definitionAvailable: true, data: { selections: [selection] } }] };
                    const changed = renderSpatialTrench(modified, input, asset)!;
                    parseNixieExperimentalSpatialPlanV1(changed);
                    assert.ok(changed.nodes.length > plan.nodes.length, selection.variantId);
                }
            }
});
test('intersection floors and emplacement approaches publish convex clip unions for every connection mask', () => {
    for (const id of ['trenchintt1', 'trenchintt2', 'trenchintt3', 'trenchempt1', 'trenchempt2', 'trenchempt3'])
        for (let mask = 0; mask < 16; mask++) {
            const occupied = new Set(['back', 'front', 'left', 'right'].filter((_, i) => mask & (1 << i))), clips = structuralModelClips(assets[id]!, occupied);
            assert.ok(clips.some(clip => clip.nodeNames.includes('structure-layer-floor')), id);
            parseNixieExperimentalSpatialPlanV1({ contractVersion: 1, supplementModel: true, nodes: [], modelClips: clips });
        }
    const region = [{ x: -3, y: -1 }, { x: -1, y: -1 }, { x: -1, y: -3 }, { x: 1, y: -3 }, { x: 1, y: -1 }, { x: 3, y: -1 }, { x: 3, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 3 }, { x: -1, y: 3 }, { x: -1, y: 1 }, { x: -3, y: 1 }];
    const area = triangulateStructureRegion(region).reduce((sum, [a, b, c]) => sum + Math.abs((b!.x - a!.x) * (c!.y - a!.y) - (b!.y - a!.y) * (c!.x - a!.x)) / 2, 0);
    assert.equal(area, 20);
});

test('native side strips never render again as rigid endpoint spans', () => {
    for (const id of ['trenchconnectort1','trenchconnectort2','trenchconnectort3']) {
        const asset=assets[id]!, plan=renderSpatialTrench(entity,data(id),asset)!;
        const baked=['wallleft','wallright','dirtsplineleft','dirtsplineright','visualsplineleft','visualsplineright','floorsplineconnector'];
        const indices=baked.flatMap(role=>asset.model!.pathProfile!.parts[role]?.meshIndices??[asset.model!.pathProfile!.parts[role]?.meshIndex]).filter(i=>i!==undefined);
        assert.ok(!plan.nodes.some(n=>n.kind==='model-path'&&indices.includes(n.meshIndex)),id);
        for(const role of ['wallback','wallfront']) {
            const part=asset.model!.pathProfile!.parts[role]!;
            assert.ok(plan.nodes.some(n=>n.kind==='model-path'&&n.meshIndex===part.meshIndex),id+': '+role);
        }
    }
});
