import { isUpgradeModificationVariant } from './modification-storage-policy.mjs';
import { loadExcludedStructureOverrideIds } from './publish-manifest-overrides.mjs';

/** 3D export consumes extraction metadata; rendered sprites and public localization are unnecessary. */
export async function spatialExportCatalog(document, overrideDirectory) {
    const excluded = overrideDirectory ? await loadExcludedStructureOverrideIds(overrideDirectory) : new Set();
    return { assets: (document.assets ?? []).filter(asset => !asset.isUpgrade && !excluded.has(asset.id)).map(asset => {
        const raw = Array.isArray(asset.modificationSlots);
        const slots = raw ? asset.modificationSlots : Array.isArray(asset.modifications) ? asset.modifications : [];
        return { id: asset.id, codeName: asset.codeName, categoryId: asset.categoryId,
            ...(asset.isItem ? { isItem: true } : {}), ...(asset.isVehicle ? { isVehicle: true } : {}),
            ...(asset.isBunker ? { isBunker: true } : {}), ...(asset.isDestroyed ? { isDestroyed: true } : {}),
            ...(asset.isBreached ? { isBreached: true } : {}), renderLayers: asset.renderLayers ?? [],
            modifications: slots.map(slot => ({ name: slot.name, componentType: slot.componentType,
                variants: Object.fromEntries(Object.entries(slot.variants ?? {}).filter(([id]) => id !== 'default').sort(([a], [b]) => a.localeCompare(b)).map(([id, variant]) =>
                    [id, { ...(isUpgradeModificationVariant(slot, id, variant, raw ? asset.modifications?.[id] : null) ? { isUpgrade: true } : {}),
                        ...(variant.sharedModificationId ? { sharedModificationId: variant.sharedModificationId } : {}) }])) })) };
    }) };
}
