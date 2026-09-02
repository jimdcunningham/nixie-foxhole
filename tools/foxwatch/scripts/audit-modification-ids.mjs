import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    buildLegacySharedModificationIdComputation,
    buildSharedModificationIdComputation,
    resolveTemplatePathForSharedModificationIdentity,
} from './shared-modification-id.mjs';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDir, '..', '..', '..');
const defaultManifestPath = resolve(repositoryRoot, 'tools/foxwatch/tmp/foxwatch-manifest.v1.json');
const defaultOutputPath = resolve(repositoryRoot, 'tools/foxwatch/tmp/diagnostics/modification-id-audit.json');

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

function mergeVariantContext(structure, slot, variantId, variant, sourceModification) {
    return {
        ...sourceModification,
        ...variant,
        name: variant?.name ?? sourceModification?.name,
        description: variant?.description ?? sourceModification?.description,
        templateActorPath: variant?.templateActorPath ?? sourceModification?.templateActorPath,
        templateMeshPath: variant?.templateMeshPath ?? sourceModification?.templateMeshPath,
        previewMeshPath: variant?.previewMeshPath ?? sourceModification?.previewMeshPath,
        previewDirection: variant?.previewDirection ?? sourceModification?.previewDirection ?? structure?.previewDirection,
        isUpgrade: variant?.isUpgrade === true || sourceModification?.isUpgrade === true,
    };
}

function resolveSourceModification(structure, variantId, variant) {
    const normalizedVariantId = normalizeId(variantId);
    for (const [modificationId, modification] of Object.entries(structure?.modifications ?? {})) {
        const appliedModificationId = normalizeId(modification?.appliedModificationId ?? modificationId);
        if (appliedModificationId === normalizedVariantId) {
            return modification;
        }
    }

    const appliedModificationId = normalizeId(variant?.appliedModificationId);
    if (appliedModificationId) {
        return structure?.modifications?.[appliedModificationId] ?? null;
    }

    return null;
}

function collectModificationEntries(manifest) {
    const entries = [];

    for (const structure of manifest?.assets ?? []) {
        const structureId = normalizeId(structure?.id);
        if (!structureId) {
            continue;
        }

        for (const slot of structure?.modificationSlots ?? []) {
            const slotName = String(slot?.name ?? '').trim();
            for (const [variantId, variant] of Object.entries(slot?.variants ?? {})) {
                if (normalizeId(variantId) === 'default') {
                    continue;
                }

                const sourceModification = resolveSourceModification(structure, variantId, variant);
                const mergedVariant = mergeVariantContext(structure, slot, variantId, variant, sourceModification);
                const previewDirection = resolvePreviewDirection(mergedVariant, structure);
                const current = buildSharedModificationIdComputation(variantId, mergedVariant, previewDirection);
                const legacy = buildLegacySharedModificationIdComputation(variantId, mergedVariant, previewDirection);

                entries.push({
                    structureId,
                    structureCodeName: structure?.codeName ?? null,
                    slotName,
                    variantId,
                    isUpgrade: mergedVariant.isUpgrade === true,
                    previewDirection,
                    templatePath: resolveTemplatePathForSharedModificationIdentity(mergedVariant) || null,
                    templateActorPath: mergedVariant?.templateActorPath ?? null,
                    templateMeshPath: mergedVariant?.templateMeshPath ?? null,
                    previewMeshPath: mergedVariant?.previewMeshPath ?? null,
                    existingSharedModificationId: normalizeId(variant?.sharedModificationId) || null,
                    generatedSharedModificationId: current.generatedSharedModificationId,
                    legacySharedModificationId: legacy.generatedSharedModificationId,
                    identity: current.identity,
                    legacyIdentity: legacy.identity,
                    idChangedFromLegacy: current.generatedSharedModificationId !== legacy.generatedSharedModificationId,
                    idChangedFromExisting: Boolean(
                        normalizeId(variant?.sharedModificationId)
                        && normalizeId(variant?.sharedModificationId) !== current.generatedSharedModificationId,
                    ),
                });
            }
        }
    }

    return entries.sort((left, right) => {
        return left.generatedSharedModificationId.localeCompare(right.generatedSharedModificationId)
            || left.structureId.localeCompare(right.structureId)
            || left.variantId.localeCompare(right.variantId);
    });
}

