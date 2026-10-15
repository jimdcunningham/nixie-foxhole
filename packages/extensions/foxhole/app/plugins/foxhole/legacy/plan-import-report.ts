import type { LegacyPlanFieldFinding, LegacyPlanFieldInventoryResult } from './plan-field-inventory.ts';
import type { LegacySocketAttachmentFinding } from './plan-socket-mapper.ts';
import type { LegacyPlanUpgradeWarning } from './plan-upgrader.ts';

export type LegacyPlanImportReportJson = {
    fixtureName?: string;
    fromVersion: string | null;
    toVersion: string;
    entityCount: number;
    entityKindCounts: Record<string, number>;
    buildingKeys: string[];
    unresolvedBuildingKeys: string[];
    unresolvedFacilityUpgrades: string[];
    unresolvedSocketIds: string[];
    unresolvedSocketFindings: LegacySocketAttachmentFinding[];
    unresolvedCargoKeys: string[];
    unresolvedIconKeys: string[];
    unresolvedImageKeys: string[];
    unmatchedModslots: string[];
    skippedEntityTypes: Record<string, number>;
    importedShapeCounts: Record<string, number>;
    unknownProjectFields: Array<{ field: string; count: number; }>;
    unknownEntityFields: Array<{ field: string; count: number; samples: string[]; }>;
    unmappedProjectFields: Array<{ field: string; count: number; }>;
    unmappedEntityFields: Array<{ field: string; count: number; samples: string[]; }>;
    upgradeWarnings: LegacyPlanUpgradeWarning[];
};

function groupFindings(findings: LegacyPlanFieldFinding[]): Array<{ field: string; count: number; samples: string[]; }> {
    const groups = new Map<string, { count: number; samples: Set<string>; }>();
    for (const finding of findings) {
        const existing = groups.get(finding.field) ?? { count: 0, samples: new Set<string>() };
        existing.count += 1;
        const sampleLabel = [
            finding.entityKey ? `key=${finding.entityKey}` : null,
            finding.entityType ? `type=${finding.entityType}` : null,
            finding.entityId !== undefined ? `id=${finding.entityId}` : null,
        ].filter(Boolean).join(' ');
        if (sampleLabel && existing.samples.size < 5) {
            existing.samples.add(sampleLabel);
        }
        groups.set(finding.field, existing);
    }
    return [...groups.entries()]
        .map(([field, value]) => ({
            field,
            count: value.count,
            samples: [...value.samples],
        }))
        .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));
}

function groupProjectFindings(findings: LegacyPlanFieldFinding[]): Array<{ field: string; count: number; }> {
    const groups = new Map<string, number>();
    for (const finding of findings) {
        groups.set(finding.field, (groups.get(finding.field) ?? 0) + 1);
    }
    return [...groups.entries()]
        .map(([field, count]) => ({ field, count }))
        .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));
}

/**
 * Structured, serializable report for legacy plan import / inventory results.
 */
export class LegacyPlanImportReport {
    fixtureName?: string;
    fromVersion: string | null = null;
    toVersion: string = '';
    entityCount = 0;
    inventory: LegacyPlanFieldInventoryResult | null = null;
    unresolvedBuildingKeys: string[] = [];
    unresolvedFacilityUpgrades: string[] = [];
    unresolvedSocketIds: string[] = [];
    unresolvedSocketFindings: LegacySocketAttachmentFinding[] = [];
    unresolvedCargoKeys: string[] = [];
    unresolvedIconKeys: string[] = [];
    unresolvedImageKeys: string[] = [];
    unmatchedModslots: string[] = [];
    skippedEntityTypes: Record<string, number> = {};
    importedShapeCounts: Record<string, number> = {};
    upgradeWarnings: LegacyPlanUpgradeWarning[] = [];

    get unknownProjectFields(): LegacyPlanFieldFinding[] {
        return this.inventory?.unknownProjectFields ?? [];
    }

    get unknownEntityFields(): LegacyPlanFieldFinding[] {
        return this.inventory?.unknownEntityFields ?? [];
    }

