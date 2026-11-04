import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeNixieExperimentalSceneV2SnapshotNodeV1, formatNixieExperimentalPanelReportV1, parseNixieExperimentalPanelReportV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
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
    assert.equal(report.preview?.kind, 'sections');
    assert.equal(report.preview.sections.length, 1);
    const construction = report.preview.sections[0]!;
    assert.equal(construction.title, 'Construction Cost');
    assert.ok(construction.rows.some(row => row.image));
    assert.deepEqual(parseNixieExperimentalPanelReportV1(report).preview, report.preview);
    assert.ok(construction.rows.every(row => row.tone === 'cost' && /^x[0-9]/.test(row.value)));
    const empty = buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics',
        scene: { ...scene, totalCount: 0, nodes: [] }, selection });
    assert.deepEqual(empty.preview, { kind: 'empty', message: 'Select buildings to see their stats here.' });
    assert.deepEqual(report.columns, ['scope', 'section', 'metric', 'value', 'unit', 'notes']);
    assert.ok(report.sections.find(section => section.id === 'bunkerHealth')?.rows.some(row => row[2] === 'Total Health' && row[3] === '650'));
    assert.match(formatNixieExperimentalPanelReportV1(report, ['bunkerHealth']).listText, /Total Health: 650/);
    const destruction = report.sections.find(section => section.id === 'bunkerDestruction');
    assert.ok(destruction?.rows.some(row => row[5] === 'T3 Wet'));
    const dry = buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics', scene: { ...scene,
        experimentalPanelContext: { ...scene.experimentalPanelContext, values: { [`${ownerId}.stats.interval`]: '3d' } } }, selection });
    assert.equal(dry.sections.find(section => section.id === 'bunkerDestruction')?.rows.some(row => row[5] === 'T3 Wet'), false);
    const custom = buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics', scene: { ...scene,
        experimentalPanelContext: { ...scene.experimentalPanelContext, values: {
            [`${ownerId}.stats.interval`]: 'custom', [`${ownerId}.stats.customIntervalSeconds`]: 3 * 86400,
        } } }, selection });
    assert.deepEqual(custom, dry);
    assert.deepEqual(scene, before);
    assert.throws(() => buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics', scene: { ...scene, truncated: true }, selection }), /Complete scene/);
});

test('liquid capacity follows construction cost and omits zero-capacity rows', () => {
    const silo = Object.entries(assets).find(([, asset]) => asset.codeName.toLowerCase() === 'facilitysilooil');
    assert.ok(silo);
    const nodes = [encodeNixieExperimentalSceneV2SnapshotNodeV1(entity('silo', silo[0]))];
    const scene = { protocolVersion: 1 as const, surface: 'scene-v2' as const, totalCount: nodes.length, truncated: false, nodes };
    const selection = { protocolVersion: 1 as const, totalCount: 0, truncated: false, nodes: [] };
    const { preview } = parseNixieExperimentalPanelReportV1(buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics', scene, selection }));
    assert.equal(preview?.kind, 'sections');
    assert.deepEqual(preview.sections.map(section => section.title), ['Construction Cost', 'Liquid Capacity']);
    assert.deepEqual(preview.sections[1]!.rows.map(({ label, value, tone }) => ({ label, value, tone })), [
        { label: 'Total Capacity', value: '5,000 L', tone: 'info' },
        { label: 'Liquid Silos', value: '5,000 L', tone: 'gain' },
    ]);
    const pipeline = Object.entries(assets).find(([, asset]) => asset.codeName.toLowerCase() === 'facilitypipe');
    assert.ok(pipeline);
    const combined = [...nodes, encodeNixieExperimentalSceneV2SnapshotNodeV1(entity('pipe', pipeline[0]))];
    const combinedReport = buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics',
        scene: { ...scene, nodes: combined, totalCount: combined.length }, selection });
    assert.equal(combinedReport.preview?.kind, 'sections');
    const rows = combinedReport.preview.sections[1]!.rows;
    assert.equal(rows[0]?.value, '5,100 L');
    assert.equal(rows[2]?.label, 'Pipelines');
    assert.equal(rows[2]?.value, '100 L');
    assert.ok(rows[1]?.image && rows[2]?.image);
});
