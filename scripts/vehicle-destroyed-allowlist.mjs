import { access, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const vehicleDestroyedWhitelistFileName = 'vehicle-destroyed-whitelist.json';

function normalizeStructureId(value) {
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

async function readJsonObject(filePath) {
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`expected JSON object at ${filePath}`);
    }

    return parsed;
}

export async function loadVehicleDestroyedPublishAllowlist(assetOverridesDirectory) {
    const allowlist = new Set();
    const whitelistPath = resolve(assetOverridesDirectory, vehicleDestroyedWhitelistFileName);
    if (await pathExists(whitelistPath)) {
        const document = await readJsonObject(whitelistPath);
        for (const structureId of document?.structureIds ?? []) {
            const normalizedStructureId = normalizeStructureId(structureId);
            if (normalizedStructureId) {
                allowlist.add(normalizedStructureId);
            }
        }
    }

    let overrideEntries = [];
    try {
        overrideEntries = await readdir(assetOverridesDirectory, { withFileTypes: true });
    } catch {
        return allowlist;
    }

    for (const entry of overrideEntries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const structureId = normalizeStructureId(entry.name);
        if (!structureId) {
            continue;
        }

        const manifestPath = resolve(assetOverridesDirectory, entry.name, 'manifest.json');
        if (!await pathExists(manifestPath)) {
            continue;
        }

        try {
            const overrideManifest = await readJsonObject(manifestPath);
            if (overrideManifest?.publishDestroyedVisuals === true) {
                allowlist.add(structureId);
            }
        } catch {
            // Ignore malformed override manifests during allowlist discovery.
        }
    }

    return allowlist;
}

export function isVehicleDestroyedPublishAllowlisted(structureId, allowlist) {
    const normalizedStructureId = normalizeStructureId(structureId);
    return Boolean(normalizedStructureId && allowlist?.has(normalizedStructureId));
}