    get unmappedProjectFields(): LegacyPlanFieldFinding[] {
        return this.inventory?.unmappedProjectFields ?? [];
    }

    get unmappedFields(): LegacyPlanFieldFinding[] {
        return [
            ...(this.inventory?.unmappedProjectFields ?? []),
            ...(this.inventory?.unmappedEntityFields ?? []),
        ];
    }

    get hasBlockingFindings(): boolean {
        return this.unmappedFields.length > 0
            || this.unknownEntityFields.length > 0
            || this.unknownProjectFields.length > 0
            || this.unresolvedBuildingKeys.length > 0;
    }

    get hasReportableFindings(): boolean {
        return this.hasBlockingFindings
            || this.unresolvedSocketFindings.some(finding => finding.reason === 'misaligned_after_import')
            || this.unresolvedFacilityUpgrades.length > 0
            || this.unresolvedSocketIds.length > 0
            || this.unresolvedCargoKeys.length > 0
            || this.unresolvedIconKeys.length > 0
            || this.unresolvedImageKeys.length > 0
            || this.unmatchedModslots.length > 0
            || Object.keys(this.skippedEntityTypes).length > 0
            || this.upgradeWarnings.length > 0;
    }

    get issueCount(): number {
        return this.unresolvedBuildingKeys.length
            + this.unresolvedSocketFindings.filter(finding => finding.reason === 'misaligned_after_import').length
            + this.unresolvedFacilityUpgrades.length
            + this.unresolvedSocketIds.length
            + this.unresolvedCargoKeys.length
            + this.unresolvedIconKeys.length
            + this.unresolvedImageKeys.length
            + this.unmatchedModslots.length
            + Object.values(this.skippedEntityTypes).reduce((sum, count) => sum + count, 0)
            + this.upgradeWarnings.length
            + this.unmappedFields.length
            + this.unknownEntityFields.length
            + this.unknownProjectFields.length;
    }

    toJSON(): LegacyPlanImportReportJson {
        return {
            fixtureName: this.fixtureName,
            fromVersion: this.fromVersion,
            toVersion: this.toVersion,
            entityCount: this.entityCount,
            entityKindCounts: this.inventory?.entityKindCounts ?? {},
            buildingKeys: this.inventory?.buildingKeys ?? [],
            unresolvedBuildingKeys: this.unresolvedBuildingKeys,
            unresolvedFacilityUpgrades: this.unresolvedFacilityUpgrades,
            unresolvedSocketIds: this.unresolvedSocketIds,
            unresolvedSocketFindings: this.unresolvedSocketFindings,
            unresolvedCargoKeys: this.unresolvedCargoKeys,
            unresolvedIconKeys: this.unresolvedIconKeys,
            unresolvedImageKeys: this.unresolvedImageKeys,
            unmatchedModslots: this.unmatchedModslots,
            skippedEntityTypes: { ...this.skippedEntityTypes },
            importedShapeCounts: { ...this.importedShapeCounts },
            unknownProjectFields: groupProjectFindings(this.unknownProjectFields),
            unknownEntityFields: groupFindings(this.unknownEntityFields),
            unmappedProjectFields: groupProjectFindings(this.unmappedProjectFields),
            unmappedEntityFields: groupFindings(this.inventory?.unmappedEntityFields ?? []),
            upgradeWarnings: this.upgradeWarnings,
        };
    }

