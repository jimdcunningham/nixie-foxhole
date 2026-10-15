import { normalizeFoxholeModificationSelectionMap, setFoxholeModificationSlotVariantSelection } from './modification-slots.ts';
import { createFoxholeSplineConnectorSnapshot } from './spline-connector-snapshot.ts';
import { isFoxholeSplineConnectorStructure } from './spline-connector.ts';
import { createFoxholeStructureSnapshot } from './snapshot.ts';
import type { FoxholeStructureAsset } from './catalog.ts';
import type { FoxholeManifestStructure } from './manifest.ts';

export interface CreateFoxholeStructureAssetSnapshotOptions {
    asset: FoxholeStructureAsset;
    structure?: FoxholeManifestStructure | null;
    parentAsset?: FoxholeStructureAsset | null;
    label: string;
    destroyed?: boolean;
    modificationVariantIds?: Record<string, string>;
    x: number;
    y: number;
    z?: number;
}

function resolveUpgradePlacementState(
    asset: FoxholeStructureAsset,
    parentAsset: FoxholeStructureAsset | null | undefined,
): {
    foxholeKey: string;
    modificationVariantIds: Record<string, string>;
} | null {
    const parentKey = String(asset.parentStructureId ?? '').trim();
    const appliedModificationId = String(asset.appliedModificationId ?? '').trim();
    if (!asset.isUpgrade || !parentAsset || !parentKey || !appliedModificationId || parentAsset.foxholeKey !== parentKey) {
        return null;
    }

    for (const slot of parentAsset.modificationSlots) {
        const matchedVariant = slot.variants.find(variant => {
            if (!variant.isUpgrade) {
                return false;
            }

            const candidateIds = [variant.appliedModificationId, variant.id]
                .map(value => String(value ?? '').trim().toLowerCase())
                .filter(Boolean);
            return candidateIds.includes(appliedModificationId.toLowerCase());
        });

        if (!matchedVariant) {
            continue;
        }

        return {
            foxholeKey: parentAsset.foxholeKey,
            modificationVariantIds: setFoxholeModificationSlotVariantSelection({}, slot, matchedVariant.id),
        };
    }

    return null;
}

export function createFoxholeStructureAssetSnapshot(options: CreateFoxholeStructureAssetSnapshotOptions) {
    const { asset, structure, parentAsset, label, destroyed = false, modificationVariantIds, x, y, z } = options;
    const normalizedSelections = normalizeFoxholeModificationSelectionMap(modificationVariantIds);
    const normalizedUpgradePlacement = Object.keys(normalizedSelections).length > 0
        ? {
            foxholeKey: asset.foxholeKey,
            modificationVariantIds: normalizedSelections,
        }
        : resolveUpgradePlacementState(asset, parentAsset);
    const placedFoxholeKey = normalizedUpgradePlacement?.foxholeKey ?? asset.foxholeKey;
    const placedSelections = normalizedUpgradePlacement?.modificationVariantIds;

    if (!destroyed && isFoxholeSplineConnectorStructure(structure)) {
        return createFoxholeSplineConnectorSnapshot({
            foxholeKey: placedFoxholeKey,
            structure,
            label,
            x,
            y,
            z,
            modificationVariantIds: placedSelections,
        });
    }

    const placedAsset = normalizedUpgradePlacement?.foxholeKey === parentAsset?.foxholeKey
        ? parentAsset
        : asset;

    return createFoxholeStructureSnapshot({
        foxholeKey: placedFoxholeKey,
        label,
        colorHex: placedAsset?.defaultColorHex,
        destroyed,
        modificationVariantIds: placedSelections,
        x,
        y,
        z,
    });
}
