import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import nativeFs from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

import {
    analyzeBlenderSceneIndex,
    createWeightedBlenderBatches,
    orderBlenderGroupsByObservedCost,
    resolveBlenderBatchSceneLimit,
    validateBlenderOutputOwnership,
} from './scripts/blender-batches.mjs';
import {
    canLaunchSecondBlenderWorker,
    dequeueNextConcurrentBlenderBatch,
    formatBlenderWorkerLine,
    mergeBlenderPeakMemory,
    parseBlenderProgressLine,
    parseWindowsProcessMemoryLine,
    resolveRecycledSceneEntries,
    resolveBlenderWorkerCount,
    shouldSuppressRoutineBlenderLine,
    shouldRequestBlenderRecycle,
} from './scripts/blender-runner.mjs';
import {
    computeDeepAssetFingerprint,
    computeDeepExtractorFingerprint,
    createDeepExtractionCacheIdentity,
    createRawManifestCacheKey,
    deepExtractionCacheMatches,
    deepExtractionRunMatches,
    resolveInvalidatedDecodedAssetSections,
} from './scripts/deep-extraction-cache.mjs';
import {
    classifyDecodedAssetFile,
    createActiveDecodedAssetBundlePointer,
    createDecodedAssetBundleMetadata,
    createDecodedAssetBundlePaths,
} from './scripts/decoded-asset-bundle.mjs';
import { configurePublishLogging, logPublishDetail } from './scripts/publish-log.mjs';
import {
    buildPakInventory,
    computeBuildProvenance,
    createFoxWatchCacheTargets,
    readJson,
    writeJsonAtomic,
} from './scripts/pipeline-core.mjs';
import { acquireProcessLock } from './scripts/process-lock.mjs';
import {
    createManifestSourceBenchmarkReport,
    resolveManifestBenchmarkIterations,
} from './scripts/manifest-source-benchmark.mjs';
import {
    runSteamMonitorCommand,
    steamMonitorCommands,
} from './scripts/steam-monitor.mjs';
import { resolveVerifiedMonitorPakSource } from './scripts/steam-monitor-core.mjs';

const [, , command, ...commandArgs] = process.argv;
const rawArgs = commandArgs.filter(arg => arg !== '--');

const workflowCommands = [
    'refresh',
    'refresh-modifications',
    'publish-manifest',
    'clear-cache',
    'open-asset-manifest',
    'open-pose-editor',
];
const diagnosticCommands = [
    'benchmark-manifest-source',
    'find-assets',
    'find-mesh-assets',
    'inspect-blueprint',
    'compare-animation-reference-pose',
    'probe-mesh-export',
    'export-mesh',
    'export-mesh-dir',
    'dump-package-files',
    'dump-matching-packages',
];
const internalCommands = [
    'generate-map-data',
    'generate-manifest',
    'extract-ui-assets',
    'generate-render-scenes',
    'prepare-refresh',
    'snapshot-pak',
    'snapshot-decoded-packages',
    'export-asset-cache',
];
const knownCommands = new Set([
    ...workflowCommands,
    ...steamMonitorCommands,
    ...diagnosticCommands,
    ...internalCommands,
]);

if (!command || command === 'help' || command === '--help' || command === '-h') {
    printCommandHelp();
    process.exit(command ? 0 : 1);
}
if (!knownCommands.has(command)) {
    console.error(`Unknown FoxWatch command: ${command}`);
    printCommandHelp();
    process.exit(1);
}

const repoRoot = process.cwd();
const foxholePlannerRoot = path.join(repoRoot, 'packages', 'extensions', 'foxhole');
const dllPath = path.join(repoRoot, 'tools', 'foxwatch', 'bin', 'Debug', 'net8.0', 'FoxWatchService.dll');
const renderScenesIndexPath = path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'renders', 'index.render-scenes.v1.json');
const renderTemplatePath = path.join(repoRoot, 'tools', 'foxwatch', 'blender', 'render-template.blend');
const blenderRenderScriptPath = path.join(repoRoot, 'tools', 'foxwatch', 'blender', 'render_render_scenes.py');
const blenderPoseEditorScriptPath = path.join(repoRoot, 'tools', 'foxwatch', 'blender', 'pose_editor.py');
const foxwatchOutputRoot = path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'assets');
const renderDataRoot = path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'renders');
const rawRenderedAssetOutputRoot = path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'rendered-assets', 'types');
const publicRoot = path.join(foxholePlannerRoot, 'public');
const publishedManifestPath = path.join(foxholePlannerRoot, 'public', 'foxhole', 'assets', 'manifest.v1.json');
const rawFoxWatchManifestPath = path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'foxwatch-manifest.v1.json');
const blueprintTargetIndexPath = path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'foxwatch-blueprint-target-index.v1.json');
const modificationRenderIndexPath = path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'modification-render-index.v1.json');
const foxholeIconOutputRoot = path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'foxhole-icons');
const activeDecodedAssetBundlePointerPath = path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'decoded-asset-bundle.active.v1.json');
const foxWatchAppSettingsPath = path.join(repoRoot, 'tools', 'foxwatch', 'appsettings.json');
const monitorStatePath = path.join(repoRoot, 'tools', 'foxwatch', 'local', 'state', 'monitor-state.v1.json');
const monitorAcquisitionsRoot = path.join(repoRoot, 'tools', 'foxwatch', 'local', 'state', 'acquisitions');
const decodedAssetBundleRoot = path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'decoded-asset-bundles', 'v1');
const legacyDeepExtractionCacheStampPath = path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'deep-extraction-cache.v1.json');
const blenderTimingHistoryPath = path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'blender-timing-history.v1.json');
const pakSnapshotRoot = path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'pak-snapshots', 'v1');
const decodedPackageSnapshotRoot = path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'decoded-package-snapshots', 'v3');
const blenderExecutable = process.env.BLENDER_PATH || 'blender';
const publishManifestScriptPath = path.join(repoRoot, 'tools', 'foxwatch', 'scripts', 'publish-manifest.mjs');
const publishPlannerCompatScriptPath = path.join(repoRoot, 'tools', 'foxwatch', 'scripts', 'publish-planner-compat.mjs');
const runnerScriptPath = path.join(repoRoot, 'tools', 'foxwatch', 'run-foxwatch.mjs');
const refreshLockPath = path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'foxwatch-refresh.lock.json');
const inheritNpmConfigArguments = Boolean(process.env.npm_lifecycle_event);
const defaultIconOverrideExtensions = ['.webp', '.png', '.jpg', '.jpeg'];
const defaultPakDirectoryCandidates = [
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Foxhole\\War\\Content\\Paks',
    'C:\\Program Files\\Steam\\steamapps\\common\\Foxhole\\War\\Content\\Paks',
];

if (steamMonitorCommands.includes(command)) {
    await runSteamMonitorCommand({
        command,
        args: rawArgs,
        repoRoot,
        runnerScriptPath,
    });
    process.exit(0);
}

if (['publish-manifest', 'refresh', 'refresh-modifications', 'clear-cache'].includes(command)) {
    const releaseRefreshLock = acquireProcessLock(refreshLockPath, 'FoxWatch refresh/publish pipeline');
    process.on('exit', releaseRefreshLock);
}

const args = [...rawArgs];
appendNpmConfigArgument(args, 'category');
appendNpmConfigArgument(args, 'only');
appendNpmConfigArgument(args, 'deep');
appendNpmConfigArgument(args, 'output-dir');
appendNpmConfigArgument(args, 'render-asset-output-dir');
appendNpmConfigArgument(args, 'pak-path');
appendNpmConfigArgument(args, 'base-assets-url');
appendNpmConfigArgument(args, 'limit');
appendNpmConfigArgument(args, 'skip-existing-assets');
appendNpmConfigArgument(args, 'verbose');
appendNpmConfigArgument(args, 'publish-concurrency');
appendNpmConfigArgument(args, 'blender-workers');
appendNpmConfigArgument(args, 'mod');
appendNpmConfigArgument(args, 'iterations');
appendNpmConfigArgument(args, 'snapshot-dir');
appendNpmConfigArgument(args, 'decoded-snapshot-dir');

const parsedFoxwatchArgs = parseCliArgs(args);
configurePublishLogging({ verbose: hasCliFlag(parsedFoxwatchArgs, 'verbose') });

if (command === 'clear-cache') {
    await clearFoxWatchCaches();
    process.exit(0);
}

if (command === 'benchmark-manifest-source') {
    await runManifestSourceBenchmark(parsedFoxwatchArgs);
    process.exit(0);
}

if (command === 'publish-manifest') {
    const parsedArgs = parseCliArgs(args);
    await run('node', ['--experimental-strip-types', publishManifestScriptPath, ...args]);
    await publishPlannerCompat();
    await syncMissingStructureDefaultIcons(
        resolveSourceManifestPath(parsedArgs),
        getNormalizedValues(parsedArgs, 'only'),
        { skipExistingAssets: hasCliFlag(parsedArgs, 'skip-existing-assets') },
    );
    process.exit(0);
}

if (command === 'refresh-modifications') {
    const parsedArgs = parseCliArgs(args);
    await runNpm(['run', 'build:foxwatch']);

    const manifestFoxwatchArgs = await buildFoxWatchArgsFromParsedArgs(parsedArgs, {
        onlyIds: [],
        categoryIds: [],
    });
    console.log('refresh-modifications: generating full source manifest');
    await run('dotnet', [dllPath, 'generate-manifest', ...manifestFoxwatchArgs]);

    const modificationStructureIds = await collectModificationStructureIds(rawFoxWatchManifestPath, parsedArgs);
    if (modificationStructureIds.length === 0) {
        throw new Error('refresh-modifications matched no structures with modification slots');
    }

    console.log(`refresh-modifications: rendering ${modificationStructureIds.length} structure(s) with modification slots`);
    const renderFoxwatchArgs = await buildFoxWatchArgsFromParsedArgs(parsedArgs, {
        onlyIds: modificationStructureIds,
        categoryIds: [],
    });
    await run('dotnet', [dllPath, 'generate-render-scenes', ...renderFoxwatchArgs]);
    await run(blenderExecutable, buildBlenderArgs(args, {
        purgeExistingByDefault: false,
        onlyIds: modificationStructureIds,
    }));

    console.log('refresh-modifications: publishing full manifest');
    await run('node', ['--experimental-strip-types', publishManifestScriptPath]);
    await publishPlannerCompat();
    await syncMissingStructureDefaultIcons(rawFoxWatchManifestPath, null, {
        skipExistingAssets: hasCliFlag(parsedArgs, 'skip-existing-assets'),
    });
    process.exit(0);
}

if (command === 'refresh') {
    const parsedArgs = parseCliArgs(args);
    await resetBlueprintTargetIndexForDeepRefresh(parsedArgs);
    const refreshExecution = await buildRefreshExecution(args);
    emitFoxWatchProgress({
        kind: 'pipeline',
        stage: 'Building FoxWatch',
        detail: 'Compiling the current FoxWatch pipeline.',
        overallPercent: 8,
    });
    await runNpm(['run', 'build:foxwatch']);
    if (hasCliFlag(parsedArgs, 'deep')) {
        emitFoxWatchProgress({
            kind: 'pipeline',
            stage: 'Preparing Game Snapshot',
            detail: 'Validating the selected Foxhole build and decoded snapshot.',
            overallPercent: 14,
        });
    }
    const deepExtractionCache = hasCliFlag(parsedArgs, 'deep')
        ? await prepareDeepExtractionCache(parsedArgs)
        : null;
    const assetExportRun = deepExtractionCache
        ? createDeepAssetExportRun()
        : null;
    const prepareRefreshFoxWatchArgs = deepExtractionCache
        ? replaceCliOption(
            replaceCliOption(refreshExecution.foxwatchArgs, 'pak-path', deepExtractionCache.pakDirectory),
            'render-asset-output-dir',
            deepExtractionCache.assetOutputRoot,
        )
        : refreshExecution.foxwatchArgs;
    const prepareRefreshArgs = [dllPath, 'prepare-refresh', ...prepareRefreshFoxWatchArgs];
    if (assetExportRun) {
        prepareRefreshArgs.push('--asset-export-plan', assetExportRun.planPath);
    }
    if (deepExtractionCache?.rawManifestCacheKey) {
        prepareRefreshArgs.push('--raw-cache-key', deepExtractionCache.rawManifestCacheKey, '--strict');
    }
    emitFoxWatchProgress({
        kind: 'pipeline',
        stage: 'Preparing Manifest',
        detail: 'Generating the manifest and Blender scene documents.',
        overallPercent: 25,
    });
    await run('dotnet', prepareRefreshArgs, {
        env: deepExtractionCache
            ? {
                ...process.env,
                FOXWATCH_DECODED_PACKAGE_SNAPSHOT: deepExtractionCache.decodedPackageSnapshotDirectory,
                FOXWATCH_DECODED_PACKAGE_PAK_FINGERPRINT: deepExtractionCache.identity.pakFingerprint,
                FOXWATCH_DECODED_INSPECTION_SNAPSHOT: deepExtractionCache.bundlePaths.inspectionPath,
                FoxWatch__IconOutputDirectory: deepExtractionCache.iconOutputRoot,
            }
            : process.env,
    });
    if (deepExtractionCache) {
        emitFoxWatchProgress({
            kind: 'pipeline',
            stage: 'Preparing Render Assets',
            detail: 'Exporting the decoded meshes, materials, textures, and icons needed for rendering.',
            overallPercent: 40,
        });
        await runDeepAssetCacheExport(assetExportRun, deepExtractionCache, parsedArgs);
        await commitDeepExtractionCache(deepExtractionCache);
    }
    if (refreshExecution.onlyIds === null && !hasCliFlag(parsedArgs, 'limit')) {
        await runDeepRefreshBlenderBatches(args);
    } else {
        emitFoxWatchProgress({
            kind: 'pipeline',
            stage: 'Rendering',
            detail: 'Rendering the requested FoxWatch scenes in Blender.',
            overallPercent: 50,
        });
        await run(blenderExecutable, buildBlenderArgs(args, {
            purgeExistingByDefault: true,
            onlyIds: refreshExecution.onlyIds,
        }));
    }
    emitFoxWatchProgress({
        kind: 'pipeline',
        stage: 'Publishing',
        detail: 'Publishing generated assets and committing the manifest.',
        overallPercent: 92,
    });
    await run('node', ['--experimental-strip-types', publishManifestScriptPath, ...refreshExecution.publishArgs]);
    await publishPlannerCompat();
    await syncMissingStructureDefaultIcons(rawFoxWatchManifestPath, refreshExecution.onlyIds, {
        skipExistingAssets: hasCliFlag(parsedArgs, 'skip-existing-assets'),
    });
    emitFoxWatchProgress({
        kind: 'pipeline',
        stage: 'Complete',
        detail: 'The FoxWatch refresh completed successfully.',
        overallPercent: 100,
    });
    process.exit(0);
}