    formatSummary(): string {
        const json = this.toJSON();
        const lines: string[] = [];
        lines.push(`Legacy plan import report${json.fixtureName ? ` (${json.fixtureName})` : ''}`);
        lines.push(`  version: ${json.fromVersion ?? '(missing)'} → ${json.toVersion}`);
        lines.push(`  entities: ${json.entityCount}`);
        lines.push(`  kinds: ${JSON.stringify(json.entityKindCounts)}`);
        if (Object.keys(json.importedShapeCounts).length) {
            lines.push(`  imported shapes: ${JSON.stringify(json.importedShapeCounts)}`);
        }
        if (Object.keys(json.skippedEntityTypes).length) {
            lines.push(`  skipped types: ${JSON.stringify(json.skippedEntityTypes)}`);
        }

        if (json.unmappedEntityFields.length) {
            lines.push('  unmapped entity fields:');
            for (const entry of json.unmappedEntityFields) {
                lines.push(`    - ${entry.field} ×${entry.count}${entry.samples.length ? ` [${entry.samples.join('; ')}]` : ''}`);
            }
        }
        if (json.unmappedProjectFields.length) {
            lines.push('  unmapped project fields:');
            for (const entry of json.unmappedProjectFields) {
                lines.push(`    - ${entry.field} ×${entry.count}`);
            }
        }
        if (json.unknownEntityFields.length) {
            lines.push('  unknown entity fields:');
            for (const entry of json.unknownEntityFields) {
                lines.push(`    - ${entry.field} ×${entry.count}${entry.samples.length ? ` [${entry.samples.join('; ')}]` : ''}`);
            }
        }
        if (json.unknownProjectFields.length) {
            lines.push('  unknown project fields:');
            for (const entry of json.unknownProjectFields) {
                lines.push(`    - ${entry.field} ×${entry.count}`);
            }
        }
        if (json.unresolvedBuildingKeys.length) {
            lines.push(`  unresolved building keys (${json.unresolvedBuildingKeys.length}): ${json.unresolvedBuildingKeys.slice(0, 40).join(', ')}${json.unresolvedBuildingKeys.length > 40 ? '…' : ''}`);
        }
        if (json.unresolvedFacilityUpgrades.length) {
            lines.push(`  unresolved facility upgrades (${json.unresolvedFacilityUpgrades.length}): ${json.unresolvedFacilityUpgrades.slice(0, 20).join(', ')}${json.unresolvedFacilityUpgrades.length > 20 ? '…' : ''}`);
        }
        if (json.unresolvedSocketIds.length) {
            lines.push(`  unresolved socket ids (${json.unresolvedSocketIds.length}): ${json.unresolvedSocketIds.slice(0, 20).join(', ')}${json.unresolvedSocketIds.length > 20 ? '…' : ''}`);
        }
        const disconnected = json.unresolvedSocketFindings.filter(finding => finding.reason === 'misaligned_after_import');
        if (disconnected.length) {
            lines.push(`  disconnected connections (${disconnected.length}): ${disconnected.slice(0, 20).map(finding => `${finding.entityId}:${finding.legacySocketId} ↔ ${finding.peerEntityId}:${finding.peerSocketId}`).join(', ')}${disconnected.length > 20 ? '…' : ''}`);
        }
        if (json.unresolvedCargoKeys.length) {
            lines.push(`  unresolved cargo keys (${json.unresolvedCargoKeys.length}): ${json.unresolvedCargoKeys.slice(0, 20).join(', ')}${json.unresolvedCargoKeys.length > 20 ? '…' : ''}`);
        }
        if (json.unresolvedIconKeys.length) {
            lines.push(`  unresolved icon keys (${json.unresolvedIconKeys.length}): ${json.unresolvedIconKeys.slice(0, 20).join(', ')}${json.unresolvedIconKeys.length > 20 ? '…' : ''}`);
        }
        if (json.unresolvedImageKeys.length) {
            lines.push(`  unresolved image files (${json.unresolvedImageKeys.length}): ${json.unresolvedImageKeys.slice(0, 20).join(', ')}${json.unresolvedImageKeys.length > 20 ? '…' : ''}`);
        }
        if (json.unmatchedModslots.length) {
            lines.push(`  unmatched modslots (${json.unmatchedModslots.length}): ${json.unmatchedModslots.slice(0, 20).join(', ')}${json.unmatchedModslots.length > 20 ? '…' : ''}`);
        }
        if (json.upgradeWarnings.length) {
            lines.push(`  upgrade warnings: ${json.upgradeWarnings.length}`);
            for (const warning of json.upgradeWarnings.slice(0, 10)) {
                lines.push(`    - ${warning.code}: ${warning.message}`);
            }
        }
        return lines.join('\n');
    }
}
