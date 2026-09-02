import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
    extractPublishedIconKey,
    isSharedPublishedIconUrl,
    normalizeId,
} from './publish-structure-icons.mjs';
import { logPublishDetail, logPublishSummary, logPublishWarn } from './publish-log.mjs';

/**
 * Resolve the co-located `<variantId>.icon.default.webp` URL for a host-local modification
 * from an existing co-located texture/preview/rendered URL.
 */
export function resolveHostLocalModificationDefaultIconUrl(variant) {
    const candidates = [
        variant?.icons?.rendered,
        variant?.previewUrl,
        variant?.sprite?.source,
        variant?.textureUrl,
    ];

    for (const candidate of candidates) {
        const normalized = String(candidate ?? '').trim().replace(/\\/g, '/');
        const match = normalized.match(
            /^(\/foxhole\/assets\/types\/(?:structures|items|vehicles)\/[^/]+\/modifications\/([^/]+)\/)/i,
        );
        if (!match) {
            continue;
        }

        const folderPrefix = match[1];
        const variantId = match[2];
        if (!variantId) {
            continue;
        }

        return `${folderPrefix}${variantId}.icon.default.webp`;
    }

    return null;
}

function addSharedIconKeyReference(counts, value) {
    const iconKey = extractPublishedIconKey(value);
    if (!iconKey) {
        return;
    }

    counts.set(iconKey, (counts.get(iconKey) ?? 0) + 1);
}

function getStructureModificationSlots(structure) {
    if (Array.isArray(structure?.modificationSlots) && structure.modificationSlots.length > 0) {
        return structure.modificationSlots;
    }

    if (Array.isArray(structure?.modifications)) {
        return structure.modifications;
    }

    return [];
}

/**
 * Count `/foxhole/assets/icons/<key>` references across the published manifest.
 * Multi-referenced keys stay in the global icons pool; single-use keys can co-locate.
 */
export function collectSharedPublishedIconKeyReferenceCounts(manifest) {
    const counts = new Map();

    for (const category of Object.values(manifest?.categories ?? {})) {
        addSharedIconKeyReference(counts, category?.iconUrl);
    }

    for (const structure of manifest?.assets ?? []) {
        addSharedIconKeyReference(counts, structure?.icons?.default ?? structure?.iconUrl);
        addSharedIconKeyReference(counts, structure?.icons?.rendered ?? structure?.previewIconUrl);
        addSharedIconKeyReference(counts, structure?.previewUrl);
        addSharedIconKeyReference(counts, structure?.subTypeIconUrl);
        addSharedIconKeyReference(counts, structure?.destroyed?.icons?.default ?? structure?.destroyed?.iconUrl);
        addSharedIconKeyReference(counts, structure?.destroyed?.icons?.rendered ?? structure?.destroyed?.previewIconUrl);
        addSharedIconKeyReference(counts, structure?.packaged?.icons?.default ?? structure?.packaged?.iconUrl);
        addSharedIconKeyReference(counts, structure?.packaged?.icons?.rendered ?? structure?.packaged?.previewIconUrl);

        for (const slot of getStructureModificationSlots(structure)) {
            for (const variant of Object.values(slot?.variants ?? {})) {
                addSharedIconKeyReference(counts, variant?.icons?.default ?? variant?.iconUrl);
                addSharedIconKeyReference(counts, variant?.icons?.rendered);
                addSharedIconKeyReference(counts, variant?.previewUrl);
                addSharedIconKeyReference(counts, variant?.subTypeIconUrl);
            }
        }
    }

    for (const modification of Object.values(manifest?.shared?.modifications ?? {})) {
        addSharedIconKeyReference(counts, modification?.icons?.default ?? modification?.iconUrl);
        addSharedIconKeyReference(counts, modification?.icons?.rendered);
        addSharedIconKeyReference(counts, modification?.previewUrl);
    }

    return counts;
}

