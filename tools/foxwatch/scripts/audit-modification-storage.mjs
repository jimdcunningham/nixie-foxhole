import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    extractCanonicalGlobalModificationRoots,
    planModificationStorageForRenderIdGroup,
    summarizeModificationStoragePlan,
} from './modification-storage-policy.mjs';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDir, '..', '..', '..');
const defaultRendersDirectory = resolve(repositoryRoot, 'tools/foxwatch/tmp/renders');
const defaultRenderScenesIndexPath = resolve(defaultRendersDirectory, 'index.render-scenes.v1.json');

function normalizeId(value) {
    return String(value ?? '').trim().toLowerCase();
}

function parseCliArgs(rawArgs) {
    const parsed = { _: [] };
    for (let index = 0; index < rawArgs.length; index += 1) {
        const current = rawArgs[index];
        if (!current.startsWith('--')) {
            parsed._.push(current);
            continue;
        }
        const key = current.slice(2);
        const next = rawArgs[index + 1];
        if (!next || next.startsWith('--')) {
            parsed[key] = true;
            continue;
        }
        parsed[key] = next;
        index += 1;
    }
    return parsed;
}

async function pathExists(filePath) {
    try {
        await stat(filePath);
        return true;
    } catch {
        return false;
    }
}

async function walkFiles(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...await walkFiles(fullPath));
            continue;
        }
        files.push(fullPath);
    }
    return files;
}

function normalizeNode(node, meshById, matById) {
    if (!node || typeof node !== 'object') {
        return null;
    }

    return {
        visible: node.visible === true,
        variantIds: [...(node.variantIds ?? [])].map(normalizeId).sort(),
        mesh: node.meshId
            ? (meshById.get(normalizeId(node.meshId)) ?? String(node.meshId))
            : null,
        materials: (node.materialIds ?? [])
            .map(materialId => matById.get(normalizeId(materialId)) ?? String(materialId))
            .sort(),
        location: node.location ?? null,
        rotationEulerDegrees: node.rotationEulerDegrees ?? null,
        scale: node.scale ?? null,
        unrealLocationCentimeters: node.unrealLocationCentimeters ?? null,
        unrealSceneLocationCentimeters: node.unrealSceneLocationCentimeters ?? null,
        unrealRotationDegrees: node.unrealRotationDegrees ?? null,
        children: (node.children ?? []).map(child => normalizeNode(child, meshById, matById)),
    };
}

function createApproxSceneFingerprint(document) {
    const meshById = new Map();
    for (const mesh of document?.assets?.meshes ?? []) {
        meshById.set(normalizeId(mesh.id), JSON.stringify({
            sourcePath: mesh.sourcePath ?? null,
            exportUrl: mesh.exportUrl ?? null,
        }));
    }
    const matById = new Map();
    for (const material of document?.assets?.materials ?? []) {
        matById.set(normalizeId(material.id), JSON.stringify({
            name: material.name ?? null,
            textures: material.textures ?? null,
        }));
    }

    const normalized = {
        render: {
            modes: [...(document?.render?.modes ?? [])].map(normalizeId).sort(),
            previewDirection: normalizeId(document?.render?.previewDirection),
            transparentBackground: document?.render?.transparentBackground ?? null,
            clipFloor: document?.render?.clipFloor ?? null,
            floorZ: document?.render?.floorZ ?? null,
            materialMode: normalizeId(document?.render?.materialMode),
        },
        roots: (document?.scene?.roots ?? []).map(root => normalizeNode(root, meshById, matById)),
    };

    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 16);
}

function isUpgradeConsumer(consumers = []) {
    return consumers.some(consumer => {
        const slotName = normalizeId(consumer?.slotName);
        return slotName.includes('upgradeslot');
    });
}

function expectedPublicPath(planEntry) {
    if (planEntry.storage === 'shared') {
        return `shared/modifications/${planEntry.renderId}/`;
    }
    return `types/structures/${normalizeId(planEntry.structureId)}/modifications/${normalizeId(planEntry.variantId)}/`;
}

