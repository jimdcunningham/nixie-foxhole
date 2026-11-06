import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeNixieExperimentalSceneV2SnapshotNodeV1, formatNixieExperimentalPanelReportV1, parseNixieExperimentalPanelReportV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/scene-v2';
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
        experimentalPanelContext: { contractVersion: 1 as const, ownerId, panelId: 'statistics', values: { [`${ownerId}.stats.scope`]: 'scene', [`${ownerId}.stats.interval`]: '1h' } } };
    const selection = { protocolVersion: 1 as const, totalCount: 0, truncated: false, nodes: [] };
    const before = structuredClone(scene);
    const report = buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics', scene, selection });
    assert.equal(report.preview?.kind, 'sections');
    const health = report.preview.sections.find(section => section.id === 'bunker-health');
    assert.deepEqual(health?.rows.map(row => row.label),
        ['Total Health', 'Repair Cost', 'Repair Rate', 'Breachable Health', 'Structural Integrity']);
    assert.equal(health?.rows[0]?.value, '650');
    assert.ok(health?.rows.every(row => row.icon === 'ph:shield-fill'));
    const table = report.preview.sections.at(-1)?.table;
    assert.deepEqual(table?.columns, ['Weapon', 'T1', 'T2', 'T3 Wet', 'T3 Dry']);
    assert.ok(table.rows.some(row => row.image));
    assert.ok(table.rows.every(row => row.values.length === 4));
    const construction = report.preview.sections[0]!;
    assert.equal(construction.title, 'Construction Cost');
    assert.ok(construction.rows.some(row => row.image));
    assert.deepEqual(parseNixieExperimentalPanelReportV1(report).preview, report.preview);
    assert.ok(construction.rows.every(row => row.tone === 'cost' && /^x[0-9]/.test(row.value)));
    const empty = buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics',
        scene: { ...scene, totalCount: 0, nodes: [] }, selection });
    assert.deepEqual(empty.preview, { kind: 'empty', message: 'Place buildings to see their stats here.' });
    const selectionFallback = buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics',
        scene: { ...scene, totalCount: 0, nodes: [], experimentalPanelContext: { ...scene.experimentalPanelContext,
            values: { [`${ownerId}.stats.scope`]: 'selection' } } }, selection });
    assert.equal(selectionFallback.previewLabel, 'Scene');
    assert.deepEqual(selectionFallback.preview, { kind: 'empty', message: 'Select buildings to see their stats here.' });
    const layerFallback = buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics',
        scene: { ...scene, totalCount: 0, nodes: [], experimentalPanelContext: { ...scene.experimentalPanelContext,
            values: { [`${ownerId}.stats.scope`]: 'auto' } } }, selection });
    assert.equal(layerFallback.previewLabel, 'Layer');
    assert.deepEqual(layerFallback.preview, { kind: 'empty',
        message: 'Activate a layer with Foxhole nodes to review aggregated totals for that layer.' });
    assert.deepEqual(report.columns, ['scope', 'section', 'metric', 'value', 'unit', 'notes']);
    assert.ok(report.sections.find(section => section.id === 'bunkerHealth')?.rows.some(row => row[2] === 'Total Health' && row[3] === '650'));
    assert.match(formatNixieExperimentalPanelReportV1(report, ['bunkerHealth']).listText, /Total Health: 650/);
    const destruction = report.sections.find(section => section.id === 'bunkerDestruction');
    assert.ok(destruction?.rows.some(row => row[5] === 'T3 Wet'));
    const dry = buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics', scene: { ...scene,
        experimentalPanelContext: { ...scene.experimentalPanelContext, values: { [`${ownerId}.stats.scope`]: 'scene', [`${ownerId}.stats.interval`]: '3d' } } }, selection });
    assert.equal(dry.sections.find(section => section.id === 'bunkerDestruction')?.rows.some(row => row[5] === 'T3 Wet'), false);
    const custom = buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics', scene: { ...scene,
        experimentalPanelContext: { ...scene.experimentalPanelContext, values: {
            [`${ownerId}.stats.scope`]: 'scene', [`${ownerId}.stats.interval`]: 'custom', [`${ownerId}.stats.customIntervalSeconds`]: 3 * 86400,
        } } }, selection });
    assert.equal(dry.preview?.kind, 'sections');
    assert.deepEqual(dry.preview.sections.at(-1)?.table?.columns, ['Weapon', 'T1', 'T2', 'T3']);
    assert.deepEqual(custom.preview, dry.preview);
    const customExport = formatNixieExperimentalPanelReportV1(custom, ['bunkerDestruction', 'maintenance']);
    assert.match(customExport.listText, /Custom \(3d\)/);
    assert.match(customExport.csvText, /Custom \(3d\)/);
    assert.deepEqual(scene, before);
    assert.throws(() => buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics', scene: { ...scene, truncated: true }, selection }), /Complete scene/);
});

