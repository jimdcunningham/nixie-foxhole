export const GIBIBYTE = 1024 ** 3;
export const MINIMUM_DUAL_WORKER_TOTAL_MEMORY = 24 * GIBIBYTE;
export const MINIMUM_SECOND_WORKER_AVAILABLE_MEMORY = 12 * GIBIBYTE;
// Pair batches by their combined footprint. This lets a light batch use W2
// while W1 handles a larger batch without ever pairing two maximum-size jobs.
export const MAXIMUM_CONCURRENT_BLENDER_MESH_BYTES = 80 * 1024 * 1024;
export const MAXIMUM_CONCURRENT_BLENDER_NODES = 800;
export const MAXIMUM_CONCURRENT_BLENDER_DEFAULT_ICONS = 10;
export const BLENDER_RECYCLE_RSS_BYTES = 6 * GIBIBYTE;
export const BLENDER_RECYCLE_PRIVATE_BYTES = 8 * GIBIBYTE;
export const BLENDER_PROGRESS_PREFIX = 'FOXWATCH_BLENDER_PROGRESS ';

const IMPORTANT_BLENDER_LINE = /\b(?:warn(?:ing)?|error|traceback|exception|failed?|missing|fatal|crash|out of memory)\b/i;
const ROUTINE_BLENDER_LINES = [
    /^Blender \d/i,
    /^\s*\d{2}:\d{2}\.\d+\s+blend\s+\|\s+Read blend:/i,
    /^\d{2}:\d{2}:\d{2}\s+\|\s+INFO:\s+Data are loaded, start creating Blender stuff\s*$/i,
    /^\d{2}:\d{2}:\d{2}\s+\|\s+INFO:\s+Blender create Mesh node\b/i,
    /^\d{2}:\d{2}:\d{2}\s+\|\s+INFO:\s+glTF import finished in\b/i,
    /^\s*\d{2}:\d{2}\.\d+\s+render\s+\|\s+Saved:/i,
    /^Applying debug color\b/i,
    /^render_render_scenes:\s+rendered\s+\d+\s+structure\(s\)/i,
    /^Blender quit\s*$/i,
];

export function resolveBlenderWorkerCount(cliValue, environmentValue, totalMemoryBytes) {
    const rawValue = cliValue ?? environmentValue;
    if (rawValue === undefined || rawValue === null || rawValue === '') {
        return totalMemoryBytes >= MINIMUM_DUAL_WORKER_TOTAL_MEMORY ? 2 : 1;
    }
    const parsedValue = Number(rawValue);
    if (!Number.isSafeInteger(parsedValue) || (parsedValue !== 1 && parsedValue !== 2)) {
        throw new Error(`--blender-workers must be 1 or 2, received '${rawValue}'`);
    }
    return parsedValue;
}

export function canLaunchSecondBlenderWorker(availableMemoryBytes) {
    return availableMemoryBytes >= MINIMUM_SECOND_WORKER_AVAILABLE_MEMORY;
}

export function canRunBlenderBatchesConcurrently(left, right) {
    return !left?.exclusive
        && !right?.exclusive
        && Number(left?.uniqueMeshBytes ?? 0) + Number(right?.uniqueMeshBytes ?? 0)
            <= MAXIMUM_CONCURRENT_BLENDER_MESH_BYTES
        && Number(left?.nodeCount ?? 0) + Number(right?.nodeCount ?? 0)
            <= MAXIMUM_CONCURRENT_BLENDER_NODES
        && Number(left?.defaultIconCount ?? 0) + Number(right?.defaultIconCount ?? 0)
            <= MAXIMUM_CONCURRENT_BLENDER_DEFAULT_ICONS;
}

export function dequeueNextConcurrentBlenderBatch(queue, activeBatch) {
    const batchIndex = queue.findIndex(batch => canRunBlenderBatchesConcurrently(activeBatch, batch));
    if (batchIndex < 0) {
        return null;
    }
    return queue.splice(batchIndex, 1)[0];
}

