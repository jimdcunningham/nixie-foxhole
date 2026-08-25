const DEFAULT_MAX_SCENES_PER_BATCH = 50;

export function resolveBlenderBatchSceneLimit(rawValue) {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
        return DEFAULT_MAX_SCENES_PER_BATCH;
    }

    const parsedValue = Number(rawValue);
    if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
        throw new Error(`FOXWATCH_BLENDER_BATCH_SCENES must be a positive integer, received '${rawValue}'`);
    }

    return parsedValue;
}

export function createBlenderSceneBatches(indexDocument, options = {}) {
    const maxScenes = options.maxScenes ?? DEFAULT_MAX_SCENES_PER_BATCH;
    if (!Number.isSafeInteger(maxScenes) || maxScenes <= 0) {
        throw new Error(`Blender batch scene limit must be a positive integer, received '${maxScenes}'`);
    }

    const scenes = indexDocument?.scenes;
    if (!Array.isArray(scenes)) {
        throw new Error('FoxWatch render scene index must contain a scenes array');
    }

    const groupsByStructure = new Map();
    const seenSceneEntries = new Set();
    for (const scene of scenes) {
        const sceneEntry = String(scene?.outputPath ?? '').replace(/\\/g, '/').trim();
        if (!sceneEntry) {
            throw new Error('FoxWatch render scene index contains an entry without outputPath');
        }
        if (seenSceneEntries.has(sceneEntry)) {
            throw new Error(`FoxWatch render scene index contains duplicate outputPath '${sceneEntry}'`);
        }
        seenSceneEntries.add(sceneEntry);

        const structureId = String(scene?.structureId ?? '').trim().toLowerCase();
        const dependencyGroup = structureId || `scene:${sceneEntry}`;
        let group = groupsByStructure.get(dependencyGroup);
        if (!group) {
            group = { dependencyGroup, sceneEntries: [] };
            groupsByStructure.set(dependencyGroup, group);
        }
        group.sceneEntries.push(sceneEntry);
    }

    const batches = [];
    let currentBatch = null;
    for (const group of groupsByStructure.values()) {
        if (currentBatch && currentBatch.sceneEntries.length + group.sceneEntries.length > maxScenes) {
            batches.push(currentBatch);
            currentBatch = null;
        }

        if (!currentBatch) {
            currentBatch = { dependencyGroups: [], sceneEntries: [] };
        }
        currentBatch.dependencyGroups.push(group.dependencyGroup);
        currentBatch.sceneEntries.push(...group.sceneEntries);

        if (currentBatch.sceneEntries.length >= maxScenes) {
            batches.push(currentBatch);
            currentBatch = null;
        }
    }

    if (currentBatch) {
        batches.push(currentBatch);
    }

    return batches;
}
