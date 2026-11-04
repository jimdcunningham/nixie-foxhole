import type { NixieExperimentalPanelReportRequestV1, NixieExperimentalPanelReportV1, NixiePanelReportPreviewV1, NixiePanelReportPreviewSectionV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import assets from '#foxhole-scene-v2-assets';
import { readSceneStatistics, readStatisticsPreferences } from './scene-statistics.ts';
import { FOXHOLE_STATISTICS_INTERVALS } from './production-statistics.ts';
import { buildFoxholeStatsExportCsvRows, buildFoxholeStatsExportListText, buildFoxholeStatsExportCsvFileName,
    buildFoxholeStatsExportSpreadsheetTitle, resolveFoxholeStatsExportSectionAvailability,
    FOXHOLE_STATS_EXPORT_SECTION_IDS, FOXHOLE_STATS_EXPORT_SECTION_LABELS } from './statistics-export-formats.ts';
import type { FoxholeStatsExportScopePayload } from './statistics-export-formats.ts';

export function buildFoxholeStatisticsReport(request: NixieExperimentalPanelReportRequestV1): NixieExperimentalPanelReportV1 {
    const preferences = readStatisticsPreferences(request.scene);
    const summary = readSceneStatistics(request.scene, request.selection, preferences.scope, preferences.intervalSeconds);
    const intervalLabel = FOXHOLE_STATISTICS_INTERVALS.find(interval => interval.seconds === preferences.intervalSeconds)?.label ?? '1 Hour';
    const localized = (id: string) => Object.values(assets).find(asset => asset.codeName.toLowerCase() === id.toLowerCase());
    const health = summary.bunker?.health;
    const destruction = summary.bunker?.destruction;
    const quantity = (value: number) => 'x' + value.toLocaleString('en-US', { maximumFractionDigits: 1 });
    const whole = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 0 });
    const resourceRow = (resource: { resourceId: string; quantity: number; }, tone: 'cost' | 'gain',
        fallback = resource.resourceId): NixiePanelReportPreviewSectionV1['rows'][number] => {
        const asset = localized(resource.resourceId);
        const image = asset?.browserIcon ?? asset?.browserPreview;
        return { label: asset?.label ?? fallback, value: quantity(resource.quantity), tone, ...(image ? { image } : {}) };
    };
    const ownedAssets = summary.entities.flatMap(entity => {
        const id = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner' && component.componentId === 'asset')?.data.assetId;
        return typeof id === 'string' && assets[id] ? [assets[id]] : [];
    });
    const detail = [[summary.metrics.Entities, 'node', 'nodes'], [ownedAssets.filter(asset => asset.isVehicle).length, 'vehicle', 'vehicles'],
        [ownedAssets.filter(asset => asset.isFacility).length, 'facility', 'facilities'], [ownedAssets.filter(asset => asset.isBunker).length, 'bunker', 'bunkers']]
        .filter(([count], index) => index === 0 || Number(count) > 0)
        .map(([count, singular, plural]) => `${Number(count).toLocaleString('en-US')} ${count === 1 ? singular : plural}`).join(' • ');
    const weaponName = (weapon: { name: string; codeName: string; id: string; }) => {
        const named = weapon.name && ![weapon.codeName, weapon.id].some(value => value.toLowerCase() === weapon.name.toLowerCase());
        return named ? weapon.name : localized(weapon.codeName)?.label ?? weapon.name;
    };
    const costs = summary.resources.costs.map(resource => {
        const asset = localized(resource.resourceId);
        return { name: asset?.label ?? resource.resourceId, category: asset?.categoryLabel ?? '',
            quantity: resource.quantity, direction: '', image: asset?.browserIcon };
    }).sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
    const sections: NixiePanelReportPreviewSectionV1[] = [{
        id: 'construction-cost',
        title: 'Construction Cost',
        emptyMessage: 'No published construction costs are available for this scope yet.',
        rows: costs.slice(0, 256).map(cost => ({ label: cost.name, tone: 'cost',
            value: quantity(cost.quantity),
            ...(cost.image ? { image: cost.image } : {}) })),
    }];
    const { total, silo, pipeline } = summary.resources.liquid;
    if (total > 0) {
        const volume = (litres: number) => litres.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' L';
        const rows: NixiePanelReportPreviewSectionV1['rows'] = [
            { label: 'Total Capacity', value: volume(total), tone: 'info', icon: 'ph:drop-fill' },
        ];
        if (silo > 0) {
            const image = localized('FacilitySiloOil')?.browserIcon;
            rows.push({ label: 'Liquid Silos', value: volume(silo), tone: 'gain', icon: 'ph:oil', ...(image ? { image } : {}) });
        }
        if (pipeline > 0) {
            const image = localized('FacilityPipe')?.browserIcon;
            rows.push({ label: 'Pipelines', value: volume(pipeline), tone: 'warning', icon: 'ph:pipe', ...(image ? { image } : {}) });
        }
        sections.push({ id: 'liquid-capacity', title: 'Liquid Capacity', emptyMessage: 'No liquid capacity is available.', rows });
    }
    const { producedMw, consumedMw, netMw } = summary.resources.power;
    if (producedMw > 0 || consumedMw > 0 || netMw !== 0) {
        const rows: NixiePanelReportPreviewSectionV1['rows'] = [];
        const addPower = (label: string, megawatts: number, tone: 'cost' | 'gain') => {
            rows.push({ label, value: megawatts.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' MW',
                tone, icon: 'nx:lightning', iconTone: 'white' });
        };
        if (producedMw > 0) {
            addPower('Produced', producedMw, 'gain');
        }
        if (consumedMw > 0) {
            addPower('Consumed', consumedMw, 'cost');
        }
        addPower('Net Total', netMw, netMw >= 0 ? 'gain' : 'cost');
        sections.push({ id: 'facility-power', title: 'Facility Power', emptyMessage: 'No facility power is available.', rows });
    }
    if (summary.resources.maintenancePerHour > 0) {
        const supplies = summary.resources.maintenanceSupplies;
        sections.push({ id: 'building-maintenance', title: 'Building Maintenance',
            emptyMessage: 'No maintenance supplies are required for this interval.',
            rows: supplies > 0 ? [resourceRow({ resourceId: 'maintenancesupplies', quantity: supplies }, 'cost', 'Maintenance Supplies')] : [] });
    }
    for (const [id, title, resources, tone] of [
        ['production-input', 'Production Input', summary.production.inputs, 'cost'],
        ['production-output', 'Production Output', summary.production.outputs, 'gain'],
    ] as const) {
        if (resources.length) {
            sections.push({ id, title, emptyMessage: 'No resources in this interval.',
                rows: resources.slice(0, 256).map(resource => resourceRow(resource, tone)) });
        }
    }
    if (health) {
        const integrity = health.structuralIntegrityClass;
        const integrityTone = { high: 'gain', medium: 'warning', low: 'caution', critical: 'cost' } as const;
        const integrityLabel = integrity.charAt(0).toUpperCase() + integrity.slice(1);
        const rows: NixiePanelReportPreviewSectionV1['rows'] = [
            { label: 'Total Health', value: whole(health.effectiveHealth), tone: 'gain' },
            { label: 'Repair Cost', value: whole(health.repairCost), tone: 'warning' },
            { label: 'Repair Rate', value: whole(Math.floor(health.repairRate)) + '/swing', tone: 'warning' },
            { label: 'Breachable Health', value: `${whole(health.breachableHealth)} (${whole(health.breachableHealthPercent)}%)`, tone: integrityTone[integrity] },
            { label: 'Structural Integrity', value: `${whole(health.structuralIntegrityPercent)}% (${integrityLabel})`, tone: integrityTone[integrity] },
        ];
        sections.push({ id: 'bunker-health', title: 'Bunker Health', emptyMessage: 'No bunker health is available.',
            rows: rows.map(row => ({ ...row, icon: 'ph:shield-fill', iconTone: 'white' })) });
    }
    const preview: NixiePanelReportPreviewV1 = summary.resources.structureCount > 0
        ? { kind: 'sections', sections, showEmbeddedContent: !!destruction?.weapons.length }
        : { kind: 'empty', message: summary.scope === 'layer'
            ? 'Activate a layer with Foxhole nodes to review aggregated totals for that layer.'
            : preferences.scope === 'layer' || preferences.scope === 'scene'
                ? 'Place buildings to see their stats here.'
                : 'Select buildings to see their stats here.' };
    const scope: FoxholeStatsExportScopePayload = {
        id: summary.scope, label: summary.scope === 'selection' ? 'Selection' : summary.scope === 'layer' ? 'Layer' : 'Scene',
        detail, nodeCount: summary.metrics.Entities,
        costEntries: costs,
        liquidCapacity: summary.resources.liquid, facilityPower: summary.resources.power, maintenanceSupplies: summary.resources.maintenanceSupplies,
        production: { activeOrderCount: summary.production.activeOrderCount, powerMw: summary.production.powerMw,
            inputs: summary.production.inputs.map(resource => ({ name: localized(resource.resourceId)?.label ?? resource.resourceId, category: resource.channel,
                quantity: resource.quantity, direction: 'input' })),
            outputs: summary.production.outputs.map(resource => ({ name: localized(resource.resourceId)?.label ?? resource.resourceId, category: resource.channel,
                quantity: resource.quantity, direction: 'output' })) },
        bunkerHealth: health
            ? { totalHealth: health.effectiveHealth, repairCost: health.repairCost, repairRate: health.repairRate,
                breachableHealth: health.breachableHealth, breachableHealthPercent: health.breachableHealthPercent,
                structuralIntegrityPercent: health.structuralIntegrityPercent, structuralIntegrityClass: health.structuralIntegrityClass }
            : null,
        bunkerDestruction: destruction
            ? { weapons: destruction.weapons.map(weapon => ({
                name: weaponName(weapon), ...weapon.shots })) }
            : null,
    };
    const availability = resolveFoxholeStatsExportSectionAvailability(scope);
    const listHeader = `${scope.label} Statistics\n${scope.detail}`;
    const options = { scopes: [scope], scopeIds: [scope.id], intervalLabel };
    return { contractVersion: 1, title: buildFoxholeStatsExportSpreadsheetTitle(options), fileName: buildFoxholeStatsExportCsvFileName(options),
        listHeader, preview, columns: ['scope', 'section', 'metric', 'value', 'unit', 'notes'],
        sections: FOXHOLE_STATS_EXPORT_SECTION_IDS.filter(id => scope.nodeCount > 0 && availability[id]).map(id => ({
            id, title: FOXHOLE_STATS_EXPORT_SECTION_LABELS[id],
            listText: buildFoxholeStatsExportListText({ ...options, sectionIds: [id] }).slice(listHeader.length).trim(),
            rows: buildFoxholeStatsExportCsvRows({ ...options, sectionIds: [id] }).slice(1),
        })) };
}