if (command === 'open-pose-editor') {
    const parsedArgs = parseCliArgs(args);
    const onlyValues = getNormalizedValues(parsedArgs, 'only');
    if (onlyValues.length !== 1) {
        console.error('open-pose-editor requires exactly one --only <structure-id> target');
        process.exit(1);
    }

    const [structureId] = onlyValues;
    const foxwatchArgs = await buildFoxWatchArgs(args);
    const poseOverridePath = getPoseOverridePath(structureId);
    const manifestOverridePath = getManifestOverridePath(structureId);
    const beforePoseOverrideSignature = await readFileSignature(poseOverridePath);
    const beforeManifestOverrideSignature = await readFileSignature(manifestOverridePath);
    if (!args.includes('--pose-variants')) {
        foxwatchArgs.push('--pose-variants');
    }

    await runNpm(['run', 'build:foxwatch']);
    await run('dotnet', [dllPath, 'generate-render-scenes', ...foxwatchArgs]);
    const generatedScenePath = path.join(renderDataRoot, structureId, 'scene.json');
    if (!await sceneHasSerializedPoses(generatedScenePath)) {
        console.warn(`No generated poses were serialized for ${structureId}; Blender will open, but the pose list will be empty until pose discovery supports that asset.`);
    }
    await run(blenderExecutable, buildPoseEditorArgs(args, structureId));
    const afterPoseOverrideSignature = await readFileSignature(poseOverridePath);
    const afterManifestOverrideSignature = await readFileSignature(manifestOverridePath);
    if (beforePoseOverrideSignature !== afterPoseOverrideSignature || beforeManifestOverrideSignature !== afterManifestOverrideSignature) {
        console.log(`Detected override change for ${structureId}; rerendering target outputs...`);
        const refreshArgs = await buildFoxWatchArgs(args);
        await run('dotnet', [dllPath, 'generate-render-scenes', ...refreshArgs]);
        await run(blenderExecutable, buildBlenderArgs(args));
        await run('node', ['--experimental-strip-types', publishManifestScriptPath, ...await buildPublishArgs(args)]);
        await publishPlannerCompat();
        await syncMissingStructureDefaultIcons(rawFoxWatchManifestPath, [structureId], {
            skipExistingAssets: hasCliFlag(parsedArgs, 'skip-existing-assets'),
        });
    }
    process.exit(0);
}

if (command === 'open-asset-manifest') {
    const parsedArgs = parseCliArgs(args);
    const assetId = await resolveSingleAssetId(parsedArgs);
    if (!assetId) {
        console.error('open-asset-manifest requires exactly one asset id, --only <asset-id>, or an asset path');
        process.exit(1);
    }

    const overridePath = getManifestOverridePath(assetId);
    const alreadyExists = await pathExists(overridePath);
    if (!alreadyExists) {
        const scaffoldDocument = await buildManifestOverrideScaffold(assetId);
        await fs.mkdir(path.dirname(overridePath), { recursive: true });
        await fs.writeFile(overridePath, `${JSON.stringify(scaffoldDocument, null, 2)}\n`, 'utf8');
        console.log(`Created ${path.relative(repoRoot, overridePath)}`);
    }

    if (!Object.hasOwn(parsedArgs, 'no-open')) {
        const didOpen = await openDocumentInEditor(overridePath);
        if (!didOpen) {
            console.warn(`Unable to launch an editor automatically. Open ${path.relative(repoRoot, overridePath)} manually.`);
        }
    }

    console.log(path.relative(repoRoot, overridePath));
    if (Object.hasOwn(parsedArgs, 'watch-refresh')) {
        console.log(`Watching ${path.relative(repoRoot, overridePath)} for saves. Press Ctrl+C to stop.`);
        await watchManifestRefresh(assetId, overridePath);
    }

    process.exit(0);
}

await run('dotnet', [dllPath, command, ...args]);

function printCommandHelp() {
    console.log('Usage: npm run foxwatch -- <command> [options]');
    console.log('\nWorkflows:');
    for (const value of workflowCommands) console.log(`  ${value}`);
    console.log('\nLocal Steam monitoring:');
    for (const value of steamMonitorCommands) console.log(`  ${value}`);
    console.log('\nDiagnostics and export tools:');
    for (const value of diagnosticCommands) console.log(`  ${value}`);
    console.log('\nInternal pipeline commands:');
    for (const value of internalCommands) console.log(`  ${value}`);
}

function run(executable, commandArgs, options = {}) {
    if (executable === blenderExecutable && commandArgs.includes(blenderRenderScriptPath)) {
        const startedAt = performance.now();
        return runBlenderBatchProcess(commandArgs, {
            workerNumber: 1,
            verbose: commandArgs.includes('--verbose'),
        }).then(() => {
            console.log(`Blender render completed in ${formatElapsedMilliseconds(performance.now() - startedAt)}.`);
        });
    }

    return new Promise((resolve, reject) => {
        const baseEnvironment = options.env ?? process.env;
        const child = spawn(executable, commandArgs, {
            cwd: repoRoot,
            stdio: 'inherit',
            shell: false,
            env: executable === 'node' && commandArgs.includes(publishManifestScriptPath)
                ? {
                    ...baseEnvironment,
                    UV_THREADPOOL_SIZE: baseEnvironment.FOXWATCH_UV_THREADPOOL_SIZE ?? '4',
                    FOXWATCH_SHARP_CONCURRENCY: baseEnvironment.FOXWATCH_SHARP_CONCURRENCY ?? '2',
                }
                : baseEnvironment,
        });

        child.on('error', reject);
        child.on('exit', (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(`${executable} exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`));
        });
    });
}

function runNpm(commandArgs) {
    if (process.platform !== 'win32') {
        return run('npm', commandArgs);
    }

    return run('cmd.exe', ['/d', '/s', '/c', 'npm', ...commandArgs]);
}

async function runManifestSourceBenchmark(parsedArgs) {
    const pakDirectory = await resolveRegenPakDirectory(parsedArgs);
    if (!pakDirectory) {
        throw new Error('Manifest source benchmark requires a readable Foxhole PAK directory.');
    }

    const iterations = resolveManifestBenchmarkIterations((parsedArgs.iterations ?? []).at(-1));
    const pakInventory = await buildPakInventory(pakDirectory);
    const snapshotDirectory = (parsedArgs['snapshot-dir'] ?? []).at(-1)
        ? path.resolve(repoRoot, (parsedArgs['snapshot-dir'] ?? []).at(-1))
        : path.join(pakSnapshotRoot, pakInventory.fingerprint);
    const decodedSnapshotDirectory = (parsedArgs['decoded-snapshot-dir'] ?? []).at(-1)
        ? path.resolve(repoRoot, (parsedArgs['decoded-snapshot-dir'] ?? []).at(-1))
        : path.join(decodedPackageSnapshotRoot, pakInventory.fingerprint);
    assertSafeGeneratedCacheRoot(snapshotDirectory);
    assertSafeGeneratedCacheRoot(decodedSnapshotDirectory);

    const runId = `${new Date().toISOString().replace(/[:.]/g, '')}-pid${process.pid}`;
    const runDirectory = path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'manifest-source-benchmarks', runId);
    await fs.mkdir(runDirectory, { recursive: true });

    console.log(
        `Manifest source benchmark: Steam build ${pakInventory.steamBuildId ?? 'unknown'}, `
        + `${iterations} iteration(s) per source.`,
    );
    await runNpm(['run', 'build:foxwatch']);

    const snapshotMetadataPath = path.join(snapshotDirectory, 'foxwatch-pak-snapshot.v1.json');
    const snapshotPreviouslyComplete = await pathExists(snapshotMetadataPath);
    const snapshotStartedAt = performance.now();
    await run('dotnet', [
        dllPath,
        'snapshot-pak',
        '--pak-path',
        pakDirectory,
        '--output-dir',
        snapshotDirectory,
        '--pak-fingerprint',
        pakInventory.fingerprint,
    ]);
    const snapshotBuildMs = performance.now() - snapshotStartedAt;
    const snapshotMetadata = await readJson(snapshotMetadataPath);
    if (snapshotMetadata?.complete !== true || snapshotMetadata?.pakFingerprint !== pakInventory.fingerprint) {
        throw new Error(`Package snapshot did not produce valid complete metadata: ${snapshotMetadataPath}`);
    }

    const decodedMetadataPath = path.join(decodedSnapshotDirectory, 'foxwatch-decoded-packages.v3.json');
    const decodedSnapshotPreviouslyComplete = await pathExists(decodedMetadataPath);
    const decodedSnapshotStartedAt = performance.now();
    await run('dotnet', [
        dllPath,
        'snapshot-decoded-packages',
        '--pak-path',
        snapshotDirectory,
        '--output-dir',
        decodedSnapshotDirectory,
        '--pak-fingerprint',
        pakInventory.fingerprint,
    ]);
    const decodedSnapshotBuildMs = performance.now() - decodedSnapshotStartedAt;
    const decodedMetadata = await readJson(decodedMetadataPath);
    if (decodedMetadata?.complete !== true
        || decodedMetadata?.schemaVersion !== 3
        || decodedMetadata?.pakFingerprint !== pakInventory.fingerprint) {
        throw new Error(`Decoded package snapshot did not produce valid complete metadata: ${decodedMetadataPath}`);
    }

    const directTimings = [];
    const snapshotTimings = [];
    const decodedTimings = [];
    const decodedDirectTimings = [];
    const completedOutputs = [];
    const runTrial = async (sourceKind, iteration) => {
        const sourceDirectory = sourceKind === 'direct' || sourceKind === 'decoded-direct'
            ? pakDirectory
            : snapshotDirectory;
        const trialRoot = path.join(runDirectory, `${sourceKind}-${iteration + 1}`);
        const outputPath = path.join(trialRoot, 'manifest.v1.json');
        const iconOutputDirectory = path.join(trialRoot, 'icons');
        const assetOutputDirectory = path.join(trialRoot, 'assets');
        await fs.mkdir(trialRoot, { recursive: true });
        const environment = {
            ...process.env,
            FoxWatch__PakDirectoryPath: sourceDirectory,
            FoxWatch__IconOutputDirectory: iconOutputDirectory,
            FoxWatch__RenderAssetOutputDirectory: assetOutputDirectory,
            ...(sourceKind === 'decoded' || sourceKind === 'decoded-direct'
                ? {
                    FOXWATCH_DECODED_PACKAGE_SNAPSHOT: decodedSnapshotDirectory,
                    ...(sourceKind === 'decoded-direct'
                        ? { FOXWATCH_DECODED_PACKAGE_PAK_FINGERPRINT: pakInventory.fingerprint }
                        : {}),
                }
                : {}),
        };
        console.log(`Manifest benchmark ${sourceKind} ${iteration + 1}/${iterations}: ${sourceDirectory}`);
        const startedAt = performance.now();
        await run('dotnet', [
            dllPath,
            'generate-manifest',
            '--pak-path',
            sourceDirectory,
            '--output',
            outputPath,
            '--base-assets-url',
            '/foxhole/assets/',
            '--strict',
        ], { env: environment });
        const elapsedMs = performance.now() - startedAt;
        if (sourceKind === 'direct') directTimings.push(elapsedMs);
        else if (sourceKind === 'decoded') decodedTimings.push(elapsedMs);
        else if (sourceKind === 'decoded-direct') decodedDirectTimings.push(elapsedMs);
        else snapshotTimings.push(elapsedMs);
        completedOutputs.push({ sourceKind, iteration, outputPath, elapsedMs });
    };

    for (let iteration = 0; iteration < iterations; iteration += 1) {
        const order = iteration % 2 === 0
            ? ['direct', 'snapshot', 'decoded', 'decoded-direct']
            : ['decoded-direct', 'decoded', 'snapshot', 'direct'];
        for (const sourceKind of order) {
            await runTrial(sourceKind, iteration);
        }
    }

    const [baselineOutput, ...comparisonOutputs] = completedOutputs;
    const baselineBytes = await fs.readFile(baselineOutput.outputPath);
    const baselineHash = createHash('sha256').update(baselineBytes).digest('hex');
    for (const output of comparisonOutputs) {
        const outputBytes = await fs.readFile(output.outputPath);
        const outputHash = createHash('sha256').update(outputBytes).digest('hex');
        if (!outputBytes.equals(baselineBytes)) {
            throw new Error(
                `Manifest benchmark correctness failure: ${output.sourceKind} iteration ${output.iteration + 1} `
                + `produced ${outputHash}, expected ${baselineHash}. Outputs remain in ${runDirectory}.`,
            );
        }
    }

    const report = createManifestSourceBenchmarkReport({
        pakFingerprint: pakInventory.fingerprint,
        steamBuildId: pakInventory.steamBuildId,
        snapshotDirectory,
        snapshotReused: snapshotPreviouslyComplete,
        snapshotBuildMs,
        snapshotFileCount: snapshotMetadata.fileCount,
        snapshotBytes: snapshotMetadata.totalBytes,
        decodedSnapshotDirectory,
        decodedSnapshotReused: decodedSnapshotPreviouslyComplete,
        decodedSnapshotBuildMs,
        decodedSnapshotPackageCount: decodedMetadata.packageCount,
        decodedSnapshotBytes: decodedMetadata.totalBytes,
        decodedUnsupportedPackageCount: (decodedMetadata.unsupportedPackagePaths ?? []).length,
        directTimings,
        snapshotTimings,
        decodedTimings,
        decodedDirectTimings,
        manifestBytes: baselineBytes.length,
        manifestSha256: baselineHash,
    });
    const reportPath = path.join(runDirectory, 'benchmark-results.v3.json');
    await writeJsonAtomic(reportPath, report);

    console.log(`Direct PAK manifest median: ${formatElapsedMilliseconds(report.direct.medianMs)}.`);
    console.log(`Loose snapshot manifest median: ${formatElapsedMilliseconds(report.looseSnapshot.medianMs)}.`);
    console.log(`Decoded snapshot manifest median: ${formatElapsedMilliseconds(report.decoded.medianMs)}.`);
    console.log(`Decoded snapshot + direct PAK manifest median: ${formatElapsedMilliseconds(report.decodedDirect.medianMs)}.`);
    if (report.medianSavingsMs >= 0) {
        console.log(
            `Snapshot result: ${report.medianSpeedup?.toFixed(2) ?? 'n/a'}x speedup, `
            + `${formatElapsedMilliseconds(report.medianSavingsMs)} median savings.`,
        );
    } else {
        console.log(
            `Snapshot result: ${report.medianSpeedup?.toFixed(2) ?? 'n/a'}x direct throughput, `
            + `${formatElapsedMilliseconds(-report.medianSavingsMs)} slower.`,
        );
    }
    console.log(
        `Decoded result: ${report.decodedMedianSpeedup?.toFixed(2) ?? 'n/a'}x speedup, `
        + `${formatElapsedMilliseconds(report.decodedMedianSavingsMs)} median savings.`,
    );
    console.log(
        `Decoded + direct PAK result: ${report.decodedDirectMedianSpeedup?.toFixed(2) ?? 'n/a'}x speedup, `
        + `${formatElapsedMilliseconds(report.decodedDirectMedianSavingsMs)} median savings.`,
    );
    console.log(`All ${completedOutputs.length} manifests were byte-identical (${baselineHash}).`);
    console.log(`Benchmark report: ${reportPath}`);
}

