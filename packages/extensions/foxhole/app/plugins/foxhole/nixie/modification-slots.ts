import type {
    FoxholeStructureModificationSlotAsset,
    FoxholeStructureModificationSlotVariantAsset,
} from './catalog.ts';

export type FoxholeStructureModificationSelectionMap = Record<string, string>;

function normalizeSelectionKey(value: unknown): string {
    return String(value ?? '').trim();
}

export function normalizeFoxholeModificationSelectionMap(value: unknown): FoxholeStructureModificationSelectionMap {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    const nextSelections: FoxholeStructureModificationSelectionMap = {};
    for (const [slotId, variantId] of Object.entries(value)) {
        const normalizedSlotId = normalizeSelectionKey(slotId);
        const normalizedVariantId = normalizeSelectionKey(variantId);
        if (!normalizedSlotId || !normalizedVariantId) {
            continue;
        }
        nextSelections[normalizedSlotId] = normalizedVariantId;
    }

    return nextSelections;
}

export function replaceFoxholeModificationSelectionMap(
    _currentSelections: FoxholeStructureModificationSelectionMap | null | undefined,
    nextSelections: unknown,
): FoxholeStructureModificationSelectionMap {
    return normalizeFoxholeModificationSelectionMap(nextSelections);
}

export function resolveFoxholeModificationSlotVariantId(
    slot: Pick<FoxholeStructureModificationSlotAsset, 'id' | 'variants' | 'variantById'>,
    selections: FoxholeStructureModificationSelectionMap | null | undefined,
): string | null {
    const normalizedSelections = normalizeFoxholeModificationSelectionMap(selections);
    const selectedVariantId = normalizeSelectionKey(normalizedSelections[slot.id]);
    if (selectedVariantId && slot.variantById[selectedVariantId]) {
        return selectedVariantId;
    }

    return null;
}

export function resolveFoxholeModificationSlotVariant(
    slot: Pick<FoxholeStructureModificationSlotAsset, 'id' | 'variants' | 'variantById'>,
    selections: FoxholeStructureModificationSelectionMap | null | undefined,
): FoxholeStructureModificationSlotVariantAsset | null {
    const variantId = resolveFoxholeModificationSlotVariantId(slot, selections);
    if (!variantId) {
        return null;
    }

    return slot.variantById[variantId] ?? null;
}

export function setFoxholeModificationSlotVariantSelection(
    selections: FoxholeStructureModificationSelectionMap | null | undefined,
    slot: Pick<FoxholeStructureModificationSlotAsset, 'id' | 'variantById'>,
    variantId: string | null | undefined,
): FoxholeStructureModificationSelectionMap {
    const nextSelections = { ...normalizeFoxholeModificationSelectionMap(selections) };
    const normalizedVariantId = normalizeSelectionKey(variantId);

    if (!normalizedVariantId || !slot.variantById[normalizedVariantId]) {
        delete nextSelections[slot.id];
        return nextSelections;
    }

    nextSelections[slot.id] = normalizedVariantId;
    return nextSelections;
}

export interface FoxholeSelectedModificationSlotVariant {
    slot: FoxholeStructureModificationSlotAsset;
    variant: FoxholeStructureModificationSlotVariantAsset;
}

export function getFoxholeSelectedModificationSlotVariants(
    slots: readonly FoxholeStructureModificationSlotAsset[],
    selections: FoxholeStructureModificationSelectionMap | null | undefined,
): FoxholeSelectedModificationSlotVariant[] {
    return slots.flatMap(slot => {
        const variantId = resolveFoxholeModificationSlotVariantId(slot, selections);
        if (!variantId) {
            return [];
        }

        const variant = slot.variantById[variantId];
        return variant ? [{ slot, variant }] : [];
    });
}

/** Keep logical choices supported by the destination; its catalog owns tier-specific visuals. */
export function reconcileFoxholeTierModificationSelections(
    slots: readonly Pick<FoxholeStructureModificationSlotAsset, 'id' | 'variantById'>[],
    selections: FoxholeStructureModificationSelectionMap | null | undefined,
    excludeUpgrades = false,
): FoxholeStructureModificationSelectionMap {
    const normalized = normalizeFoxholeModificationSelectionMap(selections);
    return Object.fromEntries(slots.flatMap(slot => {
        const variantId = normalized[slot.id];
        const variant = variantId ? slot.variantById[variantId] : undefined;
        return variant && (!excludeUpgrades || !variant.isUpgrade) ? [[slot.id, variant.id]] : [];
    }));
}
