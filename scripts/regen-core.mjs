import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import nativeFs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const CACHE_SCHEMA_VERSION = 1;
const LOCK_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const SMALL_TEXT_LIMIT = 256 * 1024;

export function createRegenPaths(repoRoot) {
    const cacheRoot = path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'regen-cache', 'v1');
    return {
        cacheRoot,
        lockPath: path.join(cacheRoot, 'regen.lock'),
        observedPath: path.join(cacheRoot, 'last-observed.v1.json'),
        successfulPath: path.join(cacheRoot, 'last-successful.v1.json'),
        buildPath: path.join(cacheRoot, 'build-provenance.v1.json'),
        runRoot: path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'regen'),
    };
}

export async function acquireRegenLock(lockPath) {
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    const lock = { pid: process.pid, startedAt: new Date().toISOString() };
    try {
        const handle = await fs.open(lockPath, 'wx');
        await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`, 'utf8');
        await handle.close();
    } catch (error) {
        if (error?.code !== 'EEXIST') {
            throw error;
        }
        const existing = await readJson(lockPath);
        const started = Date.parse(existing?.startedAt ?? '');
        const old = !Number.isFinite(started) || Date.now() - started > LOCK_STALE_AFTER_MS;
        const alive = Number.isInteger(existing?.pid) && isProcessAlive(existing.pid);
        if (alive && !old) {
            throw new Error(`FoxWatch regen is already running (PID ${existing.pid}).`);
        }
        await fs.rm(lockPath, { force: true });
        return acquireRegenLock(lockPath);
    }

    let released = false;
    return async () => {
        if (released) {
            return;
        }
        released = true;
        const existing = await readJson(lockPath);
        if (existing?.pid === process.pid) {
            await fs.rm(lockPath, { force: true });
        }
    };
}

export async function buildInputSnapshot(repoRoot, stageMapPath, options = {}) {
    const stageMapBytes = await fs.readFile(stageMapPath);
    const stageMap = JSON.parse(stageMapBytes.toString('utf8'));
    if (!stageMap?.stages) {
        throw new Error(`Invalid FoxWatch stage map: ${stageMapPath}`);
    }
    const stageMapFingerprint = sha256(stageMapBytes);
    const mayReusePriorHashes = options.priorSnapshot?.stageMapFingerprint === stageMapFingerprint;
    const files = await walkFiles(path.join(repoRoot, 'tools', 'foxwatch'), {
        ignoredSegments: new Set(['bin', 'obj', 'tmp', 'vendor', '__pycache__']),
    });
    const stageEntries = Object.entries(stageMap.stages);
    const inputs = {};
    const unmappedSources = [];

    const inspectedFiles = await mapWithConcurrency(files, 32, async absolutePath => {
        const relativePath = slash(path.relative(repoRoot, absolutePath));
        const stages = stageEntries
            .filter(([, patterns]) => patterns.some(pattern => globMatches(relativePath, pattern)))
            .map(([stage]) => stage);
        const stat = await fs.stat(absolutePath);
        if (stages.length === 0) {
            return { relativePath, stages, input: null };
        }
        const prior = options.priorSnapshot?.inputs?.[relativePath];
        const mtimeNs = Math.round(stat.mtimeMs * 1_000_000);
        if (mayReusePriorHashes && prior?.size === stat.size && prior?.mtimeNs === mtimeNs) {
            return { relativePath, stages, input: { ...prior, stages } };
        }
        const bytes = await fs.readFile(absolutePath);
        return { relativePath, stages, input: {
            hash: sha256(bytes),
            size: bytes.length,
            mtimeNs,
            stages,
            ...(bytes.length <= SMALL_TEXT_LIMIT && isTextInput(relativePath)
                ? { text: bytes.toString('utf8') }
                : {}),
        } };
    });
    for (const { relativePath, stages, input } of inspectedFiles) {
        if (isPipelineSource(relativePath) && stages.length === 0) {
            unmappedSources.push(relativePath);
        }
        if (input) {
            inputs[relativePath] = input;
        }
    }

    if (unmappedSources.length > 0) {
        throw new Error(`FoxWatch pipeline sources are missing from regen-stages.v1.json:\n${unmappedSources.join('\n')}`);
    }

    const pakInventory = options.pakDirectory
        ? await buildPakInventory(options.pakDirectory)
        : null;
    const stageFingerprints = Object.fromEntries(Object.keys(stageMap.stages).map(stage => [
        stage,
        sha256(JSON.stringify({
            inputs: Object.entries(inputs)
                .filter(([, input]) => input.stages.includes(stage))
                .map(([relativePath, input]) => [relativePath, input.hash]),
            pak: stage === 'extract' ? pakInventory?.fingerprint ?? null : null,
        })),
    ]));
    return {
        schemaVersion: CACHE_SCHEMA_VERSION,
        observedAt: new Date().toISOString(),
        stageMapFingerprint,
        inputs,
        pakInventory,
        stageFingerprints,
        fingerprint: sha256(JSON.stringify({ inputs, pakInventory })),
    };
}

export function createRegenPlan(previous, current, publishedManifest, dependencyIndex = null) {
    const changedPaths = diffSnapshots(previous, current);
    const directAssetIds = new Set();
    const sharedPreviewOnlyIds = new Set();
    const dirtyStages = new Set();
    const reasons = [];
    let allAssets = false;

    for (const relativePath of changedPaths) {
        const currentInput = current.inputs[relativePath];
        const previousInput = previous?.inputs?.[relativePath];
        for (const stage of currentInput?.stages ?? previousInput?.stages ?? []) {
            dirtyStages.add(stage);
        }
        const assetId = assetIdFromPath(relativePath);
        if (assetId) {
            directAssetIds.add(assetId);
        } else if (relativePath === 'tools/foxwatch/asset-overrides/modifications.json') {
            const changedRenderIds = changedModificationKeys(previousInput?.text, currentInput?.text);
            for (const renderId of changedRenderIds) {
                const entry = dependencyIndex?.entries?.[renderId];
                for (const consumer of entry?.consumers ?? []) {
                    if (consumer?.structureId) {
                        const consumerId = String(consumer.structureId).toLowerCase();
                        directAssetIds.add(consumerId);
                        sharedPreviewOnlyIds.add(consumerId);
                    }
                }
            }
            if (changedRenderIds.length === 0 || directAssetIds.size === 0) {
                allAssets = true;
            }
        } else {
            allAssets = true;
        }
        reasons.push({ path: relativePath, kind: changeKind(previousInput, currentInput) });
    }
    if (JSON.stringify(previous?.pakInventory ?? null) !== JSON.stringify(current.pakInventory ?? null)) {
        allAssets = true;
        dirtyStages.add('extract');
        reasons.push({ path: '<foxhole-paks>', kind: 'changed' });
    }

    const knownIds = (publishedManifest?.assets ?? []).map(asset => asset.id).filter(Boolean);
    const affectedAssetIds = allAssets ? knownIds : [...directAssetIds];
    const publisherOnly = dirtyStages.size > 0 && [...dirtyStages].every(stage => stage === 'publish');
    const modesByAsset = Object.fromEntries(affectedAssetIds.map(id => [
        id,
        publisherOnly
            ? []
            : sharedPreviewOnlyIds.has(id)
                ? ['preview', 'rendered-icon']
                : inferModesForAsset(id, changedPaths, previous, current),
    ]));
    return {
        schemaVersion: 1,
        runId: `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`,
        createdAt: new Date().toISOString(),
        baseline: !previous,
        changedPaths,
        reasons,
        dirtyStages: [...dirtyStages].sort(),
        directAssetIds: [...directAssetIds].sort(),
        affectedAssetIds: [...new Set(affectedAssetIds)].sort(),
        modesByAsset,
        requiresBuild: dirtyStages.has('extract'),
        requiresHydration: [...dirtyStages].some(stage => ['extract', 'hydrate', 'scene'].includes(stage)),
        requiresBlender: Object.values(modesByAsset).some(modes => modes.some(mode => ['preview', 'rendered-icon', 'component'].includes(mode))),
        requiresImagePublish: Object.values(modesByAsset).some(modes => modes.length > 0),
        requiresPublish: affectedAssetIds.length > 0 || dirtyStages.has('publish'),
    };
}

export async function computeBuildProvenance(repoRoot) {
    const roots = [path.join(repoRoot, 'tools', 'foxwatch')];
    const entries = [];
    for (const root of roots) {
        for (const absolutePath of await walkFiles(root, { ignoredSegments: new Set(['bin', 'obj', 'tmp', 'vendor', '__pycache__']) })) {
            const relativePath = slash(path.relative(repoRoot, absolutePath));
            if (!relativePath.endsWith('.cs') && !relativePath.endsWith('.csproj') && !relativePath.endsWith('.props') && !relativePath.endsWith('.targets')) {
                continue;
            }
            entries.push([relativePath, sha256(await fs.readFile(absolutePath))]);
        }
    }
    entries.sort(([left], [right]) => left.localeCompare(right));
    return { schemaVersion: 1, configuration: 'Debug|net8.0', fingerprint: sha256(JSON.stringify(entries)), entries };
}

export async function shouldBuildFoxWatch(provenancePath, dllPath, provenance) {
    if (!nativeFs.existsSync(dllPath)) {
        return true;
    }
    const previous = await readJson(provenancePath);
    return previous?.fingerprint !== provenance.fingerprint || previous?.configuration !== provenance.configuration;
}

export async function writeJsonAtomic(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, filePath);
}

export async function readJson(filePath) {
    try {
        return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

export function diffSnapshots(previous, current) {
    const paths = new Set([...Object.keys(previous?.inputs ?? {}), ...Object.keys(current.inputs ?? {})]);
    return [...paths].filter(relativePath => previous?.inputs?.[relativePath]?.hash !== current.inputs[relativePath]?.hash).sort();
}

function inferModesForAsset(assetId, changedPaths, previous, current) {
    const assetPaths = changedPaths.filter(relativePath => assetIdFromPath(relativePath) === assetId);
    if (assetPaths.length === 0) {
        return ['preview', 'rendered-icon', 'default-icon', 'component'];
    }
    let modes = new Set();
    for (const relativePath of assetPaths) {
        if (/\/icon(?:\.[^.]+)*\.(?:webp|png|jpe?g)$/i.test(slash(relativePath))) {
            modes.add('default-icon');
            continue;
        }
        if (/manifest\.json$/i.test(relativePath)) {
            const oldValue = parseJson(previous?.inputs?.[relativePath]?.text);
            const newValue = parseJson(current.inputs[relativePath]?.text);
            const changedKeys = changedTopLevelKeys(oldValue, newValue);
            const renderKeys = new Set(['previewDirection', 'defaultIcon', 'generateDefaultIcon', 'icon', 'subtypes', 'components', 'render', 'pencil']);
            if (changedKeys.every(key => !renderKeys.has(key))) {
                continue;
            }
            if (changedKeys.length === 1 && changedKeys[0] === 'previewDirection') {
                modes.add('preview');
                modes.add('rendered-icon');
                continue;
            }
            if (changedKeys.every(key => ['defaultIcon', 'icon', 'subtypes'].includes(key))) {
                modes.add('default-icon');
                continue;
            }
        }
        modes = new Set(['preview', 'rendered-icon', 'default-icon', 'component']);
    }
    return [...modes];
}

function changedTopLevelKeys(left, right) {
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
        return ['*'];
    }
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].filter(key => JSON.stringify(left[key]) !== JSON.stringify(right[key])).sort();
}

function changedModificationKeys(leftText, rightText) {
    const left = parseJson(leftText)?.modifications ?? {};
    const right = parseJson(rightText)?.modifications ?? {};
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].filter(key => JSON.stringify(left[key]) !== JSON.stringify(right[key])).sort();
}

function parseJson(value) {
    try {
        return value ? JSON.parse(value) : null;
    } catch {
        return null;
    }
}
function changeKind(before, after) {
    return !before ? 'added' : !after ? 'deleted' : 'changed';
}
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error?.code === 'EPERM';
    }
}
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
function slash(value) {
    return value.replaceAll('\\', '/');
}
function isTextInput(value) {
    return /\.(?:cs|csproj|json|mjs|js|ts|py|md|props|targets)$/i.test(value);
}
function isPipelineSource(value) {
    return /(?:\.cs|\.csproj|\.py|\.mjs)$/i.test(value) && value.startsWith('tools/foxwatch/');
}

function assetIdFromPath(relativePath) {
    const match = slash(relativePath).match(/^tools\/foxwatch\/(?:asset-overrides|pose-overrides|render-overrides)\/([^/]+)\//i);
    return match?.[1]?.toLowerCase() ?? null;
}

async function walkFiles(root, { ignoredSegments = new Set() } = {}) {
    const output = [];
    async function visit(directory) {
        let entries;
        try {
            entries = await fs.readdir(directory, { withFileTypes: true });
        } catch (error) {
            if (error?.code === 'ENOENT') {
                return;
            }
            throw error;
        }
        for (const entry of entries) {
            if (ignoredSegments.has(entry.name)) {
                continue;
            }
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(absolutePath);
            } else if (entry.isFile()) {
                output.push(absolutePath);
            }
        }
    }
    await visit(root);
    return output.sort();
}

async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    async function worker() {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await mapper(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
    return results;
}

function globMatches(value, pattern) {
    const escaped = slash(pattern)
        .replaceAll('**/', '\u0000')
        .replaceAll('**', '\u0001')
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replaceAll('*', '[^/]*')
        .replaceAll('\u0000', '(?:.*/)?')
        .replaceAll('\u0001', '.*');
    return new RegExp(`^${escaped}$`, 'i').test(slash(value));
}

async function buildPakInventory(directory) {
    const files = await walkFiles(directory);
    const entries = [];
    for (const filePath of files) {
        if (!/\.(?:pak|utoc|ucas)$/i.test(filePath)) {
            continue;
        }
        const stat = await fs.stat(filePath, { bigint: true });
        entries.push({ path: slash(path.relative(directory, filePath)), size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() });
    }
    entries.sort((left, right) => left.path.localeCompare(right.path));
    const steamBuildId = await readSteamBuildId(directory);
    return {
        directory: path.resolve(directory),
        steamBuildId,
        entries,
        fingerprint: sha256(JSON.stringify({ steamBuildId, entries })),
    };
}

async function readSteamBuildId(directory) {
    let current = path.resolve(directory);
    for (let depth = 0; depth < 10; depth += 1) {
        const manifestPath = path.join(current, 'appmanifest_505460.acf');
        try {
            const manifest = await fs.readFile(manifestPath, 'utf8');
            return manifest.match(/"buildid"\s+"([0-9]+)"/i)?.[1] ?? null;
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                throw error;
            }
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return null;
}