export function shouldCoLocateSingleUseModificationDefaultIcon(defaultIconUrl, referenceCounts) {
    if (!isSharedPublishedIconUrl(defaultIconUrl)) {
        return false;
    }

    const iconKey = extractPublishedIconKey(defaultIconUrl);
    if (!iconKey) {
        return false;
    }

    return (referenceCounts.get(iconKey) ?? 0) === 1;
}

/**
 * Pipe valve/silo insulation blueprint icons resolve to the shared pipe-segment glyph.
 * Force those host-local upgrades to reuse the parent structure default icon instead,
 * matching underground/overhead insulation where default === host default.
 */
const INSULATION_DEFAULT_ICON_INHERIT_PARENT_STRUCTURE_IDS = new Set([
    'facilitypipevalve',
    'facilitysilooil',
]);

export function shouldInheritParentStructureDefaultIconForModification(structureId, variantId) {
    return normalizeId(variantId) === 'insulation'
        && INSULATION_DEFAULT_ICON_INHERIT_PARENT_STRUCTURE_IDS.has(normalizeId(structureId));
}

function rebuildManifestWithModificationSlots(manifest, assets) {
    const nextManifest = {
        ...manifest,
        assets,
    };
    // Preserve non-enumerable shared-modification source metadata across the rebuild.
    for (const key of ['__sharedModificationDefaultIconSourceById', '__sharedModificationSourceById']) {
        const value = manifest?.[key];
        if (typeof value === 'undefined') {
            continue;
        }

        Object.defineProperty(nextManifest, key, {
            value,
            enumerable: false,
            configurable: true,
            writable: false,
        });
    }

    return nextManifest;
}

function replaceStructureModificationSlots(structure, nextSlots) {
    if (Array.isArray(structure?.modificationSlots) && structure.modificationSlots.length > 0) {
        return { ...structure, modificationSlots: nextSlots };
    }

    return { ...structure, modifications: nextSlots };
}

/**
 * Copy single-use host-local modification default icons next to the mod folder and
 * rewrite manifest URLs. Multi-referenced `/icons/` keys are left in the shared pool.
 */
export async function coLocateSingleUseHostLocalModificationDefaultIcons(manifest, {
    readIconSource,
    writeIconFile,
    resolvePublicAssetFilePath,
}) {
    const referenceCounts = collectSharedPublishedIconKeyReferenceCounts(manifest);
    const coLocatedIconKeys = new Set();
    let coLocatedCount = 0;

    const assets = [];
    for (const structure of manifest?.assets ?? []) {
        const slots = getStructureModificationSlots(structure);
        if (slots.length === 0) {
            assets.push(structure);
            continue;
        }

        const nextSlots = [];
        for (const slot of slots) {
            const nextVariants = {};
            for (const [variantId, variant] of Object.entries(slot?.variants ?? {})) {
                if (normalizeId(variantId) === 'default' || variant?.sharedModificationId) {
                    nextVariants[variantId] = variant;
                    continue;
                }

                const defaultIconUrl = String(variant?.icons?.default ?? variant?.iconUrl ?? '').trim();
                if (!shouldCoLocateSingleUseModificationDefaultIcon(defaultIconUrl, referenceCounts)) {
                    nextVariants[variantId] = variant;
                    continue;
                }

                const coLocatedDefaultUrl = resolveHostLocalModificationDefaultIconUrl(variant);
                if (!coLocatedDefaultUrl) {
                    nextVariants[variantId] = variant;
                    continue;
                }

                const outputPath = resolvePublicAssetFilePath(coLocatedDefaultUrl);
                if (!outputPath) {
                    logPublishWarn(`could not resolve co-located mod default path for ${coLocatedDefaultUrl}`);
                    nextVariants[variantId] = variant;
                    continue;
                }

                try {
                    const source = await readIconSource(defaultIconUrl);
                    await mkdir(dirname(outputPath), { recursive: true });
                    await writeIconFile(outputPath, source.content);
                    logPublishDetail(`co-located single-use mod icon ${source.sourceFilePath} -> ${outputPath}`);

                    const iconKey = extractPublishedIconKey(defaultIconUrl);
                    if (iconKey) {
                        coLocatedIconKeys.add(iconKey);
                    }
                    coLocatedCount += 1;

                    nextVariants[variantId] = {
                        ...variant,
                        icons: {
                            ...(variant?.icons ?? {}),
                            default: coLocatedDefaultUrl,
                        },
                    };
                } catch (error) {
                    logPublishWarn(
                        `failed to co-locate single-use mod icon ${defaultIconUrl} -> ${coLocatedDefaultUrl}: ${error}`,
                    );
                    nextVariants[variantId] = variant;
                }
            }

            nextSlots.push({
                ...slot,
                variants: nextVariants,
            });
        }

        assets.push(replaceStructureModificationSlots(structure, nextSlots));
    }

    if (coLocatedCount > 0) {
        logPublishSummary(`publish-manifest: co-located ${coLocatedCount} single-use modification default icons`);
    }

    return {
        manifest: rebuildManifestWithModificationSlots(manifest, assets),
        coLocatedIconKeys,
        coLocatedCount,
    };
}

