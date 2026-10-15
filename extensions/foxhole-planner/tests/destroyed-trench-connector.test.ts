import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { destroyedTrenchConnectorPieces } from '../src/destroyed-trench-connector.ts';
import { trenchLayerQuad } from '../src/trench-connector.ts';
import assetMetadata from '../src/scene-v2-assets-node.ts';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';

const metadata = { assets: assetMetadata };
const start = { x: -57.6, y: 0, rotation: 0 }, end = { x: 57.6, y: 0, rotation: 0 };
const frames = (tier: number) => Object.entries(metadata.assets[`trenchconnectordestroyedt${tier}`]!.renderLayers)
    .map(([id, visual]) => ({ id, textureUrl: visual.resourceId, width: visual.width * 2, height: visual.height * 2,
        offsetX: visual.offsetX * 2, offsetY: visual.offsetY * 2, anchorX: visual.anchorX, anchorY: visual.anchorY }));

test('all destroyed connector tiers publish genuine centre rubble, floor, endpoint and side pieces', () => {
    for (const tier of [1, 2, 3]) {
        const layers = frames(tier);
        assert.ok(layers.some(layer => layer.id === 'floor'));
        assert.ok(layers.some(layer => layer.id === 'destroyed'));
        assert.ok(layers.some(layer => layer.id === 'dirtback'));
        assert.ok(layers.some(layer => layer.id.startsWith('piece-')));
        assert.equal(metadata.assets[`trenchconnectort${tier}`]!.destroyedAssetId, `trenchconnectordestroyedt${tier}`);
        const pieces = destroyedTrenchConnectorPieces(tier, layers, start, end);
        assert.ok(pieces.some(piece => piece.id === 'destroyed'));
        assert.ok(pieces.some(piece => piece.id === 'floor'));
        assert.ok(pieces.every(piece => piece.textureUrl.startsWith(`foxhole.visual.trenchconnectordestroyedt${tier}-layer-`)));
        assert.ok(pieces.every(piece => piece.positions.length === piece.uvs.length && piece.positions.every(Number.isFinite)));
        if (tier < 3) {
            assert.ok(pieces.every(piece => !piece.id.startsWith('wall')));
        }
    }
});

test('endpoint dirt follows the edited handle independently and restores without changing saved geometry', () => {
    for (const tier of [1, 2, 3]) {
        const layers = frames(tier);
        const back = layers.find(layer => layer.id === 'dirtback')!;
        const original = destroyedTrenchConnectorPieces(tier, layers, start, end);
        const movedEnd = { x: 145, y: 37, rotation: -Math.PI / 5 };
        const sourceState = { start, end: movedEnd };
        const saved = structuredClone(sourceState);
        const moved = destroyedTrenchConnectorPieces(tier, layers, sourceState.start, sourceState.end);
        assert.deepEqual(moved.find(piece => piece.id === 'dirtback')!.positions, trenchLayerQuad(back, start, movedEnd));
        assert.deepEqual(moved.find(piece => piece.id === 'dirtback')!.positions, original.find(piece => piece.id === 'dirtback')!.positions);
        assert.notDeepEqual(moved.find(piece => piece.id === 'dirtfront')!.positions, original.find(piece => piece.id === 'dirtfront')!.positions);
        assert.notDeepEqual(moved.find(piece => piece.id === 'destroyed')!.positions, original.find(piece => piece.id === 'destroyed')!.positions);
        assert.deepEqual(sourceState, saved);
        const attached = destroyedTrenchConnectorPieces(tier, layers, start, movedEnd, true, false);
        assert.equal(attached.some(piece => piece.id.includes('back')), false);
        assert.ok(attached.some(piece => piece.id === 'dirtfront'));
    }
});

test('minimum and maximum connector shapes clip centre art at native scale instead of stretching it', () => {
    for (const tier of [1, 2, 3]) {
        const layers = frames(tier);
        for (const length of [80, 256]) {
            for (const startRotation of [-Math.PI / 4, 0, Math.PI / 4]) {
                for (const endRotation of [-Math.PI / 4, 0, Math.PI / 4]) {
                    const a = { x: 0, y: 0, rotation: startRotation }, b = { x: length, y: 0, rotation: endRotation };
                    const pieces = destroyedTrenchConnectorPieces(tier, layers, a, b);
                    assert.ok(pieces.every(piece => piece.positions.every(Number.isFinite) && piece.uvs.every(Number.isFinite)));
                    for (const id of ['floor', 'destroyed']) {
                        const layer = layers.find(entry => entry.id === id)!;
                        const piece = pieces.find(entry => entry.id === id)!;
                        const width = layer.width / 2, height = layer.height / 2;
                        const left = layer.offsetX / 2 - width * layer.anchorX;
                        const top = layer.offsetY / 2 - height * layer.anchorY;
                        for (let i = 0; i < piece.positions.length; i += 2) {
                            assert.ok(Math.abs(piece.positions[i]! - length / 2 - left - piece.uvs[i]! * width) < 1e-7);
                            assert.ok(Math.abs(piece.positions[i + 1]! - top - piece.uvs[i + 1]! * height) < 1e-7);
                        }
                    }
                }
            }
        }
    }
});

test('destroyed connector mesh plans use the saved endpoints and authored wreck resources in V2', () => {
    for (const tier of [1, 2, 3]) {
        const data = { foxholeKey: `trenchconnectort${tier}`, startX: -40, startY: -20, startRotation: Math.PI / 7,
            endX: 170, endY: 35, endRotation: -Math.PI / 9, minLength: 80, maxLength: 256,
            minRadius: 0, maxRadius: 0, maxBuffer: 0, curveT: 0, blueprint: false };
        const entity: NixieExperimentalComponentEntitySnapshotV1 = { entityId: 'connector', revision: 1, components: [
            { ownerId: 'nixie.foxhole-planner', componentId: 'spline-connector', version: 1, definitionAvailable: true, data },
            { ownerId: 'nixie.foxhole-planner', componentId: 'appearance', version: 1, definitionAvailable: true, data: { destroyed: true } },
        ] };
        const saved = structuredClone(entity);
        const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity));
        const meshes = plan.root.children.filter(child => child.kind === 'mesh');
        const expected = destroyedTrenchConnectorPieces(tier, frames(tier),
            { x: data.startX, y: data.startY, rotation: data.startRotation },
            { x: data.endX, y: data.endY, rotation: data.endRotation });
        assert.equal(meshes.length, expected.length);
        for (let i = 0; i < expected.length; i++) {
            assert.equal(meshes[i]!.resourceId, expected[i]!.textureUrl);
            assert.deepEqual(meshes[i]!.positions, expected[i]!.positions);
        }
        assert.deepEqual(entity, saved);
        const restored = renderFoxholeSceneV2Entity({ ...entity, components: entity.components.map(component => component.componentId === 'appearance'
            ? { ...component, data: { destroyed: false } }
            : component) });
        assert.equal(JSON.stringify(restored).includes('destroyed-trench-'), false);
    }
});
