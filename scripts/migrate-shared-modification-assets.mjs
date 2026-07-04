import { access, cp, mkdir, readFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    buildLegacySharedModificationIdComputation,
    buildSharedModificationIdComputation,
} from './shared-modification-id.mjs';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDir, '..', '..', '..');
const defaultManifestPath = resolve(repositoryRoot, 'tools/foxwatch/tmp/foxwatch-manifest.v1.json');
const defaultSharedModificationsDirectory = resolve(
    repositoryRoot,
    'apps/foxhole-planner/public/foxhole/assets/shared/modifications',
);

function parseCliArgs(rawArgs) {
    const parsed = { _: [] };

    for (let index = 0; index < rawArgs.length; index += 1) {
        const current = rawArgs[index];
        if (!current.startsWith('--')) {
            parsed._.push(current);
            continue;
        }

        const key = current.slice(2);
        parsed[key] ??= [];

        const next = rawArgs[index + 1];
        if (!next || next.startsWith('--')) {
            parsed[key] = parsed[key] ?? true;
            continue;
        }

        parsed[key].push(next);
        index += 1;
    }

    return parsed;
}

function normalizeId(value) {
    return String(value ?? '').trim().toLowerCase();
}

function resolvePreviewDirection(variant, structure) {
    return normalizeId(variant?.previewDirection) || normalizeId(structure?.previewDirection) || 'se';
}

function resolveSourceModification(structure, variantId) {
    const normalizedVariantId = normalizeId(variantId);
    for (const [modificationId, modification] of Object.entries(structure?.modifications ?? {})) {
        const appliedModificationId = normalizeId(modification?.appliedModificationId ?? modificationId);
        if (appliedModificationId === normalizedVariantId) {
            return modification;
        }
    }

    return null;
}

function collectLegacyToNewMappings(manifest) {
    const mappings = new Map();

    for (const structure of manifest?.assets ?? []) {
        for (const slot of structure?.modificationSlots ?? []) {
            for (const [variantId, variant] of Object.entries(slot?.variants ?? {})) {
                if (normalizeId(variantId) === 'default') {
                    continue;
                }

                const sourceModification = resolveSourceModification(structure, variantId);
                const mergedVariant = {
                    ...sourceModification,
                    ...variant,
                };
                const previewDirection = resolvePreviewDirection(mergedVariant, structure);
                const current = buildSharedModificationIdComputation(variantId, mergedVariant, previewDirection);
                const legacy = buildLegacySharedModificationIdComputation(variantId, mergedVariant, previewDirection);
                if (legacy.generatedSharedModificationId !== current.generatedSharedModificationId) {
                    mappings.set(legacy.generatedSharedModificationId, current.generatedSharedModificationId);
                }
            }
        }
    }

    return mappings;
}

async function pathExists(targetPath) {
    try {
        await access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function migrateDirectory(sourceDirectory, targetDirectory, dryRun) {
    if (!await pathExists(sourceDirectory)) {
        return { status: 'missing-source' };
    }

    if (await pathExists(targetDirectory)) {
        return { status: 'target-exists' };
    }

    if (dryRun) {
        return { status: 'would-migrate' };
    }

    await mkdir(dirname(targetDirectory), { recursive: true });
    try {
        await rename(sourceDirectory, targetDirectory);
        return { status: 'renamed' };
    } catch {
        await cp(sourceDirectory, targetDirectory, { recursive: true });
        return { status: 'copied' };
    }
}

async function main() {
    const parsedArgs = parseCliArgs(process.argv.slice(2));
    const dryRun = Object.hasOwn(parsedArgs, 'dry-run');
    const manifestPath = parsedArgs.manifest?.at(-1)
        ? resolve(repositoryRoot, parsedArgs.manifest.at(-1))
        : defaultManifestPath;
    const sharedModificationsDirectory = parsedArgs['shared-modifications-dir']?.at(-1)
        ? resolve(repositoryRoot, parsedArgs['shared-modifications-dir'].at(-1))
        : defaultSharedModificationsDirectory;

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const mappings = collectLegacyToNewMappings(manifest);
    const results = [];

    for (const [legacyId, nextId] of [...mappings.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
        const sourceDirectory = resolve(sharedModificationsDirectory, legacyId);
        const targetDirectory = resolve(sharedModificationsDirectory, nextId);
        const outcome = await migrateDirectory(sourceDirectory, targetDirectory, dryRun);
        results.push({
            legacyId,
            nextId,
            ...outcome,
        });
    }

    const summary = {
        dryRun,
        manifestPath,
        sharedModificationsDirectory,
        mappingCount: mappings.size,
        renamed: results.filter(entry => entry.status === 'renamed').length,
        copied: results.filter(entry => entry.status === 'copied').length,
        wouldMigrate: results.filter(entry => entry.status === 'would-migrate').length,
        targetExists: results.filter(entry => entry.status === 'target-exists').length,
        missingSource: results.filter(entry => entry.status === 'missing-source').length,
    };

    console.log(`Shared modification asset migration${dryRun ? ' (dry run)' : ''}`);
    console.log(`Mappings: ${summary.mappingCount}`);
    console.log(`Renamed: ${summary.renamed}, copied: ${summary.copied}, target exists: ${summary.targetExists}, missing source: ${summary.missingSource}`);
    if (dryRun) {
        console.log(`Would migrate: ${summary.wouldMigrate}`);
        for (const entry of results.filter(result => result.status === 'would-migrate')) {
            console.log(`  ${entry.legacyId} -> ${entry.nextId}`);
        }
    }
}

await main();