/**
 * Force selected host-local modification defaults to copy the parent structure icon.
 */
export async function inheritParentStructureDefaultIconsForModifications(manifest, {
    readIconSource,
    writeIconFile,
    resolvePublicAssetFilePath,
}) {
    let inheritedCount = 0;
    const assets = [];

    for (const structure of manifest?.assets ?? []) {
        const structureId = normalizeId(structure?.id);
        const slots = getStructureModificationSlots(structure);
        if (!structureId || slots.length === 0) {
            assets.push(structure);
            continue;
        }

        const parentDefaultIconUrl = String(structure?.icons?.default ?? structure?.iconUrl ?? '').trim();
        const nextSlots = [];
        let structureChanged = false;

        for (const slot of slots) {
            const nextVariants = {};
            for (const [variantId, variant] of Object.entries(slot?.variants ?? {})) {
                if (!shouldInheritParentStructureDefaultIconForModification(structureId, variantId)) {
                    nextVariants[variantId] = variant;
                    continue;
                }

                if (!parentDefaultIconUrl) {
                    logPublishWarn(
                        `cannot inherit parent default icon for ${structureId}/${variantId}: parent has no default icon`,
                    );
                    nextVariants[variantId] = variant;
                    continue;
                }

                const coLocatedDefaultUrl = resolveHostLocalModificationDefaultIconUrl(variant)
                    ?? `/foxhole/assets/types/structures/${structureId}/modifications/${normalizeId(variantId)}/${normalizeId(variantId)}.icon.default.webp`;
                const outputPath = resolvePublicAssetFilePath(coLocatedDefaultUrl);
                if (!outputPath) {
                    logPublishWarn(`could not resolve inherited mod default path for ${coLocatedDefaultUrl}`);
                    nextVariants[variantId] = variant;
                    continue;
                }

                try {
                    const source = await readIconSource(parentDefaultIconUrl);
                    await mkdir(dirname(outputPath), { recursive: true });
                    await writeIconFile(outputPath, source.content);
                    logPublishDetail(
                        `inherited parent default icon ${source.sourceFilePath} -> ${outputPath}`,
                    );
                    inheritedCount += 1;
                    structureChanged = true;
                    nextVariants[variantId] = {
                        ...variant,
                        icons: {
                            ...(variant?.icons ?? {}),
                            default: coLocatedDefaultUrl,
                        },
                    };
                } catch (error) {
                    logPublishWarn(
                        `failed to inherit parent default icon ${parentDefaultIconUrl} -> ${coLocatedDefaultUrl}: ${error}`,
                    );
                    nextVariants[variantId] = variant;
                }
            }

            nextSlots.push({
                ...slot,
                variants: nextVariants,
            });
        }

        assets.push(structureChanged
            ? replaceStructureModificationSlots(structure, nextSlots)
            : structure);
    }

    if (inheritedCount > 0) {
        logPublishSummary(
            `publish-manifest: inherited ${inheritedCount} modification default icons from parent structures`,
        );
    }

    return {
        manifest: rebuildManifestWithModificationSlots(manifest, assets),
        inheritedCount,
    };
}