function buildCollisionReport(entries) {
    const groups = new Map();

    for (const entry of entries) {
        const key = entry.generatedSharedModificationId;
        const group = groups.get(key) ?? [];
        group.push(entry);
        groups.set(key, group);
    }

    const sharedIdGroups = [];
    const conflictingGroups = [];
    for (const [generatedSharedModificationId, group] of groups.entries()) {
        if (group.length <= 1) {
            continue;
        }

        const uniqueStructures = new Set(group.map(entry => entry.structureId));
        const uniqueTemplatePaths = new Set(group.map(entry => normalizeId(entry.templatePath)));
        const uniqueVariantIds = new Set(group.map(entry => normalizeId(entry.variantId)));
        const groupReport = {
            generatedSharedModificationId,
            consumerCount: group.length,
            structureCount: uniqueStructures.size,
            structures: [...uniqueStructures].sort(),
            variantIds: [...uniqueVariantIds].sort(),
            templatePaths: [...uniqueTemplatePaths].sort(),
            legacySharedModificationIds: [...new Set(group.map(entry => entry.legacySharedModificationId))].sort(),
            entries: group.map(entry => ({
                structureId: entry.structureId,
                slotName: entry.slotName,
                variantId: entry.variantId,
                isUpgrade: entry.isUpgrade,
                previewDirection: entry.previewDirection,
                templatePath: entry.templatePath,
            })),
        };

        sharedIdGroups.push(groupReport);
        if (uniqueTemplatePaths.size > 1 || uniqueVariantIds.size > 1) {
            conflictingGroups.push(groupReport);
        }
    }

    sharedIdGroups.sort((left, right) => right.consumerCount - left.consumerCount);
    conflictingGroups.sort((left, right) => right.consumerCount - left.consumerCount);

    return { sharedIdGroups, conflictingGroups };
}

function printSummary(report) {
    const { summary, sharedIdGroups, conflictingGroups } = report;
    console.log(`Modification ID audit (${summary.manifestPath})`);
    console.log(`Structures: ${summary.structureCount}`);
    console.log(`Modification variants: ${summary.variantCount}`);
    console.log(`Unique generated IDs: ${summary.uniqueGeneratedIdCount}`);
    console.log(`Shared ID groups (multiple slot entries): ${summary.sharedIdGroupsWithMultipleConsumers}`);
    console.log(`Conflicting groups (same ID, different variant/template): ${summary.conflictingGroupCount}`);
    console.log(`Changed from legacy hash: ${summary.changedFromLegacyCount}`);
    console.log(`Changed from existing manifest ID: ${summary.changedFromExistingCount}`);
    console.log(`Missing template path: ${summary.missingTemplatePathCount}`);

    if (sharedIdGroups.length > 0) {
        console.log('\nLargest shared ID groups:');
        for (const group of sharedIdGroups.slice(0, 15)) {
            console.log(`  ${group.generatedSharedModificationId} -> ${group.consumerCount} slot entries across ${group.structureCount} structures (${group.variantIds.join(', ')})`);
        }

        if (sharedIdGroups.length > 15) {
            console.log(`  ... and ${sharedIdGroups.length - 15} more shared groups`);
        }
    }

    if (conflictingGroups.length > 0) {
        console.log('\nConflicting groups:');
        for (const group of conflictingGroups.slice(0, 10)) {
            console.log(`  ${group.generatedSharedModificationId} -> variants=${group.variantIds.join('|')} templates=${group.templatePaths.join('|')}`);
        }
    } else {
        console.log('\nNo conflicting groups detected.');
    }

    console.log(`\nFull report: ${summary.outputPath}`);
}

async function main() {
    const parsedArgs = parseCliArgs(process.argv.slice(2));
    const manifestPath = parsedArgs.manifest?.at(-1)
        ? resolve(repositoryRoot, parsedArgs.manifest.at(-1))
        : defaultManifestPath;
    const outputPath = parsedArgs.output?.at(-1)
        ? resolve(repositoryRoot, parsedArgs.output.at(-1))
        : defaultOutputPath;

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!Array.isArray(manifest?.assets)) {
        throw new Error(`manifest at ${manifestPath} does not use the assets root`);
    }

    const entries = collectModificationEntries(manifest);
    const { sharedIdGroups, conflictingGroups } = buildCollisionReport(entries);
    const uniqueGeneratedIds = new Set(entries.map(entry => entry.generatedSharedModificationId));
    const report = {
        generatedAtUtc: new Date().toISOString(),
        manifestPath,
        entries,
        sharedIdGroups,
        conflictingGroups,
        summary: {
            manifestPath,
            outputPath,
            structureCount: manifest.assets.length,
            variantCount: entries.length,
            uniqueGeneratedIdCount: uniqueGeneratedIds.size,
            sharedIdGroupsWithMultipleConsumers: sharedIdGroups.length,
            conflictingGroupCount: conflictingGroups.length,
            changedFromLegacyCount: entries.filter(entry => entry.idChangedFromLegacy).length,
            changedFromExistingCount: entries.filter(entry => entry.idChangedFromExisting).length,
            missingTemplatePathCount: entries.filter(entry => !entry.templatePath).length,
        },
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    printSummary(report);
}

await main();