async function resolveRegenPakDirectory(parsedArgs) {
    const configuredCandidates = [
        (parsedArgs['pak-path'] ?? []).at(-1),
        process.env.FoxWatch__PakDirectoryPath,
        process.env.FOXWATCH_PAK_PATH,
    ];
    for (const candidate of configuredCandidates) {
        if (!candidate) {
            continue;
        }
        const resolved = path.resolve(repoRoot, candidate);
        if (nativeFs.existsSync(resolved)) {
            return resolved;
        }
    }

    const appSettings = await readJson(foxWatchAppSettingsPath);
    const configuredPakDirectory = appSettings?.FoxWatch?.PakDirectoryPath;
    if (configuredPakDirectory) {
        const resolved = path.resolve(repoRoot, configuredPakDirectory);
        if (nativeFs.existsSync(resolved)) {
            return resolved;
        }
    }

    const monitorPakDirectory = await resolveMonitorManagedPakDirectory();
    if (monitorPakDirectory) {
        return monitorPakDirectory;
    }

    for (const candidate of defaultPakDirectoryCandidates) {
        const resolved = path.resolve(repoRoot, candidate);
        if (nativeFs.existsSync(resolved)) {
            return resolved;
        }
    }
    return null;
}

async function resolveMonitorManagedPakDirectory() {
    const state = await readJson(monitorStatePath);
    if (!state?.selectedBranch && !state?.selectedBuildId) {
        return null;
    }

    const branch = String(state.selectedBranch ?? '').trim().toLowerCase();
    const buildId = String(state.selectedBuildId ?? '').trim();
    const receiptPath = path.join(monitorAcquisitionsRoot, branch, `${buildId}.json`);
    const receipt = await readJson(receiptPath);
    const source = resolveVerifiedMonitorPakSource(state, receipt, receiptPath);
    const inventory = await buildPakInventory(source.pakDirectory);
    if (inventory.steamBuildId !== source.buildId || inventory.fingerprint !== source.pakFingerprint) {
        throw new Error(
            `Monitor-managed ${source.branch} BuildID ${source.buildId} no longer matches its verified PAK inventory. `
            + 'Run the FoxWatch monitor again or pass --pak-path explicitly.',
        );
    }
    console.log(
        `Using verified monitor-managed ${source.branch} BuildID ${source.buildId}: ${source.pakDirectory}`,
    );
    return source.pakDirectory;
}

async function clearFoxWatchCaches() {
    const targets = createFoxWatchCacheTargets(repoRoot);
    let removedTargets = 0;
    for (const target of targets) {
        assertSafeGeneratedCacheRoot(target);
        if (await pathExists(target)) {
            await fs.rm(target, { recursive: true, force: true });
            removedTargets += 1;
        }
    }
    console.log(
        `Cleared ${removedTargets} FoxWatch cache location(s). `
        + 'Steam installations, monitor state, logs, rendered outputs, and published assets were preserved.',
    );
}

async function prepareDeepExtractionCache(parsedArgs) {
    const pakDirectory = await resolveRegenPakDirectory(parsedArgs);
    if (!pakDirectory) {
        throw new Error('Deep refresh requires a readable Foxhole PAK directory before extracted-asset cache validation.');
    }

    const [pakInventory, buildProvenance] = await Promise.all([
        buildPakInventory(pakDirectory),
        computeBuildProvenance(repoRoot),
    ]);
    const bundlePaths = createDecodedAssetBundlePaths(decodedAssetBundleRoot, pakInventory.fingerprint);
    const assetOutputRoot = (parsedArgs['render-asset-output-dir'] ?? []).at(-1)
        ? path.resolve(repoRoot, (parsedArgs['render-asset-output-dir'] ?? []).at(-1))
        : bundlePaths.assetRoot;
    const iconOutputRoot = bundlePaths.iconRoot;
    assertSafeGeneratedCacheRoot(assetOutputRoot);
    assertSafeGeneratedCacheRoot(iconOutputRoot);
    assertSafeGeneratedCacheRoot(bundlePaths.packageSnapshotRoot);
    const runtimeDirectory = path.dirname(dllPath);
    const [extractorFingerprint, assetFingerprint] = await Promise.all([
        computeDeepExtractorFingerprint(buildProvenance.fingerprint, runtimeDirectory),
        computeDeepAssetFingerprint(repoRoot, runtimeDirectory),
    ]);
    const identity = createDeepExtractionCacheIdentity({
        pakInventory,
        extractorFingerprint,
        assetFingerprint,
        assetOutputRoot,
        iconOutputRoot,
    });
    const rawManifestCacheKey = createRawManifestCacheKey({ pakInventory, extractorFingerprint });
    const packageSnapshots = await prepareDeepPackageSnapshots(
        pakDirectory,
        pakInventory,
        bundlePaths.packageSnapshotRoot,
    );

    let cached = null;
    try {
        cached = await readJson(bundlePaths.cacheStampPath);
    } catch (error) {
        console.warn(`Ignoring corrupt deep extraction cache stamp: ${error.message}`);
    }

    if (!cached) {
        cached = await migrateLegacyDecodedAssetCache({
            pakInventory,
            identity,
            assetOutputRoot,
            iconOutputRoot,
        });
    }

    const invalidatedSections = new Set(resolveInvalidatedDecodedAssetSections(cached, identity));
    if (deepExtractionCacheMatches(cached, identity)) {
        if (!await pathExists(bundlePaths.inspectionPath)) {
            invalidatedSections.add('inspections');
        }
        if (!await pathExists(path.join(iconOutputRoot, 'icon-source-index.v1.json'))) {
            invalidatedSections.add('icons');
        }
        if (!await pathExists(assetOutputRoot)) {
            invalidatedSections.add('geometry');
            invalidatedSections.add('materials');
            invalidatedSections.add('textures');
        }
    }

    if (invalidatedSections.size === 0) {
        console.log(
            `Decoded asset bundle verified for Steam build ${identity.steamBuildId ?? 'unknown'}; `
            + 'canonical mesh, material, texture, and icon exports may be reused.',
        );
    } else {
        await fs.rm(bundlePaths.cacheStampPath, { force: true });
        await invalidateDecodedAssetSections(
            assetOutputRoot,
            iconOutputRoot,
            bundlePaths.inspectionPath,
            [...invalidatedSections],
        );
        if (invalidatedSections.has('icons')) {
            await fs.rm(path.join(
                repoRoot,
                'tools',
                'foxwatch',
                'tmp',
                'pipeline-cache',
                'v1',
                'raw-manifests',
                `${rawManifestCacheKey}.json`,
            ), { force: true });
        }
        console.log(
            `Decoded asset bundle requires ${[...invalidatedSections].join(', ')} for Steam build ${identity.steamBuildId ?? 'unknown'}; `
            + 'only those canonical sections will be rebuilt from the current PAK.',
        );
    }

    return {
        pakDirectory,
        identity,
        assetOutputRoot,
        iconOutputRoot,
        bundlePaths,
        cacheStampPath: bundlePaths.cacheStampPath,
        rawManifestCacheKey,
        ...packageSnapshots,
    };
}

async function prepareDeepPackageSnapshots(pakDirectory, pakInventory, decodedPackageSnapshotDirectory) {
    assertSafeGeneratedCacheRoot(decodedPackageSnapshotDirectory);

    const legacySnapshotDirectory = path.join(decodedPackageSnapshotRoot, pakInventory.fingerprint);
    if (!await pathExists(decodedPackageSnapshotDirectory) && await pathExists(legacySnapshotDirectory)) {
        await fs.mkdir(path.dirname(decodedPackageSnapshotDirectory), { recursive: true });
        await fs.rename(legacySnapshotDirectory, decodedPackageSnapshotDirectory);
        console.log('Moved the existing decoded package snapshot into the canonical decoded asset bundle.');
    }

    const decodedMetadataPath = path.join(decodedPackageSnapshotDirectory, 'foxwatch-decoded-packages.v3.json');
    const decodedSnapshotWasReady = await pathExists(decodedMetadataPath);
    await run('dotnet', [
        dllPath,
        'snapshot-decoded-packages',
        '--pak-path',
        pakDirectory,
        '--output-dir',
        decodedPackageSnapshotDirectory,
        '--pak-fingerprint',
        pakInventory.fingerprint,
    ]);
    const decodedMetadata = await readJson(decodedMetadataPath);
    if (decodedMetadata?.complete !== true
        || decodedMetadata?.schemaVersion !== 3
        || decodedMetadata?.pakFingerprint !== pakInventory.fingerprint) {
        throw new Error(`Decoded package snapshot did not produce valid complete metadata: ${decodedMetadataPath}`);
    }

    console.log(
        `Deep package source ready for Steam build ${pakInventory.steamBuildId ?? 'unknown'}: `
        + `${decodedSnapshotWasReady ? 'reused' : 'built'} ${formatBytes(decodedMetadata.totalBytes)} decoded snapshot `
        + `(${decodedMetadata.packageCount} package(s), ${(decodedMetadata.unsupportedPackagePaths ?? []).length} unsupported).`,
    );

    return { decodedPackageSnapshotDirectory };
}

async function migrateLegacyDecodedAssetCache({ pakInventory, identity, assetOutputRoot, iconOutputRoot }) {
    let legacyStamp = null;
    try {
        legacyStamp = await readJson(legacyDeepExtractionCacheStampPath);
    } catch {
        return null;
    }
    if (legacyStamp?.pakFingerprint !== pakInventory.fingerprint
        || !await pathExists(foxwatchOutputRoot)
        || path.resolve(assetOutputRoot) === path.resolve(foxwatchOutputRoot)
        || path.resolve(iconOutputRoot) === path.resolve(foxholeIconOutputRoot)) {
        return null;
    }

    await fs.mkdir(path.dirname(assetOutputRoot), { recursive: true });
    await fs.cp(foxwatchOutputRoot, assetOutputRoot, { recursive: true, force: false });
    console.log('Migrated the verified legacy mesh, material, and texture cache into the decoded asset bundle.');
    return {
        ...identity,
        assetContractVersions: {
            ...identity.assetContractVersions,
            inspections: 0,
            icons: 0,
        },
    };
}

