import fs from 'node:fs/promises';
import path from 'node:path';

export const MEBIBYTE = 1024 * 1024;
export const DEFAULT_BLENDER_BATCH_LIMITS = Object.freeze({
    maxScenes: 32,
    maxMeshBytes: 64 * MEBIBYTE,
    maxNodes: 600,
    maxDefaultIcons: 8,
    heavyMeshBytes: 64 * MEBIBYTE,
    heavyNodes: 600,
});

export function resolveBlenderBatchSceneLimit(rawValue) {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
        return DEFAULT_BLENDER_BATCH_LIMITS.maxScenes;
    }

    const parsedValue = Number(rawValue);
    if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
        throw new Error(`FOXWATCH_BLENDER_BATCH_SCENES must be a positive integer, received '${rawValue}'`);
    }

    return parsedValue;
}

export function createBlenderSceneBatches(indexDocument, options = {}) {
    const groups = createBlenderDependencyGroups(indexDocument).map(group => ({
        ...group,
        uniqueMeshBytes: 0,
        nodeCount: 0,
        defaultIconCount: 0,
        heavy: false,
    }));
    return createWeightedBlenderBatches(groups, {
        ...DEFAULT_BLENDER_BATCH_LIMITS,
        ...options,
        heavyMeshBytes: Number.MAX_SAFE_INTEGER,
        heavyNodes: Number.MAX_SAFE_INTEGER,
    }).map(batch => ({
        dependencyGroups: batch.dependencyGroups,
        sceneEntries: batch.sceneEntries,
    }));
}

export function createBlenderDependencyGroups(indexDocument) {
    const scenes = indexDocument?.scenes;
    if (!Array.isArray(scenes)) {
        throw new Error('FoxWatch render scene index must contain a scenes array');
    }

    const groupsByStructure = new Map();
    const seenSceneEntries = new Set();
    for (const scene of scenes) {
        const sceneEntry = normalizeSceneEntry(scene?.outputPath);
        if (!sceneEntry) {
            throw new Error('FoxWatch render scene index contains an entry without outputPath');
        }
        const sceneKey = sceneEntry.toLowerCase();
        if (seenSceneEntries.has(sceneKey)) {
            throw new Error(`FoxWatch render scene index contains duplicate outputPath '${sceneEntry}'`);
        }
        seenSceneEntries.add(sceneKey);

        const structureId = String(scene?.structureId ?? '').trim().toLowerCase();
        const dependencyGroup = structureId || `scene:${sceneEntry}`;
        let group = groupsByStructure.get(dependencyGroup);
        if (!group) {
            group = { dependencyGroup, sceneEntries: [], indexEntries: [] };
            groupsByStructure.set(dependencyGroup, group);
        }
        group.sceneEntries.push(sceneEntry);
        group.indexEntries.push(scene);
    }
    return [...groupsByStructure.values()];
}

