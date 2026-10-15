import type { FoxholeSceneV2SplineConnectorData } from '../src/scene-v2-spline-connectors.ts';
import type { FoxholeSpatialPathProfile } from '../src/scene-v2-models.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import assets from '../src/scene-v2-assets-node.ts';
import { renderFoxholeSpatialConnector } from '../src/scene-v2-spatial-connectors.ts';
import { createFoxholeSceneV2SplineProductData } from '../src/scene-v2-connector-products.ts';
import { getFoxholeSceneV2ModelComponentData, readFoxholeSpatialPathProfile } from '../src/scene-v2-models.ts';
import { parseNixieExperimentalSpatialPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import type { NixieExperimentalComponentEntitySnapshotV1 as Entity } from '@nixie/extension-sdk/experimental/scene-v2';

test('overhead and insulated pipelines retain rigid endpoint origins and native span insets at both length limits', () => {
    const asset = assets.facilitypipeoverhead!;
    assert.ok(asset.model?.pathProfile && asset.model.insulatedPathProfile, 'run the focused overhead export before this integration check');
    const entity: Entity = { entityId: 'overhead', revision: 1, components: [{ ownerId: 'nixie.foxhole-planner',
        componentId: 'modification', version: 1, definitionAvailable: true, data: { selections: [] } }] };
    for (const length of [256,640]) for (const insulated of [false,true]) {
        entity.components[0]!.data.selections = insulated ? [{ slotId: 'UpgradeSlotComponent', variantId: 'insulation' }] : [];
        const data = { ...createFoxholeSceneV2SplineProductData('facilitypipeoverhead', asset.connector!),
            endX: length, endY: 90, startZ: 10, endZ: 42 } as unknown as FoxholeSceneV2SplineConnectorData & { startZ: number; endZ: number; };
        const before = structuredClone({ entity, data });
        const result = renderFoxholeSpatialConnector(entity, data, asset)!;
        assert.deepEqual(parseNixieExperimentalSpatialPlanV1(result), result);
        const node = result.nodes[0]!;
        assert.ok(node.kind === 'model-path');
        const profile: FoxholeSpatialPathProfile = insulated ? asset.model.insulatedPathProfile! : asset.model.pathProfile!;
        assert.equal(node.resourceId, `foxhole.model.facilitypipeoverhead${insulated ? '.upgrade.insulation' : ''}`);
        assert.equal(node.meshIndex, profile.parts.span!.meshIndex);
        assert.deepEqual(node.startOrigin, [0,0,0]); assert.deepEqual(node.endOrigin, [256,0,0]);
        assert.equal(node.startInset, 70.4); assert.equal(node.endInset, 70.4);
        assert.deepEqual(node.points.slice(0,3), [0,0,10]); assert.deepEqual(node.points.slice(-3), [length,90,42]);
        assert.deepEqual({ entity, data }, before);
        assert.deepEqual(renderFoxholeSpatialConnector(JSON.parse(JSON.stringify(entity)), data, asset), result);
    }
    assert.equal('pathProfile' in getFoxholeSceneV2ModelComponentData(asset.model), false);
    assert.throws(() => readFoxholeSpatialPathProfile({ version: 1, parts: { span: { meshIndex: -1, origin: [0,0,0] } } }));
});
