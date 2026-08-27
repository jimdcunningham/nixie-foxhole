export function stripPublishedManifestLocalizationMetadata(strings = {}) {
    return Object.fromEntries(Object.entries(strings).filter(([key]) => (
        !String(key).replace(/^foxhole:/, '').startsWith('meta:')
    )));
}

export function normalizeConversionRecipeCursorOrder(manifest) {
    for (const structure of manifest?.assets ?? []) {
        moveNextRecipeIdToEnd(structure);
        for (const slot of listModificationSlotCollections(structure)) {
            for (const variant of Object.values(slot?.variants ?? {})) {
                moveNextRecipeIdToEnd(variant);
            }
        }
    }
    return manifest;
}

function listModificationSlotCollections(structure) {
    if (Array.isArray(structure?.modificationSlots) && structure.modificationSlots.length > 0) {
        return structure.modificationSlots;
    }
    if (Array.isArray(structure?.modifications)) {
        return structure.modifications;
    }
    return [];
}

function moveNextRecipeIdToEnd(owner) {
    if (!owner || typeof owner !== 'object' || !Object.hasOwn(owner, 'nextRecipeId')) {
        return;
    }

    const nextRecipeId = owner.nextRecipeId;
    delete owner.nextRecipeId;
    owner.nextRecipeId = nextRecipeId;
}
