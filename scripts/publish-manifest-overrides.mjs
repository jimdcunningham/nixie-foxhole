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
