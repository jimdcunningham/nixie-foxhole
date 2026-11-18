import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatNixiePanelReportV1 } from '@nixiejs/extension-sdk';
import { buildFoxholeStatsExportCsvRows, buildFoxholeStatsExportListText,
    FOXHOLE_STATS_EXPORT_SECTION_IDS, FOXHOLE_STATS_EXPORT_SECTION_LABELS } from '../../../../../extensions/foxhole-planner/src/statistics-export-formats.ts';
import type { FoxholeStatsExportScopePayload } from '../../../../../extensions/foxhole-planner/src/statistics-export-formats.ts';

const scope: FoxholeStatsExportScopePayload = { id: 'scene', label: 'Scene', detail: '2 nodes • 1 facility', nodeCount: 2,
    costEntries: [{ name: 'Basic "Materials", Pack', category: 'Materials', quantity: 126.5, direction: '' }],
    liquidCapacity: { total: 400, silo: 100, pipeline: 300 }, facilityPower: { producedMw: 10, consumedMw: 24, netMw: -14 },
    maintenanceSupplies: 3.5, production: { activeOrderCount: 2, powerMw: 1.5,
        inputs: [{ name: 'Materials', category: 'item', quantity: 12, direction: 'loss' }],
        outputs: [{ name: 'Ammunition', category: 'crate', quantity: 3, direction: 'gain' }] },
    bunkerHealth: { totalHealth: 650, repairCost: 50, repairRate: 13.75, breachableHealth: 600, breachableHealthPercent: 92.3,
        structuralIntegrityPercent: 100, structuralIntegrityClass: 'high' },
    bunkerDestruction: { weapons: [{ name: 'HE Grenade', t1: 4, t2: 5, t3: 12, t3wet: 2 }] } };

test('host list and CSV reports preserve the legacy seven-section export', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/foxhole-legacy-statistics-export.json', import.meta.url), 'utf8'));
    const selections = {
        all: FOXHOLE_STATS_EXPORT_SECTION_IDS,
        productionAndDestruction: ['production', 'bunkerDestruction'] as const,
        cost: ['cost'] as const,
    };
    for (const intervalLabel of ['15 Minutes', '1 Hour', '3 Days']) {
        const options = { scopes: [scope], scopeIds: [scope.id], intervalLabel };
        const header = `${scope.label} Statistics\n${scope.detail}`;
        const report = { contractVersion: 1 as const, title: 'Foxhole Statistics', fileName: 'foxhole.csv', listHeader: header,
            columns: ['scope', 'section', 'metric', 'value', 'unit', 'notes'], sections: FOXHOLE_STATS_EXPORT_SECTION_IDS.map(id => ({
                id, title: FOXHOLE_STATS_EXPORT_SECTION_LABELS[id], listText: buildFoxholeStatsExportListText({ ...options, sectionIds: [id] }).slice(header.length).trim(),
                rows: buildFoxholeStatsExportCsvRows({ ...options, sectionIds: [id] }).slice(1),
            })) };
        for (const [selection, sectionIds] of Object.entries(selections)) {
            const formatted = formatNixiePanelReportV1(report, sectionIds);
            assert.equal(formatted.listText, fixture[selection].listText.replaceAll('{interval}', intervalLabel));
            assert.equal(formatted.csvText, fixture[selection].csvText.replaceAll('{interval}', intervalLabel));
        }
    }
});
