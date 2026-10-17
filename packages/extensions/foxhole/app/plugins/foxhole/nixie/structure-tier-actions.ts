import { reconcileFoxholeAssetCargoPatch } from './hold-profile.ts';
import {
    findFoxholeAppliedModificationAssetFromCatalog,

} from './catalog.ts';
import type { FoxholeStructureAsset, FoxholeStructureCatalog } from './catalog.ts';
import {
    getFoxholeSelectedModificationSlotVariants,
    normalizeFoxholeModificationSelectionMap,
    reconcileFoxholeTierModificationSelections,
} from './modification-slots.ts';
import type { FoxholeStructureState } from './types.ts';

export type FoxholeStructureTierDirection = 'up' | 'down';
export type FoxholeStructureTierMutationMode = 'tier-change' | 'clear-upgrade';

export interface FoxholeStructureTierMutation {
    direction: FoxholeStructureTierDirection;
    mode: FoxholeStructureTierMutationMode;
    currentAsset: FoxholeStructureAsset;
    targetAsset: FoxholeStructureAsset;
    patch: Pick<FoxholeStructureState, 'foxholeKey' | 'modificationVariantIds' | 'markedItemCodenames'>;
}

function normalizeRelationshipLookupValue(value: string | null | undefined): string {
    return String(value ?? '').trim().toLowerCase();
}

export function resolveFoxholeRelationshipAsset(
    catalog: Pick<FoxholeStructureCatalog, 'assetByKey'>,
    assetId: string | null | undefined,
    codeName: string | null | undefined,
): FoxholeStructureAsset | null {
    const normalizedAssetId = String(assetId ?? '').trim();
    if (normalizedAssetId) {
        const byId = catalog.assetByKey[normalizedAssetId];
        if (byId) {
            return byId;
        }
    }

    const normalizedCodeName = String(codeName ?? '').trim().toLowerCase();
    return normalizedCodeName
        ? (catalog.assetByKey[normalizedCodeName] ?? null)
        : null;
}

export function resolveFoxholeRelationshipUpgradeSourceAsset(
    catalog: Pick<FoxholeStructureCatalog, 'assetByKey'>,
    currentAsset: FoxholeStructureAsset,
): FoxholeStructureAsset | null {
    const source = resolveFoxholeRelationshipAsset(
        catalog,
        currentAsset.downgradeStructureId,
        currentAsset.downgradeStructureCodeName,
    );
    if (!source || source.foxholeKey === currentAsset.foxholeKey) {
        return null;
    }

    const upgrade = resolveFoxholeRelationshipAsset(
        catalog,
        source.upgradeStructureId,
        source.upgradeStructureCodeName,
    );
    return upgrade?.foxholeKey === currentAsset.foxholeKey ? source : null;
}

export function resolveFoxholeConversionSourceAsset(
    catalog: Pick<FoxholeStructureCatalog, 'assets'>,
    currentAsset: FoxholeStructureAsset,
): FoxholeStructureAsset | null {
    const conversionKeys = new Set([
        ...currentAsset.conversionStructureIds,
        ...currentAsset.conversionCodeNames,
    ].map(normalizeRelationshipLookupValue));
    // A facility's vehicle products are recipes, not replacements for the host.
    const hasConversionTarget = conversionKeys.size > 0 && catalog.assets.some(target => target !== currentAsset
        && target.isVehicle === currentAsset.isVehicle
        && (conversionKeys.has(normalizeRelationshipLookupValue(target.foxholeKey))
            || conversionKeys.has(normalizeRelationshipLookupValue(target.codeName))));
    if (hasConversionTarget) {
        return currentAsset;
    }

    return resolveFoxholeConversionParentAsset(catalog, currentAsset);
}

export function resolveFoxholeConversionParentAsset(
    catalog: Pick<FoxholeStructureCatalog, 'assets'>,
    currentAsset: FoxholeStructureAsset,
): FoxholeStructureAsset | null {
    const normalizedCurrentKey = normalizeRelationshipLookupValue(currentAsset.foxholeKey);
    const normalizedCurrentCodeName = normalizeRelationshipLookupValue(currentAsset.codeName);
    const currentTier = Number.isFinite(currentAsset.tier) ? Number(currentAsset.tier) : null;

    return catalog.assets.find(entry => {
        if (
            entry.foxholeKey === currentAsset.foxholeKey
            // Facilities list conversion products, not vehicle upgrade ancestry.
            || entry.isVehicle !== currentAsset.isVehicle
            || entry.isUpgrade
            || entry.isDestroyed
            || entry.isBreached
            || entry.conversionCodeNames.length === 0
        ) {
            return false;
        }

        const entryTier = Number.isFinite(entry.tier) ? Number(entry.tier) : null;
        if (currentTier !== null && entryTier !== currentTier) {
            return false;
        }

        return entry.conversionStructureIds.some(id => normalizeRelationshipLookupValue(id) === normalizedCurrentKey)
            || entry.conversionCodeNames.some(codeName => normalizeRelationshipLookupValue(codeName) === normalizedCurrentCodeName);
    }) ?? null;
}

export function isFoxholeConversionTargetAsset(
    catalog: Pick<FoxholeStructureCatalog, 'assets'>,
    currentAsset: FoxholeStructureAsset,
): boolean {
    return Boolean(resolveFoxholeConversionParentAsset(catalog, currentAsset));
}