export function describeConcurrentBlenderWait(activeBatch, queue) {
    const plannedBatchNumber = Number(activeBatch?.plannedBatchNumber ?? 0);
    const batchLabel = plannedBatchNumber > 0 ? `planned batch ${plannedBatchNumber}` : 'the active batch';
    if (activeBatch?.exclusive) {
        return `${capitalize(batchLabel)} must run alone.`;
    }
    if (!Array.isArray(queue) || queue.length === 0) {
        return `No queued batches remain; waiting for ${batchLabel} to finish.`;
    }
    if (queue.some(batch => canRunBlenderBatchesConcurrently(activeBatch, batch))) {
        return null;
    }

    const blockers = new Set();
    for (const batch of queue) {
        if (batch?.exclusive) {
            blockers.add('exclusive batches');
        }
        if (Number(activeBatch?.uniqueMeshBytes ?? 0) + Number(batch?.uniqueMeshBytes ?? 0)
            > MAXIMUM_CONCURRENT_BLENDER_MESH_BYTES) {
            blockers.add('the 80 MiB mesh limit');
        }
        if (Number(activeBatch?.nodeCount ?? 0) + Number(batch?.nodeCount ?? 0)
            > MAXIMUM_CONCURRENT_BLENDER_NODES) {
            blockers.add('the 800-node limit');
        }
        if (Number(activeBatch?.defaultIconCount ?? 0) + Number(batch?.defaultIconCount ?? 0)
            > MAXIMUM_CONCURRENT_BLENDER_DEFAULT_ICONS) {
            blockers.add('the 10-icon limit');
        }
    }
    const blockerList = [...blockers];
    const reason = blockerList.length > 0
        ? formatList(blockerList)
        : 'the dual-worker safety limits';
    return `No queued batch can run beside ${batchLabel} without exceeding ${reason}.`;
}

export function shouldSuppressRoutineBlenderLine(line) {
    const normalized = String(line ?? '').trimEnd();
    if (!normalized.trim()) {
        return true;
    }
    if (IMPORTANT_BLENDER_LINE.test(normalized)) {
        return false;
    }
    return ROUTINE_BLENDER_LINES.some(pattern => pattern.test(normalized));
}

export function parseBlenderProgressLine(line) {
    const normalized = String(line ?? '').trim();
    if (!normalized.startsWith(BLENDER_PROGRESS_PREFIX)) {
        return null;
    }
    try {
        const progress = JSON.parse(normalized.slice(BLENDER_PROGRESS_PREFIX.length));
        const completed = Number(progress?.completed);
        const total = Number(progress?.total);
        if (!Number.isSafeInteger(completed) || !Number.isSafeInteger(total)
            || completed < 0 || total < 1 || completed > total) {
            return null;
        }
        return {
            completed,
            total,
            sceneEntry: String(progress.sceneEntry ?? ''),
            structureId: String(progress.structureId ?? ''),
        };
    } catch {
        return null;
    }
}

export function resolveRecycledSceneEntries(plannedSceneEntries, metrics) {
    if (metrics?.status !== 'recycle') {
        return null;
    }
    const completed = metrics.completedSceneEntries;
    const remaining = metrics.remainingSceneEntries;
    if (!Array.isArray(completed) || !Array.isArray(remaining) || completed.length === 0 || remaining.length === 0) {
        throw new Error('Blender requested recycling without making forward progress');
    }
    if (!sameSceneEntryCounts([...completed, ...remaining], plannedSceneEntries)) {
        throw new Error('Blender recycling journal does not describe an exact partition of the planned scenes');
    }
    return remaining;
}

export function formatBlenderWorkerLine(workerNumber, line) {
    return `[Blender W${workerNumber}] ${line}`;
}

export function parseWindowsProcessMemoryLine(line) {
    const match = String(line ?? '').trim().match(/^(\d+),(\d+)$/);
    if (!match) {
        return null;
    }
    const rss = Number(match[1]);
    const privateBytes = Number(match[2]);
    if (!Number.isSafeInteger(rss) || !Number.isSafeInteger(privateBytes)) {
        return null;
    }
    return { rss, private: privateBytes };
}

export function shouldRequestBlenderRecycle(memory) {
    return Number(memory?.rss ?? 0) >= BLENDER_RECYCLE_RSS_BYTES
        || Number(memory?.private ?? 0) >= BLENDER_RECYCLE_PRIVATE_BYTES;
}

export function mergeBlenderPeakMemory(metrics, externalPeakMemory) {
    return {
        ...metrics,
        peakMemory: {
            rss: Math.max(Number(metrics?.peakMemory?.rss ?? 0), Number(externalPeakMemory?.rss ?? 0)),
            private: Math.max(Number(metrics?.peakMemory?.private ?? 0), Number(externalPeakMemory?.private ?? 0)),
        },
    };
}

function sameSceneEntryCounts(left, right) {
    if (left.length !== right.length) return false;
    const counts = new Map();
    for (const entry of left) {
        const normalized = normalizeSceneEntry(entry);
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
    for (const entry of right) {
        const normalized = normalizeSceneEntry(entry);
        const count = counts.get(normalized) ?? 0;
        if (count === 0) return false;
        if (count === 1) counts.delete(normalized);
        else counts.set(normalized, count - 1);
    }
    return counts.size === 0;
}

function normalizeSceneEntry(entry) {
    return String(entry).replace(/\\/g, '/').toLowerCase();
}

function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatList(values) {
    if (values.length <= 1) {
        return values[0] ?? '';
    }
    if (values.length === 2) {
        return `${values[0]} or ${values[1]}`;
    }
    return `${values.slice(0, -1).join(', ')}, or ${values.at(-1)}`;
}