async function loadModificationSceneDocuments(rendersDirectory, renderScenesIndexPath) {
    const index = JSON.parse(await readFile(renderScenesIndexPath, 'utf8'));
    const scenes = Array.isArray(index?.scenes) ? index.scenes : [];
    const documents = [];

    for (const entry of scenes) {
        const outputPath = String(entry?.outputPath ?? '').replace(/\\/g, '/');
        if (!outputPath.includes('/modifications/') && !outputPath.startsWith('mods/')) {
            continue;
        }
        if (outputPath.includes('/components/')) {
            continue;
        }

        const absolutePath = resolve(rendersDirectory, outputPath);
        if (!await pathExists(absolutePath)) {
            continue;
        }

        const sceneDocument = JSON.parse(await readFile(absolutePath, 'utf8'));
        const renderId = normalizeId(entry?.renderId)
            || normalizeId(basename(outputPath, '.scene.json'));
        const structureId = normalizeId(entry?.structureId)
            || normalizeId(outputPath.split('/')[0]);
        const consumers = Array.isArray(entry?.consumers) ? entry.consumers : [];
        const isUpgrade = isUpgradeConsumer(consumers);
        const variantId = normalizeId(consumers[0]?.variantId)
            || normalizeId(renderId.split('-')[0]);
        const canonicalRoots = isUpgrade
            ? []
            : extractCanonicalGlobalModificationRoots(sceneDocument?.scene?.roots, variantId);
        const documentForFingerprint = canonicalRoots.length > 0
            ? {
                ...sceneDocument,
                scene: {
                    ...(sceneDocument.scene ?? {}),
                    roots: canonicalRoots,
                },
            }
            : sceneDocument;

        documents.push({
            structureId,
            renderId,
            variantId,
            isUpgrade,
            fingerprint: createApproxSceneFingerprint(documentForFingerprint),
            outputPath,
            consumers,
        });
    }

    return documents;
}

function planAllRenderIds(documents) {
    const byRenderId = new Map();
    for (const document of documents) {
        const renderId = normalizeId(document.renderId);
        if (!renderId) {
            continue;
        }
        if (!byRenderId.has(renderId)) {
            byRenderId.set(renderId, []);
        }
        byRenderId.get(renderId).push(document);
    }

    const plans = [];
    for (const [renderId, group] of [...byRenderId.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
        const indexStorage = group.some(document => normalizeId(document.structureId) === 'mods')
            ? 'shared'
            : null;
        const indexConsumerStructureIds = group.flatMap(document => (
            (document.consumers ?? []).map(consumer => consumer.structureId)
        ));
        plans.push(...planModificationStorageForRenderIdGroup(group, {
            renderId,
            indexStorage,
            indexConsumerStructureIds,
        }));
    }
    return plans;
}

function assertExpectedContracts(plans) {
    const failures = [];
    const sharedUpgrade = plans.filter(entry => (
        entry.storage === 'shared'
        && entry.reason === 'upgrade-never-shared'
    ));
    if (sharedUpgrade.length > 0) {
        failures.push(`upgrades planned as shared: ${sharedUpgrade.map(entry => entry.renderId).join(', ')}`);
    }

    const desk = plans.find(entry => entry.renderId === 'desk-a7a2ff0d194a');
    if (desk && desk.storage !== 'shared') {
        failures.push(`desk-a7a2ff0d194a expected shared, got ${desk.storage} (${desk.reason})`);
    }

    const insulationHost = plans.filter(entry => (
        entry.renderId === 'insulation-24d1abd82849' && entry.storage === 'shared'
    ));
    if (insulationHost.length > 0) {
        failures.push('insulation-24d1abd82849 must stay host-local for upgrades');
    }

    const coke = plans.filter(entry => (
        entry.renderId?.startsWith('cokefurnace-') && entry.storage === 'shared'
    ));
    if (coke.length > 0) {
        failures.push(`cokefurnace upgrade planned as shared: ${coke.map(entry => entry.renderId).join(', ')}`);
    }

    return failures;
}

async function main() {
    const args = parseCliArgs(process.argv.slice(2));
    const rendersDirectory = resolve(String(args.renders ?? defaultRendersDirectory));
    const renderScenesIndexPath = resolve(String(args.index ?? defaultRenderScenesIndexPath));

    if (!await pathExists(renderScenesIndexPath)) {
        console.error(`missing render scenes index: ${renderScenesIndexPath}`);
        process.exit(2);
    }

    const documents = await loadModificationSceneDocuments(rendersDirectory, renderScenesIndexPath);
    const plans = planAllRenderIds(documents);
    const summary = summarizeModificationStoragePlan(plans);
    const failures = assertExpectedContracts(plans);

    const sharedSamples = plans
        .filter(entry => entry.storage === 'shared')
        .slice(0, 20)
        .map(entry => ({
            renderId: entry.renderId,
            path: expectedPublicPath(entry),
            consumers: entry.consumerStructureIds?.length ?? 0,
            reason: entry.reason,
            representative: entry.representativeStructureId,
        }));

    const hostUpgradeSamples = plans
        .filter(entry => entry.storage === 'host' && entry.reason === 'upgrade-never-shared')
        .slice(0, 20)
        .map(entry => ({
            renderId: entry.renderId,
            structureId: entry.structureId,
            path: expectedPublicPath(entry),
        }));

    const report = {
        rendersDirectory: relative(repositoryRoot, rendersDirectory).replace(/\\/g, '/'),
        documentCount: documents.length,
        plannedSharedRenderIds: summary.sharedCount,
        plannedHostDocuments: summary.hostCount,
        sharedSamples,
        hostUpgradeSamples,
        failures,
    };

    console.log(JSON.stringify(report, null, 2));

    if (failures.length > 0) {
        console.error(`modification-storage audit failed with ${failures.length} contract violation(s)`);
        process.exit(1);
    }
}

await main();