test('liquid capacity follows construction cost and omits zero-capacity rows', () => {
    const silo = Object.entries(assets).find(([, asset]) => asset.codeName.toLowerCase() === 'facilitysilooil');
    assert.ok(silo);
    const nodes = [encodeNixieExperimentalSceneV2SnapshotNodeV1(entity('silo', silo[0]))];
    const scene = { protocolVersion: 1 as const, surface: 'scene-v2' as const, totalCount: nodes.length, truncated: false, nodes,
        experimentalPanelContext: { contractVersion: 1 as const, ownerId, panelId: 'statistics', values: { [`${ownerId}.stats.scope`]: 'scene' } } };
    const selection = { protocolVersion: 1 as const, totalCount: 0, truncated: false, nodes: [] };
    const { preview } = parseNixieExperimentalPanelReportV1(buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics', scene, selection }));
    assert.equal(preview?.kind, 'sections');
    assert.deepEqual(preview.sections.slice(0, 2).map(section => section.title), ['Construction Cost', 'Liquid Capacity']);
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

test('facility power reports production, consumption, and signed net totals in order', () => {
    const nodes = ['facilitypowerdiesel', 'facilityrefinery1'].map((id, index) =>
        encodeNixieExperimentalSceneV2SnapshotNodeV1(entity(String(index), id)));
    const scene = { protocolVersion: 1 as const, surface: 'scene-v2' as const, totalCount: nodes.length, truncated: false, nodes,
        experimentalPanelContext: { contractVersion: 1 as const, ownerId, panelId: 'statistics', values: { [`${ownerId}.stats.scope`]: 'scene' } } };
    const selection = { protocolVersion: 1 as const, totalCount: 0, truncated: false, nodes: [] };
    const rowsFor = (selectedNodes: typeof nodes) => {
        const { preview } = parseNixieExperimentalPanelReportV1(buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics',
            scene: { ...scene, nodes: selectedNodes, totalCount: selectedNodes.length }, selection }));
        assert.equal(preview?.kind, 'sections');
        const power = preview.sections.find(section => section.id === 'facility-power');
        assert.equal(power?.title, 'Facility Power');
        const rows = power.rows;
        assert.ok(rows.every(row => row.icon === 'nx:lightning' && row.iconTone === 'white'));
        return rows.map(({ label, value, tone }) => [label, value, tone]);
    };
    assert.deepEqual(rowsFor(nodes), [['Produced', '5 MW', 'gain'], ['Consumed', '2 MW', 'cost'], ['Net Total', '3 MW', 'gain']]);
    assert.deepEqual(rowsFor(nodes.slice(1)), [['Consumed', '2 MW', 'cost'], ['Net Total', '-2 MW', 'cost']]);
});

test('maintenance and production appear in order with resource icons and interval totals', () => {
    const refinery = entity('refinery', 'facilityrefinery1');
    refinery.components.push({ ownerId, componentId: 'production-order', version: 1, definitionAvailable: true,
        data: { orders: [{ recipeId: 'structure:facilityrefinery1:recipe:1', cycles: 2 }] } });
    const scene = { protocolVersion: 1 as const, surface: 'scene-v2' as const, totalCount: 1, truncated: false,
        nodes: [encodeNixieExperimentalSceneV2SnapshotNodeV1(refinery)], experimentalPanelContext: {
            contractVersion: 1 as const, ownerId, panelId: 'statistics', values: { [`${ownerId}.stats.scope`]: 'scene', [`${ownerId}.stats.interval`]: '30m' },
        } };
    const selection = { protocolVersion: 1 as const, totalCount: 0, truncated: false, nodes: [] };
    const { preview } = parseNixieExperimentalPanelReportV1(buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics', scene, selection }));
    assert.equal(preview?.kind, 'sections');
    assert.deepEqual(preview.sections.map(section => section.title),
        ['Construction Cost', 'Facility Power', 'Building Maintenance', 'Production Input', 'Production Output']);
    const rows = preview.sections.slice(2).map(section => section.rows[0]!);
    assert.deepEqual(rows.map(({ value, tone }) => [value, tone]), [['x0.5', 'cost'], ['x300', 'cost'], ['x40', 'gain']]);
    assert.ok(rows.every(row => row.image));
});

test('statistics catalog resource names follow the shared locale in previews and exports', () => {
    const nodes = [encodeNixieExperimentalSceneV2SnapshotNodeV1(entity('factory', 'facilityrefinery1'))];
    const report = (locale: string) => buildFoxholeStatisticsReport({ contractVersion: 1, panelId: 'statistics',
        scene: { protocolVersion: 1, surface: 'scene-v2', totalCount: 1, truncated: false, nodes,
            experimentalPanelContext: { contractVersion: 1, ownerId, panelId: 'statistics', locale,
                values: { [`${ownerId}.stats.scope`]: 'scene' } } },
        selection: { protocolVersion: 1, totalCount: 0, truncated: false, nodes: [] } });
    const english = report('en');
    const french = report('fr');
    assert.notDeepEqual(french.preview, english.preview);
    assert.notEqual(french.sections[0]!.listText, english.sections[0]!.listText);
    assert.deepEqual(french.sections[0]!.rows.map(row => row[3]).sort(), english.sections[0]!.rows.map(row => row[3]).sort());
});