async function invalidateDecodedAssetSections(assetOutputRoot, iconOutputRoot, inspectionPath, invalidatedSections) {
    const invalidated = new Set(invalidatedSections);
    if (invalidated.has('inspections')) {
        await fs.rm(inspectionPath, { force: true });
    }
    if (invalidated.has('icons')) {
        await resetGeneratedCacheRoot(iconOutputRoot);
    } else {
        await fs.mkdir(iconOutputRoot, { recursive: true });
    }

    const assetSections = ['geometry', 'materials', 'textures'];
    if (assetSections.every(section => invalidated.has(section))) {
        await resetGeneratedCacheRoot(assetOutputRoot);
        return;
    }
    await fs.mkdir(assetOutputRoot, { recursive: true });
    for (const filePath of await walkDirectoryFiles(assetOutputRoot)) {
        const section = classifyDecodedAssetFile(filePath);
        if (section && invalidated.has(section)) {
            await fs.rm(filePath, { force: true });
        }
    }
    await removeEmptyDirectories(assetOutputRoot);
}

async function removeEmptyDirectories(directoryPath) {
    if (!await pathExists(directoryPath)) {
        return true;
    }
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            await removeEmptyDirectories(path.join(directoryPath, entry.name));
        }
    }
    if ((await fs.readdir(directoryPath)).length === 0) {
        await fs.rmdir(directoryPath);
        return true;
    }
    return false;
}

function createDeepAssetExportRun() {
    const runId = `${new Date().toISOString().replace(/[:.]/g, '')}-pid${process.pid}`;
    const runRoot = path.join(repoRoot, 'tools', 'foxwatch', 'tmp', 'asset-cache-runs', runId);
    return {
        runId,
        runRoot,
        planPath: path.join(runRoot, 'asset-export-plan.v1.json'),
        mergedRoot: path.join(runRoot, 'merged'),
        backupRoot: path.join(runRoot, 'previous'),
    };
}

async function runDeepAssetCacheExport(runContext, cacheContext, parsedArgs) {
    const plan = await readJson(runContext.planPath);
    const meshCount = plan?.meshPackagePaths?.length ?? 0;
    const explicitMaterialPaths = plan?.materialPackagePaths ?? [];
    if (meshCount + explicitMaterialPaths.length === 0) {
        console.log('Deep asset cache is complete; no mesh or material export jobs are required.');
        return;
    }

    const workerCount = resolveAssetCacheWorkerCount(process.env.FOXWATCH_ASSET_WORKERS);
    const pakArgument = (parsedArgs['pak-path'] ?? []).at(-1) ?? cacheContext.pakDirectory;
    const startedAt = performance.now();
    const stageRoots = [];
    const referencedMaterialPaths = new Set(explicitMaterialPaths);

    if (meshCount > 0) {
        const geometryPlanPath = path.join(runContext.runRoot, 'geometry-export-plan.v1.json');
        await writeJsonAtomic(geometryPlanPath, {
            schemaVersion: 1,
            meshPackagePaths: plan.meshPackagePaths,
            materialPackagePaths: [],
            texturePackagePaths: [],
        });
        const geometryWorkerCount = Math.min(workerCount, meshCount);
        const geometryStageRoots = Array.from(
            { length: geometryWorkerCount },
            (_, index) => path.join(runContext.runRoot, `geometry-worker-${index + 1}`),
        );
        const resultPaths = geometryStageRoots.map(
            (_, index) => path.join(runContext.runRoot, `geometry-worker-${index + 1}.result.json`),
        );
        const claimDirectory = path.join(runContext.runRoot, 'geometry-claims');
        console.log(
            `Deep asset cache geometry phase: exporting ${meshCount} unique mesh package(s) `
            + `with ${geometryWorkerCount} isolated worker(s).`,
        );
        await Promise.all(geometryStageRoots.map((stageRoot, workerIndex) => run('dotnet', [
            dllPath,
            'export-asset-cache',
            '--plan',
            geometryPlanPath,
            '--output-dir',
            stageRoot,
            '--result',
            resultPaths[workerIndex],
            '--pak-path',
            pakArgument,
            '--worker-index',
            String(workerIndex),
            '--worker-count',
            String(geometryWorkerCount),
            '--claim-dir',
            claimDirectory,
            '--mesh-geometry-only',
        ])));
        await assertAssetWorkerCompletion(resultPaths, meshCount, 'geometry');
        for (const resultPath of resultPaths) {
            const result = await readJson(resultPath);
            for (const materialPath of result?.referencedMaterialPackagePaths ?? []) {
                referencedMaterialPaths.add(materialPath);
            }
        }
        stageRoots.push(...geometryStageRoots);
        console.log(
            `Deep asset cache geometry phase discovered ${referencedMaterialPaths.size} unique material package(s).`,
        );
    }

    if (referencedMaterialPaths.size > 0) {
        const materialPlanPath = path.join(runContext.runRoot, 'material-export-plan.v1.json');
        await writeJsonAtomic(materialPlanPath, {
            schemaVersion: 1,
            meshPackagePaths: [],
            materialPackagePaths: [...referencedMaterialPaths].sort((left, right) => left.localeCompare(right)),
            texturePackagePaths: [],
        });
        const materialWorkerCount = Math.min(workerCount, referencedMaterialPaths.size);
        const materialStageRoots = Array.from(
            { length: materialWorkerCount },
            (_, index) => path.join(runContext.runRoot, `material-worker-${index + 1}`),
        );
        const resultPaths = materialStageRoots.map(
            (_, index) => path.join(runContext.runRoot, `material-worker-${index + 1}.result.json`),
        );
        const claimDirectory = path.join(runContext.runRoot, 'material-claims');
        console.log(
            `Deep asset cache material phase: exporting ${referencedMaterialPaths.size} unique material package(s) `
            + `with ${materialWorkerCount} isolated worker(s).`,
        );
        await Promise.all(materialStageRoots.map((stageRoot, workerIndex) => run('dotnet', [
            dllPath,
            'export-asset-cache',
            '--plan',
            materialPlanPath,
            '--output-dir',
            stageRoot,
            '--result',
            resultPaths[workerIndex],
            '--pak-path',
            pakArgument,
            '--worker-index',
            String(workerIndex),
            '--worker-count',
            String(materialWorkerCount),
            '--claim-dir',
            claimDirectory,
            '--material-metadata-only',
        ])));
        await assertAssetWorkerCompletion(resultPaths, referencedMaterialPaths.size, 'material');
        stageRoots.push(...materialStageRoots);

        const referencedTexturePaths = new Set();
        for (const resultPath of resultPaths) {
            const result = await readJson(resultPath);
            for (const texturePath of result?.referencedTexturePackagePaths ?? []) {
                referencedTexturePaths.add(texturePath);
            }
        }
        console.log(
            `Deep asset cache material phase discovered ${referencedTexturePaths.size} unique texture package(s).`,
        );

        if (referencedTexturePaths.size > 0) {
            const texturePlanPath = path.join(runContext.runRoot, 'texture-export-plan.v1.json');
            await writeJsonAtomic(texturePlanPath, {
                schemaVersion: 1,
                meshPackagePaths: [],
                materialPackagePaths: [],
                texturePackagePaths: [...referencedTexturePaths].sort((left, right) => left.localeCompare(right)),
            });
            const textureWorkerCount = Math.min(
                resolveTextureWorkerCount(
                    process.env.FOXWATCH_TEXTURE_WORKERS,
                    process.env.FOXWATCH_ASSET_WORKERS,
                    workerCount,
                ),
                referencedTexturePaths.size,
            );
            const textureStageRoots = Array.from(
                { length: textureWorkerCount },
                (_, index) => path.join(runContext.runRoot, `texture-worker-${index + 1}`),
            );
            const resultPaths = textureStageRoots.map(
                (_, index) => path.join(runContext.runRoot, `texture-worker-${index + 1}.result.json`),
            );
            const claimDirectory = path.join(runContext.runRoot, 'texture-claims');
            console.log(
                `Deep asset cache texture phase: exporting ${referencedTexturePaths.size} unique texture package(s) `
                + `with ${textureWorkerCount} isolated worker(s).`,
            );
            await Promise.all(textureStageRoots.map((stageRoot, workerIndex) => run('dotnet', [
                dllPath,
                'export-asset-cache',
                '--plan',
                texturePlanPath,
                '--output-dir',
                stageRoot,
                '--result',
                resultPaths[workerIndex],
                '--pak-path',
                pakArgument,
                '--worker-index',
                String(workerIndex),
                '--worker-count',
                String(textureWorkerCount),
                '--claim-dir',
                claimDirectory,
            ])));
            await assertAssetWorkerCompletion(resultPaths, referencedTexturePaths.size, 'texture');
            stageRoots.push(...textureStageRoots);
        }
    }

    const mergeMetrics = await mergeAssetCacheStages(
        cacheContext.assetOutputRoot,
        stageRoots,
        runContext,
    );
    console.log(
        `Deep asset cache completed in ${formatElapsedMilliseconds(performance.now() - startedAt)}: `
        + `${mergeMetrics.installedFiles} installed file(s), ${mergeMetrics.identicalCollisions} verified shared output(s), `
        + `${formatBytes(mergeMetrics.installedBytes)} staged.`,
    );
}

async function assertAssetWorkerCompletion(resultPaths, expectedJobs, phase) {
    const results = await Promise.all(resultPaths.map(resultPath => readJson(resultPath)));
    const completedJobs = results.reduce((total, result) => total + Number(result?.completedJobs ?? 0), 0);
    if (completedJobs !== expectedJobs) {
        throw new Error(
            `Deep asset cache ${phase} workers completed ${completedJobs}/${expectedJobs} jobs; refusing to install a partial cache.`,
        );
    }
}

function resolveAssetCacheWorkerCount(value) {
    if (value == null || value === '') {
        return 2;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 2) {
        throw new Error(`FOXWATCH_ASSET_WORKERS must be 1 or 2; received ${value}.`);
    }
    return parsed;
}

function resolveTextureWorkerCount(value, assetWorkerOverride, fallbackWorkerCount) {
    if (value != null && value !== '') {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4) {
            throw new Error(`FOXWATCH_TEXTURE_WORKERS must be between 1 and 4; received ${value}.`);
        }
        return parsed;
    }
    if (assetWorkerOverride != null && assetWorkerOverride !== '') {
        return fallbackWorkerCount;
    }
    const hasCapacity = os.totalmem() >= 24 * 1024 ** 3 && os.freemem() >= 12 * 1024 ** 3;
    return hasCapacity ? 4 : fallbackWorkerCount;
}

async function mergeAssetCacheStages(assetOutputRoot, stageRoots, runContext) {
    assertSafeGeneratedCacheRoot(assetOutputRoot);
    await fs.rm(runContext.mergedRoot, { recursive: true, force: true });
    await fs.mkdir(runContext.mergedRoot, { recursive: true });
    if (await pathExists(assetOutputRoot)) {
        await fs.cp(assetOutputRoot, runContext.mergedRoot, { recursive: true, force: false });
    }

    let installedFiles = 0;
    let installedBytes = 0;
    let identicalCollisions = 0;
    for (const stageRoot of stageRoots) {
        for (const sourcePath of await walkDirectoryFiles(stageRoot)) {
            const relativePath = path.relative(stageRoot, sourcePath);
            const destinationPath = path.join(runContext.mergedRoot, relativePath);
            if (await pathExists(destinationPath)) {
                const [sourceHash, destinationHash] = await Promise.all([
                    readFileSignature(sourcePath),
                    readFileSignature(destinationPath),
                ]);
                if (sourceHash !== destinationHash) {
                    throw new Error(`Asset cache workers produced different bytes for ${relativePath}.`);
                }
                identicalCollisions += 1;
                continue;
            }

            await fs.mkdir(path.dirname(destinationPath), { recursive: true });
            await fs.copyFile(sourcePath, destinationPath);
            const stat = await fs.stat(sourcePath);
            installedFiles += 1;
            installedBytes += stat.size;
        }
    }

    await fs.rm(runContext.backupRoot, { recursive: true, force: true });
    if (await pathExists(assetOutputRoot)) {
        await fs.rename(assetOutputRoot, runContext.backupRoot);
    }
    try {
        await fs.rename(runContext.mergedRoot, assetOutputRoot);
    } catch (error) {
        if (await pathExists(runContext.backupRoot)) {
            await fs.rename(runContext.backupRoot, assetOutputRoot);
        }
        throw error;
    }
    await fs.rm(runContext.backupRoot, { recursive: true, force: true });
    return { installedFiles, installedBytes, identicalCollisions };
}

async function walkDirectoryFiles(directoryPath) {
    const files = [];
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...await walkDirectoryFiles(entryPath));
        } else if (entry.isFile()) {
            files.push(entryPath);
        }
    }
    return files;
}

