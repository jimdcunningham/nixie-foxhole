/**
 * Multi-scope / multi-section statistics export (list text + CSV).
 */

export type FoxholeStatsExportScopeId = 'selection' | 'layer' | 'scene';

export type FoxholeStatsExportSectionId
    = | 'cost'
        | 'liquid'
        | 'power'
        | 'maintenance'
        | 'production'
        | 'bunkerHealth'
        | 'bunkerDestruction';

export const FOXHOLE_STATS_EXPORT_SCOPE_IDS: readonly FoxholeStatsExportScopeId[] = [
    'selection',
    'layer',
    'scene',
] as const;

export const FOXHOLE_STATS_EXPORT_SECTION_IDS: readonly FoxholeStatsExportSectionId[] = [
    'cost',
    'liquid',
    'power',
    'maintenance',
    'production',
    'bunkerHealth',
    'bunkerDestruction',
] as const;

export const FOXHOLE_STATS_EXPORT_SECTION_LABELS: Record<FoxholeStatsExportSectionId, string> = {
    cost: 'Construction Cost',
    liquid: 'Liquid Capacity',
    power: 'Facility Power',
    maintenance: 'Building Maintenance',
    production: 'Production',
    bunkerHealth: 'Bunker Health',
    bunkerDestruction: 'Bunker Destruction',
};

export const FOXHOLE_STATS_EXPORT_SCOPE_LABELS: Record<FoxholeStatsExportScopeId, string> = {
    selection: 'Selection',
    layer: 'Layer',
    scene: 'Scene',
};

export interface FoxholeStatsExportCostEntry {
    name: string;
    category: string;
    quantity: number;
    direction: string;
}

export interface FoxholeStatsExportBunkerHealth {
    totalHealth: number;
    repairCost: number;
    repairRate: number;
    breachableHealth: number;
    breachableHealthPercent: number;
    structuralIntegrityPercent: number;
    structuralIntegrityClass: string;
}

export interface FoxholeStatsExportDestructionWeapon {
    name: string;
    t1: number;
    t2: number;
    t3: number;
    t3wet: number | null;
}

export interface FoxholeStatsExportScopePayload {
    id: FoxholeStatsExportScopeId;
    label: string;
    detail: string;
    nodeCount: number;
    costEntries: FoxholeStatsExportCostEntry[];
    liquidCapacity: {
        total: number;
        silo: number;
        pipeline: number;
    };
    facilityPower: {
        producedMw: number;
        consumedMw: number;
        netMw: number;
    };
    maintenanceSupplies: number;
    production: {
        activeOrderCount: number;
        powerMw: number;
        inputs: FoxholeStatsExportCostEntry[];
        outputs: FoxholeStatsExportCostEntry[];
    };
    bunkerHealth: FoxholeStatsExportBunkerHealth | null;
    bunkerDestruction: {
        weapons: FoxholeStatsExportDestructionWeapon[];
    } | null;
}

export interface FoxholeStatsExportOptions {
    scopes: readonly FoxholeStatsExportScopePayload[];
    scopeIds: readonly FoxholeStatsExportScopeId[];
    sectionIds: readonly FoxholeStatsExportSectionId[];
    intervalLabel?: string | null;
}

