import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildFoxholeStatsExportCsvFileName,
    buildFoxholeStatsExportCsvText,
    buildFoxholeStatsExportListText,
    buildFoxholeStatsExportSpreadsheetTitle,
    parseFoxholeStatsExportIdList,
    resolveFoxholeStatsExportSectionAvailability,
    serializeFoxholeStatsExportIdList,
} from '../app/plugins/foxhole/nixie/stats-export.ts';
// eslint-disable-next-line no-duplicate-imports
import type { FoxholeStatsExportScopePayload } from '../app/plugins/foxhole/nixie/stats-export.ts';

function createScope(overrides: Partial<FoxholeStatsExportScopePayload> & Pick<FoxholeStatsExportScopePayload, 'id' | 'label'>): FoxholeStatsExportScopePayload {
    return {
        detail: '2 nodes',
        nodeCount: 2,
        costEntries: [],
        liquidCapacity: { total: 0, silo: 0, pipeline: 0 },
        facilityPower: { producedMw: 0, consumedMw: 0, netMw: 0 },
        maintenanceSupplies: 0,
        production: { activeOrderCount: 0, powerMw: 0, inputs: [], outputs: [] },
        bunkerHealth: null,
        bunkerDestruction: null,
        ...overrides,
    };
}

const layerScope = createScope({
    id: 'layer',
    label: 'Layer',
    detail: '7 nodes · 3 facilities · 4 bunkers',
    nodeCount: 7,
    costEntries: [
        { name: 'Basic Materials', category: 'Resource', quantity: 100, direction: 'loss' },
        { name: 'Refined Materials', category: 'Resource', quantity: 25, direction: 'loss' },
    ],
    liquidCapacity: { total: 500, silo: 500, pipeline: 0 },
    facilityPower: { producedMw: 5, consumedMw: 2, netMw: 3 },
    maintenanceSupplies: 12,
    bunkerHealth: {
        totalHealth: 3000,
        repairCost: 150,
        repairRate: 42.7,
        breachableHealth: 900,
        breachableHealthPercent: 30,
        structuralIntegrityPercent: 75,
        structuralIntegrityClass: 'high',
    },
    bunkerDestruction: {
        weapons: [
            { name: 'Mortar', t1: 10, t2: 8, t3: 6, t3wet: 12 },
            { name: 'RPG', t1: 4, t2: 3, t3: 2, t3wet: null },
        ],
    },
});

test('resolveFoxholeStatsExportSectionAvailability reflects populated sections', () => {
    assert.deepEqual(resolveFoxholeStatsExportSectionAvailability(layerScope), {
        cost: true,
        liquid: true,
        power: true,
        maintenance: true,
        production: false,
        bunkerHealth: true,
        bunkerDestruction: true,
    });

    const costOnly = createScope({
        id: 'scene',
        label: 'Scene',
        costEntries: [{ name: 'Basic Materials', category: 'Resource', quantity: 10, direction: 'loss' }],
    });
    assert.deepEqual(resolveFoxholeStatsExportSectionAvailability(costOnly), {
        cost: true,
        liquid: false,
        power: false,
        maintenance: false,
        production: false,
        bunkerHealth: false,
        bunkerDestruction: false,
    });
});

test('buildFoxholeStatsExportListText exports selected sections for the active scope', () => {
    const text = buildFoxholeStatsExportListText({
        scopes: [layerScope],
        scopeIds: ['layer'],
        sectionIds: ['cost', 'bunkerHealth'],
        intervalLabel: '1 Hour',
    });

    assert.match(text, /Layer Statistics/);
    assert.match(text, /Construction Cost/);
    assert.match(text, /100 Basic Materials \(Resource\)/);
    assert.match(text, /Bunker Health/);
    assert.match(text, /Structural Integrity: 75% \(High\)/);
    assert.doesNotMatch(text, /Facility Power/);
    assert.doesNotMatch(text, /Bunker Destruction/);
});

test('buildFoxholeStatsExportCsvText uses shared columns for selected sections', () => {
    const csv = buildFoxholeStatsExportCsvText({
        scopes: [layerScope],
        scopeIds: ['layer'],
        sectionIds: ['cost', 'power', 'bunkerDestruction'],
        intervalLabel: '1 Hour',
    });

    const lines = csv.split(/\r?\n/);
    assert.equal(lines[0], 'scope,section,metric,value,unit,notes');
    assert.ok(lines.some(line => line.startsWith('Layer,Construction Cost,Basic Materials,100,,Resource')));
    assert.ok(lines.some(line => line.startsWith('Layer,Facility Power,Net Total,3,MW,')));
    assert.ok(lines.some(line => line.startsWith('Layer,Bunker Destruction,Mortar,10,shots,T1')));
    assert.ok(lines.some(line => line.startsWith('Layer,Bunker Destruction,Mortar,12,shots,T3 Wet')));
    assert.ok(lines.some(line => line.startsWith('Layer,Bunker Destruction,RPG,2,shots,T3')));
    assert.ok(!lines.some(line => line.includes('Bunker Health')));
    assert.ok(!lines.some(line => line.includes('Liquid Capacity')));
});

test('buildFoxholeStatsExportCsvText skips empty scopes and unavailable sections', () => {
    const emptyLayer = createScope({
        id: 'layer',
        label: 'Layer',
        nodeCount: 0,
        detail: '',
        costEntries: [{ name: 'Basic Materials', category: 'Resource', quantity: 10, direction: 'loss' }],
    });
    const csv = buildFoxholeStatsExportCsvText({
        scopes: [emptyLayer],
        scopeIds: ['layer'],
        sectionIds: ['cost', 'liquid'],
    });

    assert.equal(csv, 'scope,section,metric,value,unit,notes');
});

test('filename and spreadsheet title helpers encode the active scope', () => {
    assert.equal(
        buildFoxholeStatsExportCsvFileName({
            scopeIds: ['layer'],
            date: new Date(2026, 6, 26),
        }),
        'foxhole-stats-layer-20260726.csv',
    );
    assert.equal(
        buildFoxholeStatsExportSpreadsheetTitle({ scopeIds: ['layer'] }),
        'Foxhole Statistics · Layer',
    );
});

test('parse and serialize export id lists', () => {
    assert.deepEqual(
        parseFoxholeStatsExportIdList('cost, bunkerHealth, unknown,cost', ['cost', 'liquid', 'bunkerHealth'] as const),
        ['cost', 'bunkerHealth'],
    );
    assert.equal(serializeFoxholeStatsExportIdList(['power', 'maintenance']), 'power,maintenance');
});