async function commitDeepExtractionCache(context) {
    const [pakInventory, buildProvenance] = await Promise.all([
        buildPakInventory(context.pakDirectory),
        computeBuildProvenance(repoRoot),
    ]);
    const runtimeDirectory = path.dirname(dllPath);
    const [extractorFingerprint, assetFingerprint] = await Promise.all([
        computeDeepExtractorFingerprint(buildProvenance.fingerprint, runtimeDirectory),
        computeDeepAssetFingerprint(repoRoot, runtimeDirectory),
    ]);
    const verifiedIdentity = createDeepExtractionCacheIdentity({
        pakInventory,
        extractorFingerprint,
        assetFingerprint,
        assetOutputRoot: context.identity.assetOutputRoot,
        iconOutputRoot: context.identity.iconOutputRoot,
    });
    if (!deepExtractionRunMatches(context.identity, verifiedIdentity)) {
        await fs.rm(context.cacheStampPath, { force: true });
        throw new Error('Foxhole PAK inventory or FoxWatch extraction sources changed during preparation; refusing to render or publish mixed extraction data.');
    }

    const packageMetadataPath = path.join(
        context.decodedPackageSnapshotDirectory,
        'foxwatch-decoded-packages.v3.json',
    );
    const packageMetadata = await readJson(packageMetadataPath);
    const inventory = await buildDecodedAssetBundleInventory(
        context.assetOutputRoot,
        context.iconOutputRoot,
        context.bundlePaths.inspectionPath,
    );
    const bundleMetadata = createDecodedAssetBundleMetadata({
        identity: verifiedIdentity,
        packageMetadata,
        inventory,
        paths: context.bundlePaths,
    });
    await writeJsonAtomic(context.bundlePaths.metadataPath, bundleMetadata);
    await writeJsonAtomic(context.cacheStampPath, {
        ...verifiedIdentity,
        verifiedAt: new Date().toISOString(),
    });
    await activateDecodedAssetBundle(bundleMetadata, context.bundlePaths);
    await fs.rm(legacyDeepExtractionCacheStampPath, { force: true });
    console.log(
        `Activated decoded asset bundle: ${inventory.geometry.fileCount} mesh, `
        + `${inventory.materials.fileCount} material, ${inventory.textures.fileCount} texture, `
        + `${inventory.icons.fileCount} icon source, ${inventory.inspections.fileCount} inspection snapshot file(s).`,
    );
}

async function buildDecodedAssetBundleInventory(assetRoot, iconRoot, inspectionPath) {
    const inventory = Object.fromEntries(
        ['inspections', 'geometry', 'materials', 'textures', 'icons']
            .map(section => [section, { fileCount: 0, totalBytes: 0 }]),
    );
    if (await pathExists(inspectionPath)) {
        const inspectionStats = await fs.stat(inspectionPath);
        inventory.inspections.fileCount = 1;
        inventory.inspections.totalBytes = inspectionStats.size;
    }
    for (const root of [assetRoot, iconRoot]) {
        if (!await pathExists(root)) {
            continue;
        }
        for (const filePath of await walkDirectoryFiles(root)) {
            const section = classifyDecodedAssetFile(filePath, iconRoot);
            if (!section) {
                continue;
            }
            const fileStats = await fs.stat(filePath);
            inventory[section].fileCount += 1;
            inventory[section].totalBytes += fileStats.size;
        }
    }
    return inventory;
}

async function activateDecodedAssetBundle(bundleMetadata, bundlePaths) {
    const pointer = createActiveDecodedAssetBundlePointer(bundleMetadata, bundlePaths);
    const activations = [
        [foxwatchOutputRoot, bundlePaths.assetRoot],
        [foxholeIconOutputRoot, bundlePaths.iconRoot],
    ];
    const completed = [];
    try {
        for (const [viewPath, targetPath] of activations) {
            const backupPath = `${viewPath}.previous-${process.pid}`;
            const pendingPath = `${viewPath}.next-${process.pid}`;
            await fs.rm(backupPath, { recursive: true, force: true });
            await fs.rm(pendingPath, { recursive: true, force: true });
            await fs.mkdir(path.dirname(viewPath), { recursive: true });
            await fs.symlink(targetPath, pendingPath, process.platform === 'win32' ? 'junction' : 'dir');
            let movedPrevious = false;
            if (await pathExists(viewPath)) {
                await fs.rename(viewPath, backupPath);
                movedPrevious = true;
            }
            try {
                await fs.rename(pendingPath, viewPath);
            } catch (error) {
                if (movedPrevious && await pathExists(backupPath)) {
                    await fs.rename(backupPath, viewPath);
                }
                throw error;
            }
            completed.push({ viewPath, backupPath });
        }
        await writeJsonAtomic(activeDecodedAssetBundlePointerPath, pointer);
    } catch (error) {
        for (const { viewPath, backupPath } of completed.reverse()) {
            await fs.rm(viewPath, { recursive: true, force: true });
            if (await pathExists(backupPath)) {
                await fs.rename(backupPath, viewPath);
            }
        }
        throw error;
    }
    for (const { backupPath } of completed) {
        await fs.rm(backupPath, { recursive: true, force: true });
    }
}

function assertSafeGeneratedCacheRoot(directoryPath) {
    const resolvedPath = path.resolve(directoryPath);
    const relativePath = path.relative(repoRoot, resolvedPath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error(`Refusing to invalidate generated FoxWatch cache outside the repository: ${resolvedPath}`);
    }
}

async function resetGeneratedCacheRoot(directoryPath) {
    const resolvedPath = path.resolve(directoryPath);
    assertSafeGeneratedCacheRoot(resolvedPath);
    await fs.rm(resolvedPath, { recursive: true, force: true });
    await fs.mkdir(resolvedPath, { recursive: true });
}

function normalizeAssetId(value) {
    return String(value ?? '').trim().toLowerCase();
}

function getPublishedAssetTypeName(asset) {
    if (asset?.isVehicle === true) {
        return 'vehicles';
    }

    if (asset?.isItem === true) {
        return 'items';
    }

    return 'structures';
}

function getPublishedAssetPath(assetType, assetId, fileName) {
    return path.join(
        foxholePlannerRoot,
        'public',
        'foxhole',
        'assets',
        'types',
        assetType,
        assetId,
        fileName,
    );
}

function resolveExplicitStructureDefaultIconSource(structure, isDestroyed = false) {
    if (isDestroyed) {
        return String(
            structure?.destroyed?.icons?.default
            ?? structure?.destroyed?.iconUrl
            ?? structure?.icons?.default
            ?? structure?.iconUrl
            ?? '',
        ).trim();
    }

    return String(
        structure?.subTypeIconUrl
            ? (structure?.iconUrl ?? structure?.icons?.default ?? '')
            : (structure?.icons?.default ?? structure?.iconUrl ?? ''),
    ).trim();
}

async function writeIconFileIfExists(sourcePath, targetPath, actionLabel = 'synced') {
    try {
        await fs.access(sourcePath);
    } catch {
        return false;
    }

    const sourceBuffer = await fs.readFile(sourcePath);
    const content = path.extname(sourcePath).toLowerCase() === '.webp'
        ? sourceBuffer
        : await sharp(sourceBuffer).webp({ lossless: true, effort: 6 }).toBuffer();
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content);
    logPublishDetail(`${actionLabel} ${path.relative(repoRoot, sourcePath)} -> ${path.relative(repoRoot, targetPath)}`);
    return true;
}

function getPublishedDefaultIconTargetPath(asset, isDestroyed = false) {
    const assetId = normalizeAssetIdValue(asset?.id);
    if (!assetId) {
        return null;
    }

    const assetType = getPublishedAssetTypeName(asset);
    const filePrefix = isDestroyed ? `${assetId}.destroyed` : assetId;
    return getPublishedAssetPath(assetType, assetId, `${filePrefix}.icon.default.webp`);
}

async function resolveAssetDefaultIconOverrideSourcePath(assetId) {
    const overrideDirectory = path.join(repoRoot, 'tools', 'foxwatch', 'asset-overrides', assetId);
    for (const extension of defaultIconOverrideExtensions) {
        const candidatePath = path.join(overrideDirectory, `icon.default${extension}`);
        if (await pathExists(candidatePath)) {
            return candidatePath;
        }
    }

    return null;
}

async function syncStructureDefaultIcon(structure, isDestroyed = false) {
    const options = arguments[2] ?? {};
    const assetId = normalizeAssetIdValue(structure?.id);
    const targetPath = getPublishedDefaultIconTargetPath(structure, isDestroyed);
    if (!assetId || !targetPath) {
        return false;
    }

    if (options.skipExistingAssets && await pathExists(targetPath)) {
        return true;
    }

    if (!isDestroyed) {
        const overrideSourcePath = await resolveAssetDefaultIconOverrideSourcePath(assetId);
        if (overrideSourcePath) {
            return await writeIconFileIfExists(overrideSourcePath, targetPath, 'overrode');
        }

        if (structure?.generateDefaultIcon === true) {
            return await pathExists(targetPath);
        }

        return await pathExists(targetPath);
    }

    if (await pathExists(targetPath)) {
        return true;
    }

    return false;
}

function resolveSourceManifestPath(parsedArgs) {
    const explicitSourcePath = (parsedArgs['source-manifest'] ?? parsedArgs.source ?? []).at(-1);
    return explicitSourcePath ? path.resolve(repoRoot, explicitSourcePath) : rawFoxWatchManifestPath;
}

async function collectModificationStructureIds(manifestPath, parsedArgs = {}) {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const requestedVariantIds = new Set(getNormalizedValues(parsedArgs, 'mod'));

    const structureIds = new Set();
    for (const structure of manifest?.assets ?? []) {
        const structureId = normalizeAssetId(structure?.id);
        if (!structureId) {
            continue;
        }

        let hasMatchingModification = false;
        for (const slot of structure?.modificationSlots ?? []) {
            for (const [variantId] of Object.entries(slot?.variants ?? {})) {
                const normalizedVariantId = normalizeAssetId(variantId);
                if (!normalizedVariantId || normalizedVariantId === 'default') {
                    continue;
                }

                if (requestedVariantIds.size > 0 && !requestedVariantIds.has(normalizedVariantId)) {
                    continue;
                }

                hasMatchingModification = true;
                break;
            }

            if (hasMatchingModification) {
                break;
            }
        }

        if (hasMatchingModification) {
            structureIds.add(structureId);
        }
    }

    return [...structureIds].sort((left, right) => left.localeCompare(right));
}

async function syncMissingStructureDefaultIcons(sourceManifestPath, onlyIds = null) {
    const options = arguments[2] ?? {};
    let sourceManifest = null;
    try {
        sourceManifest = JSON.parse(await fs.readFile(sourceManifestPath, 'utf8'));
    } catch {
        return;
    }

    const allowedIds = Array.isArray(onlyIds) && onlyIds.length > 0
        ? new Set(onlyIds.map(normalizeAssetId).filter(Boolean))
        : null;

    for (const structure of sourceManifest?.assets ?? []) {
        const structureId = normalizeAssetId(structure?.id);
        if (!structureId) {
            continue;
        }
        if (allowedIds && !allowedIds.has(structureId)) {
            continue;
        }
        if (structure?.isItem === true) {
            continue;
        }

        await syncStructureDefaultIcon(structure, false, options);

        if (structure?.destroyed && !resolveExplicitStructureDefaultIconSource(structure, true)) {
            await syncStructureDefaultIcon(structure, true, options);
        }
    }
}

function appendNpmConfigArgument(args, optionName) {
    if (!inheritNpmConfigArguments) {
        return;
    }

    const cliFlag = `--${optionName}`;
    if (args.includes(cliFlag)) {
        return;
    }

    const originalValues = readOriginalNpmOptionValues(optionName);
    if (originalValues.length > 0) {
        appendRepeatedArgs(args, optionName, originalValues);
        return;
    }

    if (hasOriginalNpmFlag(optionName)) {
        args.push(cliFlag);
        return;
    }

    const envKey = `npm_config_${optionName.replace(/-/g, '_')}`;
    const envValue = process.env[envKey];
    if (!envValue) {
        return;
    }

    if (envValue === 'true') {
        if (args.length === 1 && !args[0].startsWith('--')) {
            const [positionalValue] = args.splice(0, 1);
            args.push(cliFlag, positionalValue);
        }

        return;
    }

    args.push(cliFlag, envValue);
}

function readOriginalNpmOptionValues(optionName) {
    const rawOriginalArgv = process.env.npm_config_argv;
    if (!rawOriginalArgv) {
        return [];
    }

    try {
        const parsedArgv = JSON.parse(rawOriginalArgv);
        const originalArgs = Array.isArray(parsedArgv?.original) ? parsedArgv.original : [];
        const flag = `--${optionName}`;
        const values = [];

        for (let index = 0; index < originalArgs.length; index += 1) {
            const current = String(originalArgs[index] ?? '');
            if (current === flag) {
                const next = String(originalArgs[index + 1] ?? '');
                if (next && !next.startsWith('--')) {
                    values.push(next);
                    index += 1;
                }
                continue;
            }

            if (current.startsWith(`${flag}=`)) {
                const value = current.slice(flag.length + 1).trim();
                if (value) {
                    values.push(value);
                }
            }
        }

        return values;
    } catch {
        return [];
    }
}

