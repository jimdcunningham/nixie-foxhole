import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeNixieExperimentalSceneV2SnapshotNodeV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { readSceneStatistics, readStatisticsPreferences } from '../src/scene-statistics.ts';

test('Planner summary counts typed owned assets and configured orders from complete ECS snapshots', () => {
    const ownerId = 'nixie.foxhole-planner';
    const entity: NixieExperimentalComponentEntitySnapshotV1 = { entityId: 'factory', revision: 3, components: [
        { ownerId, componentId: 'asset', version: 1, definitionAvailable: true, data: { assetId: 'facilityfactoryammo' } },
        { ownerId, componentId: 'production-order', version: 1, definitionAvailable: true, data: { orders: [{ id: 'one', recipeId: 'ammo', cycles: 2 }] } },
    ] };
    const scene = { protocolVersion: 1 as const, surface: 'scene-v2' as const, totalCount: 1, truncated: false, nodes: [encodeNixieExperimentalSceneV2SnapshotNodeV1(entity)] };
    const selection = { protocolVersion: 1 as const, totalCount: 0, truncated: false, nodes: [] };
    assert.deepEqual(readSceneStatistics(scene, selection).metrics, { 'Entities': 1, 'Assets': 1, 'Connectors': 0, 'Planning Shapes': 0, 'Configured Orders': 1 });
    assert.throws(() => readSceneStatistics({ ...scene, totalCount: 2 }, selection), /Complete scene/);
    entity.components[1]!.definitionAvailable = false;
    assert.throws(() => readSceneStatistics({ ...scene, nodes: [encodeNixieExperimentalSceneV2SnapshotNodeV1(entity)] }, selection), /unresolved/);
});

test('statistics consume only declared owner-local saved panel preferences', () => {
    const scene = { protocolVersion: 1 as const, totalCount: 0, truncated: false, nodes: [], experimentalPanelContext: {
        contractVersion: 1 as const, ownerId: 'nixie.foxhole-planner', panelId: 'statistics', values: {
            'nixie.foxhole-planner.stats.scope': 'scene', 'nixie.foxhole-planner.stats.interval': '3d', 'nixie.foxhole-planner.showLabels': false,
        },
    } };
    assert.deepEqual(readStatisticsPreferences(scene), { scope: 'scene', intervalSeconds: 259200 });
    assert.deepEqual(readStatisticsPreferences({ ...scene, experimentalPanelContext: { ...scene.experimentalPanelContext, ownerId: 'example.foreign' } }), { scope: 'auto', intervalSeconds: 3600 });
    assert.deepEqual(readStatisticsPreferences({ ...scene, experimentalPanelContext: { ...scene.experimentalPanelContext, panelId: 'other' } }), { scope: 'auto', intervalSeconds: 3600 });
    assert.deepEqual(readStatisticsPreferences({ ...scene, experimentalPanelContext: { ...scene.experimentalPanelContext, values: { 'nixie.foxhole-planner.stats.scope': 'invalid' } } }), { scope: 'auto', intervalSeconds: 3600 });
});
