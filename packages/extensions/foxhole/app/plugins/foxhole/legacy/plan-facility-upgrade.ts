import { LEGACY_PLAN_BUILDING_KEY_MAP, resolveLegacyPlanBuildingKey } from './plan-building-key-map.ts';
import { resolveLegacyPlanFacilityUpgradeCodeName } from './plan-facility-upgrade-codenames.ts';
import type { FoxholeStructureAsset, FoxholeStructureCatalog } from '../nixie/catalog.ts';
import {
    normalizeFoxholeModificationSelectionMap,
    setFoxholeModificationSlotVariantSelection,

} from '../nixie/modification-slots.ts';
import type { FoxholeStructureModificationSelectionMap } from '../nixie/modification-slots.ts';

export type LegacyBuildingResolution = {
    foxholeKey: string;
    modificationVariantIds: FoxholeStructureModificationSelectionMap;
    kind: 'structure' | 'structure+mod';
};

function normalizeModId(value: unknown): string {
    return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Strip trailing `modslot` so legacy `bridge` matches Nixie `BridgeModSlot`. */
function normalizeModSlotKey(value: unknown): string {
    const normalized = normalizeModId(value);
    return normalized.endsWith('modslot') ? normalized.slice(0, -'modslot'.length) : normalized;
}

/**
 * Legacy trench `under`/`pipes` was the bunker gear-power pipe overlay (engine
 * unions), not a FoxWatch modification slot. Drop it on import.
 */
const LEGACY_IGNORED_MODSLOTS = new Set(['under']);

function legacyModSlotMatches(
    slotKey: string,
    entry: { id: string; name?: string | null; },
): boolean {
    const legacyKey = normalizeModSlotKey(slotKey);
    if (!legacyKey) {
        return false;
    }
    return normalizeModSlotKey(entry.id) === legacyKey
        || normalizeModSlotKey(entry.name) === legacyKey;
}

export function listLegacyPlanParentPrefixes(legacyKey: string): Array<{ parentKey: string; suffix: string; }> {
    const prefixes: Array<{ parentKey: string; suffix: string; }> = [];
    for (const parentKey of Object.keys(LEGACY_PLAN_BUILDING_KEY_MAP)) {
        if (legacyKey === parentKey || !legacyKey.startsWith(`${parentKey}_`)) {
            continue;
        }
        prefixes.push({
            parentKey,
            suffix: legacyKey.slice(parentKey.length + 1),
        });
    }
    return prefixes.sort((left, right) => right.parentKey.length - left.parentKey.length);
}

function findModificationVariant(
    asset: FoxholeStructureAsset,
    candidates: readonly string[],
): { slotId: string; variantId: string; } | null {
    const normalizedCandidates = [...new Set(candidates.map(normalizeModId).filter(Boolean))];
    if (!normalizedCandidates.length) {
        return null;
    }

    for (const slot of asset.modificationSlots) {
        for (const variant of slot.variants) {
            const variantIds = [variant.id, variant.appliedModificationId, variant.modificationId]
                .map(normalizeModId)
                .filter(Boolean);
            if (variantIds.some(id => normalizedCandidates.includes(id))) {
                return { slotId: slot.id, variantId: variant.id };
            }
        }
    }

    return null;
}

/**
 * Resolves a legacy building key to a Nixie foxholeKey + optional modification selections.
 * Facility upgrades that are mods (not separate assets) become parent + modificationVariantIds.
 */
export class LegacyPlanFacilityUpgradeResolver {
    private readonly catalog: FoxholeStructureCatalog;

    constructor(catalog: FoxholeStructureCatalog) {
        this.catalog = catalog;
    }

    resolve(legacyKey: string): LegacyBuildingResolution | null {
        const normalizedKey = String(legacyKey ?? '').trim();
        if (!normalizedKey) {
            return null;
        }

        const directKey = resolveLegacyPlanBuildingKey(normalizedKey);
        if (directKey && this.catalog.structureByKey[directKey]) {
            return {
                foxholeKey: directKey,
                modificationVariantIds: {},
                kind: 'structure',
            };
        }

        for (const { parentKey, suffix } of listLegacyPlanParentPrefixes(normalizedKey)) {
            const suffixAsStructure = resolveLegacyPlanBuildingKey(suffix);
            if (suffixAsStructure && this.catalog.structureByKey[suffixAsStructure]) {
                return {
                    foxholeKey: suffixAsStructure,
                    modificationVariantIds: {},
                    kind: 'structure',
                };
            }

            const parentFoxholeKey = resolveLegacyPlanBuildingKey(parentKey);
            if (!parentFoxholeKey) {
                continue;
            }
            const parentAsset = this.catalog.assetByKey[parentFoxholeKey]
                ?? this.catalog.assets.find(asset => asset.foxholeKey === parentFoxholeKey)
                ?? null;
            if (!parentAsset) {
                continue;
            }

            const upgradeCodeName = resolveLegacyPlanFacilityUpgradeCodeName(normalizedKey);
            const matched = findModificationVariant(parentAsset, [
                suffix,
                normalizedKey,
                ...(upgradeCodeName ? [upgradeCodeName] : []),
            ]);
            if (!matched) {
                continue;
            }

            return {
                foxholeKey: parentFoxholeKey,
                modificationVariantIds: setFoxholeModificationSlotVariantSelection(
                    {},
                    parentAsset.modificationSlots.find(slot => slot.id === matched.slotId)!,
                    matched.variantId,
                ),
                kind: 'structure+mod',
            };
        }

        return null;
    }

    /**
     * Maps legacy `modslots` onto Nixie modificationVariantIds for the resolved asset.
     * Unmatched slots are returned for reporting.
     */
    mapModslots(
        foxholeKey: string,
        modslots: Record<string, string | null | undefined> | null | undefined,
        existing?: FoxholeStructureModificationSelectionMap,
    ): {
        modificationVariantIds: FoxholeStructureModificationSelectionMap;
        unmatchedSlots: string[];
    } {
        let selections = normalizeFoxholeModificationSelectionMap(existing);
        const unmatchedSlots: string[] = [];
        if (!modslots || typeof modslots !== 'object') {
            return { modificationVariantIds: selections, unmatchedSlots };
        }

        const asset = this.catalog.assetByKey[foxholeKey]
            ?? this.catalog.assets.find(entry => entry.foxholeKey === foxholeKey)
            ?? null;
        if (!asset) {
            unmatchedSlots.push(...Object.keys(modslots));
            return { modificationVariantIds: selections, unmatchedSlots };
        }

        for (const [slotKey, variantKey] of Object.entries(modslots)) {
            if (variantKey == null || String(variantKey).trim() === '') {
                continue;
            }
            if (LEGACY_IGNORED_MODSLOTS.has(normalizeModId(slotKey))) {
                continue;
            }
            const slot = asset.modificationSlots.find(entry => legacyModSlotMatches(slotKey, entry));
            if (!slot) {
                unmatchedSlots.push(slotKey);
                continue;
            }
            const matched = findModificationVariant(
                { ...asset, modificationSlots: [slot] },
                [String(variantKey)],
            );
            if (!matched) {
                unmatchedSlots.push(slotKey);
                continue;
            }
            selections = setFoxholeModificationSlotVariantSelection(selections, slot, matched.variantId);
        }

        return { modificationVariantIds: selections, unmatchedSlots };
    }
}
