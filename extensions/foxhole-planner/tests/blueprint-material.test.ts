import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import metadata from '../src/scene-v2-assets-node.ts';

test('model blueprints request solid lit materials while flat artwork keeps its established blue tint', () => {
    const entity = (blueprint: boolean): NixieExperimentalComponentEntitySnapshotV1 => ({ entityId: 'blue-refinery', revision: 1,
        components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: 'facilityrefinery1' } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'appearance', version: 1, definitionAvailable: true,
            data: { blueprint, tint: 0x123456, brightness: 1.2 } }] });
    const subject = entity(true), before = structuredClone(subject);
    const blue = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(subject));
    assert.deepEqual(blue.experimentalSpatial?.modelMaterial, { color: 0x4f79c6, roughness: 0.6, metallic: 0 });
    assert.equal(blue.experimentalSpatial?.supplementModel, true);
    const texture = blue.root.children.find(node => node.id === 'building-texture');
    assert.equal(texture?.kind === 'sprite' && texture.tint, 0x335CFF);
    assert.equal(texture?.brightness, 2.15);
    assert.deepEqual(subject, before);
    const normal = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity(false)));
    assert.equal(normal.experimentalSpatial?.modelMaterial, undefined);
    const normalTexture = normal.root.children.find(node => node.id === 'building-texture');
    assert.equal(normalTexture?.kind === 'sprite' && normalTexture.tint, 0x123456);
    const unsupported = Object.entries(metadata).find(([, asset]) => !asset.canBlueprint)!;
    assert.ok(unsupported);
    subject.components[0]!.data.assetId = unsupported[0];
    assert.equal(renderFoxholeSceneV2Entity(subject).experimentalSpatial?.modelMaterial, undefined);
});

test('pipeline blueprint materials preserve the model-path geometry recipe', () => {
    const entity = (blueprint: boolean): NixieExperimentalComponentEntitySnapshotV1 => ({ entityId: 'blue-pipe', revision: 1,
        components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'spline-connector', version: 1, definitionAvailable: true,
            data: { foxholeKey: 'facilitypipeoverhead', startX: 0, startY: 0, startRotation: 0,
                endX: 240, endY: 0, endRotation: 0, minLength: 32, maxLength: 800, minRadius: 16,
                maxRadius: 800, maxBuffer: 3.2, curveT: 0, blueprint } }] });
    const blue = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity(true)));
    const normal = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity(false)));
    assert.equal(blue.experimentalSpatial?.modelMaterial?.color, 0x4f79c6);
    assert.deepEqual(blue.experimentalSpatial?.nodes, normal.experimentalSpatial?.nodes);
    assert.ok(blue.experimentalSpatial?.nodes.some(node => node.kind === 'model-path'));
});
