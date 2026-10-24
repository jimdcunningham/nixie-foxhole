import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeNixieExperimentalSceneV2SnapshotNodeV1, formatNixieExperimentalPanelReportV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import assets from '../src/scene-v2-assets-node.ts';
import { buildFoxholeStatisticsReport } from '../src/statistics-report.ts';

const ownerId = 'nixie.foxhole-planner';
const entity = (id: string, assetId: string): NixieExperimentalComponentEntitySnapshotV1 => ({ entityId: id, revision: 1,
    components: [{ ownerId, componentId: 'asset', version: 1, definitionAvailable: true, data: { assetId } }] });

test('Planner report sections contain computed resources and the existing bunker weapon/health formats', () => {
    const artillery = Object.entries(assets).find(([, asset]) => asset.codeName.toLowerCase() === 'artilleryait1');
    assert.ok(artillery);
    const nodes = [encodeNixieExperimentalSceneV2SnapshotNodeV1(entity('garrison', artillery[0]))];
    const scene = { protocolVersion: 1 as const, surface: 'scene-v2' as const, totalCount: 1, truncated: false, nodes,
        experimentalPanelContext: { contractVersion: 1 as const, ownerId, panelId: 'statistics', values: { [`${ownerId}.stats.interval`]: '1h' } } };
    const selection = { protocolVersion: 1 as const, totalCount: 0, truncated: false, nodes: [] };
    const before = structuredClone(scene);
    const report = buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics', scene, selection });
    assert.deepEqual(report.columns, ['scope', 'section', 'metric', 'value', 'unit', 'notes']);
    assert.ok(report.sections.find(section => section.id === 'bunkerHealth')?.rows.some(row => row[2] === 'Total Health' && row[3] === '650'));
    assert.match(formatNixieExperimentalPanelReportV1(report, ['bunkerHealth']).listText, /Total Health: 650/);
    const destruction = report.sections.find(section => section.id === 'bunkerDestruction');
    assert.ok(destruction?.rows.some(row => row[5] === 'T3 Wet'));
    const dry = buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics', scene: { ...scene,
        experimentalPanelContext: { ...scene.experimentalPanelContext, values: { [`${ownerId}.stats.interval`]: '3d' } } }, selection });
    assert.equal(dry.sections.find(section => section.id === 'bunkerDestruction')?.rows.some(row => row[5] === 'T3 Wet'), false);
    assert.deepEqual(scene, before);
    assert.throws(() => buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics', scene: { ...scene, truncated: true }, selection }), /Complete scene/);
});