function hasOriginalNpmFlag(optionName) {
    const rawOriginalArgv = process.env.npm_config_argv;
    if (!rawOriginalArgv) {
        return false;
    }

    try {
        const parsedArgv = JSON.parse(rawOriginalArgv);
        const originalArgs = Array.isArray(parsedArgv?.original) ? parsedArgv.original : [];
        const flag = `--${optionName}`;
        return originalArgs.some((arg, index) => {
            const current = String(arg ?? '');
            if (current !== flag) {
                return false;
            }

            const next = String(originalArgs[index + 1] ?? '');
            return !next || next.startsWith('--');
        });
    } catch {
        return false;
    }
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

function hasCliFlag(parsedArgs, key) {
    return Object.hasOwn(parsedArgs, key);
}

function getNormalizedValues(parsedArgs, key) {
    return (parsedArgs[key] ?? [])
        .flatMap(value => String(value).split(','))
        .map(value => value.trim())
        .filter(Boolean);
}

async function getNormalizedAssetIds(parsedArgs, key) {
    const directValues = getNormalizedValues(parsedArgs, key)
        .map(value => normalizeAssetIdValue(value))
        .filter(Boolean);

    if (directValues.length > 0 || !Object.hasOwn(parsedArgs, key)) {
        return directValues;
    }

    const clipboardAssetId = await readClipboardAssetId();
    if (!clipboardAssetId) {
        return directValues;
    }

    return [clipboardAssetId];
}

function normalizeAssetIdValue(rawValue) {
    return normalizeLookupValue(rawValue);
}

function normalizeLookupValue(rawValue) {
    const trimmedValue = String(rawValue ?? '').trim();
    if (!trimmedValue) {
        return null;
    }

    return trimmedValue.toLowerCase();
}

function appendRepeatedArgs(outputArgs, optionName, values) {
    for (const value of values) {
        outputArgs.push(`--${optionName}`, value);
    }
}

async function buildFoxWatchArgs(rawArgs) {
    const parsedArgs = parseCliArgs(rawArgs);
    return buildFoxWatchArgsFromParsedArgs(parsedArgs);
}

async function buildFoxWatchArgsFromParsedArgs(parsedArgs, options = {}) {
    const outputArgs = [];
    const onlyIds = options.onlyIds ?? await getNormalizedAssetIds(parsedArgs, 'only');
    const categoryIds = options.categoryIds ?? getNormalizedValues(parsedArgs, 'category');
    const manifestOutputPath = (parsedArgs['output'] ?? []).at(-1)
        ? path.resolve(repoRoot, (parsedArgs['output'] ?? []).at(-1))
        : rawFoxWatchManifestPath;
    const renderSceneOutputDir = (parsedArgs['output-dir'] ?? []).at(-1)
        ? path.resolve(repoRoot, (parsedArgs['output-dir'] ?? []).at(-1))
        : renderDataRoot;
    const renderAssetOutputDir = (parsedArgs['render-asset-output-dir'] ?? []).at(-1)
        ? path.resolve(repoRoot, (parsedArgs['render-asset-output-dir'] ?? []).at(-1))
        : foxwatchOutputRoot;

    appendRepeatedArgs(outputArgs, 'only', onlyIds);
    appendRepeatedArgs(outputArgs, 'category', categoryIds);
    outputArgs.push('--output', manifestOutputPath);
    outputArgs.push('--output-dir', renderSceneOutputDir);
    outputArgs.push('--render-asset-output-dir', renderAssetOutputDir);

    if (hasCliFlag(parsedArgs, 'verbose')) {
        outputArgs.push('--verbose');
    }

    for (const optionName of ['pak-path', 'base-assets-url', 'limit']) {
        const values = parsedArgs[optionName] ?? [];
        if (values.length > 0) {
            outputArgs.push(`--${optionName}`, values.at(-1));
        }
    }

    return outputArgs;
}

function buildBlenderArgs(rawArgs, options = {}) {
    const parsedArgs = parseCliArgs(rawArgs);
    const outputDir = (parsedArgs['output-dir'] ?? []).at(-1)
        ? path.resolve(repoRoot, (parsedArgs['output-dir'] ?? []).at(-1))
        : rawRenderedAssetOutputRoot;
    const outputArgs = [
        renderTemplatePath,
        '--background',
        '--python-exit-code',
        '1',
        '--python',
        blenderRenderScriptPath,
        '--',
        '--index',
        renderScenesIndexPath,
        '--output-dir',
        outputDir,
        '--render-data-root',
        renderDataRoot,
        '--foxwatch-output-root',
        foxwatchOutputRoot,
    ];

    appendRepeatedArgs(outputArgs, 'only', options.onlyIds ?? getNormalizedValues(parsedArgs, 'only'));
    appendRepeatedArgs(outputArgs, 'scene-entry', options.sceneEntries ?? []);

    for (const optionName of ['limit', 'public-root', 'foxwatch-output-root', 'pixels-per-meter', 'preview-size', 'icon-size']) {
        const values = parsedArgs[optionName] ?? [];
        if (values.length > 0) {
            outputArgs.push(`--${optionName}`, values.at(-1));
        }
    }

    appendRepeatedArgs(outputArgs, 'mode', options.modes ?? getNormalizedValues(parsedArgs, 'mode'));
    appendRepeatedArgs(outputArgs, 'scene-variant', getNormalizedValues(parsedArgs, 'scene-variant'));
    if (options.resultJournalPath) {
        outputArgs.push('--result-journal', options.resultJournalPath);
    }
    if (options.metricsJournalPath) {
        outputArgs.push('--metrics-journal', options.metricsJournalPath);
    }
    if (options.recycleRequestPath) {
        outputArgs.push('--recycle-request', options.recycleRequestPath);
    }

    const flagOptions = new Set();
    for (const optionName of ['debug-bounds', 'purge-existing']) {
        if (Object.hasOwn(parsedArgs, optionName)) {
            flagOptions.add(optionName);
        }
    }

    if (options.purgeExistingByDefault) {
        flagOptions.add('purge-existing');
    }

    if (hasCliFlag(parsedArgs, 'verbose')) {
        flagOptions.add('verbose');
    }

    for (const optionName of flagOptions) {
        outputArgs.push(`--${optionName}`);
    }

    return outputArgs;
}

function replaceCliOption(inputArgs, optionName, value) {
    const flag = `--${optionName}`;
    const outputArgs = [];
    for (let index = 0; index < inputArgs.length; index += 1) {
        if (inputArgs[index] === flag) {
            index += 1;
            continue;
        }
        outputArgs.push(inputArgs[index]);
    }
    outputArgs.push(flag, value);
    return outputArgs;
}

async function runDeepRefreshBlenderBatches(rawArgs) {
    const blenderPhaseStartedAt = performance.now();
    const parsedArgs = parseCliArgs(rawArgs);
    const indexDocument = await readJson(renderScenesIndexPath);
    const maxScenes = resolveBlenderBatchSceneLimit(process.env.FOXWATCH_BLENDER_BATCH_SCENES);
    const analysis = await analyzeBlenderSceneIndex(indexDocument, {
        renderDataRoot,
        foxwatchOutputRoot,
    });
    validateBlenderOutputOwnership(analysis.sceneDocuments);
    const timingHistory = await readJson(blenderTimingHistoryPath) ?? { schemaVersion: 1, groups: {} };
    const orderedGroups = orderBlenderGroupsByObservedCost(analysis.groups, timingHistory);
    const batches = createWeightedBlenderBatches(orderedGroups, { maxScenes });
    if (batches.length === 0) {
        throw new Error('Deep refresh render index contains no scene entries');
    }

    const workerCount = resolveBlenderWorkerCount(
        (parsedArgs['blender-workers'] ?? []).at(-1),
        process.env.FOXWATCH_BLENDER_WORKERS,
        os.totalmem(),
    );
    const verbose = hasCliFlag(parsedArgs, 'verbose');
    const sceneCount = batches.reduce((total, batch) => total + batch.sceneEntries.length, 0);
    const concurrentCandidateCount = batches.filter(batch => !batch.exclusive).length;
    console.log(
        `Deep refresh: rendering ${sceneCount} scene document(s) in ${batches.length} weighted batch(es) `
        + `with up to ${workerCount} guarded Blender worker(s) `
        + `(${concurrentCandidateCount} non-exclusive batch(es) available for resource-matched concurrency)`,
    );
    emitFoxWatchProgress({
        kind: 'blender-start',
        stage: 'Rendering',
        detail: `Rendering ${sceneCount} scenes in ${batches.length} Blender batches.`,
        overallPercent: 50,
        batchTotal: batches.length,
        sceneTotal: sceneCount,
        workerCount,
    });

    const metricsRoot = path.join(
        repoRoot,
        'tools',
        'foxwatch',
        'tmp',
        'blender-batches',
        `${new Date().toISOString().replace(/[:.]/g, '')}-pid${process.pid}`,
    );
    await fs.mkdir(metricsRoot, { recursive: true });
    const queue = batches.map((batch, index) => ({
        ...batch,
        plannedBatchNumber: index + 1,
        recycleCount: 0,
        completedBeforeRecycle: 0,
        originalSceneCount: batch.sceneEntries.length,
    }));
    const active = new Map();
    const activeBatches = new Map();
    const completedPlannedBatches = new Set();
    const plannedBatchSceneProgress = new Map(batches.map((_, index) => [index + 1, 0]));
    const workerBatchCounts = new Map([[1, 0], [2, 0]]);
    let launchSequence = 0;
    let failedResult = null;
    let reportedMemoryGuard = false;

    const launchBatch = (batch, workerNumber) => {
        if (!batch.workerBatchNumber || batch.assignedWorker !== workerNumber) {
            batch.workerBatchNumber = (workerBatchCounts.get(workerNumber) ?? 0) + 1;
            batch.assignedWorker = workerNumber;
            workerBatchCounts.set(workerNumber, batch.workerBatchNumber);
        }
        launchSequence += 1;
        const metricsJournalPath = path.join(metricsRoot, `launch-${String(launchSequence).padStart(4, '0')}-w${workerNumber}.json`);
        const recycleRequestPath = path.join(metricsRoot, `launch-${String(launchSequence).padStart(4, '0')}-w${workerNumber}.recycle`);
        const promise = runBlenderBatchProcess(
            buildBlenderArgs(rawArgs, {
                purgeExistingByDefault: true,
                sceneEntries: batch.sceneEntries,
                metricsJournalPath,
                recycleRequestPath,
            }),
            {
                workerNumber,
                verbose,
                recycleRequestPath,
                onProgress(progress) {
                    const completedScenes = batch.completedBeforeRecycle + progress.completed;
                    plannedBatchSceneProgress.set(batch.plannedBatchNumber, completedScenes);
                    emitFoxWatchProgress({
                        kind: 'blender-scene',
                        stage: 'Rendering',
                        worker: workerNumber,
                        workerBatch: batch.workerBatchNumber,
                        batch: batch.plannedBatchNumber,
                        batchTotal: batches.length,
                        scene: completedScenes,
                        sceneTotal: batch.originalSceneCount,
                        completedBatches: completedPlannedBatches.size,
                        completedScenes: [...plannedBatchSceneProgress.values()].reduce((total, value) => total + value, 0),
                        structureId: progress.structureId,
                        sceneEntry: progress.sceneEntry,
                        overallPercent: renderOverallPercent(plannedBatchSceneProgress, sceneCount),
                    });
                },
            },
        ).then(async processMetrics => ({
            ok: true,
            workerNumber,
            batch,
            metrics: mergeBlenderPeakMemory(await readJson(metricsJournalPath), processMetrics.externalPeakMemory),
        })).catch(error => ({ ok: false, workerNumber, batch, error }));
        active.set(workerNumber, promise);
        activeBatches.set(workerNumber, batch);
    };

    const settleOne = async () => {
        const result = await Promise.race(active.values());
        active.delete(result.workerNumber);
        activeBatches.delete(result.workerNumber);
        if (!result.ok) {
            failedResult = result;
            return;
        }

        reportBlenderBatchMetrics(result.workerNumber, result.batch, result.metrics, batches.length);
        updateBlenderTimingHistory(timingHistory, result.metrics?.dependencyGroupTimings);
        if (result.metrics?.status === 'recycle') {
            let remainingSceneEntries;
            try {
                remainingSceneEntries = resolveRecycledSceneEntries(result.batch.sceneEntries, result.metrics);
            } catch (error) {
                failedResult = {
                    ...result,
                    ok: false,
                    error,
                };
                return;
            }
            queue.unshift({
                ...result.batch,
                sceneEntries: remainingSceneEntries,
                recycleCount: result.batch.recycleCount + 1,
                completedBeforeRecycle: result.batch.completedBeforeRecycle
                    + (result.metrics?.completedSceneEntries?.length ?? 0),
            });
        } else {
            completedPlannedBatches.add(result.batch.plannedBatchNumber);
            plannedBatchSceneProgress.set(result.batch.plannedBatchNumber, result.batch.originalSceneCount);
            emitFoxWatchProgress({
                kind: 'blender-batch',
                stage: 'Rendering',
                worker: result.workerNumber,
                workerBatch: result.batch.workerBatchNumber,
                batch: result.batch.plannedBatchNumber,
                batchTotal: batches.length,
                scene: result.batch.originalSceneCount,
                sceneTotal: result.batch.originalSceneCount,
                completedBatches: completedPlannedBatches.size,
                completedScenes: [...plannedBatchSceneProgress.values()].reduce((total, value) => total + value, 0),
                overallPercent: renderOverallPercent(plannedBatchSceneProgress, sceneCount),
            });
        }
    };

    while ((queue.length > 0 || active.size > 0) && !failedResult) {
        const nextBatch = queue[0];
        if (active.size === 0 && nextBatch?.exclusive) {
            queue.shift();
            launchBatch(nextBatch, 1);
            await settleOne();
            continue;
        }

        while (queue.length > 0 && active.size < workerCount) {
            const availableMemoryBytes = os.freemem();
            if (active.size === 1 && !canLaunchSecondBlenderWorker(availableMemoryBytes)) {
                if (!reportedMemoryGuard) {
                    const memoryGuardDetail = `Waiting for 12 GiB available RAM (${formatBytes(availableMemoryBytes)} available).`;
                    console.log(`Blender memory guard is holding the second worker. ${memoryGuardDetail}`);
                    emitFoxWatchProgress({
                        kind: 'blender-worker-wait',
                        stage: 'Rendering',
                        worker: 2,
                        reason: 'memory-guard',
                        detail: memoryGuardDetail,
                        overallPercent: renderOverallPercent(plannedBatchSceneProgress, sceneCount),
                    });
                    reportedMemoryGuard = true;
                }
                break;
            }

            const batch = active.size === 0
                ? queue.shift()
                : dequeueNextConcurrentBlenderBatch(queue, activeBatches.values().next().value);
            if (!batch) {
                break;
            }
            const workerNumber = [1, 2].find(candidate => !active.has(candidate));
            launchBatch(batch, workerNumber);
        }
        if (active.size > 0) {
            await settleOne();
        }
    }

    if (failedResult) {
        await Promise.allSettled(active.values());
        const groups = failedResult.batch.dependencyGroups.join(', ');
        throw new Error(
            `Blender worker ${failedResult.workerNumber} failed in planned batch ${failedResult.batch.plannedBatchNumber} `
            + `(dependency groups: ${groups}): ${failedResult.error.message}`,
            { cause: failedResult.error },
        );
    }

    await writeJsonAtomic(blenderTimingHistoryPath, timingHistory);

    console.log(`Blender phase completed in ${formatElapsedMilliseconds(performance.now() - blenderPhaseStartedAt)}.`);
}

function updateBlenderTimingHistory(history, timings) {
    if (!Array.isArray(timings)) return;
    history.schemaVersion = 1;
    history.groups ??= {};
    for (const timing of timings) {
        const dependencyGroup = String(timing?.dependencyGroup ?? '').trim().toLowerCase();
        const elapsedMs = Number(timing?.elapsedMs ?? 0);
        if (!dependencyGroup || !Number.isFinite(elapsedMs) || elapsedMs <= 0) continue;
        const previous = history.groups[dependencyGroup];
        const samples = Math.min(Number(previous?.samples ?? 0), 4);
        history.groups[dependencyGroup] = {
            samples: samples + 1,
            estimateMs: Math.round(((Number(previous?.estimateMs ?? 0) * samples) + elapsedMs) / (samples + 1)),
            lastMs: Math.round(elapsedMs),
        };
    }
    history.updatedAt = new Date().toISOString();
}

function runBlenderBatchProcess(commandArgs, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(blenderExecutable, commandArgs, {
            cwd: repoRoot,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
            env: process.env,
        });
        const memorySampler = startWindowsProcessMemorySampler(child.pid, options.recycleRequestPath);
        drainBlenderOutput(child.stdout, options, false);
        drainBlenderOutput(child.stderr, options, true);
        child.on('error', reject);
        child.on('close', (code, signal) => {
            memorySampler.stop();
            if (code === 0) {
                resolve({ externalPeakMemory: memorySampler.peakMemory });
                return;
            }
            reject(new Error(`Blender exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`));
        });
    });
}