function escapeCsvValue(value: string | number): string {
    const normalized = String(value ?? '');
    if (!/[",\n\r]/.test(normalized)) {
        return normalized;
    }

    return `"${normalized.replace(/"/g, '""')}"`;
}

function formatQuantity(value: number): string {
    if (Number.isInteger(value)) {
        return String(value);
    }

    return String(Math.round(value * 1000) / 1000);
}

function formatPowerMw(value: number): string {
    const rounded = Math.round(value * 1000) / 1000;
    return `${rounded}`;
}

function titleCase(value: string): string {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
        return '';
    }

    return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

export function resolveFoxholeStatsExportSectionAvailability(
    scope: FoxholeStatsExportScopePayload,
): Record<FoxholeStatsExportSectionId, boolean> {
    return {
        cost: scope.costEntries.length > 0,
        liquid: scope.liquidCapacity.total > 0,
        power: scope.facilityPower.producedMw > 0
            || scope.facilityPower.consumedMw > 0
            || scope.facilityPower.netMw !== 0,
        maintenance: scope.maintenanceSupplies > 0,
        production: scope.production.activeOrderCount > 0,
        bunkerHealth: scope.bunkerHealth != null,
        bunkerDestruction: (scope.bunkerDestruction?.weapons.length ?? 0) > 0,
    };
}

export function scopeHasFoxholeStatsExportData(scope: FoxholeStatsExportScopePayload): boolean {
    const availability = resolveFoxholeStatsExportSectionAvailability(scope);
    return Object.values(availability).some(Boolean);
}

export function parseFoxholeStatsExportIdList<T extends string>(
    value: unknown,
    allowed: readonly T[],
): T[] {
    const allowedSet = new Set(allowed);
    const raw = String(value ?? '')
        .split(',')
        .map(part => part.trim())
        .filter((part): part is T => allowedSet.has(part as T));

    return [...new Set(raw)];
}

export function serializeFoxholeStatsExportIdList(values: readonly string[]): string {
    return values.map(value => String(value ?? '').trim()).filter(Boolean).join(',');
}

function appendCostListLines(lines: string[], scope: FoxholeStatsExportScopePayload): void {
    lines.push(FOXHOLE_STATS_EXPORT_SECTION_LABELS.cost);
    for (const entry of scope.costEntries) {
        const categorySuffix = entry.category ? ` (${entry.category})` : '';
        lines.push(`${formatQuantity(entry.quantity)} ${entry.name}${categorySuffix}`);
    }
    lines.push('');
}

function appendLiquidListLines(lines: string[], scope: FoxholeStatsExportScopePayload): void {
    lines.push(FOXHOLE_STATS_EXPORT_SECTION_LABELS.liquid);
    lines.push(`Total Capacity: ${formatQuantity(scope.liquidCapacity.total)}`);
    if (scope.liquidCapacity.silo > 0) {
        lines.push(`Liquid Silos: ${formatQuantity(scope.liquidCapacity.silo)}`);
    }
    if (scope.liquidCapacity.pipeline > 0) {
        lines.push(`Pipelines: ${formatQuantity(scope.liquidCapacity.pipeline)}`);
    }
    lines.push('');
}

function appendPowerListLines(lines: string[], scope: FoxholeStatsExportScopePayload): void {
    lines.push(FOXHOLE_STATS_EXPORT_SECTION_LABELS.power);
    if (scope.facilityPower.producedMw > 0) {
        lines.push(`Produced: ${formatPowerMw(scope.facilityPower.producedMw)} MW`);
    }
    if (scope.facilityPower.consumedMw > 0) {
        lines.push(`Consumed: ${formatPowerMw(scope.facilityPower.consumedMw)} MW`);
    }
    lines.push(`Net Total: ${formatPowerMw(scope.facilityPower.netMw)} MW`);
    lines.push('');
}

function appendMaintenanceListLines(
    lines: string[],
    scope: FoxholeStatsExportScopePayload,
    intervalLabel: string | null | undefined,
): void {
    const intervalSuffix = intervalLabel ? ` (${intervalLabel})` : '';
    lines.push(`${FOXHOLE_STATS_EXPORT_SECTION_LABELS.maintenance}${intervalSuffix}`);
    lines.push(`Maintenance Supplies: ${formatQuantity(scope.maintenanceSupplies)}`);
    lines.push('');
}

function appendProductionListLines(lines: string[], scope: FoxholeStatsExportScopePayload, intervalLabel: string | null | undefined): void {
    lines.push(`${FOXHOLE_STATS_EXPORT_SECTION_LABELS.production}${intervalLabel ? ` (${intervalLabel})` : ''}`);
    lines.push(`Active Orders: ${scope.production.activeOrderCount}`);
    lines.push(`Power: ${formatPowerMw(scope.production.powerMw)} MW`);
    for (const entry of scope.production.inputs) {
        lines.push(`Input: ${formatQuantity(entry.quantity)} ${entry.name}`);
    }
    for (const entry of scope.production.outputs) {
        lines.push(`Output: ${formatQuantity(entry.quantity)} ${entry.name}`);
    }
    lines.push('');
}

function appendBunkerHealthListLines(lines: string[], scope: FoxholeStatsExportScopePayload): void {
    const health = scope.bunkerHealth;
    if (!health) {
        return;
    }

    lines.push(FOXHOLE_STATS_EXPORT_SECTION_LABELS.bunkerHealth);
    lines.push(`Total Health: ${formatQuantity(health.totalHealth)}`);
    lines.push(`Repair Cost: ${formatQuantity(health.repairCost)}`);
    lines.push(`Repair Rate: ${formatQuantity(Math.floor(health.repairRate))}/swing`);
    lines.push(`Breachable Health: ${formatQuantity(health.breachableHealth)} (${formatQuantity(health.breachableHealthPercent)}%)`);
    lines.push(`Structural Integrity: ${formatQuantity(health.structuralIntegrityPercent)}% (${titleCase(health.structuralIntegrityClass)})`);
    lines.push('');
}

function appendBunkerDestructionListLines(
    lines: string[],
    scope: FoxholeStatsExportScopePayload,
    intervalLabel: string | null | undefined,
): void {
    const destruction = scope.bunkerDestruction;
    if (!destruction || destruction.weapons.length === 0) {
        return;
    }

    const intervalSuffix = intervalLabel ? ` (${intervalLabel})` : '';
    lines.push(`${FOXHOLE_STATS_EXPORT_SECTION_LABELS.bunkerDestruction}${intervalSuffix}`);
    const includeWet = destruction.weapons.some(weapon => weapon.t3wet != null);
    for (const weapon of destruction.weapons) {
        const wetPart = includeWet ? `, T3 Wet ${weapon.t3wet ?? '—'}` : '';
        lines.push(`${weapon.name}: T1 ${weapon.t1}, T2 ${weapon.t2}${wetPart}, T3 ${weapon.t3}`);
    }
    lines.push('');
}

export function buildFoxholeStatsExportListText(options: FoxholeStatsExportOptions): string {
    const selectedScopeIds = new Set(options.scopeIds);
    const selectedSectionIds = new Set(options.sectionIds);
    const scopes = options.scopes.filter(scope => selectedScopeIds.has(scope.id) && scope.nodeCount > 0);
    const lines: string[] = [];

    for (const scope of scopes) {
        const availability = resolveFoxholeStatsExportSectionAvailability(scope);
        const activeSections = FOXHOLE_STATS_EXPORT_SECTION_IDS.filter(sectionId => (
            selectedSectionIds.has(sectionId) && availability[sectionId]
        ));
        if (activeSections.length === 0) {
            continue;
        }

        lines.push(`${scope.label} Statistics`);
        if (scope.detail) {
            lines.push(scope.detail);
        }
        lines.push('');

        for (const sectionId of activeSections) {
            switch (sectionId) {
                case 'cost':
                    appendCostListLines(lines, scope);
                    break;
                case 'liquid':
                    appendLiquidListLines(lines, scope);
                    break;
                case 'power':
                    appendPowerListLines(lines, scope);
                    break;
                case 'maintenance':
                    appendMaintenanceListLines(lines, scope, options.intervalLabel);
                    break;
                case 'production':
                    appendProductionListLines(lines, scope, options.intervalLabel);
                    break;
                case 'bunkerHealth':
                    appendBunkerHealthListLines(lines, scope);
                    break;
                case 'bunkerDestruction':
                    appendBunkerDestructionListLines(lines, scope, options.intervalLabel);
                    break;
                default:
                    break;
            }
        }
    }

    return lines.join('\n').trim();
}

function pushCsvRow(
    rows: string[][],
    scope: FoxholeStatsExportScopePayload,
    sectionId: FoxholeStatsExportSectionId,
    metric: string,
    value: string | number,
    unit = '',
    notes = '',
): void {
    rows.push([
        scope.label,
        FOXHOLE_STATS_EXPORT_SECTION_LABELS[sectionId],
        metric,
        String(value),
        unit,
        notes,
    ]);
}

export function buildFoxholeStatsExportCsvRows(options: FoxholeStatsExportOptions): string[][] {
    const selectedScopeIds = new Set(options.scopeIds);
    const selectedSectionIds = new Set(options.sectionIds);
    const scopes = options.scopes.filter(scope => selectedScopeIds.has(scope.id) && scope.nodeCount > 0);
    const rows: string[][] = [
        ['scope', 'section', 'metric', 'value', 'unit', 'notes'],
    ];

    for (const scope of scopes) {
        const availability = resolveFoxholeStatsExportSectionAvailability(scope);

        if (selectedSectionIds.has('cost') && availability.cost) {
            for (const entry of scope.costEntries) {
                pushCsvRow(rows, scope, 'cost', entry.name, entry.quantity, '', entry.category || entry.direction);
            }
        }

        if (selectedSectionIds.has('liquid') && availability.liquid) {
            pushCsvRow(rows, scope, 'liquid', 'Total Capacity', scope.liquidCapacity.total);
            if (scope.liquidCapacity.silo > 0) {
                pushCsvRow(rows, scope, 'liquid', 'Liquid Silos', scope.liquidCapacity.silo);
            }
            if (scope.liquidCapacity.pipeline > 0) {
                pushCsvRow(rows, scope, 'liquid', 'Pipelines', scope.liquidCapacity.pipeline);
            }
        }

        if (selectedSectionIds.has('power') && availability.power) {
            if (scope.facilityPower.producedMw > 0) {
                pushCsvRow(rows, scope, 'power', 'Produced', formatPowerMw(scope.facilityPower.producedMw), 'MW');
            }
            if (scope.facilityPower.consumedMw > 0) {
                pushCsvRow(rows, scope, 'power', 'Consumed', formatPowerMw(scope.facilityPower.consumedMw), 'MW');
            }
            pushCsvRow(rows, scope, 'power', 'Net Total', formatPowerMw(scope.facilityPower.netMw), 'MW');
        }

        if (selectedSectionIds.has('maintenance') && availability.maintenance) {
            pushCsvRow(
                rows,
                scope,
                'maintenance',
                'Maintenance Supplies',
                scope.maintenanceSupplies,
                '',
                options.intervalLabel ?? '',
            );
        }

        if (selectedSectionIds.has('production') && availability.production) {
            pushCsvRow(rows, scope, 'production', 'Active Orders', scope.production.activeOrderCount, '', options.intervalLabel ?? '');
            pushCsvRow(rows, scope, 'production', 'Power', formatPowerMw(scope.production.powerMw), 'MW');
            for (const entry of scope.production.inputs) {
                pushCsvRow(rows, scope, 'production', `Input: ${entry.name}`, entry.quantity, '', entry.category || entry.direction);
            }
            for (const entry of scope.production.outputs) {
                pushCsvRow(rows, scope, 'production', `Output: ${entry.name}`, entry.quantity, '', entry.category || entry.direction);
            }
        }

        if (selectedSectionIds.has('bunkerHealth') && availability.bunkerHealth && scope.bunkerHealth) {
            const health = scope.bunkerHealth;
            pushCsvRow(rows, scope, 'bunkerHealth', 'Total Health', health.totalHealth);
            pushCsvRow(rows, scope, 'bunkerHealth', 'Repair Cost', health.repairCost);
            pushCsvRow(rows, scope, 'bunkerHealth', 'Repair Rate', Math.floor(health.repairRate), '/swing');
            pushCsvRow(
                rows,
                scope,
                'bunkerHealth',
                'Breachable Health',
                health.breachableHealth,
                '',
                `${health.breachableHealthPercent}%`,
            );
            pushCsvRow(
                rows,
                scope,
                'bunkerHealth',
                'Structural Integrity',
                `${health.structuralIntegrityPercent}%`,
                '',
                titleCase(health.structuralIntegrityClass),
            );
        }

        if (selectedSectionIds.has('bunkerDestruction') && availability.bunkerDestruction) {
            for (const weapon of scope.bunkerDestruction?.weapons ?? []) {
                pushCsvRow(rows, scope, 'bunkerDestruction', weapon.name, weapon.t1, 'shots', 'T1');
                pushCsvRow(rows, scope, 'bunkerDestruction', weapon.name, weapon.t2, 'shots', 'T2');
                if (weapon.t3wet != null) {
                    pushCsvRow(rows, scope, 'bunkerDestruction', weapon.name, weapon.t3wet, 'shots', 'T3 Wet');
                }
                pushCsvRow(rows, scope, 'bunkerDestruction', weapon.name, weapon.t3, 'shots', 'T3');
            }
        }
    }

    return rows;
}

export function buildFoxholeStatsExportCsvText(options: FoxholeStatsExportOptions): string {
    return buildFoxholeStatsExportCsvRows(options).map(row => row.map(value => escapeCsvValue(value)).join(',')).join('\r\n');
}

export function buildFoxholeStatsExportCsvFileName(options: {
    scopeIds: readonly FoxholeStatsExportScopeId[];
    date?: Date;
}): string {
    const scopePart = options.scopeIds.length > 0
        ? options.scopeIds.join('-')
        : 'stats';
    const date = options.date ?? new Date();
    const stamp = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
    ].join('');

    return `foxhole-stats-${scopePart}-${stamp}.csv`;
}

export function buildFoxholeStatsExportSpreadsheetTitle(options: {
    scopeIds: readonly FoxholeStatsExportScopeId[];
}): string {
    if (options.scopeIds.length === 0) {
        return 'Foxhole Statistics';
    }

    const labels = options.scopeIds.map(id => FOXHOLE_STATS_EXPORT_SCOPE_LABELS[id]);
    return `Foxhole Statistics · ${labels.join(' + ')}`;
}
