import { access, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { isVehicleDestroyedPublishAllowlisted } from './vehicle-destroyed-allowlist.mjs';

function normalizeId(value) {
    return String(value ?? '').trim().toLowerCase();
}

async function pathExists(filePath) {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

function mergeAuthoredStructurePreviewDirections(authoredPreviewDirectionById, additionalPreviewDirectionsById) {
    for (const [structureId, previewDirection] of additionalPreviewDirectionsById ?? []) {
        if (structureId && previewDirection) {
            authoredPreviewDirectionById.set(structureId, previewDirection);
        }
    }

    return authoredPreviewDirectionById;
}

function normalizeMarkedCargoOverlayAxis(value) {
    if (value === null || typeof value === 'undefined' || value === '') {
        return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeMarkedCargoOverlay(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const offsetX = normalizeMarkedCargoOverlayAxis(value.offsetX);
    const offsetY = normalizeMarkedCargoOverlayAxis(value.offsetY);
    if (typeof offsetX === 'undefined' && typeof offsetY === 'undefined') {
        return null;
    }

    return {
        ...(typeof offsetX === 'number' ? { offsetX } : {}),
        ...(typeof offsetY === 'number' ? { offsetY } : {}),
    };
}

function mergeAuthoredStructureMarkedCargoOverlays(authoredMarkedCargoOverlayById, additionalMarkedCargoOverlaysById) {
    for (const [structureId, markedCargoOverlay] of additionalMarkedCargoOverlaysById ?? []) {
        if (structureId && markedCargoOverlay) {
            authoredMarkedCargoOverlayById.set(structureId, markedCargoOverlay);
        }
    }

    return authoredMarkedCargoOverlayById;
}

export async function loadAuthoredStructureMarkedCargoOverlays(assetOverridesDirectory) {
    const authoredMarkedCargoOverlayById = new Map();
    let overrideEntries = [];
    try {
        overrideEntries = await readdir(assetOverridesDirectory, { withFileTypes: true });
    } catch {
        return authoredMarkedCargoOverlayById;
    }

    for (const entry of overrideEntries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const structureId = normalizeId(entry.name);
        if (!structureId) {
            continue;
        }

        const manifestPath = resolve(assetOverridesDirectory, entry.name, 'manifest.json');
        if (!await pathExists(manifestPath)) {
            continue;
        }

        try {
            const overrideManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
            const markedCargoOverlay = normalizeMarkedCargoOverlay(overrideManifest?.markedCargoOverlay);
            if (markedCargoOverlay) {
                authoredMarkedCargoOverlayById.set(structureId, markedCargoOverlay);
            }
        } catch {
            // Ignore malformed override manifests during marked-cargo overlay discovery.
        }
    }

    return authoredMarkedCargoOverlayById;
}

export function preserveAuthoredStructureMarkedCargoOverlays(
    publishedManifest,
    sourceManifest,
    authoredMarkedCargoOverlayById = new Map(),
) {
    const mergedAuthoredMarkedCargoOverlayById = mergeAuthoredStructureMarkedCargoOverlays(
        new Map(authoredMarkedCargoOverlayById),
        (sourceManifest?.assets ?? [])
            .map(structure => [normalizeId(structure?.id), normalizeMarkedCargoOverlay(structure?.markedCargoOverlay)])
            .filter(([structureId, markedCargoOverlay]) => structureId && markedCargoOverlay),
    );

    return {
        ...publishedManifest,
        assets: (publishedManifest?.assets ?? []).map(structure => {
            const structureId = normalizeId(structure?.id);
            if (!structureId) {
                return structure;
            }

            const authoredMarkedCargoOverlay = mergedAuthoredMarkedCargoOverlayById.get(structureId);
            if (!authoredMarkedCargoOverlay) {
                return structure;
            }

            const publishedMarkedCargoOverlay = normalizeMarkedCargoOverlay(structure?.markedCargoOverlay);
            if (JSON.stringify(publishedMarkedCargoOverlay) === JSON.stringify(authoredMarkedCargoOverlay)) {
                return structure;
            }

            return {
                ...structure,
                markedCargoOverlay: authoredMarkedCargoOverlay,
            };
        }),
    };
}

export async function loadAuthoredStructurePreviewDirections(assetOverridesDirectory) {
    const authoredPreviewDirectionById = new Map();
    let overrideEntries = [];
    try {
        overrideEntries = await readdir(assetOverridesDirectory, { withFileTypes: true });
    } catch {
        return authoredPreviewDirectionById;
    }

    for (const entry of overrideEntries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const structureId = normalizeId(entry.name);
        if (!structureId) {
            continue;
        }

        const manifestPath = resolve(assetOverridesDirectory, entry.name, 'manifest.json');
        if (!await pathExists(manifestPath)) {
            continue;
        }

        try {
            const overrideManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
            const previewDirection = normalizeId(overrideManifest?.previewDirection);
            if (previewDirection) {
                authoredPreviewDirectionById.set(structureId, previewDirection);
            }
        } catch {
            // Ignore malformed override manifests during preview-direction discovery.
        }
    }

    return authoredPreviewDirectionById;
}

export function preserveAuthoredStructurePreviewDirections(
    publishedManifest,
    sourceManifest,
    authoredPreviewDirectionById = new Map(),
) {
    const mergedAuthoredPreviewDirectionById = mergeAuthoredStructurePreviewDirections(
        new Map(authoredPreviewDirectionById),
        (sourceManifest?.assets ?? [])
            .map(structure => [normalizeId(structure?.id), normalizeId(structure?.previewDirection)])
            .filter(([structureId, previewDirection]) => structureId && previewDirection),
    );

    return {
        ...publishedManifest,
        assets: (publishedManifest?.assets ?? []).map(structure => {
            const structureId = normalizeId(structure?.id);
            if (!structureId) {
                return structure;
            }

            const authoredPreviewDirection = mergedAuthoredPreviewDirectionById.get(structureId);
            if (!authoredPreviewDirection || normalizeId(structure?.previewDirection) === authoredPreviewDirection) {
                return structure;
            }

            return {
                ...structure,
                previewDirection: authoredPreviewDirection,
            };
        }),
    };
}

export function shouldPublishVehicleDestroyedVisual(structure, vehicleDestroyedPublishAllowlist) {
    const structureId = normalizeId(structure?.id);
    if (!structureId || structure?.isVehicle !== true) {
        return true;
    }

    return isVehicleDestroyedPublishAllowlisted(structureId, vehicleDestroyedPublishAllowlist);
}

export function augmentTargetedOnlyPublishedStructures(filteredManifest, publishedManifest, filter) {
    if (!filter?.only?.size || !publishedManifest) {
        return filteredManifest;
    }

    const filteredIds = new Set((filteredManifest?.assets ?? [])
        .map(structure => normalizeId(structure?.id))
        .filter(Boolean));
    const publishedById = new Map((publishedManifest?.assets ?? [])
        .map(structure => {
            const structureId = normalizeId(structure?.id);
            return structureId ? [structureId, structure] : null;
        })
        .filter(Boolean));

    const augmentedAssets = [...(filteredManifest?.assets ?? [])];
    for (const onlyId of filter.only) {
        if (filteredIds.has(onlyId)) {
            continue;
        }

        const publishedStructure = publishedById.get(onlyId);
        if (!publishedStructure) {
            continue;
        }

        augmentedAssets.push(publishedStructure);
        filteredIds.add(onlyId);
    }

    return {
        ...filteredManifest,
        assets: augmentedAssets,
    };
}

export function getExplicitlyRemovedStructureIdsForTargetedPublish() {
    return new Set();
}