export function resolveFoxholeRelationshipSelectionAsset(
    catalog: Pick<FoxholeStructureCatalog, 'assets' | 'assetByKey'>,
    currentAsset: FoxholeStructureAsset,
    targetAsset: FoxholeStructureAsset,
): FoxholeStructureAsset | null {
    return currentAsset.foxholeKey === targetAsset.foxholeKey
        ? (resolveFoxholeConversionParentAsset(catalog, currentAsset)
            ?? resolveFoxholeRelationshipUpgradeSourceAsset(catalog, currentAsset))
        : targetAsset;
}

function resolveFoxholeStructureUpgradeAsset(
    catalog: Pick<FoxholeStructureCatalog, 'assetByKey'>,
    currentAsset: FoxholeStructureAsset,
): FoxholeStructureAsset | null {
    const target = resolveFoxholeRelationshipAsset(
        catalog,
        currentAsset.upgradeStructureId,
        currentAsset.upgradeStructureCodeName,
    );
    return target?.foxholeKey === currentAsset.foxholeKey ? null : target;
}

function resolveFoxholeStructureDowngradeAsset(
    catalog: Pick<FoxholeStructureCatalog, 'assetByKey' | 'assets'>,
    currentAsset: FoxholeStructureAsset,
): FoxholeStructureAsset | null {
    const explicitTarget = resolveFoxholeRelationshipAsset(
        catalog,
        currentAsset.downgradeStructureId,
        currentAsset.downgradeStructureCodeName,
    );
    if (explicitTarget && explicitTarget.foxholeKey !== currentAsset.foxholeKey) {
        return explicitTarget;
    }

    const parentAsset = resolveFoxholeConversionParentAsset(catalog, currentAsset);
    if (parentAsset && parentAsset.foxholeKey !== currentAsset.foxholeKey) {
        const inheritedTarget = resolveFoxholeRelationshipAsset(catalog, parentAsset.foxholeKey, parentAsset.codeName);
        if (inheritedTarget?.foxholeKey !== currentAsset.foxholeKey) {
            return inheritedTarget;
        }
    }

    return explicitTarget?.foxholeKey === currentAsset.foxholeKey ? null : explicitTarget;
}

function resolveFoxholeAppliedUpgradeAsset(
    catalog: Pick<FoxholeStructureCatalog, 'assets'>,
    currentAsset: FoxholeStructureAsset,
    selections: Partial<FoxholeStructureState>['modificationVariantIds'],
): FoxholeStructureAsset | null {
    const selectedUpgradeVariant = getFoxholeSelectedModificationSlotVariants(
        currentAsset.modificationSlots,
        selections,
    ).find(entry => entry.variant.isUpgrade);
    const appliedModificationId = String(
        selectedUpgradeVariant?.variant.appliedModificationId
        ?? selectedUpgradeVariant?.variant.id
        ?? '',
    ).trim();

    if (!appliedModificationId) {
        return null;
    }

    return findFoxholeAppliedModificationAssetFromCatalog(catalog, {
        parentStructureId: currentAsset.foxholeKey,
        appliedModificationId,
    });
}

export function resolveFoxholeStructureTierMutation(
    catalog: Pick<FoxholeStructureCatalog, 'assetByKey' | 'assets'> & Partial<Pick<FoxholeStructureCatalog, 'structureByKey'>>,
    state: Partial<FoxholeStructureState> | null | undefined,
    direction: FoxholeStructureTierDirection,
): FoxholeStructureTierMutation | null {
    const foxholeKey = String(state?.foxholeKey ?? '').trim();
    if (!foxholeKey) {
        return null;
    }

    const currentAsset = catalog.assetByKey[foxholeKey];
    if (!currentAsset) {
        return null;
    }

    const normalizedSelections = normalizeFoxholeModificationSelectionMap(state?.modificationVariantIds);
    const activeUpgradeSelections = getFoxholeSelectedModificationSlotVariants(
        currentAsset.modificationSlots,
        normalizedSelections,
    ).filter(entry => entry.variant.isUpgrade);

    if (direction === 'down' && activeUpgradeSelections.length > 0) {
        return {
            direction,
            mode: 'clear-upgrade',
            currentAsset: resolveFoxholeAppliedUpgradeAsset(catalog, currentAsset, normalizedSelections) ?? currentAsset,
            targetAsset: currentAsset,
            patch: reconcileFoxholeAssetCargoPatch(catalog, state ?? {}, {
                foxholeKey: currentAsset.foxholeKey,
                modificationVariantIds: reconcileFoxholeTierModificationSelections(currentAsset.modificationSlots, normalizedSelections, true),
            }),
        };
    }

    const targetAsset = direction === 'up'
        ? resolveFoxholeStructureUpgradeAsset(catalog, currentAsset)
        : resolveFoxholeStructureDowngradeAsset(catalog, currentAsset);
    if (!targetAsset || targetAsset.foxholeKey === currentAsset.foxholeKey) {
        return null;
    }

    return {
        direction,
        mode: 'tier-change',
        currentAsset,
        targetAsset,
        patch: reconcileFoxholeAssetCargoPatch(catalog, state ?? {}, {
            foxholeKey: targetAsset.foxholeKey,
            modificationVariantIds: reconcileFoxholeTierModificationSelections(targetAsset.modificationSlots, normalizedSelections),
        }),
    };
}