function startWindowsProcessMemorySampler(processId, recycleRequestPath) {
    const peakMemory = { rss: 0, private: 0 };
    if (process.platform !== 'win32' || !Number.isSafeInteger(processId)) {
        return { peakMemory, stop() {} };
    }

    const script = [
        "$ErrorActionPreference='SilentlyContinue'",
        `while ($true) { $p = Get-Process -Id ${processId} -ErrorAction SilentlyContinue; if ($null -eq $p) { break }; `
            + "[Console]::Out.WriteLine(('{0},{1}' -f $p.WorkingSet64,$p.PrivateMemorySize64)); [Console]::Out.Flush(); Start-Sleep -Milliseconds 1000 }",
    ].join('; ');
    const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
    const sampler = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: false,
        windowsHide: true,
    });
    let buffered = '';
    let recycleRequested = false;
    sampler.stdout?.setEncoding('utf8');
    sampler.stdout?.on('data', chunk => {
        buffered += chunk;
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? '';
        for (const line of lines) {
            const memory = parseWindowsProcessMemoryLine(line);
            if (!memory) continue;
            peakMemory.rss = Math.max(peakMemory.rss, memory.rss);
            peakMemory.private = Math.max(peakMemory.private, memory.private);
            if (!recycleRequested && shouldRequestBlenderRecycle(memory)) {
                recycleRequested = true;
                void fs.writeFile(recycleRequestPath, `${JSON.stringify(memory)}\n`, 'utf8');
            }
        }
    });
    sampler.on('error', () => {});

    return {
        peakMemory,
        stop() {
            if (!sampler.killed) sampler.kill();
        },
    };
}

function drainBlenderOutput(stream, options, isErrorStream) {
    let buffered = '';
    stream.setEncoding('utf8');
    const emitLine = (line) => {
        const normalized = line.replace(/\r$/, '');
        const progress = parseBlenderProgressLine(normalized);
        if (progress) {
            options.onProgress?.(progress);
            return;
        }
        if (!options.verbose && shouldSuppressRoutineBlenderLine(normalized)) {
            return;
        }
        const formatted = formatBlenderWorkerLine(options.workerNumber, normalized);
        if (isErrorStream) {
            console.error(formatted);
        } else {
            console.log(formatted);
        }
    };
    stream.on('data', chunk => {
        buffered += chunk;
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines) {
            emitLine(line);
        }
    });
    stream.on('end', () => {
        if (buffered) {
            emitLine(buffered);
        }
    });
}

function emitFoxWatchProgress(progress) {
    console.log(`FOXWATCH_PROGRESS ${JSON.stringify(progress)}`);
}

function renderOverallPercent(batchSceneProgress, totalScenes) {
    const completedScenes = [...batchSceneProgress.values()].reduce((total, value) => total + value, 0);
    return 50 + Math.floor((completedScenes / Math.max(totalScenes, 1)) * 40);
}

function reportBlenderBatchMetrics(workerNumber, batch, metrics, plannedBatchCount) {
    const peakMemory = metrics?.peakMemory ?? {};
    console.log(
        `Blender W${workerNumber} batch ${batch.plannedBatchNumber}/${plannedBatchCount}: `
        + `${metrics?.completedSceneEntries?.length ?? batch.sceneEntries.length} scene(s) in `
        + `${formatElapsedMilliseconds(metrics?.elapsedMs ?? 0)}, peak ${formatBytes(peakMemory.rss)} RSS / `
        + `${formatBytes(peakMemory.private)} private`,
    );
    for (const role of metrics?.slowRoles ?? []) {
        console.log(
            `Slow render: ${role.structureId} ${role.renderMode}`
            + `${role.sceneVariant ? ` [${role.sceneVariant}]` : ''} — ${formatElapsedMilliseconds(role.elapsedMs)}`,
        );
    }
    if (metrics?.status === 'recycle') {
        console.log(
            `Blender W${workerNumber} recycled after ${metrics.completedSceneEntries?.length ?? 0} scene(s); `
            + `${metrics.remainingSceneEntries?.length ?? 0} scene(s) requeued.`,
        );
    }
}

function formatBytes(value) {
    const bytes = Number(value ?? 0);
    return bytes > 0 ? `${(bytes / (1024 ** 3)).toFixed(1)} GiB` : 'n/a';
}

function formatElapsedMilliseconds(value) {
    const milliseconds = Number(value ?? 0);
    return `${(milliseconds / 1000).toFixed(1)}s`;
}

async function buildPublishArgs(rawArgs) {
    const parsedArgs = parseCliArgs(rawArgs);
    return buildPublishArgsFromParsedArgs(parsedArgs);
}

async function buildPublishArgsFromParsedArgs(parsedArgs, options = {}) {
    const outputArgs = [];
    const onlyIds = options.onlyIds ?? await getNormalizedAssetIds(parsedArgs, 'only');
    const categoryIds = options.categoryIds ?? getNormalizedValues(parsedArgs, 'category');

    appendRepeatedArgs(outputArgs, 'only', onlyIds);
    appendRepeatedArgs(outputArgs, 'category', categoryIds);
    appendPublishCliPassthroughArgs(outputArgs, parsedArgs);

    return outputArgs;
}

function appendPublishCliPassthroughArgs(outputArgs, parsedArgs) {
    if (hasCliFlag(parsedArgs, 'deep')) {
        outputArgs.push('--deep');
    }

    if (hasCliFlag(parsedArgs, 'skip-existing-assets')) {
        outputArgs.push('--skip-existing-assets');
    }

    if (hasCliFlag(parsedArgs, 'verbose')) {
        outputArgs.push('--verbose');
    }

    if (hasCliFlag(parsedArgs, 'allow-partial-source')) {
        outputArgs.push('--allow-partial-source');
    }

    const publishConcurrency = (parsedArgs['publish-concurrency'] ?? []).at(-1);
    if (publishConcurrency) {
        outputArgs.push('--publish-concurrency', publishConcurrency);
    }
}

async function buildRefreshExecution(rawArgs) {
    const parsedArgs = parseCliArgs(rawArgs);
    const isDeepRefresh = Object.hasOwn(parsedArgs, 'deep');
    const publishedManifest = await readPublishedManifest();

    if (isDeepRefresh) {
        const categoryIds = resolveDeepRefreshCategoryIds(parsedArgs, publishedManifest);
        return {
            onlyIds: null,
            foxwatchArgs: await buildFoxWatchArgsFromParsedArgs(parsedArgs, { categoryIds }),
            publishArgs: await buildPublishArgsFromParsedArgs(parsedArgs, { categoryIds }),
        };
    }

    if (!publishedManifest) {
        throw new Error('refresh requires --deep when the published manifest is unavailable.');
    }

    const onlyIds = await resolveManifestBackedRefreshTargetIds(parsedArgs, publishedManifest);
    return {
        onlyIds,
        foxwatchArgs: await buildFoxWatchArgsFromParsedArgs(parsedArgs, {
            onlyIds,
            categoryIds: [],
        }),
        publishArgs: await buildPublishArgsFromParsedArgs(parsedArgs, {
            onlyIds,
            categoryIds: [],
        }),
    };
}

async function resetBlueprintTargetIndexForDeepRefresh(parsedArgs) {
    if (!Object.hasOwn(parsedArgs, 'deep')) {
        return;
    }

    try {
        const existed = await pathExists(blueprintTargetIndexPath);
        await fs.rm(blueprintTargetIndexPath, { force: true });
        console.log(existed
            ? `Removed stale FoxWatch blueprint target index before deep refresh: ${path.relative(repoRoot, blueprintTargetIndexPath)}`
            : `Deep refresh will rebuild FoxWatch blueprint target index: ${path.relative(repoRoot, blueprintTargetIndexPath)}`);
    } catch (error) {
        console.warn(`Unable to reset FoxWatch blueprint target index before deep refresh: ${error}`);
    }
}

async function resolveManifestBackedRefreshTargetIds(parsedArgs, publishedManifest) {
    const requestedOnlyIds = await getNormalizedAssetIds(parsedArgs, 'only');
    const requestedCategoryIds = getNormalizedValues(parsedArgs, 'category');
    if (requestedOnlyIds.length === 0 && requestedCategoryIds.length === 0) {
        throw new Error('refresh requires --only or --category unless --deep is provided.');
    }

    const manifestAssets = getPublishedManifestAssets(publishedManifest);
    const manifestCategories = getPublishedManifestCategories(publishedManifest);
    const orderedManifestAssetIds = manifestAssets
        .map(asset => normalizeLookupValue(asset?.id))
        .filter(Boolean);

    const resolvedOnlyTargetIds = resolvePublishedManifestAssetIds(manifestAssets, requestedOnlyIds);
    if (resolvedOnlyTargetIds.unresolved.length > 0) {
        throw new Error(`refresh target not found in the published manifest: ${resolvedOnlyTargetIds.unresolved.join(', ')}. Use --deep to discover new assets.`);
    }

    const resolvedCategoryIds = resolvePublishedManifestCategoryIds(manifestCategories, requestedCategoryIds);
    if (resolvedCategoryIds.unresolved.length > 0) {
        throw new Error(`refresh category not found in the published manifest: ${resolvedCategoryIds.unresolved.join(', ')}. Use --deep to discover new assets.`);
    }

    const categoryAssetIds = collectPublishedManifestAssetIdsForCategories(manifestAssets, resolvedCategoryIds.ids);
    let targetIdSet = null;
    if (resolvedOnlyTargetIds.ids.length > 0) {
        targetIdSet = new Set(resolvedOnlyTargetIds.ids);
    }

    if (resolvedCategoryIds.ids.length > 0) {
        if (categoryAssetIds.length === 0) {
            throw new Error(`refresh category matched no published manifest assets: ${resolvedCategoryIds.ids.join(', ')}. Use --deep to discover new assets.`);
        }

        const categoryAssetIdSet = new Set(categoryAssetIds);
        targetIdSet = targetIdSet
            ? new Set([...targetIdSet].filter(assetId => categoryAssetIdSet.has(assetId)))
            : categoryAssetIdSet;
    }

    const onlyIds = orderedManifestAssetIds.filter((assetId, index, values) => (
        values.indexOf(assetId) === index
        && (!targetIdSet || targetIdSet.has(assetId))
    ));
    if (onlyIds.length === 0) {
        throw new Error('refresh target filters matched no published manifest assets. Use --deep to discover new assets.');
    }

    return onlyIds;
}

function resolveDeepRefreshCategoryIds(parsedArgs, publishedManifest) {
    const requestedCategoryIds = getNormalizedValues(parsedArgs, 'category');
    if (requestedCategoryIds.length === 0) {
        return requestedCategoryIds;
    }

    return resolvePublishedManifestCategoryIds(
        getPublishedManifestCategories(publishedManifest),
        requestedCategoryIds,
        { allowUnresolved: true },
    ).ids;
}