export async function analyzeBlenderSceneIndex(indexDocument, options) {
    const renderDataRoot = path.resolve(options.renderDataRoot);
    const foxwatchOutputRoot = path.resolve(options.foxwatchOutputRoot);
    const readJson = options.readJson ?? (async filePath => JSON.parse(await fs.readFile(filePath, 'utf8')));
    const stat = options.stat ?? fs.stat;
    const groups = createBlenderDependencyGroups(indexDocument);
    const sceneDocuments = new Map();
    const sourceSizeCache = new Map();
    const outputOwners = new Map();

    for (const group of groups) {
        const uniqueMeshSources = new Set();
        let nodeCount = 0;
        let defaultIconCount = 0;
        for (const sceneEntry of group.sceneEntries) {
            const scenePath = path.resolve(renderDataRoot, ...sceneEntry.split('/'));
            if (!isPathInside(renderDataRoot, scenePath)) {
                throw new Error(`Render scene entry escapes render root: '${sceneEntry}'`);
            }
            const document = await readJson(scenePath);
            sceneDocuments.set(sceneEntry, document);
            nodeCount += countSceneNodes(document?.scene?.roots);
            const variants = Array.isArray(document?.variants) ? document.variants.filter(variant => variant?.id) : [];
            if (document?.render?.generateDefaultIcon && variants.length === 0) {
                defaultIconCount += 1;
            }
            for (const mesh of document?.assets?.meshes ?? []) {
                const sourcePath = String(mesh?.exportUrl ?? mesh?.sourcePath ?? '')
                    .replace(/\\/g, '/')
                    .replace(/^\/+/, '')
                    .trim();
                if (sourcePath) {
                    uniqueMeshSources.add(sourcePath);
                }
            }
            registerPlannedOutputs(document, sceneEntry, outputOwners);
        }

        let uniqueMeshBytes = 0;
        const meshSources = [];
        for (const sourcePath of uniqueMeshSources) {
            if (!sourceSizeCache.has(sourcePath)) {
                const filePath = path.resolve(foxwatchOutputRoot, ...sourcePath.split('/'));
                let size = 0;
                if (isPathInside(foxwatchOutputRoot, filePath)) {
                    try {
                        size = (await stat(filePath)).size;
                    } catch (error) {
                        if (error?.code !== 'ENOENT') {
                            throw error;
                        }
                    }
                }
                sourceSizeCache.set(sourcePath, size);
            }
            const size = sourceSizeCache.get(sourcePath);
            uniqueMeshBytes += size;
            meshSources.push({ path: sourcePath, size });
        }

        Object.assign(group, {
            uniqueMeshBytes,
            meshSources,
            nodeCount,
            defaultIconCount,
            heavy: uniqueMeshBytes >= DEFAULT_BLENDER_BATCH_LIMITS.heavyMeshBytes
                || nodeCount >= DEFAULT_BLENDER_BATCH_LIMITS.heavyNodes,
        });
    }
    return { groups, sceneDocuments };
}

export function createWeightedBlenderBatches(groups, options = {}) {
    const limits = { ...DEFAULT_BLENDER_BATCH_LIMITS, ...options };
    validateLimits(limits);
    const batches = [];
    let currentBatch = null;

    for (const group of groups) {
        const normalizedGroup = {
            ...group,
            sceneEntries: [...group.sceneEntries],
            uniqueMeshBytes: Number(group.uniqueMeshBytes ?? 0),
            nodeCount: Number(group.nodeCount ?? 0),
            defaultIconCount: Number(group.defaultIconCount ?? 0),
            meshSources: Array.isArray(group.meshSources) ? group.meshSources : null,
        };
        normalizedGroup.heavy = Boolean(group.heavy)
            || normalizedGroup.uniqueMeshBytes >= limits.heavyMeshBytes
            || normalizedGroup.nodeCount >= limits.heavyNodes;
        const oversized = exceedsOrdinaryLimits(normalizedGroup, limits);

        if (normalizedGroup.heavy || oversized) {
            if (currentBatch) {
                batches.push(currentBatch);
                currentBatch = null;
            }
            batches.push(createBatch([normalizedGroup], { exclusive: true, heavy: normalizedGroup.heavy }));
            continue;
        }

        if (currentBatch && wouldExceedBatch(currentBatch, normalizedGroup, limits)) {
            batches.push(currentBatch);
            currentBatch = null;
        }
        if (!currentBatch) {
            currentBatch = createBatch([]);
        }
        appendGroup(currentBatch, normalizedGroup);
    }

    if (currentBatch) {
        batches.push(currentBatch);
    }
    return batches;
}

export function orderBlenderGroupsByObservedCost(groups, history) {
    return groups
        .map((group, index) => ({
            group,
            index,
            estimateMs: Number(history?.groups?.[group.dependencyGroup]?.estimateMs ?? 0),
        }))
        .sort((left, right) => right.estimateMs - left.estimateMs || left.index - right.index)
        .map(entry => entry.group);
}

export function validateBlenderOutputOwnership(sceneDocuments) {
    const owners = new Map();
    for (const [sceneEntry, document] of sceneDocuments) {
        registerPlannedOutputs(document, sceneEntry, owners);
    }
    return owners.size;
}

