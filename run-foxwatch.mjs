import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import nativeFs from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const [, , command, ...commandArgs] = process.argv;
const rawArgs = commandArgs.filter(arg => arg !== '--');

if (!command) {
    console.error('Usage: node ./tools/foxwatch/run-foxwatch.mjs <foxwatch-command> [...args]');
    process.exit(1);
}

const repoRoot = process.cwd();
const foxholePlannerRoot = path.join(repoRoot, 'apps', 'foxhole-planner');
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
const blenderExecutable = process.env.BLENDER_PATH || 'blender';
const publishManifestScriptPath = path.join(repoRoot, 'tools', 'foxwatch', 'scripts', 'publish-manifest.mjs');
const publishPlannerCompatScriptPath = path.join(repoRoot, 'tools', 'foxwatch', 'scripts', 'publish-planner-compat.mjs');
const runnerScriptPath = path.join(repoRoot, 'tools', 'foxwatch', 'run-foxwatch.mjs');
const inheritNpmConfigArguments = Boolean(process.env.npm_lifecycle_event);
const defaultIconOverrideExtensions = ['.webp', '.png', '.jpg', '.jpeg'];

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
appendNpmConfigArgument(args, 'mod');

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
    await runNpm(['run', 'build:foxwatch']);
    await run('dotnet', [dllPath, 'generate-manifest', ...refreshExecution.foxwatchArgs]);
    await run('dotnet', [dllPath, 'generate-render-scenes', ...refreshExecution.foxwatchArgs]);
    await run(blenderExecutable, buildBlenderArgs(args, {
        purgeExistingByDefault: true,
        onlyIds: refreshExecution.onlyIds
            ? [...new Set([...refreshExecution.onlyIds, 'packaged-pallets'])]
            : refreshExecution.onlyIds,
    }));
    await run('node', ['--experimental-strip-types', publishManifestScriptPath, ...refreshExecution.publishArgs]);
    await publishPlannerCompat();
    await syncMissingStructureDefaultIcons(rawFoxWatchManifestPath, refreshExecution.onlyIds, {
        skipExistingAssets: hasCliFlag(parsedArgs, 'skip-existing-assets'),
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

function run(executable, commandArgs) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, commandArgs, {
            cwd: repoRoot,
            stdio: 'inherit',
            shell: false,
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
    console.log(`${actionLabel} ${path.relative(repoRoot, sourcePath)} -> ${path.relative(repoRoot, targetPath)}`);
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

    for (const optionName of ['limit', 'public-root', 'foxwatch-output-root', 'pixels-per-meter', 'preview-size', 'icon-size']) {
        const values = parsedArgs[optionName] ?? [];
        if (values.length > 0) {
            outputArgs.push(`--${optionName}`, values.at(-1));
        }
    }

    for (const optionName of ['mode', 'scene-variant']) {
        appendRepeatedArgs(outputArgs, optionName, getNormalizedValues(parsedArgs, optionName));
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

    for (const optionName of flagOptions) {
        outputArgs.push(`--${optionName}`);
    }

    return outputArgs;
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

    return outputArgs;
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