export async function removePublicIconsByKey(publicIconsDirectory, iconKeys, {
    pathExists,
    unlink,
    walkFiles,
}) {
    if (!iconKeys?.size) {
        return 0;
    }

    let directoryExists = false;
    try {
        directoryExists = await pathExists(publicIconsDirectory);
    } catch {
        directoryExists = false;
    }
    if (!directoryExists) {
        return 0;
    }

    let removed = 0;
    for await (const filePath of walkFiles(publicIconsDirectory)) {
        const fileName = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
        const match = fileName.match(/^(.+)\.webp$/i);
        if (!match) {
            continue;
        }

        const iconKey = normalizeId(match[1]);
        if (!iconKeys.has(iconKey)) {
            continue;
        }

        await unlink(filePath);
        removed += 1;
        logPublishDetail(`removed co-located-away shared icon ${filePath}`);
    }

    return removed;
}

/**
 * Delete public `/icons/<key>.webp` files that are no longer referenced by the published
 * manifest. Shared-mod co-location leaves blueprint source glyphs here unless pruned.
 */
export async function removeUnreferencedPublicIcons(publicIconsDirectory, referencedIconKeys, {
    pathExists,
    unlink,
    walkFiles,
}) {
    // An empty keep-set would delete the entire pool; only prune when we know what to keep.
    if (!(referencedIconKeys instanceof Set) || referencedIconKeys.size === 0) {
        return 0;
    }

    let directoryExists = false;
    try {
        directoryExists = await pathExists(publicIconsDirectory);
    } catch {
        directoryExists = false;
    }
    if (!directoryExists) {
        return 0;
    }

    let removed = 0;
    for await (const filePath of walkFiles(publicIconsDirectory)) {
        const fileName = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
        const match = fileName.match(/^(.+)\.webp$/i);
        if (!match) {
            continue;
        }

        const iconKey = normalizeId(match[1]);
        if (!iconKey || referencedIconKeys.has(iconKey)) {
            continue;
        }

        await unlink(filePath);
        removed += 1;
        logPublishDetail(`removed unreferenced shared icon ${filePath}`);
    }

    return removed;
}

/**
 * Collect `/icons/<key>` source glyphs used while co-locating shared modification defaults.
 * These are publish inputs, not final publish outputs, once shared folders own the pixels.
 */
export function collectSharedModificationSourceIconKeys(manifest) {
    const keys = new Set();

    function addSourceUrl(value) {
        const iconKey = extractPublishedIconKey(value);
        if (iconKey) {
            keys.add(iconKey);
        }
    }

    const sharedModificationDefaultIconSourceById = manifest?.__sharedModificationDefaultIconSourceById instanceof Map
        ? manifest.__sharedModificationDefaultIconSourceById
        : null;
    if (sharedModificationDefaultIconSourceById) {
        for (const sourceUrl of sharedModificationDefaultIconSourceById.values()) {
            addSourceUrl(sourceUrl);
        }
    }

    const sharedModificationSourceById = manifest?.__sharedModificationSourceById instanceof Map
        ? manifest.__sharedModificationSourceById
        : null;
    if (sharedModificationSourceById) {
        for (const sources of sharedModificationSourceById.values()) {
            addSourceUrl(sources?.defaultIconSourceUrl);
            addSourceUrl(sources?.renderedIconSourceUrl);
        }
    }

    return keys;
}