function registerPlannedOutputs(document, sceneEntry, owners) {
    const structureId = String(document?.structure?.id ?? '').trim().toLowerCase();
    const assetType = normalizeAssetType(document?.structure?.assetType);
    const outputKey = String(document?.render?.outputKey ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
    if (!structureId || !outputKey) {
        throw new Error(`Render scene '${sceneEntry}' does not define structure.id and render.outputKey`);
    }
    const modes = document?.render?.modes?.length ? document.render.modes : ['topdown', 'preview'];
    const variants = document?.variants?.length
        ? document.variants.map(variant => String(variant?.id ?? '').trim().toLowerCase()).filter(Boolean)
        : [''];
    for (const variant of variants) {
        for (const rawMode of modes) {
            const mode = String(rawMode).trim().toLowerCase();
            registerOutputOwner(owners, `${assetType}/${structureId}/${outputKey}|${mode}|${variant}`, sceneEntry);
        }
    }
    if (document?.render?.generateDefaultIcon && variants.length === 1 && variants[0] === '' && modes.some(mode => String(mode).toLowerCase() === 'preview')) {
        registerOutputOwner(owners, `${assetType}/${structureId}/${outputKey}|icon.default|`, sceneEntry);
    }
}

function registerOutputOwner(owners, output, sceneEntry) {
    const existingOwner = owners.get(output);
    if (existingOwner && existingOwner !== sceneEntry) {
        throw new Error(`Blender output collision '${output}' is planned by '${existingOwner}' and '${sceneEntry}'`);
    }
    owners.set(output, sceneEntry);
}

function countSceneNodes(nodes) {
    if (!Array.isArray(nodes)) {
        return 0;
    }
    return nodes.reduce((total, node) => total + 1 + countSceneNodes(node?.children), 0);
}

function createBatch(groups, options = {}) {
    const batch = {
        dependencyGroups: [],
        sceneEntries: [],
        uniqueMeshBytes: 0,
        nodeCount: 0,
        defaultIconCount: 0,
        exclusive: Boolean(options.exclusive),
        heavy: Boolean(options.heavy),
        _meshSourceSizes: new Map(),
    };
    for (const group of groups) {
        appendGroup(batch, group);
    }
    return batch;
}

function appendGroup(batch, group) {
    batch.dependencyGroups.push(group.dependencyGroup);
    batch.sceneEntries.push(...group.sceneEntries);
    if (group.meshSources) {
        for (const source of group.meshSources) {
            if (!batch._meshSourceSizes.has(source.path)) {
                batch._meshSourceSizes.set(source.path, source.size);
                batch.uniqueMeshBytes += source.size;
            }
        }
    } else {
        batch.uniqueMeshBytes += group.uniqueMeshBytes;
    }
    batch.nodeCount += group.nodeCount;
    batch.defaultIconCount += group.defaultIconCount;
}

function wouldExceedBatch(batch, group, limits) {
    return batch.sceneEntries.length + group.sceneEntries.length > limits.maxScenes
        || batch.uniqueMeshBytes + additionalMeshBytes(batch, group) > limits.maxMeshBytes
        || batch.nodeCount + group.nodeCount > limits.maxNodes
        || batch.defaultIconCount + group.defaultIconCount > limits.maxDefaultIcons;
}

function additionalMeshBytes(batch, group) {
    if (!group.meshSources) {
        return group.uniqueMeshBytes;
    }
    return group.meshSources.reduce(
        (total, source) => total + (batch._meshSourceSizes.has(source.path) ? 0 : source.size),
        0,
    );
}

function exceedsOrdinaryLimits(group, limits) {
    return group.sceneEntries.length > limits.maxScenes
        || group.uniqueMeshBytes > limits.maxMeshBytes
        || group.nodeCount > limits.maxNodes
        || group.defaultIconCount > limits.maxDefaultIcons;
}

function validateLimits(limits) {
    for (const key of ['maxScenes', 'maxMeshBytes', 'maxNodes', 'maxDefaultIcons', 'heavyMeshBytes', 'heavyNodes']) {
        if (!Number.isFinite(limits[key]) || limits[key] <= 0) {
            throw new Error(`Blender batch ${key} must be positive, received '${limits[key]}'`);
        }
    }
}

function normalizeSceneEntry(value) {
    return String(value ?? '').replace(/\\/g, '/').trim();
}

function normalizeAssetType(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'item' || normalized === 'items') return 'items';
    if (normalized === 'vehicle' || normalized === 'vehicles') return 'vehicles';
    return 'structures';
}

function isPathInside(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