function resolvePublishedManifestAssetIds(manifestAssets, requestedIds) {
    const assetIds = [];
    const unresolved = [];
    const seenAssetIds = new Set();
    const aliasIndex = buildPublishedManifestAssetAliasIndex(manifestAssets);

    for (const requestedId of requestedIds) {
        const normalizedRequestedId = normalizeLookupValue(requestedId);
        if (!normalizedRequestedId) {
            continue;
        }

        const matchedAssetIds = aliasIndex.get(normalizedRequestedId) ?? [];
        if (matchedAssetIds.length === 0) {
            unresolved.push(normalizedRequestedId);
            continue;
        }

        for (const assetId of matchedAssetIds) {
            if (seenAssetIds.has(assetId)) {
                continue;
            }

            seenAssetIds.add(assetId);
            assetIds.push(assetId);
        }
    }

    return {
        ids: assetIds,
        unresolved,
    };
}

function buildPublishedManifestAssetAliasIndex(manifestAssets) {
    const aliasIndex = new Map();

    for (const asset of manifestAssets) {
        const assetId = normalizeLookupValue(asset?.id);
        if (!assetId) {
            continue;
        }

        for (const alias of [asset?.id, asset?.codeName, asset?.parentStructureId, asset?.rootStructureId]) {
            const normalizedAlias = normalizeLookupValue(alias);
            if (!normalizedAlias) {
                continue;
            }

            const existingAliases = aliasIndex.get(normalizedAlias) ?? [];
            if (existingAliases.includes(assetId)) {
                continue;
            }

            existingAliases.push(assetId);
            aliasIndex.set(normalizedAlias, existingAliases);
        }
    }

    return aliasIndex;
}

function resolvePublishedManifestCategoryIds(manifestCategories, requestedIds, options = {}) {
    const categoryIds = [];
    const unresolved = [];
    const seenCategoryIds = new Set();
    const aliasIndex = buildPublishedManifestCategoryAliasIndex(manifestCategories);

    for (const requestedId of requestedIds) {
        const normalizedRequestedId = normalizeLookupValue(requestedId);
        if (!normalizedRequestedId) {
            continue;
        }

        const matchedCategoryIds = aliasIndex.get(normalizedRequestedId);
        if (!matchedCategoryIds || matchedCategoryIds.length === 0) {
            if (options.allowUnresolved) {
                if (seenCategoryIds.has(normalizedRequestedId)) {
                    continue;
                }

                seenCategoryIds.add(normalizedRequestedId);
                categoryIds.push(normalizedRequestedId);
                continue;
            }

            unresolved.push(normalizedRequestedId);
            continue;
        }

        for (const categoryId of matchedCategoryIds) {
            if (seenCategoryIds.has(categoryId)) {
                continue;
            }

            seenCategoryIds.add(categoryId);
            categoryIds.push(categoryId);
        }
    }

    return {
        ids: categoryIds,
        unresolved,
    };
}

function buildPublishedManifestCategoryAliasIndex(manifestCategories) {
    const aliasIndex = new Map();

    for (const category of manifestCategories) {
        const categoryId = normalizeLookupValue(category?.id);
        if (!categoryId) {
            continue;
        }

        for (const alias of [category?.id, category?.name?.fallback, typeof category?.name === 'string' ? category.name : null]) {
            const normalizedAlias = normalizeLookupValue(alias);
            if (!normalizedAlias) {
                continue;
            }

            const existingAliases = aliasIndex.get(normalizedAlias) ?? [];
            if (existingAliases.includes(categoryId)) {
                continue;
            }

            existingAliases.push(categoryId);
            aliasIndex.set(normalizedAlias, existingAliases);
        }
    }

    return aliasIndex;
}

function collectPublishedManifestAssetIdsForCategories(manifestAssets, categoryIds) {
    if (categoryIds.length === 0) {
        return [];
    }

    const categoryIdSet = new Set(categoryIds.map(categoryId => normalizeLookupValue(categoryId)).filter(Boolean));
    return manifestAssets
        .filter(asset => categoryIdSet.has(normalizeLookupValue(asset?.categoryId)))
        .map(asset => normalizeLookupValue(asset?.id))
        .filter(Boolean);
}

function buildPoseEditorArgs(rawArgs, structureId) {
    const parsedArgs = parseCliArgs(rawArgs);
    const outputArgs = [
        renderTemplatePath,
        '--python-exit-code',
        '1',
        '--python',
        blenderPoseEditorScriptPath,
        '--',
        '--index',
        renderScenesIndexPath,
        '--structure-id',
        structureId,
        '--public-root',
        publicRoot,
        '--foxwatch-output-root',
        foxwatchOutputRoot,
        '--override-path',
        getPoseOverridePath(structureId),
        '--replace-existing',
        '--purge-existing',
    ];

    const initialSceneVariant = getNormalizedValues(parsedArgs, 'scene-variant').at(-1);
    if (initialSceneVariant) {
        outputArgs.push('--scene-variant', initialSceneVariant);
    }

    return outputArgs;
}

async function resolveSingleAssetId(parsedArgs) {
    const onlyValues = await getNormalizedAssetIds(parsedArgs, 'only');
    const positionalValues = parsedArgs._.map(value => String(value).trim()).filter(Boolean);
    const rawTargets = [...onlyValues, ...positionalValues];

    if (rawTargets.length !== 1) {
        return null;
    }

    return normalizeAssetTarget(rawTargets[0]);
}

function normalizeAssetTarget(rawTarget) {
    const trimmedTarget = String(rawTarget ?? '').trim();
    if (!trimmedTarget) {
        return null;
    }

    const normalizedTarget = trimmedTarget.replace(/\\/g, '/').replace(/\/+$/, '');
    const anchoredMatch = normalizedTarget.match(/(?:^|\/)(?:asset-overrides|structures|assets)\/([^/]+)(?:\/manifest\.json)?$/i);
    if (anchoredMatch) {
        return anchoredMatch[1].toLowerCase();
    }

    if (!normalizedTarget.includes('/')) {
        return normalizedTarget.toLowerCase();
    }

    if (normalizedTarget.toLowerCase().endsWith('.json')) {
        return path.basename(normalizedTarget, path.extname(normalizedTarget)).toLowerCase();
    }

    return path.basename(normalizedTarget).toLowerCase();
}

function getPoseOverridePath(structureId) {
    return path.join(repoRoot, 'tools', 'foxwatch', 'asset-overrides', structureId, 'default.pose.json');
}

function getManifestOverridePath(assetId) {
    return path.join(repoRoot, 'tools', 'foxwatch', 'asset-overrides', assetId, 'manifest.json');
}

async function buildManifestOverrideScaffold(assetId) {
    const currentAsset = await readPublishedManifestAsset(assetId);
    if (!currentAsset) {
        return {};
    }

    const scaffold = {};
    if (typeof currentAsset.categoryId === 'string' && currentAsset.categoryId) {
        scaffold.categoryId = currentAsset.categoryId;
    }

    if (typeof currentAsset.previewDirection === 'string' && currentAsset.previewDirection) {
        scaffold.previewDirection = currentAsset.previewDirection;
    }

    if (currentAsset.clipFloor === true) {
        scaffold.clipFloor = true;
    }

    return scaffold;
}

async function watchManifestRefresh(assetId, filePath) {
    let lastSignature = await readFileSignature(filePath);
    let debounceTimer = null;
    let refreshInFlight = false;
    let refreshQueued = false;
    let stopped = false;

    const cleanup = () => {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }

        nativeFs.unwatchFile(filePath, onWatchChange);
        process.off('SIGINT', handleStop);
        process.off('SIGTERM', handleStop);
    };

    const scheduleRefresh = () => {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            void triggerRefresh();
        }, 250);
    };

    const triggerRefresh = async () => {
        if (refreshInFlight) {
            refreshQueued = true;
            return;
        }

        refreshInFlight = true;
        try {
            console.log(`Detected manifest save for ${assetId}; running targeted refresh...`);
            await run('node', [runnerScriptPath, 'refresh', '--only', assetId]);
            console.log(`Completed targeted refresh for ${assetId}.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Targeted refresh failed for ${assetId}: ${message}`);
        } finally {
            refreshInFlight = false;
            if (refreshQueued && !stopped) {
                refreshQueued = false;
                scheduleRefresh();
            }
        }
    };

    const onWatchChange = async () => {
        if (stopped) {
            return;
        }

        const nextSignature = await readFileSignature(filePath);
        if (nextSignature === lastSignature) {
            return;
        }

        lastSignature = nextSignature;
        scheduleRefresh();
    };

    const handleStop = () => {
        if (stopped) {
            return;
        }

        stopped = true;
        cleanup();
    };

    nativeFs.watchFile(filePath, { interval: 300 }, onWatchChange);
    process.on('SIGINT', handleStop);
    process.on('SIGTERM', handleStop);

    return new Promise(resolve => {
        const settleIfStopped = () => {
            if (!stopped) {
                return;
            }

            resolve();
        };

        process.on('SIGINT', settleIfStopped);
        process.on('SIGTERM', settleIfStopped);
    });
}

async function readClipboardAssetId() {
    const clipboardText = await readClipboardText();
    if (!clipboardText) {
        return null;
    }

    return normalizeAssetIdValue(clipboardText);
}

async function readClipboardText() {
    if (process.platform === 'win32') {
        return runQuietCapture('powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard -Raw']);
    }

    if (process.platform === 'darwin') {
        return runQuietCapture('pbpaste', []);
    }

    const waylandClipboard = await runQuietCapture('wl-paste', ['--no-newline']);
    if (waylandClipboard) {
        return waylandClipboard;
    }

    return runQuietCapture('xclip', ['-selection', 'clipboard', '-o']);
}

async function readPublishedManifest() {
    try {
        const rawManifestDocument = await fs.readFile(publishedManifestPath, 'utf8');
        return JSON.parse(rawManifestDocument);
    } catch {
        return null;
    }
}

async function readPublishedManifestAsset(assetId) {
    const manifestDocument = await readPublishedManifest();
    if (!manifestDocument) {
        return null;
    }

    const normalizedAssetId = normalizeLookupValue(assetId);
    if (!normalizedAssetId) {
        return null;
    }

    return getPublishedManifestAssets(manifestDocument)
        .find(asset => normalizeLookupValue(asset?.id) === normalizedAssetId) ?? null;
}

function getPublishedManifestAssets(manifestDocument) {
    if (Array.isArray(manifestDocument?.assets)) {
        return manifestDocument.assets;
    }

    return [
        ...(Array.isArray(manifestDocument?.structures) ? manifestDocument.structures : []),
        ...(Array.isArray(manifestDocument?.items) ? manifestDocument.items : []),
        ...(Array.isArray(manifestDocument?.vehicles) ? manifestDocument.vehicles : []),
    ];
}

function getPublishedManifestCategories(manifestDocument) {
    return Array.isArray(manifestDocument?.categories)
        ? manifestDocument.categories
        : [];
}

async function pathExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return false;
        }

        throw error;
    }
}

async function openDocumentInEditor(filePath) {
    const editorArgs = ['-r', '-g', filePath];
    if (await tryRunQuiet('code', editorArgs)) {
        return true;
    }

    if (await tryRunQuiet('code-insiders', editorArgs)) {
        return true;
    }

    if (process.platform === 'win32') {
        return tryRunQuiet('cmd.exe', ['/d', '/s', '/c', 'start', '', filePath]);
    }

    if (process.platform === 'darwin') {
        return tryRunQuiet('open', [filePath]);
    }

    return tryRunQuiet('xdg-open', [filePath]);
}

function tryRunQuiet(executable, commandArgs) {
    return new Promise(resolve => {
        const child = spawn(executable, commandArgs, {
            cwd: repoRoot,
            stdio: 'ignore',
            shell: false,
        });

        child.on('error', () => resolve(false));
        child.on('exit', code => resolve(code === 0));
    });
}

function runQuietCapture(executable, commandArgs) {
    return new Promise(resolve => {
        const child = spawn(executable, commandArgs, {
            cwd: repoRoot,
            stdio: ['ignore', 'pipe', 'ignore'],
            shell: false,
        });

        let stdout = '';
        child.stdout.on('data', chunk => {
            stdout += chunk.toString();
        });

        child.on('error', () => resolve(null));
        child.on('exit', code => {
            if (code !== 0) {
                resolve(null);
                return;
            }

            const trimmedOutput = stdout.trim();
            resolve(trimmedOutput || null);
        });
    });
}

async function publishPlannerCompat() {
    await run('node', [publishPlannerCompatScriptPath]);
}

async function readFileSignature(filePath) {
    try {
        const buffer = await fs.readFile(filePath);
        return createHash('sha256').update(buffer).digest('hex');
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return null;
        }

        throw error;
    }
}

async function sceneHasSerializedPoses(scenePath) {
    try {
        const rawSceneDocument = await fs.readFile(scenePath, 'utf8');
        const sceneDocument = JSON.parse(rawSceneDocument);
        return walkSceneNodes(sceneDocument?.scene?.roots).some(node => node?.pose || node?.poseVariants);
    } catch {
        return false;
    }
}

function walkSceneNodes(nodes) {
    const pendingNodes = [...(Array.isArray(nodes) ? nodes : [])];
    const flattenedNodes = [];

    while (pendingNodes.length > 0) {
        const currentNode = pendingNodes.shift();
        if (!currentNode || typeof currentNode !== 'object') {
            continue;
        }

        flattenedNodes.push(currentNode);
        if (Array.isArray(currentNode.children)) {
            pendingNodes.push(...currentNode.children);
        }
    }

    return flattenedNodes;
}
