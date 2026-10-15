import { hostSourceUrl } from "../host-source-url.mjs";
import { resolveFoxholeConnectorSelectionGeometry } from '../../../../../extensions/foxhole-planner/src/connector-selection-geometry.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import assets from '../../../../../extensions/foxhole-planner/src/scene-v2-assets-node.ts';
import { resolveFoxholeSceneV2StructureSelectionGeometry } from '../../../../../extensions/foxhole-planner/src/scene-v2-renderers.ts';
import { registerHooks } from 'node:module';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixie/extension-sdk';

registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes('/packages/extensions/foxhole/') && specifier.startsWith('#nixie/')) {
        return { url: hostSourceUrl(`../../../../nixie/app/${specifier.slice('#nixie/'.length)}`, import.meta.url).href, shortCircuit: true };
    }
    if (context.parentURL?.includes('/packages/extensions/foxhole/') && specifier.startsWith('#foxhole/')) {
        return { url: hostSourceUrl(`../../app/${specifier.slice('#foxhole/'.length)}`, import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
} });
const { foxholeSceneV2StateAdapter } = await import('../../app/plugins/foxhole/nixie/scene-v2-state-adapter.ts');

function entity(assetId: string, appearance: Record<string, boolean | number>, selections: { slotId: string; variantId: string; }[] = []): NixieExperimentalComponentEntitySnapshotV1 {
    return { entityId: 'one', revision: 1, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'appearance', version: 1, definitionAvailable: true, data: appearance },
        { ownerId: 'nixie.foxhole-planner', componentId: 'modification', version: 1, definitionAvailable: true, data: { selections } },
    ] };
}
test('SDK asset selection bounds/origins match the bundled adapter across catalog appearances and modification variants', () => {
    let compared = 0;
    const mismatches: string[] = [];
    for (const [id, asset] of Object.entries(assets)) {
        if (asset.isItem) {
            continue;
        }
        const cases = [{ input: entity(id, {}), label: 'base' }, { input: entity(id, { anchorX: 0.2, anchorY: 0.7 }), label: 'anchors' }];
        if (asset.destroyed) {
            cases.push({ input: entity(id, { destroyed: true }), label: 'destroyed' });
        }
        if (asset.packaged) {
            cases.push({ input: entity(id, { packaged: true }), label: 'packaged' });
        }
        for (const [slotId, slot] of Object.entries(asset.modifications)) {
            for (const variantId of Object.keys(slot.variants)) {
                cases.push({ input: entity(id, {}, [{ slotId, variantId }]), label: `${slotId}/${variantId}` });
            }
        }
        for (const { input, label } of cases) {
            const actual = resolveFoxholeSceneV2StructureSelectionGeometry(input, asset);
            const expected = foxholeSceneV2StateAdapter.selectionLocalBounds?.(input, 1);
            if (!expected) {
                continue;
            }
            for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const) {
                if (Math.abs(actual.localBounds[key] - expected[key]) >= 1e-7) {
                    mismatches.push(`${id}/${label}/${key}: ${actual.localBounds[key]} != ${expected[key]}`);
                }
            }
            assert.deepEqual(actual.transformOrigin, foxholeSceneV2StateAdapter.selectionTransformOriginLocal?.(input));
            compared += 1;
        }
    }
    console.info(`Compared ${compared} cases; ${mismatches.length} differences.`, mismatches.slice(0, 30));
    assert.deepEqual(mismatches, []);
    assert.ok(compared > 1000);
});

test('SDK connector origins and power-line quads match the actual bundled adapter', () => {
    for (const foxholeKey of ['powerline', 'facilitypipe', 'wallsplinet1']) {
        for (const [startX, startY, endX, endY] of [[0, 0, 100, 100], [-20, 40, 160, -30], [4, 7, 4, 7]]) {
            const data = { foxholeKey, startX, startY, endX, endY, startRotation: 0, endRotation: Math.PI,
                minLength: 0, maxLength: 1000, minRadius: 0, maxRadius: 1000, maxBuffer: 0, curveT: 0, blueprint: false };
            const subject = { entityId: 'line', revision: 1, components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'spline-connector', version: 1,
                definitionAvailable: true, data }] };
            const geometry = resolveFoxholeConnectorSelectionGeometry(data);
            assert.deepEqual(geometry.transformOrigin, foxholeSceneV2StateAdapter.selectionTransformOriginLocal?.(subject));
            assert.deepEqual(geometry.localQuad ?? null, foxholeSceneV2StateAdapter.selectionLocalQuad?.(subject));
            assert.equal(geometry.frameAngle ?? null, foxholeSceneV2StateAdapter.selectionFrameAngleLocal?.(subject));
        }
    }
});

test('range origins retain the first authored endpoint independently of the visual bounds', () => {
    for (const points of [[0, 0, 80, 0], [12, -40, -90, 30]]) {
        const subject = { entityId: 'range', revision: 1, components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'range', version: 1,
            definitionAvailable: true, data: { points } }] };
        assert.deepEqual(foxholeSceneV2StateAdapter.selectionTransformOriginLocal?.(subject), { x: points[0], y: points[1] });
    }
});
