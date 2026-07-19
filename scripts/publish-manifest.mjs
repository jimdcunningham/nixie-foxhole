import { readFileSync } from 'node:fs';
import { access, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { imageDataHasVisiblePixels } from './publish-render-utils.mjs';
import { composeSubtypeIcon } from './publish-icon-utils.mjs';
import {
    collectStructureIdsWithDestroyedRenderScenesFromDirectory,
    getCoLocatedStructureAssetFileName,
    hasRawDestroyedRenderAssets,
    publishStructureIconsForManifest,
    resolveGeneratedIconFilePathForAssetId,
    resolveSubtypeOverlayUrl,
    sanitizeVehicleDestroyedVisuals,
    shouldSyncRenderedAssetToPublic,
    structureHasResolvableDestroyedRenderScene,
} from './publish-structure-icons.mjs';
import {
    coLocateSingleUseHostLocalModificationDefaultIcons,
    removePublicIconsByKey,
} from './publish-modification-default-icons.mjs';
import {
    assertUniqueHostModificationVariantRenderIds,
    buildHostLocalModificationRenderLookupKeys,
    canShareModificationVariant,
    hasStandaloneModificationContentHashSuffix,
    isHashedHostLocalModificationDirectoryName,
    isSharedModificationRenderSceneEntry,
    resolveAssetScopedModificationRenderEntry,
} from './modification-storage-policy.mjs';
import {
    buildRenderIdComputation,
    buildSharedModificationIdComputation,
    createSharedModificationHashDiagnosticInput,
    getStandaloneModificationIdentityText,
    normalizeStandaloneModificationIdentityPart,
    normalizeStandaloneModificationKeyComponent,
} from './shared-modification-id.mjs';
import { configurePublishLogging, isPublishVerbose, logPublishDetail, logPublishSummary, logPublishWarn } from './publish-log.mjs';
import { getDefaultPublishConcurrency, mapWithConcurrency } from './publish-concurrency.mjs';
import {
    augmentTargetedOnlyPublishedStructures,
    getExplicitlyRemovedStructureIdsForTargetedPublish,
    loadAuthoredStructureMarkedCargoOverlays,
    loadAuthoredStructurePreviewDirections,
    preserveAuthoredStructureMarkedCargoOverlays,
    preserveAuthoredStructurePreviewDirections,
    shouldPublishVehicleDestroyedVisual,
} from './publish-manifest-overrides.mjs';
import { loadVehicleDestroyedPublishAllowlist } from './vehicle-destroyed-allowlist.mjs';

import {
    createFoxholeAssetsBaseUrl,
    foxholeManifestSchema,
    normalizeFoxholePackagedPalletKey,
    rebaseFoxholeManifestAssetUrls,
} from '../../../apps/foxhole-planner/app/plugins/foxhole/nixie/manifest-schema.ts';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDir, '..', '..', '..');
const foxholePlannerRoot = resolve(repositoryRoot, 'apps', 'foxhole-planner');
const publicFoxholeAssetsDirectory = resolve(foxholePlannerRoot, 'public', 'foxhole', 'assets');
const publishedManifestPath = resolve(publicFoxholeAssetsDirectory, 'manifest.v1.json');
const rawFoxWatchManifestPath = resolve(repositoryRoot, 'tools/foxwatch/tmp/foxwatch-manifest.v1.json');
const modificationRenderIndexPath = resolve(repositoryRoot, 'tools/foxwatch/tmp/modification-render-index.v1.json');
const publicIconsDirectory = resolve(publicFoxholeAssetsDirectory, 'icons');
const assetTypesDirectory = resolve(publicFoxholeAssetsDirectory, 'types');
const sharedAssetsDirectory = resolve(publicFoxholeAssetsDirectory, 'shared');
const rawRenderedAssetsRootDirectory = resolve(repositoryRoot, 'tools/foxwatch/tmp/rendered-assets');
const rawRenderedAssetTypesDirectory = resolve(rawRenderedAssetsRootDirectory, 'types');
const rawRenderedSharedAssetsDirectory = resolve(rawRenderedAssetsRootDirectory, 'shared');
const generatedIconsDirectory = resolve(repositoryRoot, 'tools/foxwatch/tmp/foxhole-icons');
const sourceGameAssetsDirectory = resolve(publicFoxholeAssetsDirectory, 'game');
const renderScenesDirectory = resolve(repositoryRoot, 'tools/foxwatch/tmp/renders');
const renderScenesIndexPath = resolve(renderScenesDirectory, 'index.render-scenes.v1.json');
const publicLocalizationsDirectory = resolve(publicFoxholeAssetsDirectory, 'localizations');
const fixtureManifestPath = resolve(repositoryRoot, 'tests/fixtures/foxhole/manifest.v1.fixture.json');
const fixtureLocalizationsDirectory = resolve(repositoryRoot, 'tests/fixtures/foxhole/localizations');
const sharedModificationOverrideManifestPath = resolve(repositoryRoot, 'tools/foxwatch/asset-overrides/modifications.json');
const defaultWreckedSubtypeIconUrl = '/foxhole/assets/icons/subtypewreckedicon.webp';
const sharedModificationHashDiagnosticsDirectory = resolve(repositoryRoot, 'tools/foxwatch/tmp/diagnostics/shared-modification-hash');

const iconSourceExtensions = new Set(['.png', '.jpg', '.jpeg']);
const publishedImageSourceExtensions = ['.png', '.jpg', '.jpeg', '.webp'];
const rawRenderedImageSourceExtensions = ['.webp', ...iconSourceExtensions];
const losslessPublishedWebpOptions = { lossless: true, quality: 100, effort: 6 };
const lossyPreviewWebpOptions = { quality: 90, alphaQuality: 100, effort: 6 };
const lossyRenderedIconWebpOptions = { quality: 90, effort: 6 };
const maxRenderedIconEdgePx = 256;
const fileSystemRetryDelayMs = [50, 100, 250, 500, 1000, 2000, 4000];
const retryableFileSystemErrorCodes = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'EPERM', 'UNKNOWN']);
const retryableFileSystemMessageFragments = [
    'operation not permitted',
    'resource busy or locked',
    'too many open files',
    'unknown error, open',
];
const assetTypeNames = ['items', 'structures', 'vehicles'];
const sharedPackagingTargetKeys = ['normal', 'large', 'extralarge'];
const renderedPublishedIconFallbackFileNameByKey = new Map([
    ['onewaytrenchitemicon', 'oneway.icon.rendered.webp'],
    ['powerlineattachment', 'powerconnection.icon.rendered.webp'],
    ['trenchsandbagitemicon', 'sandbags.icon.rendered.webp'],
]);
const sourcePublishedIconAliasByKey = new Map([
    ['onewaytrenchitemicon', 'trencht3emplacementicon'],
    ['powerlineattachment', 'powerlineb'],
    ['trenchsandbagitemicon', 'sandbagsstructureicon'],
]);
let publishedAssetTypeById = new Map();
let sourcePublishedIconPathByKeyPromise = null;
let renderedPublishedIconFallbackPathByKeyPromise = null;
let publishedSharedModificationIdsCache = null;
const renderVisibilityByFilePath = new Map();
let temporaryFileWriteSequence = 0;

const cliArgs = parseCliArgs(process.argv.slice(2));
const targetFilter = {
    only: new Set(getNormalizedValues(cliArgs, 'only').map(normalizeId)),
    category: new Set(getNormalizedValues(cliArgs, 'category').map(normalizeId)),
};
const skipExistingAssets = hasCliFlag(cliArgs, 'skip-existing-assets');
configurePublishLogging({ verbose: hasCliFlag(cliArgs, 'verbose') });
const defaultPublishConcurrency = getDefaultPublishConcurrency();
const publishConcurrency = getPositiveIntegerCliValue(cliArgs, 'publish-concurrency', defaultPublishConcurrency);
const assetOverridesDirectory = resolve(repositoryRoot, 'tools/foxwatch/asset-overrides');
const sharedModificationHashDiagnostics = {
    source: 'publish-manifest',
    runId: createSharedModificationHashDiagnosticsRunId(),
    generatedAtUtc: new Date().toISOString(),
    processId: process.pid,
    argv: process.argv.slice(2),
    targetFilter: {
        only: [...targetFilter.only].sort((left, right) => left.localeCompare(right)),
        category: [...targetFilter.category].sort((left, right) => left.localeCompare(right)),
    },
    entryCount: 0,
    entries: [],
};

function createSharedModificationHashDiagnosticsRunId() {
    return `${new Date().toISOString().replace(/[.:]/g, '-')}-pid${process.pid}`;
}

function cloneSharedModificationHashDiagnosticValue(value) {
    if (typeof value === 'undefined') {
        return undefined;
    }

    return JSON.parse(JSON.stringify(value));
}

function recordSharedModificationHashDiagnostic(entry) {
    sharedModificationHashDiagnostics.entries.push({
        loggedAtUtc: new Date().toISOString(),
        ...entry,
    });
}

async function writeSharedModificationHashDiagnostics(extra = {}) {
    await mkdir(sharedModificationHashDiagnosticsDirectory, { recursive: true });
    const outputPath = resolve(sharedModificationHashDiagnosticsDirectory, `${sharedModificationHashDiagnostics.runId}-publish-manifest.json`);
    const document = {
        ...sharedModificationHashDiagnostics,
        ...extra,
        entryCount: sharedModificationHashDiagnostics.entries.length,
    };
    await writeFileWithRetries(outputPath, `${stringifyJsonAscii(document)}\n`, 'utf8');
    logPublishDetail(`wrote ${outputPath}`);
}

async function* walkFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) {
            yield* walkFiles(fullPath);
            continue;
        }

        if (entry.isFile()) {
            yield fullPath;
        }
    }
}

async function pathExists(path) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

async function shouldReuseExistingAssetOutput(outputPath) {
    return skipExistingAssets && await pathExists(outputPath);
}

function normalizeFileSystemPath(value) {
    return String(value ?? '').replace(/\\/g, '/').toLowerCase();
}

function isMissingFileSystemError(error) {
    return String(error?.code ?? '').toUpperCase() === 'ENOENT';
}

function isRetryableFileSystemError(error) {
    const code = String(error?.code ?? '').toUpperCase();
    if (retryableFileSystemErrorCodes.has(code)) {
        return true;
    }

    const message = String(error?.message ?? '').toLowerCase();
    return retryableFileSystemMessageFragments.some(fragment => message.includes(fragment));
}

function waitForFileSystemRetry(delayMs) {
    return new Promise(resolve => setTimeout(resolve, delayMs));
}

async function withFileSystemRetries(operation) {
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            if (!isRetryableFileSystemError(error) || attempt >= fileSystemRetryDelayMs.length) {
                throw error;
            }

            await waitForFileSystemRetry(fileSystemRetryDelayMs[attempt]);
        }
    }
}

async function readFileWithRetries(filePath, options) {
    return await withFileSystemRetries(() => readFile(filePath, options));
}

function createTemporaryFileWritePath(filePath) {
    temporaryFileWriteSequence += 1;
    return resolve(
        dirname(filePath),
        `.${basename(filePath)}.${process.pid}.${temporaryFileWriteSequence}.tmp`,
    );
}

async function writeFileWithRetries(filePath, content, options) {
    const temporaryFilePath = createTemporaryFileWritePath(filePath);
    await mkdir(dirname(filePath), { recursive: true });

    try {
        await withFileSystemRetries(() => writeFile(temporaryFilePath, content, options));
        await withFileSystemRetries(() => rename(temporaryFilePath, filePath));
    } catch (error) {
        await rm(temporaryFilePath, { force: true }).catch(() => {});
        throw error;
    }
}

async function getSourcePublishedIconPathByKey() {
    if (!sourcePublishedIconPathByKeyPromise) {
        sourcePublishedIconPathByKeyPromise = (async () => {
            const sourcePaths = new Map();
            if (!await pathExists(sourceGameAssetsDirectory)) {
                return sourcePaths;
            }

            for await (const filePath of walkFiles(sourceGameAssetsDirectory)) {
                const extension = extname(filePath).toLowerCase();
                if (extension !== '.webp' && !iconSourceExtensions.has(extension)) {
                    continue;
                }

                const fileKey = normalizeId(basename(filePath, extension));
                if (fileKey && !sourcePaths.has(fileKey)) {
                    sourcePaths.set(fileKey, filePath);
                }

                if (fileKey?.endsWith('icon')) {
                    const aliasKey = fileKey.slice(0, -'icon'.length);
                    if (aliasKey && !sourcePaths.has(aliasKey)) {
                        sourcePaths.set(aliasKey, filePath);
                    }
                }
            }

            return sourcePaths;
        })();
    }

    return sourcePublishedIconPathByKeyPromise;
}

async function getRenderedPublishedIconFallbackPathByKey() {
    if (!renderedPublishedIconFallbackPathByKeyPromise) {
        renderedPublishedIconFallbackPathByKeyPromise = (async () => {
            const fallbackPaths = new Map();
            if (!await pathExists(publicFoxholeAssetsDirectory)) {
                return fallbackPaths;
            }

            const fileNameToKey = new Map([...renderedPublishedIconFallbackFileNameByKey]
                .map(([fileKey, fileName]) => [fileName, fileKey]));
            for await (const filePath of walkFiles(publicFoxholeAssetsDirectory)) {
                const fileKey = fileNameToKey.get(basename(filePath));
                if (fileKey && !fallbackPaths.has(fileKey)) {
                    fallbackPaths.set(fileKey, filePath);
                }
            }

            return fallbackPaths;
        })();
    }

    return renderedPublishedIconFallbackPathByKeyPromise;
}

function getPublishedIconKey(value) {
    const urlKey = extractPublishedIconKey(value);
    if (urlKey) {
        return urlKey;
    }

    const extension = extname(String(value ?? ''));
    return normalizeId(basename(String(value ?? ''), extension));
}

function resolveExistingPublishedIconFilePath(value) {
    const normalizedValue = String(value ?? '').trim();
    if (!normalizedValue.startsWith(createFoxholeAssetsBaseUrl('/'))) {
        return null;
    }

    return resolve(
        publicFoxholeAssetsDirectory,
        normalizedValue
            .replace(`${createFoxholeAssetsBaseUrl('/')}`, '')
            .replace(/\//g, '\\'),
    );
}

async function resolvePublishedIconSourceFilePath(directory, value) {
    const fileKey = getPublishedIconKey(value);
    if (!fileKey) {
        return null;
    }

    if (await pathExists(directory)) {
        for (const extension of publishedImageSourceExtensions) {
            const generatedPath = resolve(directory, `${fileKey}${extension}`);
            if (await pathExists(generatedPath)) {
                return generatedPath;
            }
        }
    }

    const existingPublishedIconFilePath = resolveExistingPublishedIconFilePath(value);
    if (existingPublishedIconFilePath && await pathExists(existingPublishedIconFilePath)) {
        return existingPublishedIconFilePath;
    }

    const sourcePathByKey = await getSourcePublishedIconPathByKey();
    const sourcePath = sourcePathByKey.get(fileKey);
    if (sourcePath) {
        return sourcePath;
    }

    const renderedFallbackPathByKey = await getRenderedPublishedIconFallbackPathByKey();
    const renderedFallbackPath = renderedFallbackPathByKey.get(fileKey);
    if (renderedFallbackPath) {
        return renderedFallbackPath;
    }

    const sourceAliasKey = sourcePublishedIconAliasByKey.get(fileKey);
    return sourceAliasKey ? sourcePathByKey.get(sourceAliasKey) ?? null : null;
}

async function readPublishedIconSourceFile(directory, value) {
    const sourceFilePath = await resolvePublishedIconSourceFilePath(directory, value);
    if (!sourceFilePath) {
        throw new Error(`could not resolve source file for published icon ${String(value ?? '')}`);
    }

    return {
        sourceFilePath,
        content: await readImageContentAsWebp(sourceFilePath),
    };
}

function resolveRawRenderedAssetWebpOptions(outputPath) {
    const normalizedOutputPath = normalizeFileSystemPath(outputPath);
    if (normalizedOutputPath.endsWith('.preview.webp')) {
        return lossyPreviewWebpOptions;
    }

    if (normalizedOutputPath.endsWith('.icon.rendered.webp')) {
        return lossyRenderedIconWebpOptions;
    }

    return losslessPublishedWebpOptions;
}

function resolveSubtypeComposedAssetWebpOptions(assetKind) {
    return losslessPublishedWebpOptions;
}

async function readImageContentAsWebp(filePath, webpOptions = losslessPublishedWebpOptions) {
    const sourceContent = await readFileWithRetries(filePath);
    if (extname(filePath).toLowerCase() === '.webp') {
        return sourceContent;
    }

    return await sharp(sourceContent).webp(webpOptions).toBuffer();
}

async function writeFileIfChanged(filePath, content) {
    const nextContent = typeof content === 'string'
        ? Buffer.from(content, 'utf8')
        : content;

    try {
        const existingContent = await readFileWithRetries(filePath);
        if (Buffer.compare(existingContent, nextContent) === 0) {
            return false;
        }
    } catch (error) {
        if (!isMissingFileSystemError(error)) {
            throw error;
        }

        // Missing files should fall through to the write.
    }

    await writeFileWithRetries(filePath, nextContent);
    return true;
}

function sortObjectEntries(value) {
    return Object.fromEntries(
        Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right)),
    );
}

function escapeJsonCharacter(character) {
    const codePoint = character.codePointAt(0);
    if (typeof codePoint !== 'number') {
        return character;
    }

    if (codePoint <= 0xFFFF) {
        return `\\u${codePoint.toString(16).padStart(4, '0')}`;
    }

    const adjusted = codePoint - 0x10000;
    const highSurrogate = 0xD800 + (adjusted >> 10);
    const lowSurrogate = 0xDC00 + (adjusted & 0x3FF);
    return `\\u${highSurrogate.toString(16).padStart(4, '0')}\\u${lowSurrogate.toString(16).padStart(4, '0')}`;
}

function stringifyJsonAscii(value) {
    return `${JSON.stringify(value, null, 2).replace(/[\u0080-\u{10FFFF}]/gu, escapeJsonCharacter)}\n`;
}

function normalizeLocalizationBundles(localizations) {
    return [...(localizations ?? [])]
        .map(bundle => ({
            ...bundle,
            locale: String(bundle?.locale ?? '').trim().toLowerCase(),
            strings: sortObjectEntries(bundle?.strings),
        }))
        .filter(bundle => bundle.locale);
}

function getManifestBaseAssetsUrl(manifest) {
    for (const bundle of normalizeLocalizationBundles(manifest?.localizations)) {
        const baseAssetsUrl = String(bundle?.strings?.['foxhole:meta:baseAssetsUrl'] ?? '').trim();
        if (baseAssetsUrl) {
            return baseAssetsUrl;
        }
    }

    return createFoxholeAssetsBaseUrl('/');
}

function normalizeOptionalStructureProperties(manifest) {
    return {
        ...manifest,
        assets: (manifest?.assets ?? []).map(structure => {
            if (!Array.isArray(structure?.renderLayers) || structure.renderLayers.length > 0) {
                return structure;
            }

            const { renderLayers, ...nextStructure } = structure;
            return nextStructure;
        }),
    };
}

function getSourceStructureMetadataById(manifest) {
    return manifest?.__sourceStructureMetadataById instanceof Map
        ? manifest.__sourceStructureMetadataById
        : null;
}

function attachSourceStructureMetadata(manifest, sourceStructureMetadataById) {
    const metadataById = sourceStructureMetadataById instanceof Map
        ? sourceStructureMetadataById
        : getSourceStructureMetadataById(manifest);
    if (!(metadataById instanceof Map) || !manifest || typeof manifest !== 'object') {
        return manifest;
    }

    Object.defineProperty(manifest, '__sourceStructureMetadataById', {
        value: metadataById,
        enumerable: false,
        configurable: false,
        writable: false,
    });
    return manifest;
}

function attachSharedModificationDefaultIconSourceMetadata(manifest, sharedModificationDefaultIconSourceById) {
    if (!(sharedModificationDefaultIconSourceById instanceof Map) || !manifest || typeof manifest !== 'object') {
        return manifest;
    }

    Object.defineProperty(manifest, '__sharedModificationDefaultIconSourceById', {
        value: sharedModificationDefaultIconSourceById,
        enumerable: false,
        configurable: false,
        writable: false,
    });
    return manifest;
}

function attachSharedModificationSourceMetadata(manifest, sharedModificationSourceById) {
    if (!(sharedModificationSourceById instanceof Map) || !manifest || typeof manifest !== 'object') {
        return manifest;
    }

    Object.defineProperty(manifest, '__sharedModificationSourceById', {
        value: sharedModificationSourceById,
        enumerable: false,
        configurable: false,
        writable: false,
    });
    return manifest;
}

function normalizeFileSystemPathForComparison(value) {
    return String(value ?? '').replace(/\\/g, '/').toLowerCase();
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isEmptyPlainObject(value) {
    return isPlainObject(value) && Object.keys(value).length === 0;
}

function isJsonEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function compactJsonValue(value) {
    if (Array.isArray(value)) {
        return value.map(entry => compactJsonValue(entry));
    }

    if (typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value)) {
        return Number(value.toFixed(3));
    }

    if (!isPlainObject(value)) {
        return value;
    }

    return Object.fromEntries(Object.entries(value)
        .map(([key, entryValue]) => [key, compactJsonValue(entryValue)])
        .filter(([, entryValue]) => typeof entryValue !== 'undefined'));
}

function compactObject(value, defaults = {}, transforms = {}) {
    if (!isPlainObject(value)) {
        return value;
    }

    const entries = [];
    for (const [key, rawEntryValue] of Object.entries(value)) {
        const compactedEntryValue = transforms[key]
            ? transforms[key](rawEntryValue)
            : compactJsonValue(rawEntryValue);
        if (typeof compactedEntryValue === 'undefined') {
            continue;
        }

        if (hasOwn(defaults, key) && isJsonEqual(compactedEntryValue, defaults[key])) {
            continue;
        }

        entries.push([key, compactedEntryValue]);
    }

    return Object.fromEntries(entries);
}

function compactNullableObject(value, defaults = {}, transforms = {}) {
    if (value == null) {
        return undefined;
    }

    const compacted = compactObject(value, defaults, transforms);
    return isEmptyPlainObject(compacted) ? undefined : compacted;
}

function compactArray(value, compactEntry = compactJsonValue) {
    return Array.isArray(value) ? value.map(entry => compactEntry(entry)) : value;
}

function compactBounds3d(value) {
    return compactNullableObject(value, {}, {
        min: entryValue => compactArray(entryValue),
        max: entryValue => compactArray(entryValue),
        transformMatrix: entryValue => compactArray(entryValue),
    });
}

function compactStringRecord(value) {
    return isPlainObject(value) ? sortObjectEntries(value) : value;
}

function compactLocalizationId(value) {
    if (typeof value !== 'string') {
        return value;
    }

    return value.trim()
        .replace(/^foxhole:/, '')
        .replace(/^structure:/, 'asset:')
        .replace(/:modification:/g, ':mod:')
        .replace(/:description$/, ':desc');
}

function compactLocalizationStringRecord(value) {
    if (!isPlainObject(value)) {
        return value;
    }

    const entries = new Map();
    for (const [key, entryValue] of Object.entries(value)) {
        const compactedKey = compactLocalizationId(key);
        entries.set(compactedKey, entryValue);
    }

    return sortObjectEntries(Object.fromEntries(entries));
}

function compactManifestLocalizationIds(manifest) {
    return {
        ...manifest,
        localizations: normalizeLocalizationBundles(manifest.localizations).map(bundle => ({
            ...bundle,
            strings: compactLocalizationStringRecord(bundle.strings),
        })),
    };
}

function compactLocalizedText(value) {
    if (!isPlainObject(value)) {
        return value;
    }

    const id = typeof value.id === 'string' ? compactLocalizationId(value.id) : '';
    if (id) {
        return id;
    }

    const fallback = typeof value.fallback === 'string' ? compactLocalizationId(value.fallback) : value.fallback;
    if (typeof fallback === 'string' && fallback) {
        return fallback;
    }

    return compactObject({
        ...value,
        id,
        fallback,
    }, {
        fallback: value.id ? value.fallback : undefined,
    });
}

function hasVisibleLocalizedText(value) {
    if (typeof value === 'string') {
        return value.trim().length > 0;
    }

    if (!isPlainObject(value)) {
        return false;
    }

    const id = typeof value.id === 'string' ? value.id.trim() : '';
    const fallback = typeof value.fallback === 'string' ? value.fallback.trim() : '';
    return Boolean(id || fallback);
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

function createGeneratedAssetUrl(asset, suffix) {
    const assetId = normalizeId(asset?.id);
    return `/foxhole/assets/types/${getPublishedAssetTypeName(asset)}/${assetId}/${assetId}${suffix}.webp`;
}

function omitIfGeneratedAssetUrl(asset, value, suffix) {
    return value === createGeneratedAssetUrl(asset, suffix) ? undefined : value;
}

function getSharedModificationAssetPathId(sharedModificationId) {
    const normalizedSharedModificationId = normalizeId(sharedModificationId);
    return normalizedSharedModificationId.replace(/(-[a-f0-9]{12})-\d+$/, '$1');
}

function createGeneratedSharedModificationAssetUrl(sharedModificationId, suffix) {
    const normalizedSharedModificationId = getSharedModificationAssetPathId(sharedModificationId);
    return `/foxhole/assets/shared/modifications/${normalizedSharedModificationId}/${normalizedSharedModificationId}${suffix}.webp`;
}

function omitIfGeneratedSharedModificationAssetUrl(sharedModificationId, value, suffix) {
    return value === createGeneratedSharedModificationAssetUrl(sharedModificationId, suffix) ? undefined : value;
}

function compactIcons(value) {
    const compacted = compactNullableObject(value, {
        default: null,
        rendered: null,
    });
    if (!isPlainObject(compacted)) {
        return compacted;
    }

    if (compacted.rendered && compacted.rendered === compacted.default) {
        delete compacted.rendered;
    }

    return isEmptyPlainObject(compacted) ? undefined : compacted;
}

function compactSprite(value) {
    const normalizedValue = isPlainObject(value)
        ? (() => {
            const { source, ...remainingSprite } = value;
            return hasOwn(value, 'source')
                ? {
                    source,
                    ...remainingSprite,
                }
                : value;
        })()
        : value;

    return compactNullableObject(normalizedValue, {
        width: null,
        height: null,
        anchorX: 0.5,
        anchorY: 0.5,
        offsetX: 0,
        offsetY: 0,
    });
}

function compactTextureVariant(value) {
    return compactNullableObject(value);
}

function stripRedundantPublishedColorVariantFields(structure) {
    if (!isPlainObject(structure)) {
        return structure;
    }

    const colors = Array.isArray(structure.colors) ? structure.colors : [];
    const primaryColor = colors.find(color => color?.textureUrl || color?.previewUrl || color?.renderedIconUrl);
    if (!primaryColor) {
        return structure;
    }

    const nextStructure = { ...structure };
    if (primaryColor.previewUrl && nextStructure.previewUrl === primaryColor.previewUrl) {
        delete nextStructure.previewUrl;
    }

    if (primaryColor.renderedIconUrl && nextStructure.icons?.rendered === primaryColor.renderedIconUrl) {
        nextStructure.icons = { ...nextStructure.icons };
        delete nextStructure.icons.rendered;
    }

    if (primaryColor.textureUrl && nextStructure.variants?.default?.textureUrl === primaryColor.textureUrl) {
        const nextVariants = { ...nextStructure.variants };
        delete nextVariants.default;
        nextStructure.variants = Object.keys(nextVariants).length > 0 ? nextVariants : undefined;
    }

    return nextStructure;
}

function compactTextureVariants(value) {
    return compactNullableObject(value, {
        default: undefined,
        c: undefined,
        w: undefined,
    }, {
        default: compactTextureVariant,
        c: compactTextureVariant,
        w: compactTextureVariant,
    });
}

function compactPowerGridInfo(value) {
    return compactNullableObject(value, {
        powerDelta: null,
        maxConnections: null,
    });
}

function compactSocketTag(value) {
    if (!isPlainObject(value)) {
        return value;
    }

    return compactObject({
        m: compactJsonValue(value.mask),
        c: compactJsonValue(value.category),
        g: value.tag,
    }, {
        m: null,
        c: null,
        g: null,
    });
}

function compactComponentType(value) {
    if (typeof value !== 'string') {
        return value;
    }

    return value.trim().replace(/^Class'\/Script\/[^.']+\.([^']+)'$/, '$1');
}

function compactTechId(value) {
    if (typeof value !== 'string') {
        return value;
    }

    return value.trim().replace(/^ETechID::/, '');
}

function compactEnumToken(value, prefix) {
    if (typeof value !== 'string') {
        return value;
    }

    const normalized = value.trim().replace(prefix, '');
    return normalized ? normalized.toLowerCase() : normalized;
}

function compactConnectorMeshMode(value) {
    return compactEnumToken(value, /^ESplineConnectorMeshMode::/);
}

function compactSplineMeshAxis(value) {
    return compactEnumToken(value, /^ESplineMeshAxis::/);
}

function compactBuildSocket(value) {
    if (!isPlainObject(value)) {
        return value;
    }

    return compactObject({
        n: value.name,
        c: compactComponentType(value.componentType),
        p: value.pipeType,
        t: compactArray(value.socketTags, compactSocketTag),
        x: compactJsonValue(value.x),
        y: compactJsonValue(value.y),
        z: compactJsonValue(value.z),
        r: compactJsonValue(value.rotation),
    }, {
        n: null,
        c: null,
        p: null,
        t: [],
        x: 0,
        y: 0,
        z: 0,
        r: 0,
    });
}

function compactHitPolygon(value) {
    return compactObject(value, {
        shape: [],
    });
}

function compactStructureVolume(value) {
    if (!isPlainObject(value)) {
        return value;
    }

    return compactObject({
        n: value.name,
        l: value.label,
        g: value.category,
        c: compactComponentType(value.componentType),
        x: compactJsonValue(value.x),
        y: compactJsonValue(value.y),
        z: compactJsonValue(value.z),
        w: compactJsonValue(value.width),
        d: compactJsonValue(value.length),
        h: compactJsonValue(value.height),
        r: compactJsonValue(value.rotation),
    }, {
        n: '',
        l: '',
        g: 'other',
        c: null,
        x: 0,
        y: 0,
        z: 0,
        w: null,
        d: null,
        h: null,
        r: 0,
    });
}

function compactVehicleSeat(value) {
    if (!isPlainObject(value)) {
        return value;
    }

    return compactObject({
        n: value.name,
        c: compactComponentType(value.componentType),
        t: value.seatType,
        d: value.seatDirection,
        m: value.mountCodeName,
        mc: compactVehicleSeatMountComponent(value.mountComponent),
        x: compactJsonValue(value.x),
        y: compactJsonValue(value.y),
        z: compactJsonValue(value.z),
        r: compactJsonValue(value.rotation),
    }, {
        n: null,
        c: null,
        t: null,
        d: null,
        m: null,
        mc: undefined,
        x: 0,
        y: 0,
        z: 0,
        r: 0,
    });
}

function compactVehicleSeatMountComponent(value) {
    return compactNullableObject(value, {
        packagePath: null,
        codeName: null,
        displayName: null,
        iconUrl: null,
        ammoName: null,
        compatibleAmmoNames: [],
        isMultiWeapon: false,
    });
}

function compactSpotlight(value) {
    if (!isPlainObject(value)) {
        return value;
    }

    return compactObject({
        n: value.name,
        c: compactComponentType(value.componentType),
        t: value.lightType,
        x: compactJsonValue(value.x),
        y: compactJsonValue(value.y),
        z: compactJsonValue(value.z),
        r: compactJsonValue(value.rotation),
        ps: compactJsonValue(value.planarProjectionScale),
        o: compactJsonValue(value.outerConeAngle),
        i: compactJsonValue(value.innerConeAngle),
        a: compactJsonValue(value.attenuationRadius),
        v: compactJsonValue(value.intensity),
        lc: compactJsonValue(value.lightColor),
        sr: compactJsonValue(value.sourceRadius),
        ssr: compactJsonValue(value.softSourceRadius),
        sl: compactJsonValue(value.sourceLength),
    }, {
        n: null,
        c: null,
        t: null,
        x: 0,
        y: 0,
        z: 0,
        r: 0,
        ps: 1,
        o: null,
        i: null,
        a: null,
        v: null,
        lc: null,
        sr: null,
        ssr: null,
        sl: null,
    });
}

function compactFuelTank(value) {
    if (!isPlainObject(value)) {
        return value;
    }

    return compactObject({
        c: value.codeName,
        q: compactJsonValue(value.capacity),
    }, {
        q: null,
    });
}

function compactStockpile(value) {
    return compactNullableObject(value, {
        totalItemCapacity: null,
        totalCrateCapacity: null,
        itemQuantityLimits: null,
        validItems: null,
    }, {
        itemQuantityLimits: compactStringRecord,
        validItems: entryValue => compactArray(entryValue, compactJsonValue),
    });
}

function compactHoldProfile(value) {
    return compactNullableObject(value, {
        mode: null,
        capacity: null,
        stackLimit: null,
        allowedItems: null,
        itemQuantityLimits: null,
        allowsAnyItem: null,
    }, {
        allowedItems: entryValue => compactArray(entryValue, compactJsonValue),
        itemQuantityLimits: compactStringRecord,
    });
}

function compactMarkedCargoOverlay(value) {
    return compactNullableObject(value, {
        offsetX: undefined,
        offsetY: undefined,
    });
}

function compactRecipeResource(value) {
    if (!isPlainObject(value)) {
        return value;
    }

    return compactObject({
        q: compactJsonValue(value.quantity),
        l: compactJsonValue(value.limit),
    }, {
        l: null,
    });
}

function compactRecipeResourceMap(value) {
    if (!isPlainObject(value)) {
        return value;
    }

    return Object.fromEntries(Object.entries(value)
        .map(([resourceId, resource]) => [resourceId, compactRecipeResource(resource)]));
}

function compactConversionEntry(value) {
    if (!isPlainObject(value)) {
        return value;
    }

    return compactObject({
        ii: compactRecipeResourceMap(value.itemInput),
        ci: compactRecipeResourceMap(value.crateInput),
        li: compactRecipeResourceMap(value.liquidInput),
        io: compactRecipeResourceMap(value.itemOutput),
        co: compactRecipeResourceMap(value.crateOutput),
        lo: compactRecipeResourceMap(value.liquidOutput),
        d: compactJsonValue(value.duration),
        p: compactJsonValue(value.powerDelta),
        rn: compactJsonValue(value.bConsumeResourceNodes),
    }, {
        ii: {},
        ci: {},
        li: {},
        io: {},
        co: {},
        lo: {},
        d: null,
        p: null,
        rn: null,
    });
}

function compactRange(value) {
    if (!isPlainObject(value)) {
        return value;
    }

    return compactObject({
        t: value.type,
        c: value.codeName,
        x: compactJsonValue(value.x),
        y: compactJsonValue(value.y),
        r: compactJsonValue(value.rotation),
        a: compactJsonValue(value.arc),
        mn: compactJsonValue(value.min),
        mx: compactJsonValue(value.max),
        reach: compactJsonValue(value.reach),
        o: compactJsonValue(value.overlap),
    }, {
        c: null,
        x: 0,
        y: 0,
        r: 0,
        a: null,
        mn: null,
        mx: null,
        reach: null,
        o: null,
    });
}

function compactConnectorMeshConfig(value) {
    if (!isPlainObject(value)) {
        return value;
    }

    return compactObject({
        mode: compactConnectorMeshMode(value.mode),
        axis: compactSplineMeshAxis(value.splineMeshAxis),
        length: compactJsonValue(value.nativeMeshLengthCm),
        interval: compactJsonValue(value.interval),
        start: compactJsonValue(value.startOffset),
        end: compactJsonValue(value.endOffset),
        fillRemainder: compactJsonValue(value.fillRemainder),
        extendToMinLength: compactJsonValue(value.extendSplineToMinLength),
        splineStart: compactJsonValue(value.splineStartOffset),
        splineEnd: compactJsonValue(value.splineEndOffset),
        boundaryMin: compactJsonValue(value.splineBoundaryMin),
        boundaryMax: compactJsonValue(value.splineBoundaryMax),
        materialScale: compactJsonValue(value.splineMaterialScaling),
        loc: compactJsonValue(value.relativeLocation),
        scale: compactJsonValue(value.relativeScale),
    }, {
        mode: null,
        axis: null,
        length: null,
        interval: null,
        start: 0,
        end: 0,
        fillRemainder: null,
        extendToMinLength: null,
        splineStart: null,
        splineEnd: null,
        boundaryMin: null,
        boundaryMax: null,
        materialScale: null,
        loc: [0, 0, 0],
        scale: [1, 1, 1],
    });
}

function compactSplineComponentConfig(value) {
    if (!isPlainObject(value)) {
        return value;
    }

    return compactObject({
        n: value.componentName,
        d: compactJsonValue(value.distance),
        loc: compactJsonValue(value.relativeLocation),
        rot: compactJsonValue(value.relativeRotation),
    }, {
        n: null,
        d: null,
        loc: null,
        rot: null,
    });
}

function compactConnector(value) {
    if (!isPlainObject(value)) {
        return undefined;
    }

    return compactObject({
        kind: value.kind,
        isConnector: value.isConnector,
        isManualConnector: value.isManualConnector,
        splineComponentName: value.splineComponentName,
        frontSocketName: value.frontSocketName,
        backSocketName: value.backSocketName,
        minLengthCm: value.minLengthCm,
        maxLengthCm: value.maxLengthCm,
        minWidthCm: value.minWidthCm,
        pathMode: value.pathMode,
        defaultTargetUnrealLocationCm: value.defaultTargetUnrealLocationCm,
        minR: value.minRadiusCm,
        maxR: value.maxRadiusCm,
        buffer: value.maxBufferCm,
        minBuffer: value.minBufferCm,
        enforceRadius: value.enforceSplineModeCornerRadius,
        maxArc: value.maxArcAngleDeg,
        maxTargetAngle: value.maxTargetAngleDeg,
        maxSlope: value.maxSlopeAngleDeg,
        pathStyle: value.pathStyle,
        meshConfigs: Array.isArray(value.meshConfigs)
            ? value.meshConfigs.map(compactConnectorMeshConfig)
            : [],
        configs: Array.isArray(value.componentConfigs)
            ? value.componentConfigs.map(compactSplineComponentConfig)
            : [],
    }, {
        kind: null,
        isConnector: null,
        isManualConnector: null,
        splineComponentName: null,
        frontSocketName: null,
        backSocketName: null,
        minLengthCm: null,
        maxLengthCm: null,
        minWidthCm: null,
        pathMode: null,
        defaultTargetUnrealLocationCm: null,
        minR: null,
        maxR: null,
        buffer: null,
        minBuffer: null,
        enforceRadius: null,
        maxArc: null,
        maxTargetAngle: null,
        maxSlope: null,
        pathStyle: null,
        meshConfigs: [],
        configs: [],
    });
}

function compactStructureRenderLayer(value) {
    if (!isPlainObject(value)) {
        return value;
    }

    return compactObject({
        i: value.id,
        u: value.textureUrl,
        w: compactJsonValue(value.width),
        h: compactJsonValue(value.height),
        ax: compactJsonValue(value.anchorX),
        ay: compactJsonValue(value.anchorY),
        ox: compactJsonValue(value.offsetX),
        oy: compactJsonValue(value.offsetY),
        cn: value.componentName,
        ct: compactArray(value.componentTags, compactJsonValue),
    }, {
        w: null,
        h: null,
        ax: null,
        ay: null,
        ox: 0,
        oy: 0,
        cn: null,
        ct: [],
    });
}

function compactDestroyedStructure(value, asset) {
    if (!isPlainObject(value)) {
        return value == null ? undefined : value;
    }

    const sourceSprite = isPlainObject(value.sprite) ? value.sprite : {};
    const destroyedTextureSource = omitIfGeneratedAssetUrl(asset, sourceSprite.source ?? value.textureUrl, '.destroyed.texture');
    const normalizedValue = {
        ...value,
        icons: isPlainObject(value.icons)
            ? {
                ...value.icons,
                rendered: omitIfGeneratedAssetUrl(asset, value.icons.rendered, '.destroyed.icon.rendered'),
            }
            : value.icons,
        previewIconUrl: value.previewIconUrl === (value.icons?.rendered ?? null)
            ? undefined
            : omitIfGeneratedAssetUrl(asset, value.previewIconUrl, '.destroyed.icon.rendered'),
        previewUrl: omitIfGeneratedAssetUrl(asset, value.previewUrl, '.destroyed.preview'),
        textureUrl: undefined,
        textureWidth: undefined,
        textureHeight: undefined,
        anchorX: undefined,
        anchorY: undefined,
        offsetX: undefined,
        offsetY: undefined,
        sprite: {
            ...sourceSprite,
            source: destroyedTextureSource,
            width: sourceSprite.width ?? value.textureWidth,
            height: sourceSprite.height ?? value.textureHeight,
            anchorX: sourceSprite.anchorX ?? value.anchorX,
            anchorY: sourceSprite.anchorY ?? value.anchorY,
            offsetX: sourceSprite.offsetX ?? value.offsetX,
            offsetY: sourceSprite.offsetY ?? value.offsetY,
        },
    };

    const compacted = compactNullableObject(normalizedValue, {
        componentName: null,
        iconUrl: null,
        previewIconUrl: null,
        previewUrl: null,
        previewDirection: null,
        textureUrl: null,
        textureWidth: null,
        textureHeight: null,
        anchorX: null,
        anchorY: null,
        offsetX: 0,
        offsetY: 0,
    }, {
        icons: compactIcons,
        sprite: compactSprite,
    });

    return compacted?.sprite ? compacted : undefined;
}

function compactPackagedStructure(value, _asset) {
    if (!isPlainObject(value)) {
        return value == null ? undefined : value;
    }

    const sourceSprite = isPlainObject(value.sprite) ? value.sprite : {};
    const packagedTextureSource = omitIfGeneratedAssetUrl(_asset, sourceSprite.source ?? value.textureUrl, '.packaged.texture');
    const normalizedValue = {
        ...value,
        icons: undefined,
        iconUrl: undefined,
        previewIconUrl: undefined,
        previewUrl: undefined,
        previewDirection: undefined,
        textureUrl: undefined,
        textureWidth: undefined,
        textureHeight: undefined,
        anchorX: undefined,
        anchorY: undefined,
        offsetX: undefined,
        offsetY: undefined,
        sprite: {
            ...sourceSprite,
            source: packagedTextureSource,
            width: sourceSprite.width ?? value.textureWidth,
            height: sourceSprite.height ?? value.textureHeight,
            anchorX: sourceSprite.anchorX ?? value.anchorX,
            anchorY: sourceSprite.anchorY ?? value.anchorY,
            offsetX: sourceSprite.offsetX ?? value.offsetX,
            offsetY: sourceSprite.offsetY ?? value.offsetY,
        },
    };

    const compacted = compactNullableObject(normalizedValue, {
        meshPackagePath: null,
        shippableType: null,
        textureUrl: null,
        textureWidth: null,
        textureHeight: null,
        anchorX: null,
        anchorY: null,
        offsetX: 0,
        offsetY: 0,
    }, {
        sprite: compactSprite,
        palletOffset: entryValue => compactNullableObject(entryValue, {
            x: 0,
            y: 0,
            rotationDegrees: 0,
        }),
    });

    return compacted?.shippableType || compacted?.sprite || compacted?.palletOffset ? compacted : undefined;
}

function compactSharedPackagedPallet(value) {
    return compactNullableObject(value, {
        textureUrl: null,
        width: null,
        height: null,
        anchorX: 0.5,
        anchorY: 0.5,
        offsetX: 0,
        offsetY: 0,
    });
}

function compactModificationVariant(value) {
    if (isPlainObject(value)) {
        const sharedModificationId = String(value.sharedModificationId ?? '').trim();
        if (sharedModificationId) {
            return compactObject({
                ...value,
                subTypeIconUrl: undefined,
                icons: undefined,
                previewUrl: undefined,
                previewDirection: undefined,
                sprite: undefined,
            }, {
                modificationId: null,
                requiredSocketConnectionMask: 0,
                hiddenBySocketConnectionMask: 0,
                showInBuildSite: false,
                useTemplateActor: false,
                buildSockets: [],
                footprintPolygons: [],
                fuelTanks: [],
                conversionEntries: [],
                icons: undefined,
                previewUrl: null,
                previewDirection: 'se',
                isUpgrade: false,
                upgradeName: null,
                parentStructureId: null,
                rootStructureId: null,
                appliedModificationId: null,
            }, {
                name: compactLocalizedText,
                description: compactLocalizedText,
                powerGridInfo: compactPowerGridInfo,
                buildSockets: entryValue => compactArray(entryValue, compactBuildSocket),
                footprintPolygons: entryValue => compactArray(entryValue, compactHitPolygon),
                fuelTanks: entryValue => compactArray(entryValue, compactFuelTank),
                conversionEntries: entryValue => compactArray(entryValue, compactConversionEntry),
                icons: compactIcons,
                sprite: compactSprite,
            });
        }
    }

    const normalizedValue = isPlainObject(value)
        ? {
            ...value,
            subTypeIconUrl: undefined,
        }
        : value;

    return compactObject(normalizedValue, {
        modificationId: null,
        requiredSocketConnectionMask: 0,
        hiddenBySocketConnectionMask: 0,
        showInBuildSite: false,
        useTemplateActor: false,
        buildSockets: [],
        footprintPolygons: [],
        fuelTanks: [],
        conversionEntries: [],
        cost: {},
        icons: undefined,
        previewUrl: null,
        previewDirection: 'se',
        isUpgrade: false,
        upgradeName: null,
        parentStructureId: null,
        rootStructureId: null,
        appliedModificationId: null,
        renderLayers: [],
    }, {
        name: compactLocalizedText,
        description: compactLocalizedText,
        powerGridInfo: compactPowerGridInfo,
        buildSockets: entryValue => compactArray(entryValue, compactBuildSocket),
        footprintPolygons: entryValue => compactArray(entryValue, compactHitPolygon),
        fuelTanks: entryValue => compactArray(entryValue, compactFuelTank),
        conversionEntries: entryValue => compactArray(entryValue, compactConversionEntry),
        cost: compactRecipeResourceMap,
        icons: compactIcons,
        sprite: compactSprite,
        renderLayers: entryValue => compactArray(entryValue, compactStructureRenderLayer),
    });
}

function compactSharedModificationVariant(sharedModificationId, value) {
    if (!isPlainObject(value)) {
        return compactModificationVariant(value);
    }

    const sourceIcons = isPlainObject(value.icons) ? value.icons : {};
    const sourceSprite = isPlainObject(value.sprite) ? value.sprite : {};
    const normalizedValue = {
        ...value,
        icons: isPlainObject(value.icons)
            ? {
                ...sourceIcons,
                default: omitIfGeneratedSharedModificationAssetUrl(sharedModificationId, sourceIcons.default, '.icon.default'),
                rendered: omitIfGeneratedSharedModificationAssetUrl(sharedModificationId, sourceIcons.rendered, '.icon.rendered'),
            }
            : value.icons,
        previewUrl: omitIfGeneratedSharedModificationAssetUrl(sharedModificationId, value.previewUrl, '.preview'),
        sprite: {
            ...sourceSprite,
            source: omitIfGeneratedSharedModificationAssetUrl(sharedModificationId, sourceSprite.source, '.texture'),
        },
    };

    const compacted = compactModificationVariant(normalizedValue);
    if (!isPlainObject(compacted)) {
        return compacted;
    }

    if (!hasVisibleLocalizedText(compacted.name)) {
        delete compacted.name;
    }

    if (!hasVisibleLocalizedText(compacted.description)) {
        delete compacted.description;
    }

    return isEmptyPlainObject(compacted) ? undefined : compacted;
}

function compactModificationVariantRecord(value) {
    if (!isPlainObject(value)) {
        return value;
    }

    return sortObjectEntries(Object.fromEntries(Object.entries(value)
        .map(([variantId, variant]) => [variantId, compactModificationVariant(variant)])));
}

function compactModificationSlot(value) {
    return compactObject(value, {
        x: 0,
        y: 0,
        z: 0,
        rotation: 0,
        isLinkedToSocket: false,
        linkedSocketNames: [],
        blockedByModSlotNames: [],
        variants: {},
    }, {
        componentType: compactComponentType,
        variants: compactModificationVariantRecord,
    });
}

function compactModificationSlots(value) {
    return compactArray(value, compactModificationSlot);
}

function getStructurePublishedModificationSlots(structure) {
    if (isStandaloneDestroyedOrBreachedStructure(structure)) {
        return [];
    }

    if (Array.isArray(structure?.modifications)) {
        return structure.modifications;
    }

    if (Array.isArray(structure?.modificationSlots)) {
        return structure.modificationSlots;
    }

    return [];
}

function normalizePublishedModificationPath(manifest) {
    return {
        ...manifest,
        assets: (manifest?.assets ?? []).map(structure => {
            const slots = getStructurePublishedModificationSlots(structure);
            const { modificationSlots: _modificationSlots, modifications: _modifications, ...publishedStructure } = structure;
            return {
                ...publishedStructure,
                ...(slots.length > 0 ? { modifications: slots } : {}),
            };
        }),
    };
}

function compactSharedManifest(value) {
    return compactNullableObject(value, {
        modifications: {},
        packaging: {},
    }, {
        modifications: entryValue => sortObjectEntries(Object.fromEntries(Object.entries(entryValue ?? {})
            .map(([modificationId, modification]) => [modificationId, compactSharedModificationVariant(modificationId, modification)]))),
        packaging: entryValue => sortObjectEntries(Object.fromEntries(Object.entries(entryValue ?? {})
            .map(([shippableType, pallet]) => [shippableType, compactSharedPackagedPallet(pallet)]))),
    });
}

function compactCategory(value) {
    return compactObject(value, {
        iconUrl: null,
        order: 0,
    }, {
        name: compactLocalizedText,
    });
}

function compactStructure(value) {
    const keepPublishedDefaultAssetUrl = assetUrl => assetUrl;
    const keepExplicitItemAssetUrl = (asset, assetUrl, suffix) => (
        asset?.isItem === true
            ? assetUrl
            : omitIfGeneratedAssetUrl(asset, assetUrl, suffix)
    );
    const normalizedValue = stripRedundantPublishedColorVariantFields(isPlainObject(value)
        ? {
            ...value,
            subTypeIconUrl: undefined,
            icons: isPlainObject(value.icons)
                ? {
                    ...value.icons,
                    default: keepPublishedDefaultAssetUrl(value.icons.default),
                    rendered: keepExplicitItemAssetUrl(value, value.icons.rendered, '.icon.rendered'),
                }
                : value.icons,
            iconUrl: keepPublishedDefaultAssetUrl(value.iconUrl),
            previewIconUrl: keepExplicitItemAssetUrl(value, value.previewIconUrl, '.icon.rendered'),
            previewUrl: keepExplicitItemAssetUrl(value, value.previewUrl, '.preview'),
            variants: isPlainObject(value.variants)
                ? {
                    ...value.variants,
                    default: isPlainObject(value.variants.default)
                        ? {
                            ...value.variants.default,
                            textureUrl: keepExplicitItemAssetUrl(value, value.variants.default.textureUrl, '.texture'),
                        }
                        : value.variants.default,
                }
                : value.variants,
        }
        : value);
    const inferredClipFloor = normalizedValue?.isVehicle === true || normalizedValue?.isItem === true ? false : true;

    return compactObject(normalizedValue, {
        buildOrder: 0,
        icons: undefined,
        iconUrl: null,
        previewIconUrl: null,
        previewUrl: null,
        previewDirection: 'se',
        clipFloor: inferredClipFloor,
        clipFloorZ: null,
        clipBounds: null,
        isVehicle: false,
        isBunker: false,
        isFacility: false,
        isWorldStructure: false,
        isDestroyed: false,
        isBreached: false,
        isItem: false,
        canBlueprint: false,
        upgradeStructureCodeName: null,
        conversionCodeNames: [],
        sprite: {},
        renderLayers: [],
        colors: [],
        faction: null,
        tier: null,
        techId: null,
        buildSockets: [],
        footprintPolygons: [],
        structureVolumes: [],
        vehicleSeats: [],
        spotlights: [],
        fuelTanks: [],
        conversionEntries: [],
        ranges: [],
        modifications: [],
        modificationSlots: [],
        cost: {},
        repairCost: null,
        structuralIntegrity: null,
        inventorySlots: null,
        stockpile: null,
        holdProfile: null,
        markedCargoOverlay: null,
        maxHealth: null,
        maxOrders: null,
        buildLocationType: null,
        profileType: null,
        armourType: null,
        mapIntelligenceType: null,
        bIsBuiltOnFoundation: null,
        bBuildOnWater: null,
        bIsBuiltOnLandscape: null,
        hideInList: false,
        isUpgrade: false,
        upgradeName: null,
        parentStructureId: null,
        rootStructureId: null,
        appliedModificationId: null,
    }, {
        name: compactLocalizedText,
        description: compactLocalizedText,
        techId: compactTechId,
        clipBounds: compactBounds3d,
        icons: compactIcons,
        sprite: compactSprite,
        variants: compactTextureVariants,
        destroyed: entryValue => compactDestroyedStructure(entryValue, normalizedValue),
        packaged: entryValue => compactPackagedStructure(entryValue, normalizedValue),
        powerGridInfo: compactPowerGridInfo,
        connector: compactConnector,
        renderLayers: entryValue => compactArray(entryValue, compactStructureRenderLayer),
        colors: entryValue => compactArray(entryValue, compactJsonValue),
        buildSockets: entryValue => compactArray(entryValue, compactBuildSocket),
        footprintPolygons: entryValue => compactArray(entryValue, compactHitPolygon),
        structureVolumes: entryValue => compactArray(entryValue, compactStructureVolume),
        vehicleSeats: entryValue => compactArray(entryValue, compactVehicleSeat),
        spotlights: entryValue => compactArray(entryValue, compactSpotlight),
        fuelTanks: entryValue => compactArray(entryValue, compactFuelTank),
        stockpile: compactStockpile,
        holdProfile: compactHoldProfile,
        markedCargoOverlay: compactMarkedCargoOverlay,
        conversionEntries: entryValue => compactArray(entryValue, compactConversionEntry),
        ranges: entryValue => compactArray(entryValue, compactRange),
        cost: compactRecipeResourceMap,
        modifications: compactModificationSlots,
    });
}

function compactLocalizationIndex(value) {
    return compactNullableObject(value, {
        defaultLocale: 'en',
        availableLocales: ['en'],
        files: {},
    }, {
        files: compactStringRecord,
    });
}

function compactPublishedFoxholeManifest(manifest) {
    const publishedManifest = normalizePublishedModificationPath(manifest);
    return compactObject(publishedManifest, {
        shared: { modifications: {} },
    }, {
        shared: compactSharedManifest,
        categories: entryValue => compactArray(entryValue, compactCategory),
        assets: entryValue => compactArray(entryValue, compactStructure),
        localizationIndex: compactLocalizationIndex,
    });
}

async function writeTextFileIfChanged(outputPath, content) {
    const currentContent = await readFileWithRetries(outputPath, 'utf8').catch(error => {
        if (isMissingFileSystemError(error)) {
            return null;
        }

        throw error;
    });
    if (currentContent === content) {
        return false;
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFileWithRetries(outputPath, content, 'utf8');
    return true;
}

async function mergeExternalLocalizationFiles(manifest, manifestPath) {
    const localizationFiles = manifest?.localizationIndex?.files;
    if (!localizationFiles || typeof localizationFiles !== 'object') {
        return manifest;
    }

    const localizations = normalizeLocalizationBundles(manifest.localizations);
    const knownLocales = new Set(localizations.map(bundle => bundle.locale));
    const manifestDirectory = dirname(manifestPath);

    for (const [localeKey, relativePath] of Object.entries(localizationFiles)
        .sort(([left], [right]) => left.localeCompare(right))) {
        const locale = String(localeKey ?? '').trim().toLowerCase();
        const localizationPath = String(relativePath ?? '').trim();
        if (!locale || !localizationPath || knownLocales.has(locale)) {
            continue;
        }

        try {
            const strings = JSON.parse(await readFile(resolve(manifestDirectory, localizationPath), 'utf8'));
            localizations.push({
                locale,
                strings: sortObjectEntries(strings),
            });
            knownLocales.add(locale);
        } catch (error) {
            logPublishWarn(`failed to read localization bundle for ${locale} from ${localizationPath}: ${error}`);
        }
    }

    return foxholeManifestSchema.parse({
        ...manifest,
        localizations,
    });
}

function findRawModificationVariant(rawStructure, slotName, variantId) {
    const expectedSlot = String(slotName ?? '').trim();
    const expectedVariant = String(variantId ?? '').trim();
    // Structures can declare duplicate slot names; prefer the slot that actually
    // contains this variantId instead of last-wins Map lookup.
    for (const slot of getRawStructureModificationSlots(rawStructure)) {
        if (String(slot?.name ?? '').trim() !== expectedSlot) {
            continue;
        }
        const variants = slot?.variants && typeof slot.variants === 'object' ? slot.variants : null;
        if (!variants || !(expectedVariant in variants)) {
            continue;
        }
        return { slot, variant: variants[expectedVariant] };
    }
    return { slot: null, variant: null };
}

function resolveSeededRenderId(candidates) {
    for (const candidate of candidates) {
        const value = String(candidate ?? '').trim().toLowerCase();
        if (value) {
            return value;
        }
    }
    return '';
}

function seedAuthoredSharedModificationIds(rawManifest, manifest) {
    const rawStructuresById = new Map((rawManifest?.assets ?? [])
        .map(structure => {
            const structureId = normalizeId(structure?.id);
            return structureId ? [structureId, structure] : null;
        })
        .filter(Boolean));

    return {
        ...manifest,
        assets: (manifest?.assets ?? []).map(structure => {
            const rawStructure = rawStructuresById.get(normalizeId(structure?.id));
            if (!rawStructure) {
                return structure;
            }

            return {
                ...structure,
                modificationSlots: (structure?.modificationSlots ?? []).map(slot => {
                    const slotName = String(slot?.name ?? '').trim();
                    return {
                        ...slot,
                        variants: Object.fromEntries(Object.entries(slot?.variants ?? {}).map(([variantId, variant]) => {
                            if (normalizeId(variantId) === 'default') {
                                return [variantId, variant];
                            }

                            const { slot: rawSlot, variant: rawVariant } = findRawModificationVariant(
                                rawStructure,
                                slotName,
                                variantId,
                            );
                            const mergedVariant = {
                                ...(rawVariant && typeof rawVariant === 'object' ? rawVariant : {}),
                                ...(variant && typeof variant === 'object' ? variant : {}),
                            };
                            // normalizeId('') is falsy for if-checks but truthy for ?? — do not chain it with ??.
                            let renderId = resolveSeededRenderId([
                                rawVariant?.renderId,
                                variant?.renderId,
                            ]);
                            if (!renderId) {
                                try {
                                    renderId = resolveSeededRenderId([
                                        buildRenderIdComputation(
                                            variantId,
                                            rawSlot?.dataClassPath ?? slot?.dataClassPath ?? '',
                                            mergedVariant,
                                        ).renderId,
                                    ]);
                                } catch (error) {
                                    throw new Error(
                                        `Missing renderId for ${structure?.id}/${slotName}/${variantId} in raw manifest` +
                                            (error instanceof Error ? `: ${error.message}` : ''),
                                    );
                                }
                            }
                            if (!renderId) {
                                throw new Error(
                                    `Missing renderId for ${structure?.id}/${slotName}/${variantId} in raw manifest`,
                                );
                            }

                            return [variantId, {
                                ...variant,
                                renderId,
                            }];
                        })),
                    };
                }),
            };
        }),
    };
}

function collectReferencedUpgradeStructureIds(structures) {
    const upgradeStructureIds = new Set();

    for (const structure of structures ?? []) {
        for (const slot of getStructurePublishedModificationSlots(structure)) {
            for (const [variantId, variant] of Object.entries(slot?.variants ?? {})) {
                if (normalizeId(variantId) === 'default') {
                    continue;
                }

                if (variant?.isUpgrade !== true) {
                    continue;
                }

                const appliedModificationId = normalizeId(variant?.appliedModificationId);
                if (appliedModificationId) {
                    upgradeStructureIds.add(appliedModificationId);
                }
            }
        }
    }

    return upgradeStructureIds;
}

function mergeModificationVariantPublishedContext(variant, publishedVariant) {
    if (!publishedVariant) {
        return variant;
    }

    const nextVariant = { ...variant };
    if (publishedVariant.isUpgrade === true) {
        nextVariant.isUpgrade = true;
        if (publishedVariant.appliedModificationId) {
            nextVariant.appliedModificationId = publishedVariant.appliedModificationId;
        }
        return nextVariant;
    }

    if (publishedVariant.appliedModificationId && !nextVariant.appliedModificationId) {
        nextVariant.appliedModificationId = publishedVariant.appliedModificationId;
    }

    return nextVariant;
}

function augmentPartialManifestWithPublishedContext(partialManifest, publishedManifest) {
    if (!publishedManifest) {
        return partialManifest;
    }

    const publishedStructuresById = new Map((publishedManifest.assets ?? [])
        .map(structure => {
            const structureId = normalizeId(structure?.id);
            return structureId ? [structureId, structure] : null;
        })
        .filter(Boolean));

    const publishedUpgradeStructuresById = new Map((publishedManifest.assets ?? [])
        .filter(structure => structure?.isUpgrade === true)
        .map(structure => {
            const structureId = normalizeId(structure?.id);
            return structureId ? [structureId, structure] : null;
        })
        .filter(Boolean));

    const augmentedAssets = (partialManifest.assets ?? []).map(structure => {
        const structureId = normalizeId(structure?.id);
        const publishedStructure = structureId ? publishedStructuresById.get(structureId) : null;
        if (!publishedStructure) {
            return structure;
        }

        const publishedSlotsByName = new Map(getStructurePublishedModificationSlots(publishedStructure)
            .map(slot => {
                const slotName = String(slot?.name ?? '').trim();
                return slotName ? [slotName, slot] : null;
            })
            .filter(Boolean));

        const nextSlots = (structure?.modificationSlots ?? []).map(slot => ({
            ...slot,
            variants: Object.fromEntries(Object.entries(slot?.variants ?? {}).map(([variantId, variant]) => {
                const publishedSlot = publishedSlotsByName.get(String(slot?.name ?? '').trim()) ?? null;
                const publishedVariant = publishedSlot?.variants?.[variantId] ?? null;
                return [variantId, mergeModificationVariantPublishedContext(variant, publishedVariant)];
            })),
        }));

        return {
            ...structure,
            ...(nextSlots.length > 0 ? { modificationSlots: nextSlots } : {}),
        };
    });

    const existingStructureIds = new Set(augmentedAssets
        .map(structure => normalizeId(structure?.id))
        .filter(Boolean));

    for (const upgradeStructureId of collectReferencedUpgradeStructureIds(augmentedAssets)) {
        if (existingStructureIds.has(upgradeStructureId)) {
            continue;
        }

        const publishedUpgradeStructure = publishedUpgradeStructuresById.get(upgradeStructureId);
        if (!publishedUpgradeStructure) {
            continue;
        }

        augmentedAssets.push(publishedUpgradeStructure);
        existingStructureIds.add(upgradeStructureId);
    }

    return {
        ...partialManifest,
        assets: augmentedAssets,
    };
}

function getRawStructureModificationSlots(rawStructure) {
    if (isStandaloneDestroyedOrBreachedStructure(rawStructure)
        || isStandaloneDestroyedOrBreachedStructureId(rawStructure?.id)) {
        return [];
    }

    if (Array.isArray(rawStructure?.modificationSlots)) {
        return rawStructure.modificationSlots;
    }

    if (Array.isArray(rawStructure?.modifications)) {
        return rawStructure.modifications;
    }

    return [];
}

async function loadSourceManifest(manifestPath, { seedSharedModificationIds = true } = {}) {
    const rawManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!Array.isArray(rawManifest?.assets)) {
        throw new Error(`manifest at ${manifestPath} does not use the assets root`);
    }

    const parsedManifest = foxholeManifestSchema.parse(rawManifest);
    const manifest = seedSharedModificationIds
        ? seedAuthoredSharedModificationIds(rawManifest, parsedManifest)
        : parsedManifest;
    const structureMetadataById = new Map((rawManifest.assets ?? [])
        .map(structure => {
            const structureId = normalizeId(structure?.id);
            if (!structureId) {
                return null;
            }

            return [structureId, {
                generateDefaultIcon: structure?.generateDefaultIcon === true,
            }];
        })
        .filter(Boolean));
    const normalizedManifest = normalizeOptionalStructureProperties(await mergeExternalLocalizationFiles(manifest, manifestPath));
    return attachSourceStructureMetadata(normalizedManifest, structureMetadataById);
}

function structurePrefersGeneratedDefaultIcon(structure, sourceStructureMetadata) {
    return structure?.generateDefaultIcon === true
        || sourceStructureMetadata?.generateDefaultIcon === true;
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

function getPositiveIntegerCliValue(parsedArgs, key, fallback) {
    const raw = (parsedArgs[key] ?? []).at(-1);
    const parsed = Number.parseInt(String(raw ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getNormalizedValues(parsedArgs, key) {
    return (parsedArgs[key] ?? [])
        .flatMap(value => String(value).split(','))
        .map(value => value.trim())
        .filter(Boolean);
}

function getPathValue(parsedArgs, key, fallback) {
    const value = (parsedArgs[key] ?? []).at(-1);
    return value ? resolve(repositoryRoot, value) : fallback;
}

function hasTargetFilters(filter) {
    return filter.only.size > 0 || filter.category.size > 0;
}

function matchesStructureOnly(structure, filter) {
    const normalizedStructureId = normalizeId(structure?.id);
    const normalizedCodeName = normalizeId(structure?.codeName);
    const normalizedParentStructureId = normalizeId(structure?.parentStructureId);
    const normalizedRootStructureId = normalizeId(structure?.rootStructureId);
    return filter.only.size === 0
        || filter.only.has(normalizedStructureId)
        || filter.only.has(normalizedCodeName)
        || filter.only.has(normalizedParentStructureId)
        || filter.only.has(normalizedRootStructureId);
}

function matchesTargetFilter(structure, filter) {
    const normalizedCategoryId = normalizeId(structure?.categoryId);
    const matchesOnly = matchesStructureOnly(structure, filter);
    const matchesCategory = filter.category.size === 0
        || filter.category.has(normalizedCategoryId);
    return matchesOnly && matchesCategory;
}

function applyTargetFilter(manifest, filter) {
    if (!hasTargetFilters(filter)) {
        return manifest;
    }

    const assets = filter.only.size > 0
        ? manifest.assets.filter(structure => matchesStructureOnly(structure, filter))
        : manifest.assets;
    const categoryIds = new Set(assets.map(structure => normalizeId(structure.categoryId)).filter(Boolean));
    const categories = (manifest.categories ?? []).filter(category => categoryIds.has(normalizeId(category.id)));

    return foxholeManifestSchema.parse({
        ...manifest,
        categories,
        assets,
    });
}

const EXTRACTOR_FALLBACK_CATEGORY_ORDER = 2147483647;

function isExtractorFallbackCategoryOrder(order) {
    return Number(order) >= EXTRACTOR_FALLBACK_CATEGORY_ORDER;
}

function mergeCategoryEntry(baseCategory, partialCategory) {
    if (!partialCategory) {
        return baseCategory;
    }

    if (!baseCategory) {
        return partialCategory;
    }

    const partialOrder = partialCategory.order ?? 0;
    const baseOrder = baseCategory.order ?? 0;
    const preferBaseOrder = isExtractorFallbackCategoryOrder(partialOrder)
        && !isExtractorFallbackCategoryOrder(baseOrder);

    return {
        ...baseCategory,
        ...partialCategory,
        iconUrl: partialCategory.iconUrl ?? baseCategory.iconUrl,
        order: preferBaseOrder ? baseOrder : partialOrder,
    };
}

function mergeLocalizationBundles(baseBundles, nextBundles) {
    const merged = new Map();

    for (const bundle of normalizeLocalizationBundles(baseBundles)) {
        merged.set(bundle.locale, {
            locale: bundle.locale,
            strings: { ...bundle.strings },
        });
    }

    for (const bundle of normalizeLocalizationBundles(nextBundles)) {
        const existing = merged.get(bundle.locale) ?? { locale: bundle.locale, strings: {} };
        const nextStrings = { ...bundle.strings };
        for (const [key, value] of Object.entries(nextStrings)) {
            if (key.startsWith('category:') && key.endsWith(':name') && existing.strings[key]) {
                continue;
            }

            existing.strings[key] = value;
        }

        merged.set(bundle.locale, {
            locale: bundle.locale,
            strings: sortObjectEntries(existing.strings),
        });
    }

    return [...merged.values()].sort((left, right) => left.locale.localeCompare(right.locale));
}

function mergeSharedModificationEntries(baseManifest, partialManifest) {
    return sortObjectEntries({
        ...(baseManifest?.shared?.modifications ?? {}),
        ...(partialManifest?.shared?.modifications ?? {}),
    });
}

function collectReferencedSharedModificationIds(manifest) {
    const sharedModificationIds = new Set();

    for (const structure of manifest?.assets ?? []) {
        const slots = getStructurePublishedModificationSlots(structure);
        for (const slot of slots) {
            for (const variant of Object.values(slot?.variants ?? {})) {
                const sharedModificationId = normalizeId(variant?.sharedModificationId);
                if (sharedModificationId) {
                    sharedModificationIds.add(sharedModificationId);
                }
            }
        }
    }

    return sharedModificationIds;
}

async function loadStructureIdsWithDestroyedRenderScenes() {
    if (!await pathExists(renderScenesDirectory)) {
        return null;
    }

    return collectStructureIdsWithDestroyedRenderScenesFromDirectory(renderScenesDirectory);
}

async function loadRenderScenesIndexDocument() {
    if (!await pathExists(renderScenesIndexPath)) {
        return null;
    }

    try {
        return JSON.parse(await readFile(renderScenesIndexPath, 'utf8'));
    } catch (error) {
        logPublishWarn(`failed to read render scene index from ${renderScenesIndexPath}: ${error}`);
        return null;
    }
}

async function loadModificationRenderIndexDocument() {
    if (!await pathExists(modificationRenderIndexPath)) {
        return null;
    }

    try {
        return JSON.parse(await readFile(modificationRenderIndexPath, 'utf8'));
    } catch (error) {
        logPublishWarn(`failed to read modification render index from ${modificationRenderIndexPath}: ${error}`);
        return null;
    }
}

function getModificationRenderIndexEntries(modificationRenderIndexDocument) {
    const entries = modificationRenderIndexDocument?.entries;
    if (!entries || typeof entries !== 'object') {
        return [];
    }

    return Object.values(entries);
}

function getPublishedSharedModificationIds() {
    if (publishedSharedModificationIdsCache) {
        return publishedSharedModificationIdsCache;
    }

    const sharedModificationIds = new Set();
    try {
        const overrideDocument = JSON.parse(readFileSync(sharedModificationOverrideManifestPath, 'utf8'));
        for (const renderId of Object.keys(overrideDocument ?? {})) {
            const normalizedRenderId = normalizeId(renderId);
            if (normalizedRenderId) {
                sharedModificationIds.add(normalizedRenderId);
            }
        }
    } catch {
    }

    try {
        const manifest = JSON.parse(readFileSync(publishedManifestPath, 'utf8'));
        for (const renderId of Object.keys(manifest?.shared?.modifications ?? {})) {
            const normalizedRenderId = normalizeId(renderId);
            if (normalizedRenderId) {
                sharedModificationIds.add(normalizedRenderId);
            }
        }
    } catch {
    }

    publishedSharedModificationIdsCache = sharedModificationIds;
    return sharedModificationIds;
}

function isPublishedSharedModificationRenderId(renderId) {
    return getPublishedSharedModificationIds().has(normalizeId(renderId));
}

function isSharedModificationRenderIndexEntryFromModificationIndex(entry) {
    // Storage is finalized after scene-fingerprint routing. Multi-consumer alone
    // is not enough — pipe/silo insulation stays host-local when fingerprints differ.
    return normalizeId(entry?.storage) === 'shared';
}

function buildSharedModificationConsumerLookupFromModificationIndex(modificationRenderIndexDocument) {
    const sharedModificationIdByConsumer = new Map();
    for (const entry of getModificationRenderIndexEntries(modificationRenderIndexDocument)) {
        const renderId = normalizeId(entry?.renderId);
        if (!renderId || !hasStandaloneModificationContentHashSuffix(renderId)) {
            continue;
        }

        if (!isSharedModificationRenderIndexEntryFromModificationIndex(entry)) {
            continue;
        }

        for (const consumer of entry?.consumers ?? []) {
            const structureId = normalizeId(consumer?.structureId);
            const variantId = normalizeId(consumer?.variantId);
            if (structureId && variantId) {
                sharedModificationIdByConsumer.set(`${structureId}|${variantId}`, renderId);
            }
        }
    }

    return sharedModificationIdByConsumer;
}

function collectSharedModificationIdsFromModificationRenderIndex(modificationRenderIndexDocument, scopedAssetIds = null) {
    const sharedModificationIds = new Set();
    if (!modificationRenderIndexDocument) {
        return sharedModificationIds;
    }

    for (const entry of getModificationRenderIndexEntries(modificationRenderIndexDocument)) {
        const renderId = normalizeId(entry?.renderId);
        if (!renderId || !hasStandaloneModificationContentHashSuffix(renderId)) {
            continue;
        }

        if (!isSharedModificationRenderIndexEntryFromModificationIndex(entry)) {
            continue;
        }

        const consumers = Array.isArray(entry?.consumers) ? entry.consumers : [];
        if (scopedAssetIds && scopedAssetIds.size > 0) {
            const affectsScope = consumers.some(consumer => scopedAssetIds.has(normalizeId(consumer?.structureId)));
            if (!affectsScope) {
                continue;
            }
        }

        sharedModificationIds.add(renderId);
    }

    return sharedModificationIds;
}

function collectSharedModificationIdsFromRenderIndex(renderScenesIndexDocument, scopedAssetIds = null) {
    const sharedModificationIds = new Set();
    if (!renderScenesIndexDocument) {
        return sharedModificationIds;
    }

    for (const entry of renderScenesIndexDocument?.scenes ?? []) {
        if (!isSharedModificationRenderIndexEntry(entry)) {
            continue;
        }

        const consumers = Array.isArray(entry?.consumers) ? entry.consumers : [];
        if (scopedAssetIds && scopedAssetIds.size > 0) {
            const affectsScope = consumers.some(consumer => scopedAssetIds.has(normalizeId(consumer?.structureId)));
            if (!affectsScope) {
                continue;
            }
        }

        const sharedOutputKey = normalizeId(basename(String(entry?.outputPath ?? ''), '.scene.json'));
        if (sharedOutputKey && hasStandaloneModificationContentHashSuffix(sharedOutputKey)) {
            sharedModificationIds.add(sharedOutputKey);
        }
    }

    return sharedModificationIds;
}

function buildSharedModificationConsumerLookup(renderScenesIndexDocument) {
    const sharedModificationIdByConsumer = new Map();
    if (!renderScenesIndexDocument) {
        return sharedModificationIdByConsumer;
    }

    for (const entry of renderScenesIndexDocument?.scenes ?? []) {
        if (!isSharedModificationRenderIndexEntry(entry)) {
            continue;
        }

        const sharedOutputKey = normalizeId(basename(String(entry?.outputPath ?? ''), '.scene.json'));
        if (!sharedOutputKey || !hasStandaloneModificationContentHashSuffix(sharedOutputKey)) {
            continue;
        }

        for (const consumer of entry?.consumers ?? []) {
            const structureId = normalizeId(consumer?.structureId);
            const variantId = normalizeId(consumer?.variantId);
            if (structureId && variantId) {
                sharedModificationIdByConsumer.set(`${structureId}|${variantId}`, sharedOutputKey);
            }
        }
    }

    return sharedModificationIdByConsumer;
}

function seedSharedModificationIdsFromRenderIndex(manifest, renderScenesIndexDocument, modificationRenderIndexDocument = null) {
    const sharedModificationIdByConsumer = new Map([
        ...buildSharedModificationConsumerLookup(renderScenesIndexDocument),
        ...buildSharedModificationConsumerLookupFromModificationIndex(modificationRenderIndexDocument),
    ]);

    return attachSourceStructureMetadata({
        ...manifest,
        assets: (manifest?.assets ?? []).map(structure => {
            const structureId = normalizeId(structure?.id);
            const slots = getStructurePublishedModificationSlots(structure);
            if (!structureId || slots.length === 0) {
                return structure;
            }

            const nextSlots = slots.map(slot => ({
                ...slot,
                variants: Object.fromEntries(Object.entries(slot?.variants ?? {}).map(([variantId, variant]) => {
                    if (normalizeId(variantId) === 'default') {
                        return [variantId, variant];
                    }

                    const isUpgradeVariant = resolvePublishedUpgradeVariantContext(
                        slot,
                        variantId,
                        variant,
                        null,
                    ).isUpgrade === true;
                    const existingRenderId = normalizeId(variant?.renderId);
                    const consumerKey = `${structureId}|${normalizeId(variantId)}`;
                    const sharedModificationId = sharedModificationIdByConsumer.get(consumerKey);
                    const nextVariant = { ...variant };
                    if (existingRenderId) {
                        nextVariant.renderId = existingRenderId;
                    }
                    if (sharedModificationId && !isUpgradeVariant) {
                        nextVariant.sharedModificationId = sharedModificationId;
                    } else {
                        delete nextVariant.sharedModificationId;
                    }
                    return [variantId, nextVariant];
                })),
            }));

            const canonicalModifications = structure?.modifications
                && !Array.isArray(structure.modifications)
                && typeof structure.modifications === 'object'
                ? structure.modifications
                : null;
            const { modifications: _modifications, modificationSlots: _modificationSlots, ...rest } = structure;
            return {
                ...rest,
                ...(canonicalModifications ? { modifications: canonicalModifications } : {}),
                ...(Array.isArray(structure?.modificationSlots)
                    ? { modificationSlots: nextSlots }
                    : { modifications: nextSlots }),
            };
        }),
    }, manifest);
}

function resolvePublishedUpgradeVariantContext(slot, variantId, variant, sourceModification) {
    const isUpgradeVariant = !canShareModificationVariant(slot, variantId, variant, sourceModification);

    if (!isUpgradeVariant) {
        return {};
    }

    return {
        isUpgrade: true,
        ...(sourceModification?.upgradeName || variant?.upgradeName
            ? { upgradeName: sourceModification?.upgradeName ?? variant?.upgradeName }
            : {}),
        ...(sourceModification?.parentStructureId || variant?.parentStructureId
            ? { parentStructureId: sourceModification?.parentStructureId ?? variant?.parentStructureId }
            : {}),
        ...(sourceModification?.rootStructureId || variant?.rootStructureId
            ? { rootStructureId: sourceModification?.rootStructureId ?? variant?.rootStructureId }
            : {}),
        ...(sourceModification?.appliedModificationId || variant?.appliedModificationId
            ? { appliedModificationId: sourceModification?.appliedModificationId ?? variant?.appliedModificationId }
            : {}),
    };
}

function buildScopedRawRenderedAssetTargets(manifest, renderScenesIndexDocument = null, modificationRenderIndexDocument = null) {
    const assetIds = new Set((manifest?.assets ?? [])
        .flatMap(structure => [structure?.id, structure?.codeName, structure?.parentStructureId, structure?.rootStructureId])
        .map(normalizeId)
        .filter(Boolean));
    const sharedModificationIds = collectReferencedSharedModificationIds(buildSharedModificationStore(manifest));
    for (const sharedModificationId of collectSharedModificationIdsFromRenderIndex(renderScenesIndexDocument, assetIds)) {
        sharedModificationIds.add(sharedModificationId);
    }
    for (const sharedModificationId of collectSharedModificationIdsFromModificationRenderIndex(modificationRenderIndexDocument, assetIds)) {
        sharedModificationIds.add(sharedModificationId);
    }
    const sharedPackagingKeys = new Set([
        ...sharedPackagingTargetKeys,
        ...Object.keys(manifest?.shared?.packaging ?? {})
            .map(normalizeFoxholePackagedPalletKey)
            .filter(Boolean),
    ]);

    return {
        assetIds,
        assetIdsEligibleForComponentPublish: new Set((manifest?.assets ?? [])
            .filter(shouldPublishStructureComponentRenderLayers)
            .map(structure => normalizeId(structure?.id))
            .filter(Boolean)),
        sharedModificationIds,
        sharedPackagingKeys,
    };
}

function shouldSkipHostLocalModificationSync(location, scopedTargets) {
    if (
        !scopedTargets
        || (location.scope !== 'assetModification' && location.scope !== 'assetModificationComponent')
    ) {
        return false;
    }

    const modificationId = normalizeId(location.modificationId);
    if (!modificationId) {
        return false;
    }

    // Only skip exact shared renderId folders. Prefix matching (insulation vs
    // insulation-<hash>) incorrectly drops host-local fingerprint-divergent mods.
    return scopedTargets.sharedModificationIds.has(modificationId);
}

function matchesScopedRawRenderedAssetTargets(scopedTargets, outputPath) {
    const location = parseAssetRelativeLocation(outputPath);
    if (!location) {
        return false;
    }

    if (location.scope === 'component' && isStandaloneDestroyedOrBreachedStructureId(location.assetId)) {
        return false;
    }

    // Host-local published paths use variantId only. Never sync stale *-hash folders from tmp.
    if (
        (location.scope === 'assetModification' || location.scope === 'assetModificationComponent')
        && isHashedHostLocalModificationDirectoryName(location.modificationId)
    ) {
        return false;
    }

    if (!scopedTargets) {
        return true;
    }

    if (location.scope === 'sharedModification') {
        return scopedTargets.sharedModificationIds.has(location.modificationId);
    }

    if (location.scope === 'sharedPackaging') {
        return scopedTargets.sharedPackagingKeys.has(location.shippableType);
    }

    if (location.scope === 'component') {
        return scopedTargets.assetIdsEligibleForComponentPublish.has(location.assetId);
    }

    if (location.scope === 'assetModification' || location.scope === 'assetModificationComponent') {
        if (!scopedTargets.assetIds.has(location.assetId)) {
            return false;
        }

        return !shouldSkipHostLocalModificationSync(location, scopedTargets);
    }

    return scopedTargets.assetIds.has(location.assetId);
}

function pruneSharedModificationEntries(manifest) {
    const referencedSharedModificationIds = collectReferencedSharedModificationIds(manifest);
    const sharedModifications = Object.entries(manifest?.shared?.modifications ?? {})
        .filter(([sharedModificationId]) => referencedSharedModificationIds.has(normalizeId(sharedModificationId)));

    return {
        ...manifest,
        shared: {
            ...(manifest?.shared ?? {}),
            modifications: sortObjectEntries(Object.fromEntries(sharedModifications)),
        },
    };
}

function preservePublishedVariantSharedModificationIds(publishedStructure, partialStructure) {
    // Fingerprint routing via seedSharedModificationIdsFromRenderIndex is authoritative.
    // Never force a previously published sharedModificationId onto host-local variants.
    return partialStructure;
}

function mergeManifestSubset(baseManifest, partialManifest, removedStructureIds = new Set()) {
    const partialStructuresById = new Map((partialManifest.assets ?? [])
        .filter(structure => !structure?.isUpgrade)
        .map(structure => [normalizeId(structure.id), structure])
        .filter(([id]) => id));
    const partialCategoriesById = new Map((partialManifest.categories ?? [])
        .map(category => [normalizeId(category.id), category])
        .filter(([id]) => id));

    const structures = [];
    const seenStructureIds = new Set();
    for (const structure of baseManifest.assets ?? []) {
        if (structure?.isUpgrade) {
            continue;
        }

        const structureId = normalizeId(structure.id);
        if (!structureId) {
            structures.push(structure);
            continue;
        }

        if (removedStructureIds.has(structureId)) {
            continue;
        }

        seenStructureIds.add(structureId);
        const partialStructure = partialStructuresById.get(structureId);
        structures.push(partialStructure
            ? preservePublishedVariantSharedModificationIds(structure, partialStructure)
            : structure);
    }

    for (const [structureId, structure] of partialStructuresById) {
        if (!seenStructureIds.has(structureId)) {
            structures.push(structure);
        }
    }

    const categories = [];
    const seenCategoryIds = new Set();
    for (const category of baseManifest.categories ?? []) {
        const categoryId = normalizeId(category.id);
        if (!categoryId) {
            categories.push(category);
            continue;
        }

        seenCategoryIds.add(categoryId);
        categories.push(mergeCategoryEntry(category, partialCategoriesById.get(categoryId)));
    }

    for (const [categoryId, category] of partialCategoriesById) {
        if (!seenCategoryIds.has(categoryId)) {
            categories.push(category);
        }
    }

    const referencedCategoryIds = new Set(structures
        .map(structure => normalizeId(structure?.categoryId))
        .filter(Boolean));

    return {
        ...baseManifest,
        ...partialManifest,
        shared: {
            ...(baseManifest?.shared ?? {}),
            ...(partialManifest?.shared ?? {}),
            modifications: mergeSharedModificationEntries(baseManifest, partialManifest),
            packaging: {
                ...(baseManifest?.shared?.packaging ?? {}),
                ...(partialManifest?.shared?.packaging ?? {}),
            },
        },
        categories: categories.filter(category => referencedCategoryIds.has(normalizeId(category?.id))),
        assets: structures,
        localizations: mergeLocalizationBundles(baseManifest.localizations, partialManifest.localizations),
    };
}

function collectAuthoredModificationPreviewDirections(sourceManifest) {
    const authoredPreviewDirectionByStructureVariant = new Map();

    for (const structure of sourceManifest?.assets ?? []) {
        const structureId = normalizeId(structure?.id);
        if (!structureId) {
            continue;
        }

        for (const slot of structure?.modificationSlots ?? []) {
            for (const [variantId, variant] of Object.entries(slot?.variants ?? {})) {
                const previewDirection = normalizeId(variant?.previewDirection);
                if (!previewDirection) {
                    continue;
                }

                authoredPreviewDirectionByStructureVariant.set(`${structureId}|${normalizeId(variantId)}`, previewDirection);
            }
        }
    }

    return authoredPreviewDirectionByStructureVariant;
}

function preserveAuthoredModificationPreviewDirections(publishedManifest, sourceManifest, authoredOverridesByLookupKey = {}) {
    const authoredPreviewDirectionByStructureVariant = collectAuthoredModificationPreviewDirections(sourceManifest);
    if (authoredPreviewDirectionByStructureVariant.size === 0
        && Object.keys(authoredOverridesByLookupKey).length === 0) {
        return publishedManifest;
    }

    return {
        ...publishedManifest,
        assets: (publishedManifest?.assets ?? []).map(structure => {
            const structureId = normalizeId(structure?.id);
            if (!structureId || !Array.isArray(structure?.modificationSlots)) {
                return structure;
            }

            let structureChanged = false;
            const modificationSlots = structure.modificationSlots.map(slot => ({
                ...slot,
                variants: Object.fromEntries(Object.entries(slot?.variants ?? {}).map(([variantId, variant]) => {
                    const authoredOverride = resolveAuthoredModificationOverride(
                        authoredOverridesByLookupKey,
                        structureId,
                        slot?.name,
                        variantId,
                        variant,
                    );
                    const authoredPreviewDirection = normalizeId(authoredOverride?.previewDirection)
                        ?? authoredPreviewDirectionByStructureVariant.get(`${structureId}|${normalizeId(variantId)}`);
                    if (!authoredPreviewDirection || normalizeId(variant?.previewDirection) === authoredPreviewDirection) {
                        return [variantId, variant];
                    }

                    structureChanged = true;
                    return [variantId, {
                        ...variant,
                        previewDirection: authoredPreviewDirection,
                    }];
                })),
            }));

            return structureChanged ? { ...structure, modificationSlots } : structure;
        }),
    };
}

async function loadAuthoredSharedModificationOverrides() {
    if (!await pathExists(sharedModificationOverrideManifestPath)) {
        return {};
    }

    try {
        const document = JSON.parse(await readFile(sharedModificationOverrideManifestPath, 'utf8'));
        return Object.fromEntries(Object.entries(document?.modifications ?? {})
            .map(([lookupKey, override]) => [normalizeId(lookupKey), override])
            .filter(([lookupKey]) => Boolean(lookupKey)));
    } catch (error) {
        logPublishWarn(`failed to read shared modification overrides from ${sharedModificationOverrideManifestPath}: ${error}`);
        return {};
    }
}

function enumerateModificationVariantOverrideLookupKeys(structureId, slotName, variantId, variant) {
    const normalizedStructureId = normalizeId(structureId);
    const normalizedSlotName = normalizeId(slotName);
    const normalizedVariantId = normalizeId(variantId);
    const keys = [];

    if (normalizedStructureId && normalizedSlotName && normalizedVariantId) {
        keys.push(`${normalizedStructureId}/${normalizedSlotName}/${normalizedVariantId}`);
    }

    if (normalizedStructureId && normalizedVariantId) {
        keys.push(`${normalizedStructureId}/${normalizedVariantId}`);
    }

    const renderId = normalizeId(variant?.renderId);
    if (renderId) {
        keys.push(renderId);
    }

    if (normalizedVariantId) {
        keys.push(normalizedVariantId);
    }

    return keys;
}

function resolveAuthoredModificationOverride(overridesByLookupKey, structureId, slotName, variantId, variant) {
    for (const lookupKey of enumerateModificationVariantOverrideLookupKeys(structureId, slotName, variantId, variant)) {
        const override = overridesByLookupKey?.[lookupKey];
        if (override) {
            return override;
        }
    }

    return null;
}

function preserveAuthoredSharedModificationPreviewDirections(publishedManifest, authoredOverridesByLookupKey) {
    if (!publishedManifest?.shared?.modifications || Object.keys(authoredOverridesByLookupKey).length === 0) {
        return publishedManifest;
    }

    let changed = false;
    const modifications = Object.fromEntries(Object.entries(publishedManifest.shared.modifications).map(([sharedModificationId, modification]) => {
        const authoredOverride = resolveAuthoredModificationOverride(
            authoredOverridesByLookupKey,
            null,
            null,
            sharedModificationId,
            { renderId: sharedModificationId, sharedModificationId },
        );
        const authoredPreviewDirection = normalizeId(authoredOverride?.previewDirection);
        if (!authoredPreviewDirection || normalizeId(modification?.previewDirection) === authoredPreviewDirection) {
            return [sharedModificationId, modification];
        }

        changed = true;
        return [sharedModificationId, {
            ...modification,
            previewDirection: authoredPreviewDirection,
        }];
    }));

    return changed
        ? {
            ...publishedManifest,
            shared: {
                ...publishedManifest.shared,
                modifications,
            },
        }
        : publishedManifest;
}

function normalizeStructureReferenceCodeName(value) {
    const normalized = String(value ?? '').trim();
    return normalized || null;
}

function buildPublishedStructureReferenceLookup(assets) {
    const availableReferences = new Set();
    for (const structure of assets ?? []) {
        const codeName = normalizeStructureReferenceCodeName(structure?.codeName);
        if (codeName) {
            availableReferences.add(normalizeId(codeName));
        }

        const structureId = normalizeId(structure?.id);
        if (structureId) {
            availableReferences.add(structureId);
        }
    }

    return availableReferences;
}

function removeDanglingStructureReferences(manifest) {
    const availableReferences = buildPublishedStructureReferenceLookup(manifest?.assets);
    let removedReferenceCount = 0;

    const assets = (manifest?.assets ?? []).map(structure => {
        if (!isPlainObject(structure)) {
            return structure;
        }

        let nextStructure = structure;
        const structureLabel = String(structure.id ?? structure.codeName ?? 'unknown');

        const normalizedUpgradeStructureCodeName = normalizeStructureReferenceCodeName(structure.upgradeStructureCodeName);
        if (normalizedUpgradeStructureCodeName && !availableReferences.has(normalizeId(normalizedUpgradeStructureCodeName))) {
            logPublishWarn(`removed dangling upgradeStructureCodeName ${normalizedUpgradeStructureCodeName} from ${structureLabel}`);
            removedReferenceCount += 1;
            nextStructure = {
                ...nextStructure,
                upgradeStructureCodeName: null,
            };
        }

        const conversionCodeNames = Array.isArray(structure.conversionCodeNames) ? structure.conversionCodeNames : [];
        if (conversionCodeNames.length > 0) {
            const validatedConversionCodeNames = [];
            for (const codeName of conversionCodeNames) {
                const normalizedCodeName = normalizeStructureReferenceCodeName(codeName);
                if (!normalizedCodeName) {
                    continue;
                }

                if (availableReferences.has(normalizeId(normalizedCodeName))) {
                    validatedConversionCodeNames.push(normalizedCodeName);
                    continue;
                }

                logPublishWarn(`removed dangling conversionCodeName ${normalizedCodeName} from ${structureLabel}`);
                removedReferenceCount += 1;
            }

            if (validatedConversionCodeNames.length !== conversionCodeNames.length
                || validatedConversionCodeNames.some((codeName, index) => codeName !== conversionCodeNames[index])) {
                nextStructure = {
                    ...nextStructure,
                    conversionCodeNames: validatedConversionCodeNames,
                };
            }
        }

        const normalizedDestroyedStructureCodeName = normalizeStructureReferenceCodeName(structure.destroyedStructureCodeName);
        if (normalizedDestroyedStructureCodeName && !availableReferences.has(normalizeId(normalizedDestroyedStructureCodeName))) {
            logPublishWarn(`removed dangling destroyedStructureCodeName ${normalizedDestroyedStructureCodeName} from ${structureLabel}`);
            removedReferenceCount += 1;
            nextStructure = {
                ...nextStructure,
                destroyedStructureCodeName: null,
            };
        }

        return nextStructure;
    });

    if (removedReferenceCount > 0) {
        logPublishWarn(`removed ${removedReferenceCount} dangling structure reference(s) from published manifest`);
    }

    return removedReferenceCount > 0
        ? {
            ...manifest,
            assets,
        }
        : manifest;
}

function assertSafeUnfilteredPublish(sourceManifest, publishedManifestBeforeWrite, sourceManifestPath) {
    if (hasTargetFilters(targetFilter) || Object.hasOwn(cliArgs, 'allow-partial-source') || !publishedManifestBeforeWrite) {
        return;
    }

    const sourceAssetCount = sourceManifest?.assets?.length ?? 0;
    const publishedAssetCount = publishedManifestBeforeWrite?.assets?.length ?? 0;
    if (publishedAssetCount < 20 || sourceAssetCount >= Math.ceil(publishedAssetCount / 2)) {
        return;
    }

    const relativeSourcePath = relative(repositoryRoot, sourceManifestPath);
    throw new Error(`refusing unfiltered publish from ${relativeSourcePath} because it contains ${sourceAssetCount} assets while the existing published manifest contains ${publishedAssetCount}. The source looks targeted; publish with --only/--category, regenerate a full source, or pass --allow-partial-source to override.`);
}

function getRemovedUpgradeStructureIds(previousManifest, currentManifest) {
    const currentStructureIds = new Set((currentManifest?.assets ?? [])
        .map(structure => normalizeId(structure?.id))
        .filter(Boolean));

    return new Set((previousManifest?.assets ?? [])
        .filter(structure => structure?.isUpgrade === true)
        .map(structure => normalizeId(structure?.id))
        .filter(id => id && !currentStructureIds.has(id)));
}

function getRemovedStructureIds(previousManifest, currentManifest) {
    const currentStructureIds = new Set((currentManifest?.assets ?? [])
        .map(structure => normalizeId(structure?.id))
        .filter(Boolean));

    return new Set((previousManifest?.assets ?? [])
        .map(structure => normalizeId(structure?.id))
        .filter(id => id && !currentStructureIds.has(id)));
}

function normalizePublishedIconAssetUrl(value) {
    const normalized = String(value ?? '');
    return normalized
        .replace(/(\/foxhole\/assets\/icons\/[^"']+)\.(png|jpe?g)$/i, '$1.webp')
        .replace(/(\/foxhole\/assets\/structures\/[^"']+)\.preview\.(ne|nw|se|sw)\.webp$/i, '$1.preview.webp');
}

function extractPublishedIconKey(value) {
    const match = String(value ?? '').match(/\/foxhole\/assets\/icons\/([^/]+)\.(png|jpe?g|webp)$/i);
    return match ? normalizeId(match[1]) : null;
}

function collectSubtypeOverlayIconKeys(manifest) {
    const keys = new Set();

    function addValue(value) {
        const key = extractPublishedIconKey(value);
        if (key) {
            keys.add(key);
        }
    }

    addValue(defaultWreckedSubtypeIconUrl);
    for (const structure of manifest?.assets ?? []) {
        addValue(structure?.subTypeIconUrl);
        for (const slot of getStructurePublishedModificationSlots(structure)) {
            for (const variant of Object.values(slot?.variants ?? {})) {
                addValue(variant?.subTypeIconUrl);
            }
        }
    }

    for (const modification of Object.values(manifest?.shared?.modifications ?? {})) {
        addValue(modification?.subTypeIconUrl);
    }

    return keys;
}

function isComposeTimeSubtypeIconKey(key, subtypeOverlayIconKeys = null) {
    const normalizedKey = normalizeId(key);
    if (!normalizedKey) {
        return false;
    }

    if (normalizedKey.startsWith('subtype')) {
        return true;
    }

    return subtypeOverlayIconKeys?.has(normalizedKey) ?? false;
}

function isComposeTimeSubtypeIconUrl(value, subtypeOverlayIconKeys = null) {
    const iconKey = extractPublishedIconKey(value);
    return Boolean(iconKey && isComposeTimeSubtypeIconKey(iconKey, subtypeOverlayIconKeys));
}

function isSharedPublishedIconUrl(value) {
    return /^\/foxhole\/assets\/icons\/[^/]+\.webp$/i.test(String(value ?? ''));
}

function normalizePublishedIconAssetUrls(value) {
    if (Array.isArray(value)) {
        return value.map(entry => normalizePublishedIconAssetUrls(entry));
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, normalizePublishedIconAssetUrls(entry)]),
        );
    }

    if (typeof value === 'string') {
        return normalizePublishedIconAssetUrl(value);
    }

    return value;
}

async function convertPublishedIconsToWebp(directory) {
    await convertPublishedIconsToWebpByKey(directory, null);
}

async function convertPublishedIconsToWebpByKey(directory, allowedKeys) {
    if (!await pathExists(directory)) {
        return;
    }

    for await (const filePath of walkFiles(directory)) {
        const extension = extname(filePath).toLowerCase();
        if (!iconSourceExtensions.has(extension)) {
            continue;
        }

        if (allowedKeys && !allowedKeys.has(normalizeId(basename(filePath, extension)))) {
            continue;
        }

        const outputPath = `${filePath.slice(0, -extension.length)}.webp`;
        await sharp(filePath)
            .webp(losslessPublishedWebpOptions)
            .toFile(outputPath);
        await unlink(filePath);
        logPublishDetail(`converted ${filePath} -> ${outputPath}`);
    }
}

async function clearPublishedIconsDirectory(directory) {
    await clearPublishedIconsDirectoryByKey(directory, null);
}

async function clearPublishedIconsDirectoryByKey(directory, allowedKeys) {
    if (!await pathExists(directory)) {
        return;
    }

    for await (const filePath of walkFiles(directory)) {
        const extension = extname(filePath);
        const fileKey = normalizeId(basename(filePath, extension));
        if (allowedKeys && !allowedKeys.has(fileKey)) {
            continue;
        }

        await unlink(filePath);
        logPublishDetail(`removed ${filePath}`);
    }
}

async function syncPublishedIconsToPublicDirectory(directory, publicDirectory) {
    await syncPublishedIconsToPublicDirectoryByKey(directory, publicDirectory, null);
}

async function syncPublishedIconsToPublicDirectoryByKey(directory, publicDirectory, allowedKeys) {
    if (!await pathExists(directory) && !allowedKeys) {
        return;
    }

    await mkdir(publicDirectory, { recursive: true });
    const copiedKeys = new Set();
    const copyJobs = [];

    if (await pathExists(directory)) {
        const candidateKeys = new Set();
        for await (const filePath of walkFiles(directory)) {
            const extension = extname(filePath).toLowerCase();
            if (extension !== '.webp' && !iconSourceExtensions.has(extension)) {
                continue;
            }

            const fileKey = normalizeId(basename(filePath, extension));
            if (!fileKey) {
                continue;
            }

            candidateKeys.add(fileKey);
        }

        for (const fileKey of [...candidateKeys].sort()) {
            if (allowedKeys && !allowedKeys.has(fileKey)) {
                continue;
            }

            copyJobs.push({
                fileKey,
                outputPath: resolve(publicDirectory, `${fileKey}.webp`),
            });
        }
    }

    const primaryCopyResults = await mapWithConcurrency(
        copyJobs,
        publishConcurrency,
        async ({ fileKey, outputPath }) => {
            if (await shouldReuseExistingAssetOutput(outputPath)) {
                return { fileKey, copied: false, reused: true };
            }

            const { sourceFilePath, content } = await readPublishedIconSourceFile(directory, `${fileKey}.webp`);
            const copied = await writeFileIfChanged(outputPath, content);
            if (copied) {
                logPublishDetail(`copied ${sourceFilePath} -> ${outputPath}`);
            }

            return { fileKey, copied, reused: false };
        },
    );
    for (const result of primaryCopyResults) {
        if (result?.fileKey) {
            copiedKeys.add(result.fileKey);
        }
    }
    let copiedIcons = primaryCopyResults.filter(result => result?.copied).length;

    const fallbackCopyJobs = [];
    for (const fileKey of allowedKeys ?? []) {
        if (copiedKeys.has(fileKey)) {
            continue;
        }

        fallbackCopyJobs.push({
            fileKey,
            outputPath: resolve(publicDirectory, `${fileKey}.webp`),
        });
    }

    const fallbackCopyResults = await mapWithConcurrency(
        fallbackCopyJobs,
        publishConcurrency,
        async ({ fileKey, outputPath }) => {
            if (await shouldReuseExistingAssetOutput(outputPath)) {
                return false;
            }

            try {
                const { sourceFilePath, content } = await readPublishedIconSourceFile(directory, `${fileKey}.webp`);
                const copied = await writeFileIfChanged(outputPath, content);
                if (copied) {
                    logPublishDetail(`copied fallback icon ${sourceFilePath} -> ${outputPath}`);
                }
                return copied;
            } catch (error) {
                logPublishWarn(`skipping fallback icon ${fileKey}: ${error}`);
                return false;
            }
        },
    );
    copiedIcons += fallbackCopyResults.filter(Boolean).length;

    if (copiedIcons > 0) {
        logPublishSummary(`publish-manifest: copied ${copiedIcons} shared game icons to public/icons`);
    }
}

function resolveCategoryIconKey(iconUrl) {
    const normalizedIconUrl = String(iconUrl ?? '').trim();
    if (!normalizedIconUrl) {
        return null;
    }

    const foxholeIconsPrefix = `${createFoxholeAssetsBaseUrl('/')}icons/`;
    if (normalizedIconUrl.startsWith(foxholeIconsPrefix)) {
        return normalizeId(basename(normalizedIconUrl, extname(normalizedIconUrl)));
    }

    const legacyPrefix = '/assets/foxhole/game/';
    if (normalizedIconUrl.startsWith(legacyPrefix)) {
        const relativePath = normalizedIconUrl.slice(legacyPrefix.length);
        return normalizeId(basename(relativePath, extname(relativePath)));
    }

    return null;
}

function collectCategoryIconKeys(manifest) {
    const categoryIconKeys = new Set();
    for (const category of manifest?.categories ?? []) {
        const iconKey = resolveCategoryIconKey(category?.iconUrl);
        if (iconKey) {
            categoryIconKeys.add(iconKey);
        }
    }

    return categoryIconKeys;
}

async function syncCategoryIconAssets(manifest) {
    const categoryIconKeys = collectCategoryIconKeys(manifest);
    if (categoryIconKeys.size === 0) {
        return;
    }

    await syncPublishedIconsToPublicDirectoryByKey(
        generatedIconsDirectory,
        publicIconsDirectory,
        categoryIconKeys,
    );
}

async function removeStaleSharedIconsForCoLocatedStructures(manifest) {
    if (!await pathExists(publicIconsDirectory)) {
        return;
    }

    const coLocatedStructureIconKeys = new Set();
    for (const structure of manifest?.assets ?? []) {
        const iconUrl = String(structure?.icons?.default ?? structure?.iconUrl ?? '').trim();
        if (!iconUrl || isSharedPublishedIconUrl(iconUrl)) {
            continue;
        }

        const structureId = normalizeId(structure?.id);
        if (structureId) {
            coLocatedStructureIconKeys.add(structureId);
        }
    }

    if (coLocatedStructureIconKeys.size === 0) {
        return;
    }

    for await (const filePath of walkFiles(publicIconsDirectory)) {
        const extension = extname(filePath).toLowerCase();
        if (extension !== '.webp') {
            continue;
        }

        const iconKey = normalizeId(basename(filePath, extension));
        if (!coLocatedStructureIconKeys.has(iconKey)) {
            continue;
        }

        await unlink(filePath);
        logPublishDetail(`removed stale shared icon ${filePath}`);
    }
}

async function removeComposeTimeSubtypeIconsFromPublicDirectory(subtypeOverlayIconKeys) {
    if (!await pathExists(publicIconsDirectory)) {
        return;
    }

    for await (const filePath of walkFiles(publicIconsDirectory)) {
        const extension = extname(filePath).toLowerCase();
        if (extension !== '.webp') {
            continue;
        }

        const iconKey = normalizeId(basename(filePath, extension));
        if (!isComposeTimeSubtypeIconKey(iconKey, subtypeOverlayIconKeys)) {
            continue;
        }

        await unlink(filePath);
        logPublishDetail(`removed compose-time subtype icon ${filePath}`);
    }
}

function resolveRawRenderedAssetPublicOutputPath(filePath) {
    const normalizedFilePath = normalizeFileSystemPath(filePath);
    for (const rawRootDirectory of [rawRenderedAssetTypesDirectory, rawRenderedSharedAssetsDirectory]) {
        const normalizedRawRootDirectory = normalizeFileSystemPath(rawRootDirectory);
        if (!normalizedFilePath.startsWith(`${normalizedRawRootDirectory}/`)) {
            continue;
        }

        const relativePath = relative(rawRenderedAssetsRootDirectory, filePath);
        const extension = extname(relativePath).toLowerCase();
        if (extension === '.json') {
            return resolve(publicFoxholeAssetsDirectory, relativePath);
        }

        if (extension === '.webp') {
            return resolve(publicFoxholeAssetsDirectory, relativePath);
        }

        if (extension === '.png') {
            return resolve(publicFoxholeAssetsDirectory, `${relativePath.slice(0, -extension.length)}.webp`);
        }

        if (iconSourceExtensions.has(extension)) {
            return resolve(publicFoxholeAssetsDirectory, `${relativePath.slice(0, -extension.length)}.webp`);
        }

        return null;
    }

    return null;
}

async function resolveRawRenderedAssetSourceInputPathForPublishedOutput(outputFilePath) {
    const normalizedOutputFilePath = normalizeFileSystemPath(outputFilePath);
    const normalizedPublicRootDirectory = normalizeFileSystemPath(publicFoxholeAssetsDirectory);
    if (!normalizedOutputFilePath.startsWith(`${normalizedPublicRootDirectory}/`)) {
        return null;
    }

    const relativePath = relative(publicFoxholeAssetsDirectory, outputFilePath);
    const extension = extname(relativePath).toLowerCase();
    if (extension !== '.webp') {
        return null;
    }

    for (const sourceExtension of rawRenderedImageSourceExtensions) {
        const candidatePath = resolve(
            rawRenderedAssetsRootDirectory,
            `${relativePath.slice(0, -extension.length)}${sourceExtension}`,
        );
        if (await pathExists(candidatePath)) {
            return candidatePath;
        }
    }

    return null;
}

function resolveManifestOwnerForPublicRenderedAsset(manifest, outputPath) {
    const location = parseAssetRelativeLocation(outputPath);
    if (!location) {
        return null;
    }

    if (location.scope === 'sharedModification') {
        const sharedId = normalizeId(location.modificationId);
        const modification = manifest?.shared?.modifications?.[sharedId]
            ?? Object.entries(manifest?.shared?.modifications ?? {}).find(
                ([id]) => normalizeId(id) === sharedId,
            )?.[1]
            ?? null;
        return modification ? { structure: modification, sourceStructure: modification } : null;
    }

    const assetId = normalizeId(location.assetId);
    if (!assetId) {
        return null;
    }

    const structure = (manifest?.assets ?? []).find(entry => normalizeId(entry?.id) === assetId) ?? null;
    if (!structure) {
        return null;
    }

    if (location.scope === 'assetModification') {
        const modificationId = normalizeId(location.modificationId);
        for (const slot of getStructurePublishedModificationSlots(structure)) {
            for (const [variantId, variant] of Object.entries(slot?.variants ?? {})) {
                if (normalizeId(variantId) === 'default') {
                    continue;
                }
                const variantRenderId = normalizeId(variant?.renderId);
                if (variantRenderId === modificationId || normalizeId(variantId) === modificationId) {
                    return { structure: variant, sourceStructure: variant };
                }
            }
        }

        const sharedModification = manifest?.shared?.modifications?.[modificationId]
            ?? Object.entries(manifest?.shared?.modifications ?? {}).find(
                ([id]) => normalizeId(id) === modificationId,
            )?.[1]
            ?? null;
        if (sharedModification) {
            return { structure: sharedModification, sourceStructure: sharedModification };
        }
    }

    return { structure, sourceStructure: structure };
}

function resolveDerivedRenderedIconAssetKind(fileName) {
    const normalized = String(fileName ?? '').toLowerCase();
    if (normalized.includes('.destroyed.') && normalized.endsWith('.preview.png')) {
        return 'destroyed.icon.rendered';
    }
    return 'icon.rendered';
}

function resolveDerivedDefaultIconAssetKind(fileName) {
    const normalized = String(fileName ?? '').toLowerCase();
    if (normalized.includes('.destroyed.') && normalized.endsWith('.icon.default.png')) {
        return 'destroyed.icon.default';
    }
    return 'icon.default';
}

async function deriveRenderedIconWebpFromSourceImage(sourceImage, subTypeIconUrl = null) {
    let workingImage = sourceImage;

    const normalizedSubTypeIconUrl = String(subTypeIconUrl ?? '').trim();
    if (normalizedSubTypeIconUrl) {
        try {
            const subTypeIconSource = await readPublishedIconSourceFile(generatedIconsDirectory, normalizedSubTypeIconUrl);
            // Compose at full source resolution before downscale (matches ASSET-OUTPUT.md).
            workingImage = await composeSubtypeIcon(
                sourceImage,
                subTypeIconSource.content,
                { lossless: true, quality: 100, effort: 6 },
            );
        } catch (error) {
            logPublishWarn(`failed to compose subtype icon ${normalizedSubTypeIconUrl}: ${error}`);
        }
    }

    return sharp(workingImage)
        .resize(maxRenderedIconEdgePx, maxRenderedIconEdgePx, { fit: 'inside', withoutEnlargement: true })
        .webp(lossyRenderedIconWebpOptions)
        .toBuffer();
}

async function deriveRenderedIconWebpFromPreviewPng(previewPngPath, subTypeIconUrl = null) {
    const previewPng = await readFileWithRetries(previewPngPath);
    return deriveRenderedIconWebpFromSourceImage(previewPng, subTypeIconUrl);
}

async function resolveBlankPreviewRenderedIconFallbackSource(previewPngPath, renderedIconPath, manifest = null) {
    const pencilDefaultPath = previewPngPath.replace(/\.preview\.png$/i, '.icon.default.png');
    if (await pathExists(pencilDefaultPath) && await imageFileHasVisiblePixels(pencilDefaultPath)) {
        return {
            sourceFilePath: pencilDefaultPath,
            content: await readFileWithRetries(pencilDefaultPath),
            kind: 'pencil-default',
        };
    }

    const publicDefaultPath = renderedIconPath.replace(/\.icon\.rendered\.webp$/i, '.icon.default.webp');
    if (await pathExists(publicDefaultPath) && await imageFileHasVisiblePixels(publicDefaultPath)) {
        return {
            sourceFilePath: publicDefaultPath,
            content: await readFileWithRetries(publicDefaultPath),
            kind: 'colocated-default',
        };
    }

    const location = parseAssetRelativeLocation(renderedIconPath);
    const assetId = normalizeId(location?.assetId ?? location?.modificationId);
    if (assetId) {
        const generatedIconPath = await resolveGeneratedIconFilePathForAssetId(assetId, generatedIconsDirectory);
        if (generatedIconPath) {
            return {
                sourceFilePath: generatedIconPath,
                content: await readFileWithRetries(generatedIconPath),
                kind: 'generated-icon',
            };
        }
    }

    const owner = resolveManifestOwnerForPublicRenderedAsset(manifest, renderedIconPath);
    const ownerId = normalizeId(owner?.structure?.id ?? owner?.sourceStructure?.id);
    if (ownerId && ownerId !== assetId) {
        const generatedIconPath = await resolveGeneratedIconFilePathForAssetId(ownerId, generatedIconsDirectory);
        if (generatedIconPath) {
            return {
                sourceFilePath: generatedIconPath,
                content: await readFileWithRetries(generatedIconPath),
                kind: 'generated-icon',
            };
        }
    }

    return null;
}

function createEmptyRawRenderedAssetSyncStats() {
    return {
        candidates: 0,
        reused: 0,
        previewSynced: 0,
        derivedIcons: 0,
        pencilDefaults: 0,
        rawSynced: 0,
        locked: 0,
    };
}

function mergeRawRenderedAssetSyncStats(target, source) {
    for (const [key, value] of Object.entries(source ?? {})) {
        target[key] = (target[key] ?? 0) + value;
    }
}

async function collectRawRenderedAssetSyncCandidates(scopedTargets = null) {
    const candidates = [];

    for (const rawRootDirectory of [rawRenderedAssetTypesDirectory, rawRenderedSharedAssetsDirectory]) {
        if (!await pathExists(rawRootDirectory)) {
            continue;
        }

        for await (const filePath of walkFiles(rawRootDirectory)) {
            const extension = extname(filePath).toLowerCase();
            if (extension !== '.json' && extension !== '.webp' && extension !== '.png') {
                continue;
            }

            if (extension === '.webp' && !shouldSyncRenderedAssetToPublic(basename(filePath))) {
                continue;
            }

            if (extension === '.webp' && basename(filePath).toLowerCase().endsWith('.preview.webp')) {
                const previewPngMasterPath = filePath.replace(/\.preview\.webp$/i, '.preview.png');
                if (await pathExists(previewPngMasterPath)) {
                    continue;
                }
            }

            if (extension === '.png' && !basename(filePath).toLowerCase().endsWith('.preview.png')
                && !basename(filePath).toLowerCase().endsWith('.icon.default.png')) {
                continue;
            }

            const outputPath = resolveRawRenderedAssetPublicOutputPath(filePath);
            if (!outputPath || !matchesScopedRawRenderedAssetTargets(scopedTargets, outputPath)) {
                continue;
            }

            candidates.push({ filePath, extension, outputPath });
        }
    }

    return candidates;
}

async function syncRawRenderedAssetCandidate(candidate, manifest = null) {
    const stats = createEmptyRawRenderedAssetSyncStats();
    const { filePath, extension, outputPath } = candidate;

    if (extension === '.png') {
        const previewWebpPath = outputPath.replace(/\.png$/i, '.webp');
        if (basename(filePath).toLowerCase().endsWith('.preview.png')) {
            const previewPngHasVisiblePixels = await imageFileHasVisiblePixels(filePath);
            if (previewPngHasVisiblePixels) {
                await mkdir(dirname(previewWebpPath), { recursive: true });
                const previewPng = await readFileWithRetries(filePath);
                const previewWebp = await sharp(previewPng).webp(lossyPreviewWebpOptions).toBuffer();
                if (await writeFileIfChanged(previewWebpPath, previewWebp)) {
                    stats.previewSynced += 1;
                    logPublishDetail(`synced preview master ${filePath} -> ${previewWebpPath}`);
                } else {
                    stats.reused += 1;
                }
            } else {
                logPublishDetail(`skipping blank preview master ${filePath}`);
            }

            const renderedIconPath = previewWebpPath.replace(/\.preview\.webp$/i, '.icon.rendered.webp');
            {
                await mkdir(dirname(renderedIconPath), { recursive: true });
                const owner = resolveManifestOwnerForPublicRenderedAsset(manifest, renderedIconPath);
                const subTypeIconUrl = owner
                    ? resolveSubtypeOverlayUrl({
                        structure: owner.structure,
                        sourceStructure: owner.sourceStructure,
                        assetKind: resolveDerivedRenderedIconAssetKind(basename(filePath)),
                        defaultWreckedSubtypeUrl: defaultWreckedSubtypeIconUrl,
                    })
                    : null;

                let renderedIcon = null;
                let derivedFrom = filePath;
                if (previewPngHasVisiblePixels) {
                    renderedIcon = await deriveRenderedIconWebpFromPreviewPng(filePath, subTypeIconUrl);
                } else {
                    const fallbackSource = await resolveBlankPreviewRenderedIconFallbackSource(
                        filePath,
                        renderedIconPath,
                        manifest,
                    );
                    if (fallbackSource?.content) {
                        renderedIcon = await deriveRenderedIconWebpFromSourceImage(
                            fallbackSource.content,
                            subTypeIconUrl,
                        );
                        derivedFrom = fallbackSource.sourceFilePath;
                        logPublishDetail(
                            `blank preview ${filePath}; deriving icon.rendered from ${fallbackSource.kind} ${derivedFrom}`,
                        );
                    } else {
                        logPublishWarn(
                            `blank preview ${filePath}; no icon fallback for ${renderedIconPath}`,
                        );
                    }
                }

                if (renderedIcon && await writeFileIfChanged(renderedIconPath, renderedIcon)) {
                    stats.derivedIcons += 1;
                    logPublishDetail(
                        `derived icon.rendered ${derivedFrom} -> ${renderedIconPath}`
                        + (subTypeIconUrl ? ' (with subtype)' : ''),
                    );
                } else if (renderedIcon) {
                    stats.reused += 1;
                }
            }
        } else if (basename(filePath).toLowerCase().endsWith('.icon.default.png')) {
            const defaultWebpPath = outputPath.replace(/\.png$/i, '.webp');
            if (!await shouldReuseExistingAssetOutput(defaultWebpPath)) {
                await mkdir(dirname(defaultWebpPath), { recursive: true });
                const owner = resolveManifestOwnerForPublicRenderedAsset(manifest, defaultWebpPath);
                const subTypeIconUrl = owner
                    ? resolveSubtypeOverlayUrl({
                        structure: owner.structure,
                        sourceStructure: owner.sourceStructure,
                        assetKind: resolveDerivedDefaultIconAssetKind(basename(filePath)),
                        defaultWreckedSubtypeUrl: defaultWreckedSubtypeIconUrl,
                    })
                    : null;
                const defaultPng = await readFileWithRetries(filePath);
                let defaultWebp;
                if (subTypeIconUrl) {
                    try {
                        const subTypeIconSource = await readPublishedIconSourceFile(
                            generatedIconsDirectory,
                            subTypeIconUrl,
                        );
                        defaultWebp = await composeSubtypeIcon(
                            defaultPng,
                            subTypeIconSource.content,
                            losslessPublishedWebpOptions,
                        );
                    } catch (error) {
                        logPublishWarn(
                            `failed to compose subtype icon ${subTypeIconUrl} onto pencil default ${filePath}: ${error}`,
                        );
                        defaultWebp = await sharp(defaultPng).webp(losslessPublishedWebpOptions).toBuffer();
                    }
                } else {
                    defaultWebp = await sharp(defaultPng).webp(losslessPublishedWebpOptions).toBuffer();
                }
                if (await writeFileIfChanged(defaultWebpPath, defaultWebp)) {
                    stats.pencilDefaults += 1;
                    logPublishDetail(
                        `synced pencil default ${filePath} -> ${defaultWebpPath}`
                        + (subTypeIconUrl ? ' (with subtype)' : ''),
                    );
                } else {
                    stats.reused += 1;
                }
            } else {
                stats.reused += 1;
            }
        }

        return stats;
    }

    if (await shouldReuseExistingAssetOutput(outputPath)) {
        stats.reused += 1;
        return stats;
    }

    await mkdir(dirname(outputPath), { recursive: true });
    try {
        if (extension === '.json') {
            if (await writeFileIfChanged(outputPath, await readFileWithRetries(filePath))) {
                stats.rawSynced += 1;
                logPublishDetail(`synced raw render ${filePath} -> ${outputPath}`);
            } else {
                stats.reused += 1;
            }
        } else if (await writeFileIfChanged(outputPath, await readImageContentAsWebp(filePath, resolveRawRenderedAssetWebpOptions(outputPath)))) {
            stats.rawSynced += 1;
            logPublishDetail(`synced raw render ${filePath} -> ${outputPath}`);
        } else {
            stats.reused += 1;
        }
    } catch (error) {
        if (!isRetryableFileSystemError(error) || !await pathExists(outputPath)) {
            throw error;
        }

        stats.locked += 1;
        logPublishWarn(`skipping locked raw render ${filePath} -> ${outputPath}: ${error}`);
    }

    return stats;
}

async function syncRawRenderedAssetsToPublicDirectory(scopedTargets = null, manifest = null) {
    const candidates = await collectRawRenderedAssetSyncCandidates(scopedTargets);
    if (candidates.length === 0) {
        return;
    }

    const syncStats = createEmptyRawRenderedAssetSyncStats();
    syncStats.candidates = candidates.length;
    const startedAt = Date.now();
    const partialStats = await mapWithConcurrency(
        candidates,
        publishConcurrency,
        candidate => syncRawRenderedAssetCandidate(candidate, manifest),
    );
    for (const partial of partialStats) {
        mergeRawRenderedAssetSyncStats(syncStats, partial);
    }

    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    logPublishSummary(
        `publish-manifest: synced ${syncStats.rawSynced + syncStats.previewSynced + syncStats.derivedIcons + syncStats.pencilDefaults} rendered assets`
        + ` (${syncStats.candidates} candidates, ${syncStats.reused} reused, ${syncStats.locked} locked,`
        + ` concurrency ${publishConcurrency}, ${elapsedSeconds}s)`
        + (isPublishVerbose() ? '' : '; pass --verbose for per-file logs'),
    );
}

async function readPublishedAssetUrlAsWebp(directory, sourceUrl) {
    const normalizedSourceUrl = String(sourceUrl ?? '').trim();
    if (!normalizedSourceUrl) {
        throw new Error('missing published asset source url');
    }

    if (isSharedPublishedIconUrl(normalizedSourceUrl)) {
        return readPublishedIconSourceFile(directory, normalizedSourceUrl);
    }

    const publishedSourceFilePath = resolvePublishedAssetFilePathFromUrl(normalizedSourceUrl);
    if (publishedSourceFilePath && await pathExists(publishedSourceFilePath)) {
        return {
            sourceFilePath: publishedSourceFilePath,
            content: await readImageContentAsWebp(publishedSourceFilePath),
        };
    }

    return readPublishedIconSourceFile(directory, normalizedSourceUrl);
}

async function syncSharedModificationDefaultIconAssets(manifest) {
    const sharedModificationDefaultIconSourceById = manifest?.__sharedModificationDefaultIconSourceById instanceof Map
        ? manifest.__sharedModificationDefaultIconSourceById
        : new Map();
    const sharedModificationSourceById = manifest?.__sharedModificationSourceById instanceof Map
        ? manifest.__sharedModificationSourceById
        : new Map();
    const writtenOutputPaths = new Set();
    let coLocatedSharedModificationAssets = 0;

    for (const [sharedModificationId, modification] of Object.entries(manifest?.shared?.modifications ?? {})) {
        const normalizedSharedModificationId = normalizeId(sharedModificationId);
        const sharedModificationSources = sharedModificationSourceById.get(normalizedSharedModificationId);
        // Prefer explicit source metadata from buildSharedModificationStore. Falling back to the
        // published/generated default URL only helps when that file already exists on disk.
        const defaultIconSourceUrl = sharedModificationSources?.defaultIconSourceUrl
            ?? sharedModificationDefaultIconSourceById.get(normalizedSharedModificationId)
            ?? (normalizePublishedIconAssetUrl(String(
                modification?.icons?.default ?? modification?.iconUrl ?? '',
            ).trim()) || null);
        const sourceEntries = [
            ['.icon.default', defaultIconSourceUrl],
            ['.icon.rendered', sharedModificationSources?.renderedIconSourceUrl ?? null],
            ['.preview', sharedModificationSources?.previewSourceUrl ?? null],
            ['.texture', sharedModificationSources?.textureSourceUrl ?? null],
        ].filter(([, sourceUrl]) => Boolean(sourceUrl));
        if (sourceEntries.length === 0) {
            continue;
        }

        const sharedAssetPathId = getSharedModificationAssetPathId(sharedModificationId);
        if (!sharedAssetPathId) {
            continue;
        }

        const outputDirectory = resolve(sharedAssetsDirectory, 'modifications', sharedAssetPathId);
        for (const [fileSuffix, sourceUrl] of sourceEntries) {
            const outputFilePath = resolve(outputDirectory, `${sharedAssetPathId}${fileSuffix}.webp`);
            const outputPathKey = normalizeFileSystemPathForComparison(outputFilePath);
            if (writtenOutputPaths.has(outputPathKey)) {
                continue;
            }

            if (await shouldReuseExistingAssetOutput(outputFilePath)) {
                writtenOutputPaths.add(outputPathKey);
                continue;
            }

            try {
                const source = await readPublishedAssetUrlAsWebp(generatedIconsDirectory, sourceUrl);
                await mkdir(outputDirectory, { recursive: true });
                await writeFileIfChanged(outputFilePath, source.content);
                writtenOutputPaths.add(outputPathKey);
                coLocatedSharedModificationAssets += 1;
                logPublishDetail(`co-located ${source.sourceFilePath} -> ${outputFilePath}`);
            } catch (error) {
                logPublishWarn(`skipping shared modification asset ${fileSuffix} for ${sharedModificationId} from ${sourceUrl}: ${error}`);
            }
        }
    }

    if (coLocatedSharedModificationAssets > 0) {
        logPublishSummary(`publish-manifest: co-located ${coLocatedSharedModificationAssets} shared modification assets`);
    }
}

function collectReferencedPublishedIconKeys(manifest) {
    const subtypeOverlayIconKeys = collectSubtypeOverlayIconKeys(manifest);
    const keys = new Set();

    function addValue(value) {
        const key = extractPublishedIconKey(value);
        if (!key || isComposeTimeSubtypeIconKey(key, subtypeOverlayIconKeys)) {
            return;
        }

        keys.add(key);
    }

    for (const structure of manifest?.assets ?? []) {
        addValue(structure?.icons?.default ?? structure?.iconUrl);
        addValue(structure?.icons?.rendered ?? structure?.previewIconUrl);
        addValue(structure?.previewUrl);
        addValue(structure?.variants?.default?.textureUrl);
        addValue(structure?.variants?.c?.textureUrl);
        addValue(structure?.variants?.w?.textureUrl);
        addValue(structure?.destroyed?.icons?.default ?? structure?.destroyed?.iconUrl);
        addValue(structure?.destroyed?.icons?.rendered ?? structure?.destroyed?.previewIconUrl);
        addValue(structure?.destroyed?.previewUrl);
        addValue(structure?.destroyed?.sprite?.source ?? structure?.destroyed?.textureUrl);
        addValue(structure?.packaged?.icons?.default ?? structure?.packaged?.iconUrl);
        addValue(structure?.packaged?.icons?.rendered ?? structure?.packaged?.previewIconUrl);
        addValue(structure?.packaged?.previewUrl);
        addValue(structure?.packaged?.sprite?.source ?? structure?.packaged?.textureUrl);
        for (const slot of getStructurePublishedModificationSlots(structure)) {
            for (const variant of Object.values(slot?.variants ?? {})) {
                addValue(variant?.icons?.default ?? variant?.iconUrl);
                addValue(variant?.icons?.rendered ?? variant?.renderedIconUrl);
                addValue(variant?.previewUrl);
                addValue(variant?.sprite?.source ?? variant?.textureUrl);
            }
        }
    }

    for (const modification of Object.values(manifest?.shared?.modifications ?? {})) {
        addValue(modification?.icons?.default ?? modification?.iconUrl);
        addValue(modification?.icons?.rendered ?? modification?.renderedIconUrl);
        addValue(modification?.previewUrl);
        addValue(modification?.sprite?.source ?? modification?.textureUrl);
    }

    return keys;
}

function normalizeId(value) {
    return String(value ?? '').trim().toLowerCase();
}

function createOilfieldSlickSvg(size) {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
        <filter id="blur-xl" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="34" />
        </filter>
        <filter id="blur-lg" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="18" />
        </filter>
        <filter id="blur-md" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="9" />
        </filter>
        <radialGradient id="outer-haze" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="rgba(16,28,18,0.00)"/>
            <stop offset="55%" stop-color="rgba(18,30,21,0.16)"/>
            <stop offset="78%" stop-color="rgba(14,22,16,0.42)"/>
            <stop offset="100%" stop-color="rgba(0,0,0,0.00)"/>
        </radialGradient>
        <radialGradient id="core-dark" cx="48%" cy="44%" r="56%">
            <stop offset="0%" stop-color="rgba(9,16,13,0.88)"/>
            <stop offset="48%" stop-color="rgba(15,31,22,0.80)"/>
            <stop offset="78%" stop-color="rgba(12,24,18,0.46)"/>
            <stop offset="100%" stop-color="rgba(0,0,0,0.00)"/>
        </radialGradient>
        <radialGradient id="rainbow-a" cx="35%" cy="32%" r="65%">
            <stop offset="0%" stop-color="rgba(0,160,130,0.32)"/>
            <stop offset="45%" stop-color="rgba(30,90,185,0.26)"/>
            <stop offset="70%" stop-color="rgba(160,40,190,0.18)"/>
            <stop offset="100%" stop-color="rgba(0,0,0,0.00)"/>
        </radialGradient>
        <radialGradient id="rainbow-b" cx="68%" cy="58%" r="58%">
            <stop offset="0%" stop-color="rgba(35,110,210,0.30)"/>
            <stop offset="36%" stop-color="rgba(70,210,150,0.22)"/>
            <stop offset="68%" stop-color="rgba(165,75,215,0.18)"/>
            <stop offset="100%" stop-color="rgba(0,0,0,0.00)"/>
        </radialGradient>
    </defs>

    <ellipse cx="320" cy="320" rx="236" ry="214" fill="url(#outer-haze)" filter="url(#blur-xl)"/>
    <ellipse cx="322" cy="308" rx="188" ry="172" fill="url(#core-dark)" filter="url(#blur-lg)"/>
    <ellipse cx="274" cy="285" rx="112" ry="96" fill="url(#rainbow-a)" filter="url(#blur-lg)"/>
    <ellipse cx="368" cy="352" rx="102" ry="92" fill="url(#rainbow-b)" filter="url(#blur-lg)"/>

    <g filter="url(#blur-md)">
        <ellipse cx="235" cy="255" rx="52" ry="34" fill="rgba(15,135,70,0.30)" transform="rotate(-18 235 255)"/>
        <ellipse cx="292" cy="232" rx="42" ry="22" fill="rgba(80,40,20,0.38)" transform="rotate(18 292 232)"/>
        <ellipse cx="387" cy="248" rx="38" ry="28" fill="rgba(25,45,180,0.30)" transform="rotate(-24 387 248)"/>
        <ellipse cx="223" cy="370" rx="48" ry="26" fill="rgba(20,110,55,0.28)" transform="rotate(16 223 370)"/>
        <ellipse cx="340" cy="390" rx="40" ry="26" fill="rgba(25,40,150,0.30)" transform="rotate(-8 340 390)"/>
        <ellipse cx="426" cy="352" rx="34" ry="30" fill="rgba(140,70,210,0.28)" transform="rotate(-16 426 352)"/>
        <ellipse cx="315" cy="320" rx="18" ry="84" fill="rgba(65,20,14,0.48)" transform="rotate(8 315 320)"/>
        <ellipse cx="280" cy="430" rx="20" ry="52" fill="rgba(55,30,18,0.42)" transform="rotate(-18 280 430)"/>
        <ellipse cx="185" cy="312" rx="54" ry="30" fill="rgba(20,70,130,0.20)" transform="rotate(-26 185 312)"/>
        <ellipse cx="452" cy="280" rx="42" ry="26" fill="rgba(165,115,150,0.18)" transform="rotate(-18 452 280)"/>
    </g>

    <g opacity="0.42">
        <circle cx="210" cy="205" r="5" fill="rgba(230,235,220,0.28)" />
        <circle cx="248" cy="178" r="4" fill="rgba(240,240,225,0.22)" />
        <circle cx="302" cy="165" r="5" fill="rgba(240,240,225,0.24)" />
        <circle cx="350" cy="170" r="4" fill="rgba(230,235,220,0.20)" />
        <circle cx="401" cy="185" r="5" fill="rgba(240,240,225,0.18)" />
    </g>

    <g fill="rgba(20,36,18,0.34)">
        <circle cx="172" cy="390" r="3"/>
        <circle cx="182" cy="405" r="4"/>
        <circle cx="196" cy="418" r="3"/>
        <circle cx="438" cy="402" r="3"/>
        <circle cx="452" cy="388" r="4"/>
        <circle cx="466" cy="375" r="3"/>
        <circle cx="424" cy="422" r="3"/>
        <circle cx="210" cy="442" r="3"/>
        <circle cx="228" cy="452" r="4"/>
    </g>
</svg>`;
}

async function generateSyntheticOilfieldAssets(manifest) {
    const hasOilfield = (manifest?.assets ?? []).some(structure => normalizeId(structure?.id) === 'oilfield');
    if (!hasOilfield) {
        return;
    }

    const outputDirectory = resolve(assetTypesDirectory, 'structures', 'oilfield');
    await mkdir(outputDirectory, { recursive: true });

    const texturePath = resolve(outputDirectory, 'oilfield.texture.webp');
    const previewPath = resolve(outputDirectory, 'oilfield.preview.webp');
    const renderedIconPath = resolve(outputDirectory, 'oilfield.icon.rendered.webp');
    const textureSidecarPath = resolve(outputDirectory, 'oilfield.texture.json');

    const reuseTexture = await shouldReuseExistingAssetOutput(texturePath);
    const reusePreview = await shouldReuseExistingAssetOutput(previewPath);
    const reuseRenderedIcon = await shouldReuseExistingAssetOutput(renderedIconPath);
    const reuseTextureSidecar = await shouldReuseExistingAssetOutput(textureSidecarPath);
    if (reuseTexture && reusePreview && reuseRenderedIcon && reuseTextureSidecar) {
        return;
    }

    const baseSize = 640;
    const baseBuffer = await sharp(Buffer.from(createOilfieldSlickSvg(baseSize)))
        .webp({ quality: 96, alphaQuality: 100 })
        .toBuffer();

    if (!reuseTexture) {
        await writeFileWithRetries(texturePath, baseBuffer);
    }
    if (!reusePreview) {
        await sharp(baseBuffer)
            .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .webp({ quality: 96, alphaQuality: 100 })
            .toFile(previewPath);
    }
    if (!reuseRenderedIcon) {
        await sharp(baseBuffer)
            .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .webp({ quality: 96, alphaQuality: 100 })
            .toFile(renderedIconPath);
    }

    if (!reuseTextureSidecar) {
        await writeTextFileIfChanged(textureSidecarPath, stringifyJsonAscii({
            schemaVersion: '1.0.0',
            structureId: 'oilfield',
            outputKey: 'oilfield',
            mode: 'topdown',
            sceneVariant: null,
            previewVariant: null,
            width: baseSize,
            height: baseSize,
            pixelsPerMeter: 64,
            anchorPixelX: baseSize / 2,
            anchorPixelY: baseSize / 2,
            imageCenterPixelX: baseSize / 2,
            imageCenterPixelY: baseSize / 2,
            offsetXPixels: 0,
            offsetYPixels: 0,
            offsetX: 0,
            offsetY: 0,
        }));
    }
}

function getManifestAssetTypeName(asset) {
    if (asset?.isVehicle === true) {
        return 'vehicles';
    }

    if (asset?.isItem === true) {
        return 'items';
    }

    return 'structures';
}

function buildPublishedAssetTypeLookup(manifest) {
    const lookup = new Map();

    for (const asset of manifest?.assets ?? []) {
        const assetTypeName = getManifestAssetTypeName(asset);
        for (const candidateId of [asset?.id, asset?.codeName]) {
            const normalizedCandidateId = normalizeId(candidateId);
            if (!normalizedCandidateId) {
                continue;
            }

            lookup.set(normalizedCandidateId, assetTypeName);
        }
    }

    return lookup;
}

function resolvePublishedAssetTypeName(assetId) {
    return publishedAssetTypeById.get(normalizeId(assetId)) ?? 'structures';
}

function getPublishedAssetDirectory(assetId) {
    const normalizedAssetId = normalizeId(assetId);
    if (!normalizedAssetId) {
        return null;
    }

    return resolve(assetTypesDirectory, resolvePublishedAssetTypeName(normalizedAssetId), normalizedAssetId);
}

function toPublicFoxholeAssetUrl(filePath) {
    return `${createFoxholeAssetsBaseUrl('/')}${relative(publicFoxholeAssetsDirectory, filePath).replace(/\\/g, '/')}`;
}

function getPublicFoxholeAssetFilePath(publicUrl) {
    const normalizedPublicUrl = String(publicUrl ?? '').trim();
    const publicBaseUrl = createFoxholeAssetsBaseUrl('/');
    if (!normalizedPublicUrl.startsWith(publicBaseUrl)) {
        return null;
    }

    return resolve(publicFoxholeAssetsDirectory, normalizedPublicUrl.slice(publicBaseUrl.length).replace(/\//g, '\\'));
}

function getPublishedStructureVariantTextureFilePath(assetId, variantKey) {
    const publishedAssetDirectory = getPublishedAssetDirectory(assetId);
    const normalizedAssetId = normalizeId(assetId);
    const normalizedVariantKey = normalizeId(variantKey);
    if (!publishedAssetDirectory || !normalizedAssetId || !normalizedVariantKey) {
        return null;
    }

    return resolve(publishedAssetDirectory, `${normalizedAssetId}.${normalizedVariantKey}.texture.webp`);
}

function getTextureSidecarPath(filePath) {
    if (!/\.texture(?:\.[0-9a-f]{6})?\.webp$/i.test(String(filePath ?? ''))) {
        return null;
    }

    return `${filePath.slice(0, -'.webp'.length)}.json`;
}

function parseAssetRelativeLocation(filePath) {
    const segments = relative(publicFoxholeAssetsDirectory, filePath)
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean);
    if (segments.length < 2) {
        return null;
    }

    if (segments[0] === 'shared' && segments[1] === 'modifications' && segments.length === 4) {
        return {
            scope: 'sharedModification',
            modificationId: normalizeId(segments[2]),
            fileName: segments[3],
        };
    }

    if (segments[0] === 'shared' && segments[1] === 'packaging' && segments.length === 4) {
        return {
            scope: 'sharedPackaging',
            shippableType: normalizeFoxholePackagedPalletKey(segments[2]),
            fileName: segments[3],
        };
    }

    if (segments[0] !== 'types' || segments.length < 4) {
        return null;
    }

    const assetType = normalizeId(segments[1]);
    const assetId = normalizeId(segments[2]);
    if (!assetTypeNames.includes(assetType) || !assetId) {
        return null;
    }

    if (segments.length === 4) {
        return {
            scope: 'asset',
            assetType,
            assetId,
            fileName: segments[3],
        };
    }

    if (segments.length === 6 && segments[3] === 'components') {
        return {
            scope: 'component',
            assetType,
            assetId,
            componentId: normalizeId(segments[4]),
            fileName: segments[5],
        };
    }

    if (segments.length === 6 && segments[3] === 'modifications') {
        return {
            scope: 'assetModification',
            assetType,
            assetId,
            modificationId: normalizeId(segments[4]),
            fileName: segments[5],
        };
    }

    if (
        segments.length === 8
        && segments[3] === 'modifications'
        && segments[5] === 'components'
    ) {
        return {
            scope: 'assetModificationComponent',
            assetType,
            assetId,
            modificationId: normalizeId(segments[4]),
            componentId: normalizeId(segments[6]),
            fileName: segments[7],
        };
    }

    return null;
}

function buildRenderGeneratorStyleSharedModificationIdComputation(variantId, variant, structurePreviewDirection, dataClassPath = '') {
    return buildRenderIdComputation(variantId, dataClassPath, variant);
}

function createRenderGeneratorStyleSharedModificationId(variantId, variant, structurePreviewDirection, diagnosticsContext = null) {
    const dataClassPath = String(diagnosticsContext?.dataClassPath ?? '').trim();
    const computation = buildRenderGeneratorStyleSharedModificationIdComputation(variantId, variant, structurePreviewDirection, dataClassPath);
    if (diagnosticsContext) {
        recordSharedModificationHashDiagnostic({
            kind: 'preferred-shared-modification-id-generated',
            ...cloneSharedModificationHashDiagnosticValue(diagnosticsContext),
            resolvedPreviewDirection: computation.previewDirection,
            normalizedVariantId: computation.normalizedVariantId,
            identity: computation.identity,
            fullHashHex: computation.fullHashHex,
            truncatedHashHex: computation.truncatedHashHex,
            generatedSharedModificationId: computation.generatedSharedModificationId,
            renderId: computation.renderId,
            inputs: {
                variantId: computation.variantIdInput,
                dataClassPath: computation.dataClassPathInput,
                templatePath: computation.templatePathInput,
                templateActorPath: computation.templateActorPathInput,
                templateMeshPath: computation.templateMeshPathInput,
                previewMeshPath: computation.previewMeshPathInput,
                name: computation.nameInput,
                description: computation.descriptionInput,
                previewDirection: computation.previewDirectionInput,
            },
        });
    }

    return computation.renderId;
}

function resolvePublishedSharedModificationId(candidateId, variantId, variant, structurePreviewDirection, diagnosticsContext = null) {
    const renderId = normalizeId(variant?.renderId)
        || normalizeId(candidateId);
    if (renderId && hasStandaloneModificationContentHashSuffix(renderId)) {
        if (diagnosticsContext) {
            recordSharedModificationHashDiagnostic({
                kind: 'render-id-reused-from-manifest',
                ...cloneSharedModificationHashDiagnosticValue(diagnosticsContext),
                candidateSharedModificationId: candidateId ?? null,
                generatedSharedModificationId: renderId,
                renderId,
            });
        }
        return renderId;
    }

    throw new Error(`Missing canonical renderId for modification variant '${variantId}'`);
}

function resolveSeededSharedModificationId(...candidates) {
    for (const candidate of candidates) {
        const normalized = normalizeId(candidate);
        if (normalized && hasStandaloneModificationContentHashSuffix(normalized)) {
            return normalized;
        }
    }

    return null;
}

function isHostLocalModificationRenderUrl(structureId, url) {
    const normalizedStructureId = normalizeId(structureId);
    const normalizedUrl = String(url ?? '').trim().toLowerCase();
    if (!normalizedStructureId || !normalizedUrl) {
        return false;
    }

    return normalizedUrl.includes(`/types/structures/${normalizedStructureId}/modifications/`);
}

function renderEntryHasHostLocalModificationVisuals(structureId, renderEntry) {
    if (!renderEntry || typeof renderEntry !== 'object') {
        return false;
    }

    return [
        renderEntry.previewUrl,
        renderEntry.textureUrl,
        renderEntry.defaultIconUrl,
        renderEntry.renderedIconUrl,
        renderEntry.iconUrl,
    ].some(url => isHostLocalModificationRenderUrl(structureId, url));
}

function isSharedModificationRenderIndexEntry(entry) {
    return isSharedModificationRenderSceneEntry(entry);
}

function resolvePreferredSharedModificationId(candidateId, variantId, variant, structurePreviewDirection, diagnosticsContext = null) {
    const normalizedCandidateId = normalizeId(candidateId);
    if (hasStandaloneModificationContentHashSuffix(normalizedCandidateId)) {
        if (diagnosticsContext) {
            recordSharedModificationHashDiagnostic({
                kind: 'preferred-shared-modification-id-reused',
                ...cloneSharedModificationHashDiagnosticValue(diagnosticsContext),
                candidateSharedModificationId: candidateId ?? null,
                normalizedCandidateSharedModificationId: normalizedCandidateId,
                generatedSharedModificationId: normalizedCandidateId,
            });
        }
        return normalizedCandidateId;
    }

    return createRenderGeneratorStyleSharedModificationId(variantId, variant, structurePreviewDirection, {
        candidateSharedModificationId: candidateId ?? null,
        normalizedCandidateSharedModificationId: normalizedCandidateId,
        ...cloneSharedModificationHashDiagnosticValue(diagnosticsContext),
    });
}

function createLegacyStandaloneModificationSharedRenderKey(variantId, variant, structurePreviewDirection) {
    const previewDirection = normalizeId(variant?.previewDirection) || normalizeId(structurePreviewDirection) || 'se';
    const identity = [
        normalizeId(variantId),
        variant?.useTemplateActor ? 'template-actor' : 'template-mesh',
        normalizeId(variant?.textureUrl),
        normalizeId(variant?.previewUrl),
        previewDirection,
    ].join('|');
    const hash = createHash('sha256').update(identity).digest('hex').slice(0, 12);
    const normalizedVariantId = normalizeStandaloneModificationKeyComponent(variantId);
    return normalizedVariantId ? `${normalizedVariantId}-${hash}` : hash;
}

function selectPreferredRenderUrl(currentUrl, candidateUrl) {
    if (!currentUrl) {
        return candidateUrl;
    }

    const score = value => {
        const normalized = String(value ?? '');
        const depth = normalized.split('/').filter(Boolean).length;
        return (depth * 1000) + normalized.length;
    };
    return score(candidateUrl) < score(currentUrl) ? candidateUrl : currentUrl;
}

function assignRenderUrl(entry, property, publicPath) {
    entry[property] = selectPreferredRenderUrl(entry[property], publicPath);
}

async function imageFileHasVisiblePixels(filePath) {
    const normalizedPath = resolve(filePath);
    const cached = renderVisibilityByFilePath.get(normalizedPath);
    if (cached) {
        return await cached;
    }

    const pending = (async () => {
        try {
            const content = await readFileWithRetries(filePath);
            const metadata = await sharp(content).metadata();
            const width = Number(metadata.width ?? 0);
            const height = Number(metadata.height ?? 0);
            if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
                return false;
            }

            const { data } = await sharp(content)
                .ensureAlpha()
                .resize(32, 32, { fit: 'inside', withoutEnlargement: true })
                .raw()
                .toBuffer({ resolveWithObject: true });
            return imageDataHasVisiblePixels(data);
        } catch {
            return false;
        }
    })();

    renderVisibilityByFilePath.set(normalizedPath, pending);
    return await pending;
}

async function hasVisiblePublishedAssetUrl(publicUrl) {
    const filePath = getPublicFoxholeAssetFilePath(publicUrl);
    if (!filePath || !await pathExists(filePath)) {
        return false;
    }

    return await imageFileHasVisiblePixels(filePath);
}

async function hasPublishedDestroyedVisual(structure, structuresWithVisibleRawDestroyedRenders = null) {
    const structureId = normalizeId(structure?.id);
    if (!structureId) {
        return false;
    }

    if (structuresWithVisibleRawDestroyedRenders?.has(structureId)) {
        return true;
    }

    return hasRawDestroyedRenderAssets(
        structureId,
        rawRenderedAssetTypesDirectory,
        resolvePublishedAssetTypeName,
    );
}

async function collectStructureIdsWithVisibleRawDestroyedRenders() {
    const structureIds = new Set();
    if (!await pathExists(rawRenderedAssetTypesDirectory)) {
        return structureIds;
    }

    const destroyedAssetPattern = /\.destroyed\.(texture|preview|icon\.rendered)\.webp$/i;
    for await (const filePath of walkFiles(rawRenderedAssetTypesDirectory)) {
        const fileName = basename(filePath);
        if (!destroyedAssetPattern.test(fileName)) {
            continue;
        }

        if (!await imageFileHasVisiblePixels(filePath)) {
            continue;
        }

        const structureId = normalizeId(basename(dirname(filePath)));
        if (structureId) {
            structureIds.add(structureId);
        }
    }

    return structureIds;
}

async function stripUnavailableDestroyedVisuals(
    manifest,
    structuresWithDestroyedRenderScenes = null,
    structuresWithVisibleRawDestroyedRenders = null,
    vehicleDestroyedPublishAllowlist = null,
) {
    return foxholeManifestSchema.parse({
        ...manifest,
        assets: await Promise.all((manifest?.assets ?? []).map(async structure => {
            if (!structure?.destroyed) {
                return structure;
            }

            if (!shouldPublishVehicleDestroyedVisual(structure, vehicleDestroyedPublishAllowlist)) {
                const { destroyed, ...structureWithoutDestroyed } = structure;
                return structureWithoutDestroyed;
            }

            if (await hasPublishedDestroyedVisual(structure, structuresWithVisibleRawDestroyedRenders)) {
                if (!structureHasResolvableDestroyedRenderScene(structure, structuresWithDestroyedRenderScenes)) {
                    const { destroyed, ...structureWithoutDestroyed } = structure;
                    return structureWithoutDestroyed;
                }

                return structure;
            }

            const { destroyed, ...structureWithoutDestroyed } = structure;
            return structureWithoutDestroyed;
        })),
    });
}

async function removeDestroyedArtifactsWithoutManifestEntry(manifest) {
    const destroyedAssetKinds = [
        'destroyed.icon.default',
        'destroyed.icon.rendered',
        'destroyed.preview',
        'destroyed.texture',
    ];

    for (const structure of manifest?.assets ?? []) {
        const structureId = normalizeId(structure?.id);
        if (!structureId || structure?.destroyed) {
            continue;
        }

        const outputDirectory = getPublishedAssetDirectory(structureId);
        if (!outputDirectory || !await pathExists(outputDirectory)) {
            continue;
        }

        for (const assetKind of destroyedAssetKinds) {
            const outputPath = resolve(outputDirectory, getCoLocatedStructureAssetFileName(structureId, assetKind));
            if (!await pathExists(outputPath)) {
                continue;
            }

            await unlink(outputPath);
            logPublishDetail(`removed unpublished destroyed artifact ${outputPath}`);
        }

        const destroyedTextureJsonPath = resolve(outputDirectory, `${structureId}.destroyed.texture.json`);
        if (await pathExists(destroyedTextureJsonPath)) {
            await unlink(destroyedTextureJsonPath);
            logPublishDetail(`removed unpublished destroyed artifact ${destroyedTextureJsonPath}`);
        }
    }
}

async function readImageDimensions(filePath) {
    try {
        const content = await readFileWithRetries(filePath);
        const metadata = await sharp(content).metadata();
        const width = Number(metadata.width ?? 0);
        const height = Number(metadata.height ?? 0);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            return null;
        }
        return { width, height };
    } catch {
        return null;
    }
}

async function readRenderSidecar(filePath) {
    try {
        const sidecarPath = getTextureSidecarPath(filePath);
        if (!sidecarPath) {
            return null;
        }

        const parsed = JSON.parse(await readFile(sidecarPath, 'utf8'));
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }

        const width = Number(parsed.width ?? 0);
        const height = Number(parsed.height ?? 0);
        const anchorPixelX = Number(parsed.anchorPixelX ?? NaN);
        const anchorPixelY = Number(parsed.anchorPixelY ?? NaN);
        const imageCenterPixelX = Number(parsed.imageCenterPixelX ?? NaN);
        const imageCenterPixelY = Number(parsed.imageCenterPixelY ?? NaN);
        const offsetX = Number(parsed.offsetXPixels ?? parsed.offsetX ?? NaN);
        const offsetY = Number(parsed.offsetYPixels ?? parsed.offsetY ?? NaN);

        if (typeof parsed.mode === 'string' && parsed.mode.trim().toLowerCase() !== 'topdown') {
            return null;
        }

        return {
            width: Number.isFinite(width) && width > 0 ? width : null,
            height: Number.isFinite(height) && height > 0 ? height : null,
            anchorX: Number.isFinite(width) && width > 0
                ? (Number.isFinite(imageCenterPixelX)
                    ? imageCenterPixelX / width
                    : Number.isFinite(anchorPixelX)
                        ? anchorPixelX / width
                        : null)
                : null,
            anchorY: Number.isFinite(height) && height > 0
                ? (Number.isFinite(imageCenterPixelY)
                    ? imageCenterPixelY / height
                    : Number.isFinite(anchorPixelY)
                        ? anchorPixelY / height
                        : null)
                : null,
            offsetX: Number.isFinite(offsetX) ? offsetX : null,
            offsetY: Number.isFinite(offsetY) ? offsetY : null,
        };
    } catch {
        return null;
    }
}

async function applyTextureMetadata(entry, filePath, widthKey = 'textureWidth', heightKey = 'textureHeight') {
    const sidecar = await readRenderSidecar(filePath);
    if (sidecar) {
        if (Number.isFinite(sidecar.width) && sidecar.width > 0) {
            entry[widthKey] = sidecar.width;
        }
        if (Number.isFinite(sidecar.height) && sidecar.height > 0) {
            entry[heightKey] = sidecar.height;
        }
        if (Number.isFinite(sidecar.anchorX)) {
            entry.anchorX = sidecar.anchorX;
        }
        if (Number.isFinite(sidecar.anchorY)) {
            entry.anchorY = sidecar.anchorY;
        }
        if (Number.isFinite(sidecar.offsetX)) {
            entry.offsetX = sidecar.offsetX;
        }
        if (Number.isFinite(sidecar.offsetY)) {
            entry.offsetY = sidecar.offsetY;
        }
        return;
    }

    const dimensions = await readImageDimensions(filePath);
    if (dimensions) {
        entry[widthKey] = dimensions.width;
        entry[heightKey] = dimensions.height;
    }
}

function assignIconRenderUrl(entry, publicPath, variant) {
    if (variant === 'rendered') {
        entry.renderedIconUrl = selectPreferredRenderUrl(entry.renderedIconUrl, publicPath);
        return;
    }

    entry.defaultIconUrl = selectPreferredRenderUrl(entry.defaultIconUrl, publicPath);
    entry.iconUrl = entry.defaultIconUrl ?? entry.renderedIconUrl ?? entry.iconUrl;
}

async function collectModificationRenderEntries(targetEntries, modificationId, fileName, publicPath, filePath) {
    const normalized = fileName.toLowerCase();
    const normalizedModificationId = normalizeId(modificationId);
    if (!normalizedModificationId) {
        return;
    }

    targetEntries[normalizedModificationId] ??= {};
    const entry = targetEntries[normalizedModificationId];

    if (normalized.endsWith('.preview.webp')) {
        if (!await imageFileHasVisiblePixels(filePath)) {
            return;
        }
        assignRenderUrl(entry, 'previewUrl', publicPath);
        entry.previewDirection = resolvePreviewDirectionFromUrl(publicPath) ?? entry.previewDirection;
        return;
    }

    if (normalized.endsWith('.icon.rendered.webp')) {
        if (!await imageFileHasVisiblePixels(filePath)) {
            return;
        }
        assignIconRenderUrl(entry, publicPath, 'rendered');
        return;
    }

    if (normalized.endsWith('.icon.default.webp')) {
        assignIconRenderUrl(entry, publicPath, 'default');
        return;
    }

    if (!normalized.endsWith('.texture.webp')) {
        return;
    }

    assignRenderUrl(entry, 'textureUrl', publicPath);
    await applyTextureMetadata(entry, filePath);
}

async function collectStructureComponentRenderEntries(structureLayerEntriesByStructureId, structureId, componentId, fileName, publicPath, filePath) {
    const normalized = fileName.toLowerCase();
    if (!normalized.endsWith('.texture.webp')) {
        return;
    }

    const layerId = normalizeId(componentId);
    const normalizedStructureId = normalizeId(structureId);
    if (!layerId || !normalizedStructureId || isStandaloneDestroyedOrBreachedStructureId(normalizedStructureId)) {
        return;
    }

    structureLayerEntriesByStructureId[normalizedStructureId] ??= {};
    const entry = structureLayerEntriesByStructureId[normalizedStructureId][layerId] ?? { id: layerId };
    entry.textureUrl = publicPath;
    await applyTextureMetadata(entry, filePath, 'width', 'height');
    structureLayerEntriesByStructureId[normalizedStructureId][layerId] = entry;
}

async function collectModificationComponentRenderEntries(
    modificationLayerEntriesByAssetId,
    structureId,
    modificationId,
    componentId,
    fileName,
    publicPath,
    filePath,
) {
    const normalized = fileName.toLowerCase();
    if (!normalized.endsWith('.texture.webp')) {
        return;
    }

    const layerId = normalizeId(componentId);
    const normalizedStructureId = normalizeId(structureId);
    const normalizedModificationId = normalizeId(modificationId);
    if (!layerId || !normalizedStructureId || !normalizedModificationId) {
        return;
    }

    modificationLayerEntriesByAssetId[normalizedStructureId] ??= {};
    modificationLayerEntriesByAssetId[normalizedStructureId][normalizedModificationId] ??= {};
    const entry = modificationLayerEntriesByAssetId[normalizedStructureId][normalizedModificationId][layerId] ?? { id: layerId };
    entry.textureUrl = publicPath;
    await applyTextureMetadata(entry, filePath, 'width', 'height');
    modificationLayerEntriesByAssetId[normalizedStructureId][normalizedModificationId][layerId] = entry;
}

async function collectSharedPackagedPalletRenderEntries(sharedPackagingEntriesByKey, shippableType, fileName, publicPath, filePath) {
    const normalized = fileName.toLowerCase();
    const normalizedShippableType = normalizeFoxholePackagedPalletKey(shippableType);
    if (!normalized.endsWith('.texture.webp') || !normalizedShippableType) {
        return;
    }

    sharedPackagingEntriesByKey[normalizedShippableType] ??= {};
    sharedPackagingEntriesByKey[normalizedShippableType].textureUrl = publicPath;
    await applyTextureMetadata(sharedPackagingEntriesByKey[normalizedShippableType], filePath, 'width', 'height');
}

function getStructureColorRenderEntry(entriesByKey, key, colorHex) {
    const normalizedKey = normalizeId(key);
    const normalizedColorHex = normalizeId(colorHex);
    if (!normalizedKey || !normalizedColorHex) {
        return null;
    }

    entriesByKey[normalizedKey] ??= {};
    entriesByKey[normalizedKey].colors ??= {};
    entriesByKey[normalizedKey].colors[normalizedColorHex] ??= { hex: normalizedColorHex };
    return entriesByKey[normalizedKey].colors[normalizedColorHex];
}

async function collectAssetRenderEntries(
    entriesByKey,
    modificationEntriesByKey,
    modificationEntriesByAssetId,
    structureLayerEntriesByStructureId,
    modificationLayerEntriesByAssetId,
    sharedPackagingEntriesByKey,
    filePath,
) {
    const location = parseAssetRelativeLocation(filePath);
    if (!location) {
        return;
    }

    const publicPath = toPublicFoxholeAssetUrl(filePath);
    const fileName = basename(filePath);
    const normalized = fileName.toLowerCase();

    if (location.scope === 'sharedModification') {
        await collectModificationRenderEntries(modificationEntriesByKey, location.modificationId, fileName, publicPath, filePath);
        return;
    }

    if (location.scope === 'sharedPackaging') {
        await collectSharedPackagedPalletRenderEntries(sharedPackagingEntriesByKey, location.shippableType, fileName, publicPath, filePath);
        return;
    }

    if (location.scope === 'assetModification') {
        // Ignore stale hashed host-local leftovers still on disk from older publishes.
        if (isHashedHostLocalModificationDirectoryName(location.modificationId)) {
            return;
        }
        modificationEntriesByAssetId[location.assetId] ??= {};
        await collectModificationRenderEntries(
            modificationEntriesByAssetId[location.assetId],
            location.modificationId,
            fileName,
            publicPath,
            filePath,
        );
        return;
    }

    if (location.scope === 'assetModificationComponent') {
        if (isHashedHostLocalModificationDirectoryName(location.modificationId)) {
            return;
        }
        await collectModificationComponentRenderEntries(
            modificationLayerEntriesByAssetId,
            location.assetId,
            location.modificationId,
            location.componentId,
            fileName,
            publicPath,
            filePath,
        );
        return;
    }

    if (location.scope === 'component') {
        await collectStructureComponentRenderEntries(
            structureLayerEntriesByStructureId,
            location.assetId,
            location.componentId,
            fileName,
            publicPath,
            filePath,
        );
        return;
    }

    const destroyedDirectionalPreviewMatch = normalized.match(/^(.*)\.destroyed\.preview\.(ne|nw|se|sw)\.webp$/);
    if (destroyedDirectionalPreviewMatch) {
        if (!await imageFileHasVisiblePixels(filePath)) {
            return;
        }
        const key = normalizeId(destroyedDirectionalPreviewMatch[1]);
        entriesByKey[key] ??= {};
        entriesByKey[key].destroyed ??= {};
        assignRenderUrl(entriesByKey[key].destroyed, 'previewUrl', publicPath);
        entriesByKey[key].destroyed.previewDirection = destroyedDirectionalPreviewMatch[2];
        return;
    }

    if (normalized.endsWith('.destroyed.preview.webp')) {
        if (!await imageFileHasVisiblePixels(filePath)) {
            return;
        }
        const key = normalizeId(fileName.slice(0, -'.destroyed.preview.webp'.length));
        entriesByKey[key] ??= {};
        entriesByKey[key].destroyed ??= {};
        assignRenderUrl(entriesByKey[key].destroyed, 'previewUrl', publicPath);
        entriesByKey[key].destroyed.previewDirection = resolvePreviewDirectionFromUrl(publicPath) ?? entriesByKey[key].destroyed.previewDirection;
        return;
    }

    if (normalized.endsWith('.destroyed.icon.rendered.webp')) {
        if (!await imageFileHasVisiblePixels(filePath)) {
            return;
        }
        const key = normalizeId(fileName.slice(0, -'.destroyed.icon.rendered.webp'.length));
        entriesByKey[key] ??= {};
        entriesByKey[key].destroyed ??= {};
        assignIconRenderUrl(entriesByKey[key].destroyed, publicPath, 'rendered');
        return;
    }

    if (normalized.endsWith('.destroyed.icon.default.webp')) {
        if (!await imageFileHasVisiblePixels(filePath)) {
            return;
        }
        const key = normalizeId(fileName.slice(0, -'.destroyed.icon.default.webp'.length));
        entriesByKey[key] ??= {};
        entriesByKey[key].destroyed ??= {};
        assignIconRenderUrl(entriesByKey[key].destroyed, publicPath, 'default');
        return;
    }

    if (normalized.endsWith('.destroyed.texture.webp')) {
        if (!await imageFileHasVisiblePixels(filePath)) {
            return;
        }
        const key = normalizeId(fileName.slice(0, -'.destroyed.texture.webp'.length));
        entriesByKey[key] ??= {};
        entriesByKey[key].destroyed ??= {};
        assignRenderUrl(entriesByKey[key].destroyed, 'textureUrl', publicPath);
        await applyTextureMetadata(entriesByKey[key].destroyed, filePath);
        return;
    }

    const packagedDirectionalPreviewMatch = normalized.match(/^(.*)\.packaged\.preview\.(ne|nw|se|sw)\.webp$/);
    if (packagedDirectionalPreviewMatch) {
        if (!await imageFileHasVisiblePixels(filePath)) {
            return;
        }
        const key = normalizeId(packagedDirectionalPreviewMatch[1]);
        entriesByKey[key] ??= {};
        entriesByKey[key].packaged ??= {};
        assignRenderUrl(entriesByKey[key].packaged, 'previewUrl', publicPath);
        entriesByKey[key].packaged.previewDirection = packagedDirectionalPreviewMatch[2];
        return;
    }

    if (normalized.endsWith('.packaged.preview.webp')) {
        if (!await imageFileHasVisiblePixels(filePath)) {
            return;
        }
        const key = normalizeId(fileName.slice(0, -'.packaged.preview.webp'.length));
        entriesByKey[key] ??= {};
        entriesByKey[key].packaged ??= {};
        assignRenderUrl(entriesByKey[key].packaged, 'previewUrl', publicPath);
        entriesByKey[key].packaged.previewDirection = resolvePreviewDirectionFromUrl(publicPath) ?? entriesByKey[key].packaged.previewDirection;
        return;
    }

    if (normalized.endsWith('.packaged.icon.rendered.webp')) {
        if (!await imageFileHasVisiblePixels(filePath)) {
            return;
        }
        const key = normalizeId(fileName.slice(0, -'.packaged.icon.rendered.webp'.length));
        entriesByKey[key] ??= {};
        entriesByKey[key].packaged ??= {};
        assignIconRenderUrl(entriesByKey[key].packaged, publicPath, 'rendered');
        return;
    }

    if (normalized.endsWith('.packaged.icon.default.webp')) {
        const key = normalizeId(fileName.slice(0, -'.packaged.icon.default.webp'.length));
        entriesByKey[key] ??= {};
        entriesByKey[key].packaged ??= {};
        assignIconRenderUrl(entriesByKey[key].packaged, publicPath, 'default');
        return;
    }

    if (normalized.endsWith('.packaged.texture.webp')) {
        const key = normalizeId(fileName.slice(0, -'.packaged.texture.webp'.length));
        entriesByKey[key] ??= {};
        entriesByKey[key].packaged ??= {};
        assignRenderUrl(entriesByKey[key].packaged, 'textureUrl', publicPath);
        await applyTextureMetadata(entriesByKey[key].packaged, filePath);
        return;
    }

    const colorVariantMatch = normalized.match(/^(.*)\.(texture|preview|icon\.rendered)\.([0-9a-f]{6})\.webp$/);
    if (colorVariantMatch) {
        const key = normalizeId(colorVariantMatch[1]);
        const role = colorVariantMatch[2];
        const colorHex = colorVariantMatch[3];
        const colorEntry = getStructureColorRenderEntry(entriesByKey, key, colorHex);
        if (!colorEntry) {
            return;
        }

        if (role === 'preview') {
            if (!await imageFileHasVisiblePixels(filePath)) {
                return;
            }
            assignRenderUrl(colorEntry, 'previewUrl', publicPath);
            return;
        }

        if (role === 'icon.rendered') {
            if (!await imageFileHasVisiblePixels(filePath)) {
                return;
            }
            assignIconRenderUrl(colorEntry, publicPath, 'rendered');
            return;
        }

        assignRenderUrl(colorEntry, 'textureUrl', publicPath);
        await applyTextureMetadata(colorEntry, filePath);
        return;
    }

    const directionalPreviewMatch = normalized.match(/^(.*)\.preview\.(ne|nw|se|sw)\.webp$/);
    if (directionalPreviewMatch) {
        if (!await imageFileHasVisiblePixels(filePath)) {
            return;
        }
        const key = normalizeId(directionalPreviewMatch[1]);
        entriesByKey[key] ??= {};
        assignRenderUrl(entriesByKey[key], 'previewUrl', publicPath);
        return;
    }

    if (normalized.endsWith('.preview.webp')) {
        if (!await imageFileHasVisiblePixels(filePath)) {
            return;
        }
        const key = normalizeId(fileName.slice(0, -'.preview.webp'.length));
        entriesByKey[key] ??= {};
        assignRenderUrl(entriesByKey[key], 'previewUrl', publicPath);
        return;
    }

    if (normalized.endsWith('.icon.rendered.webp')) {
        if (!await imageFileHasVisiblePixels(filePath)) {
            return;
        }
        const key = normalizeId(fileName.slice(0, -'.icon.rendered.webp'.length));
        entriesByKey[key] ??= {};
        assignIconRenderUrl(entriesByKey[key], publicPath, 'rendered');
        return;
    }

    if (normalized.endsWith('.icon.default.webp')) {
        const key = normalizeId(fileName.slice(0, -'.icon.default.webp'.length));
        entriesByKey[key] ??= {};
        assignIconRenderUrl(entriesByKey[key], publicPath, 'default');
        return;
    }

    if (normalized.endsWith('.texture.webp')) {
        const key = normalizeId(fileName.slice(0, -'.texture.webp'.length));
        entriesByKey[key] ??= {};
        assignRenderUrl(entriesByKey[key], 'textureUrl', publicPath);
        await applyTextureMetadata(entriesByKey[key], filePath);
    }
}

function resolveStructureRenderEntry(entriesByKey, structure) {
    const exactLookupKeys = Array.from(new Set([
        structure.id,
        structure.codeName,
        structure.legacyKey,
    ].map(normalizeId).filter(Boolean)));
    const fallbackLookupKeys = exactLookupKeys.map(key => `${key}.default`);
    const entries = [
        ...exactLookupKeys.map(key => entriesByKey[key]),
        ...fallbackLookupKeys.map(key => entriesByKey[key]),
        ...Object.entries(entriesByKey)
            .filter(([key]) => exactLookupKeys.some(lookupKey => key.endsWith(`.${lookupKey}`)))
            .map(([, entry]) => entry),
    ].filter(Boolean);

    if (entries.length === 0) {
        return null;
    }

    const pickValue = property => entries
        .map(entry => entry[property])
        .filter(Boolean)
        .reduce((best, value) => selectPreferredRenderUrl(best, value), null);
    const pickDirectionalPreviewValue = property => {
        const values = entries.map(entry => entry[property]).filter(Boolean);
        const desiredDirection = normalizeId(structure.previewDirection) || null;
        const directionalValues = desiredDirection
            ? values.filter(value => resolvePreviewDirectionFromUrl(value) === desiredDirection)
            : values;
        const candidates = directionalValues.length > 0 ? directionalValues : values;
        return candidates.reduce((best, value) => selectPreferredRenderUrl(best, value), null);
    };
    const colorEntriesByHex = new Map();
    for (const entry of entries) {
        for (const [hex, colorEntry] of Object.entries(entry?.colors ?? {})) {
            const normalizedHex = normalizeId(hex);
            if (!normalizedHex) {
                continue;
            }

            const variants = colorEntriesByHex.get(normalizedHex) ?? [];
            variants.push(colorEntry);
            colorEntriesByHex.set(normalizedHex, variants);
        }
    }
    const pickValueFromEntries = (candidateEntries, property) => candidateEntries
        .map(entry => entry?.[property])
        .filter(Boolean)
        .reduce((best, value) => selectPreferredRenderUrl(best, value), null);
    const pickDirectionalPreviewValueFromEntries = (candidateEntries, property) => {
        const values = candidateEntries.map(entry => entry?.[property]).filter(Boolean);
        const desiredDirection = normalizeId(structure.previewDirection) || null;
        const directionalValues = desiredDirection
            ? values.filter(value => resolvePreviewDirectionFromUrl(value) === desiredDirection)
            : values;
        const candidates = directionalValues.length > 0 ? directionalValues : values;
        return candidates.reduce((best, value) => selectPreferredRenderUrl(best, value), null);
    };
    const colors = (Array.isArray(structure.colors) ? structure.colors : [])
        .map(color => {
            const colorHex = normalizeId(color?.hex);
            if (!colorHex) {
                return null;
            }

            const colorEntries = colorEntriesByHex.get(colorHex) ?? [];
            const textureUrl = pickValueFromEntries(colorEntries, 'textureUrl');
            const previewUrl = pickDirectionalPreviewValueFromEntries(colorEntries, 'previewUrl');
            const renderedIconUrl = pickValueFromEntries(colorEntries, 'renderedIconUrl') ?? pickValueFromEntries(colorEntries, 'iconUrl');

            return {
                hex: colorHex,
                ...(textureUrl ? { textureUrl } : {}),
                ...(previewUrl ? { previewUrl } : {}),
                ...(renderedIconUrl ? { renderedIconUrl } : {}),
                ...(Number.isFinite(Number(colorEntries[0]?.textureWidth ?? NaN)) && Number(colorEntries[0]?.textureWidth ?? 0) > 0 ? { textureWidth: Number(colorEntries[0].textureWidth) } : {}),
                ...(Number.isFinite(Number(colorEntries[0]?.textureHeight ?? NaN)) && Number(colorEntries[0]?.textureHeight ?? 0) > 0 ? { textureHeight: Number(colorEntries[0].textureHeight) } : {}),
                ...(Number.isFinite(Number(colorEntries[0]?.anchorX ?? NaN)) ? { anchorX: Number(colorEntries[0].anchorX) } : {}),
                ...(Number.isFinite(Number(colorEntries[0]?.anchorY ?? NaN)) ? { anchorY: Number(colorEntries[0].anchorY) } : {}),
                ...(Number.isFinite(Number(colorEntries[0]?.offsetX ?? NaN)) ? { offsetX: Number(colorEntries[0].offsetX) } : {}),
                ...(Number.isFinite(Number(colorEntries[0]?.offsetY ?? NaN)) ? { offsetY: Number(colorEntries[0].offsetY) } : {}),
            };
        })
        .filter(color => color && (color.textureUrl || color.previewUrl || color.renderedIconUrl));
    const defaultColor = colors[0] ?? null;
    const destroyedEntries = entries
        .map(entry => entry?.destroyed)
        .filter(Boolean);
    const pickDestroyedValue = property => destroyedEntries
        .map(entry => entry[property])
        .filter(Boolean)
        .reduce((best, value) => selectPreferredRenderUrl(best, value), null);
    const pickDestroyedDirectionalPreviewValue = property => {
        const values = destroyedEntries.map(entry => entry[property]).filter(Boolean);
        const desiredDirection = normalizeId(structure.previewDirection) || null;
        const directionalValues = desiredDirection
            ? values.filter(value => resolvePreviewDirectionFromUrl(value) === desiredDirection)
            : values;
        const candidates = directionalValues.length > 0 ? directionalValues : values;
        return candidates.reduce((best, value) => selectPreferredRenderUrl(best, value), null);
    };
    const packagedEntries = entries
        .map(entry => entry?.packaged)
        .filter(Boolean);
    const pickPackagedValue = property => packagedEntries
        .map(entry => entry[property])
        .filter(Boolean)
        .reduce((best, value) => selectPreferredRenderUrl(best, value), null);
    const pickPackagedDirectionalPreviewValue = property => {
        const values = packagedEntries.map(entry => entry[property]).filter(Boolean);
        const desiredDirection = normalizeId(structure.previewDirection) || null;
        const directionalValues = desiredDirection
            ? values.filter(value => resolvePreviewDirectionFromUrl(value) === desiredDirection)
            : values;
        const candidates = directionalValues.length > 0 ? directionalValues : values;
        return candidates.reduce((best, value) => selectPreferredRenderUrl(best, value), null);
    };
    return {
        textureUrl: defaultColor?.textureUrl ?? pickValue('textureUrl'),
        previewUrl: defaultColor?.previewUrl ?? pickDirectionalPreviewValue('previewUrl'),
        iconUrl: pickValue('iconUrl'),
        defaultIconUrl: pickValue('defaultIconUrl') ?? pickValue('iconUrl'),
        renderedIconUrl: defaultColor?.renderedIconUrl ?? pickValue('renderedIconUrl') ?? pickValue('iconUrl'),
        previewDirection: resolvePreviewDirectionFromUrl(defaultColor?.previewUrl ?? pickDirectionalPreviewValue('previewUrl')),
        textureWidth: defaultColor?.textureWidth ?? entries
            .map(entry => Number(entry.textureWidth ?? 0))
            .find(value => Number.isFinite(value) && value > 0) ?? null,
        textureHeight: defaultColor?.textureHeight ?? entries
            .map(entry => Number(entry.textureHeight ?? 0))
            .find(value => Number.isFinite(value) && value > 0) ?? null,
        anchorX: defaultColor?.anchorX ?? entries
            .map(entry => Number(entry.anchorX ?? NaN))
            .find(value => Number.isFinite(value)) ?? null,
        anchorY: defaultColor?.anchorY ?? entries
            .map(entry => Number(entry.anchorY ?? NaN))
            .find(value => Number.isFinite(value)) ?? null,
        offsetX: defaultColor?.offsetX ?? entries
            .map(entry => Number(entry.offsetX ?? NaN))
            .find(value => Number.isFinite(value)) ?? null,
        offsetY: defaultColor?.offsetY ?? entries
            .map(entry => Number(entry.offsetY ?? NaN))
            .find(value => Number.isFinite(value)) ?? null,
        colors,
        destroyed: destroyedEntries.length > 0
            ? {
                textureUrl: pickDestroyedValue('textureUrl'),
                previewUrl: pickDestroyedDirectionalPreviewValue('previewUrl'),
                iconUrl: pickDestroyedValue('iconUrl'),
                defaultIconUrl: pickDestroyedValue('defaultIconUrl') ?? pickDestroyedValue('iconUrl'),
                renderedIconUrl: pickDestroyedValue('renderedIconUrl') ?? pickDestroyedValue('iconUrl'),
                previewDirection: resolvePreviewDirectionFromUrl(pickDestroyedDirectionalPreviewValue('previewUrl')),
                textureWidth: destroyedEntries
                    .map(entry => Number(entry.textureWidth ?? 0))
                    .find(value => Number.isFinite(value) && value > 0) ?? null,
                textureHeight: destroyedEntries
                    .map(entry => Number(entry.textureHeight ?? 0))
                    .find(value => Number.isFinite(value) && value > 0) ?? null,
                anchorX: destroyedEntries
                    .map(entry => Number(entry.anchorX ?? NaN))
                    .find(value => Number.isFinite(value)) ?? null,
                anchorY: destroyedEntries
                    .map(entry => Number(entry.anchorY ?? NaN))
                    .find(value => Number.isFinite(value)) ?? null,
                offsetX: destroyedEntries
                    .map(entry => Number(entry.offsetX ?? NaN))
                    .find(value => Number.isFinite(value)) ?? null,
                offsetY: destroyedEntries
                    .map(entry => Number(entry.offsetY ?? NaN))
                    .find(value => Number.isFinite(value)) ?? null,
            }
            : null,
        packaged: packagedEntries.length > 0
            ? {
                textureUrl: pickPackagedValue('textureUrl'),
                previewUrl: pickPackagedDirectionalPreviewValue('previewUrl'),
                iconUrl: pickPackagedValue('iconUrl'),
                defaultIconUrl: pickPackagedValue('defaultIconUrl') ?? pickPackagedValue('iconUrl'),
                renderedIconUrl: pickPackagedValue('renderedIconUrl') ?? pickPackagedValue('iconUrl'),
                previewDirection: resolvePreviewDirectionFromUrl(pickPackagedDirectionalPreviewValue('previewUrl')),
                textureWidth: packagedEntries
                    .map(entry => Number(entry.textureWidth ?? 0))
                    .find(value => Number.isFinite(value) && value > 0) ?? null,
                textureHeight: packagedEntries
                    .map(entry => Number(entry.textureHeight ?? 0))
                    .find(value => Number.isFinite(value) && value > 0) ?? null,
                anchorX: packagedEntries
                    .map(entry => Number(entry.anchorX ?? NaN))
                    .find(value => Number.isFinite(value)) ?? null,
                anchorY: packagedEntries
                    .map(entry => Number(entry.anchorY ?? NaN))
                    .find(value => Number.isFinite(value)) ?? null,
                offsetX: packagedEntries
                    .map(entry => Number(entry.offsetX ?? NaN))
                    .find(value => Number.isFinite(value)) ?? null,
                offsetY: packagedEntries
                    .map(entry => Number(entry.offsetY ?? NaN))
                    .find(value => Number.isFinite(value)) ?? null,
            }
            : null,
    };
}

function resolvePreviewDirectionFromUrl(value) {
    const match = String(value ?? '').toLowerCase().match(/\.preview\.(ne|nw|se|sw)\.webp$/);
    return match ? match[1] : null;
}

function sceneHasMeshNodes(sceneDocument) {
    const meshes = sceneDocument?.assets?.meshes;
    if (Array.isArray(meshes) && meshes.length > 0) {
        return true;
    }

    const stack = [...(sceneDocument?.scene?.roots ?? [])];
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') {
            continue;
        }

        if (typeof node.meshId === 'string' && node.meshId.trim().length > 0) {
            return true;
        }

        if (Array.isArray(node.children)) {
            stack.push(...node.children);
        }
    }

    return false;
}

function applyUpgradeStructureConsumerEntries(manifest, entriesByKey, modificationEntriesByAssetId) {
    for (const structure of manifest?.assets ?? []) {
        const parentStructureId = normalizeId(structure?.parentStructureId);
        const appliedModificationId = normalizeId(structure?.appliedModificationId);
        if (!structure?.isUpgrade || !parentStructureId || !appliedModificationId) {
            continue;
        }

        const renderEntry = cloneRenderEntry(entriesByKey?.[normalizeId(structure.id)]);
        if (!renderEntry) {
            continue;
        }

        renderEntry.iconUrl = renderEntry.renderedIconUrl ?? renderEntry.defaultIconUrl ?? renderEntry.iconUrl;
        renderEntry.isUpgrade = true;
        renderEntry.upgradeName = structure.upgradeName ?? null;
        renderEntry.parentStructureId = parentStructureId;
        renderEntry.rootStructureId = normalizeId(structure.rootStructureId ?? structure.parentStructureId);
        renderEntry.appliedModificationId = appliedModificationId;
        modificationEntriesByAssetId[parentStructureId] ??= {};
        modificationEntriesByAssetId[parentStructureId][appliedModificationId] = renderEntry;
    }
}

async function collectPublishedRenderEntryCandidatePaths(scopedTargets = null) {
    const candidatePaths = [];

    for (const directory of [assetTypesDirectory, sharedAssetsDirectory]) {
        if (!await pathExists(directory)) {
            continue;
        }

        for await (const filePath of walkFiles(directory)) {
            if (extname(filePath).toLowerCase() !== '.webp') {
                continue;
            }

            if (!matchesScopedRawRenderedAssetTargets(scopedTargets, filePath)) {
                continue;
            }

            candidatePaths.push(filePath);
        }
    }

    return candidatePaths;
}

function renderEntryFileRequiresVisibilityCheck(fileName) {
    const normalized = fileName.toLowerCase();
    if (!normalized.endsWith('.webp')) {
        return false;
    }

    if (normalized.endsWith('.destroyed.texture.webp')
        || normalized.endsWith('.destroyed.preview.webp')
        || normalized.endsWith('.destroyed.icon.rendered.webp')
        || normalized.endsWith('.destroyed.icon.default.webp')
        || /\.destroyed\.preview\.(ne|nw|se|sw)\.webp$/.test(normalized)) {
        return true;
    }

    if (/\.packaged\.preview\.(ne|nw|se|sw)\.webp$/.test(normalized)
        || normalized.endsWith('.packaged.preview.webp')
        || normalized.endsWith('.packaged.icon.rendered.webp')) {
        return true;
    }

    if (/\.(preview|icon\.rendered)\.[0-9a-f]{6}\.webp$/.test(normalized)) {
        return true;
    }

    if (/\.preview\.(ne|nw|se|sw)\.webp$/.test(normalized)
        || normalized.endsWith('.preview.webp')
        || normalized.endsWith('.icon.rendered.webp')) {
        return true;
    }

    return false;
}

async function prewarmRenderEntryVisibilityCache(filePaths) {
    const visibilityCandidates = filePaths.filter(filePath => renderEntryFileRequiresVisibilityCheck(basename(filePath)));
    if (visibilityCandidates.length === 0) {
        return 0;
    }

    await mapWithConcurrency(
        visibilityCandidates,
        publishConcurrency,
        filePath => imageFileHasVisiblePixels(filePath),
    );
    return visibilityCandidates.length;
}

async function buildStructureRenderEntries(manifest, scopedTargets = null) {
    const entriesByKey = {};
    const modificationEntriesByKey = {};
    const modificationEntriesByAssetId = {};
    const structureLayerEntriesByStructureId = {};
    const modificationLayerEntriesByAssetId = {};
    const sharedPackagingEntriesByKey = {};
    const candidateDirectories = [assetTypesDirectory, sharedAssetsDirectory];
    if (!(await Promise.all(candidateDirectories.map(directory => pathExists(directory)))).some(Boolean)) {
        return {
            entriesByKey,
            modificationEntriesByKey,
            modificationEntriesByAssetId,
            structureLayerEntriesByStructureId,
            modificationLayerEntriesByAssetId,
            sharedPackagingEntriesByKey,
        };
    }

    const candidatePaths = await collectPublishedRenderEntryCandidatePaths(scopedTargets);
    const startedAt = Date.now();
    const visibilityChecks = await prewarmRenderEntryVisibilityCache(candidatePaths);
    await mapWithConcurrency(
        candidatePaths,
        publishConcurrency,
        filePath => collectAssetRenderEntries(
            entriesByKey,
            modificationEntriesByKey,
            modificationEntriesByAssetId,
            structureLayerEntriesByStructureId,
            modificationLayerEntriesByAssetId,
            sharedPackagingEntriesByKey,
            filePath,
        ),
    );

    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    logPublishSummary(
        `publish-manifest: indexed ${candidatePaths.length} published render assets`
        + ` (${visibilityChecks} visibility checks, concurrency ${publishConcurrency}, ${elapsedSeconds}s)`,
    );

    await applySharedModificationConsumerEntries(modificationEntriesByKey, modificationEntriesByAssetId);
    applyUpgradeStructureConsumerEntries(manifest, entriesByKey, modificationEntriesByAssetId);

    return {
        entriesByKey,
        modificationEntriesByKey,
        modificationEntriesByAssetId,
        structureLayerEntriesByStructureId,
        modificationLayerEntriesByAssetId,
        sharedPackagingEntriesByKey,
    };
}

function cloneRenderEntry(entry) {
    return entry ? { ...entry } : entry;
}

async function applySharedModificationConsumerEntries(modificationEntriesByKey, modificationEntriesByAssetId) {
    const renderScenesIndexDocument = await loadRenderScenesIndexDocument();
    if (!renderScenesIndexDocument) {
        return;
    }

    for (const entry of renderScenesIndexDocument?.scenes ?? []) {
        const structureId = normalizeId(entry?.structureId);
        const consumers = Array.isArray(entry?.consumers) ? entry.consumers : [];
        if (!isSharedModificationRenderIndexEntry(entry)) {
            continue;
        }

        const sharedOutputKey = normalizeId(basename(String(entry?.outputPath ?? ''), '.scene.json'));
        if (!sharedOutputKey) {
            continue;
        }

        const renderEntry = modificationEntriesByKey?.[sharedOutputKey]
            ?? modificationEntriesByAssetId?.[structureId]?.[sharedOutputKey];
        if (!renderEntry) {
            continue;
        }

        renderEntry.sharedModificationId = sharedOutputKey;

        for (const consumer of consumers) {
            const consumerStructureId = normalizeId(consumer?.structureId) || structureId;
            const variantId = normalizeId(consumer?.variantId);
            if (!consumerStructureId || !variantId) {
                continue;
            }

            modificationEntriesByAssetId[consumerStructureId] ??= {};
            modificationEntriesByAssetId[consumerStructureId][variantId] = cloneRenderEntry(renderEntry);
        }
    }
}

function isAllowedRootStructureArtifact(structureId, fileName, hasDestroyedVariant = false, hasPackagedVariant = false, colorHexes = []) {
    const normalizedStructureId = normalizeId(structureId);
    const normalizedFileName = normalizeId(fileName);
    if (!normalizedStructureId || !normalizedFileName.startsWith(`${normalizedStructureId}.`)) {
        return true;
    }

    const normalizedColorHexes = Array.isArray(colorHexes)
        ? colorHexes.map(normalizeId).filter(hex => /^[0-9a-f]{6}$/.test(hex))
        : [];
    const isAllowedColorArtifact = normalizedColorHexes.some(colorHex => normalizedFileName === `${normalizedStructureId}.texture.${colorHex}.webp`
        || normalizedFileName === `${normalizedStructureId}.texture.${colorHex}.json`
        || normalizedFileName === `${normalizedStructureId}.preview.${colorHex}.webp`
        || normalizedFileName === `${normalizedStructureId}.icon.rendered.${colorHex}.webp`);

    return normalizedFileName === `${normalizedStructureId}.texture.webp`
        || normalizedFileName === `${normalizedStructureId}.icon.default.webp`
        || normalizedFileName === `${normalizedStructureId}.icon.rendered.webp`
        || normalizedFileName === `${normalizedStructureId}.preview.webp`
        || normalizedFileName.startsWith(`${normalizedStructureId}.preview.`)
        || normalizedFileName === `${normalizedStructureId}.texture.json`
        || isAllowedColorArtifact
        || (hasDestroyedVariant && (
            normalizedFileName === `${normalizedStructureId}.destroyed.texture.webp`
            || normalizedFileName === `${normalizedStructureId}.destroyed.texture.json`
            || normalizedFileName === `${normalizedStructureId}.destroyed.icon.default.webp`
            || normalizedFileName === `${normalizedStructureId}.destroyed.icon.rendered.webp`
            || normalizedFileName === `${normalizedStructureId}.destroyed.preview.webp`
            || normalizedFileName.startsWith(`${normalizedStructureId}.destroyed.preview.`)
        ))
        || (hasPackagedVariant && (
            normalizedFileName === `${normalizedStructureId}.packaged.texture.webp`
            || normalizedFileName === `${normalizedStructureId}.packaged.texture.json`
        ));
}

async function removeStaleRootStructureArtifacts(manifest) {
    const structures = [];
    for (const structure of (manifest?.assets ?? [])) {
        const structureId = normalizeId(structure?.id);
        if (!structureId) {
            continue;
        }

        structures.push({
            id: structureId,
            hasDestroyedVariant: await hasPublishedDestroyedVisual(structure),
            hasPackagedVariant: Boolean(structure?.packaged),
            colorHexes: Array.isArray(structure?.colors)
                ? structure.colors.map(color => normalizeId(color?.hex)).filter(Boolean)
                : [],
        });
    }

    if (structures.length === 0) {
        return;
    }

    for (const structure of structures) {
        const structureId = structure.id;
        const publishedAssetDirectory = getPublishedAssetDirectory(structureId);
        const candidateDirectories = [
            publishedAssetDirectory,
            resolve(renderScenesDirectory, structureId),
        ].filter(Boolean);

        for (const directory of candidateDirectories) {
            if (!await pathExists(directory)) {
                continue;
            }

            const entries = await readdir(directory, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isFile()) {
                    continue;
                }

                if (isAllowedRootStructureArtifact(
                    structureId,
                    entry.name,
                    structure.hasDestroyedVariant,
                    structure.hasPackagedVariant,
                    structure.colorHexes,
                )) {
                    continue;
                }

                if (!normalizeId(entry.name).startsWith(`${structureId}.`)) {
                    continue;
                }

                const outputPath = resolve(directory, entry.name);
                await unlink(outputPath);
                logPublishDetail(`removed stale artifact ${outputPath}`);
            }
        }
    }
}

function isStandaloneDestroyedOrBreachedStructure(structure) {
    if (structure?.isDestroyed === true || structure?.isBreached === true) {
        return true;
    }

    const structureId = normalizeId(structure?.id);
    const profileType = normalizeId(structure?.profileType);
    if (profileType === 'destroyedfort' || profileType === 'destroyedstructure') {
        return true;
    }

    return isStandaloneDestroyedOrBreachedStructureId(structureId);
}

function isStandaloneDestroyedOrBreachedStructureId(structureId) {
    const normalizedStructureId = normalizeId(structureId);
    if (!normalizedStructureId) {
        return false;
    }

    return normalizedStructureId.includes('destroyed') || normalizedStructureId.includes('breached');
}

function shouldPublishStructureComponentRenderLayers(structure) {
    // Standalone destroyed/breached structures intentionally have no component layers.
    // Spline/connector components are render-scene derived and may not appear as authored
    // renderLayers on the source manifest — keep publishing whatever component textures exist.
    return !isStandaloneDestroyedOrBreachedStructure(structure);
}

async function removeStaleStructureArtifactDirectories(manifest) {
    const structureIds = new Set((manifest?.assets ?? [])
        .map(structure => normalizeId(structure?.id))
        .filter(Boolean));

    for (const structureId of structureIds) {
        const structure = (manifest?.assets ?? []).find(asset => normalizeId(asset?.id) === structureId) ?? null;
        if (isStandaloneDestroyedOrBreachedStructure(structure ?? { id: structureId })) {
            const publishedAssetDirectory = getPublishedAssetDirectory(structureId);
            const componentsDirectory = publishedAssetDirectory
                ? resolve(publishedAssetDirectory, 'components')
                : null;
            if (componentsDirectory && await pathExists(componentsDirectory)) {
                await rm(componentsDirectory, { recursive: true, force: true });
                logPublishDetail(`removed stale component artifacts for ${structureId} at ${componentsDirectory}`);
            }
        }

        const publishedAssetDirectory = getPublishedAssetDirectory(structureId);
        const staleDirectories = [
            publishedAssetDirectory ? resolve(publishedAssetDirectory, 'mods') : null,
            resolve(renderScenesDirectory, structureId, 'mods'),
        ].filter(Boolean);

        for (const directory of staleDirectories) {
            if (!await pathExists(directory)) {
                continue;
            }

            await rm(directory, { recursive: true, force: true });
            logPublishDetail(`removed stale artifact directory ${directory}`);
        }
    }

    const sharedStaleDirectories = [
        resolve(sharedAssetsDirectory, 'mods', 'mods'),
        resolve(renderScenesDirectory, 'mods', 'mods'),
    ];

    for (const directory of sharedStaleDirectories) {
        if (!await pathExists(directory)) {
            continue;
        }

        await rm(directory, { recursive: true, force: true });
        logPublishDetail(`removed stale shared artifact directory ${directory}`);
    }
}

async function removeOrphanPublishedAssetDirectories(manifest) {
    const assetIdsByType = new Map([
        ['structures', new Set()],
        ['vehicles', new Set()],
        ['items', new Set()],
    ]);

    for (const asset of (manifest?.assets ?? [])) {
        const assetId = normalizeId(asset?.id);
        if (!assetId) {
            continue;
        }

        const assetType = getManifestAssetTypeName(asset);
        assetIdsByType.get(assetType)?.add(assetId);
    }

    for (const [assetType, assetIds] of assetIdsByType) {
        const assetTypeDirectory = resolve(assetTypesDirectory, assetType);
        if (!await pathExists(assetTypeDirectory)) {
            continue;
        }

        const entries = await readdir(assetTypeDirectory, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const assetId = normalizeId(entry.name);
            if (!assetId || assetIds.has(assetId)) {
                continue;
            }

            const directory = resolve(assetTypeDirectory, entry.name);
            await rm(directory, { recursive: true, force: true });
            logPublishDetail(`removed orphan published asset directory ${directory}`);
        }
    }
}

async function removeStructureArtifactsByIds(structureIds) {
    for (const structureId of structureIds) {
        const normalizedStructureId = normalizeId(structureId);
        if (!normalizedStructureId) {
            continue;
        }

        const publishedAssetDirectory = getPublishedAssetDirectory(normalizedStructureId);
        const candidateDirectories = [
            publishedAssetDirectory,
            resolve(renderScenesDirectory, normalizedStructureId),
        ].filter(Boolean);

        for (const directory of candidateDirectories) {
            if (!await pathExists(directory)) {
                continue;
            }

            await rm(directory, { recursive: true, force: true });
            logPublishDetail(`removed structure artifact directory ${directory}`);
        }
    }
}

async function removeLegacyTypedLayoutArtifacts(manifest) {
    const structureIds = new Set((manifest?.assets ?? [])
        .map(structure => normalizeId(structure?.id))
        .filter(Boolean));

    for (const structureId of structureIds) {
        const publishedAssetDirectory = getPublishedAssetDirectory(structureId);
        if (!publishedAssetDirectory) {
            continue;
        }

        for (const legacyDirectoryName of ['components', 'modifications']) {
            const legacyDirectoryPath = resolve(publishedAssetDirectory, legacyDirectoryName);
            if (!await pathExists(legacyDirectoryPath)) {
                continue;
            }

            const entries = await readdir(legacyDirectoryPath, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isFile()) {
                    continue;
                }

                const outputPath = resolve(legacyDirectoryPath, entry.name);
                await unlink(outputPath);
                logPublishDetail(`removed legacy typed artifact ${outputPath}`);
            }
        }
    }

    const legacySharedModsDirectory = resolve(assetTypesDirectory, 'structures', 'mods');
    if (await pathExists(legacySharedModsDirectory)) {
        await rm(legacySharedModsDirectory, { recursive: true, force: true });
        logPublishDetail(`removed legacy typed artifact directory ${legacySharedModsDirectory}`);
    }

    const legacySharedModificationKeys = new Set();
    for (const structure of manifest?.assets ?? []) {
        for (const slot of getStructurePublishedModificationSlots(structure)) {
            for (const [variantId, variant] of Object.entries(slot?.variants ?? {})) {
                if (!variant?.useTemplateActor) {
                    continue;
                }

                legacySharedModificationKeys.add(
                    createLegacyStandaloneModificationSharedRenderKey(variantId, variant, structure?.previewDirection),
                );
            }
        }
    }

    const legacySharedModificationDirectory = resolve(sharedAssetsDirectory, 'modifications');
    if (!await pathExists(legacySharedModificationDirectory)) {
        return;
    }

    for (const sharedModificationKey of legacySharedModificationKeys) {
        if (!sharedModificationKey) {
            continue;
        }

        const sharedModificationPath = resolve(legacySharedModificationDirectory, sharedModificationKey);
        if (!await pathExists(sharedModificationPath)) {
            continue;
        }

        await rm(sharedModificationPath, { recursive: true, force: true });
        logPublishDetail(`removed legacy shared modification artifact directory ${sharedModificationPath}`);
    }
}

function resolvePublishedAssetFilePathFromUrl(value) {
    const assetUrl = String(value ?? '').trim();
    if (!assetUrl.startsWith(createFoxholeAssetsBaseUrl('/'))) {
        return null;
    }

    return resolve(
        publicFoxholeAssetsDirectory,
        assetUrl.replace(`${createFoxholeAssetsBaseUrl('/')}`, '').replace(/\//g, '\\'),
    );
}

function collectReferencedPublicAssetDirectories(value, directories = new Set()) {
    if (typeof value === 'string') {
        const filePath = resolvePublishedAssetFilePathFromUrl(value);
        if (filePath) {
            directories.add(normalizeFileSystemPathForComparison(dirname(filePath)));
        }
        return directories;
    }

    if (Array.isArray(value)) {
        for (const entry of value) {
            collectReferencedPublicAssetDirectories(entry, directories);
        }
        return directories;
    }

    if (value && typeof value === 'object') {
        for (const entry of Object.values(value)) {
            collectReferencedPublicAssetDirectories(entry, directories);
        }
    }

    return directories;
}

function hasReferencedArtifactDirectory(referencedDirectories, directoryPath) {
    const normalizedDirectoryPath = normalizeFileSystemPathForComparison(directoryPath);
    const descendantPrefix = `${normalizedDirectoryPath}/`;
    for (const referencedDirectory of referencedDirectories) {
        if (referencedDirectory === normalizedDirectoryPath || referencedDirectory.startsWith(descendantPrefix)) {
            return true;
        }
    }

    return false;
}

function collectReferencedSharedModificationArtifactDirectories(manifest, directories = new Set()) {
    const referencedSharedModificationIds = collectReferencedSharedModificationIds(manifest);
    for (const sharedModificationId of Object.keys(manifest?.shared?.modifications ?? {})) {
        referencedSharedModificationIds.add(normalizeId(sharedModificationId));
    }

    for (const sharedModificationId of referencedSharedModificationIds) {
        const assetPathId = getSharedModificationAssetPathId(sharedModificationId);
        if (!assetPathId) {
            continue;
        }

        directories.add(normalizeFileSystemPathForComparison(
            resolve(sharedAssetsDirectory, 'modifications', assetPathId),
        ));
    }

    return directories;
}

function isReferencedSharedModificationArtifactDirectory(
    directoryName,
    referencedDirectories,
) {
    const candidateDirectory = resolve(sharedAssetsDirectory, 'modifications', directoryName);
    return hasReferencedArtifactDirectory(referencedDirectories, candidateDirectory);
}

async function removeUnreferencedGeneratedModificationArtifactDirectories(manifest, structureIds = null) {
    const referencedDirectories = collectReferencedPublicAssetDirectories(manifest);
    collectReferencedSharedModificationArtifactDirectories(manifest, referencedDirectories);
    const scopedStructureIds = structureIds instanceof Set
        ? structureIds
        : new Set((manifest?.assets ?? [])
            .map(structure => normalizeId(structure?.id))
            .filter(Boolean));
    let removedHostModificationDirectories = 0;
    let removedSharedModificationDirectories = 0;

    for (const structureId of scopedStructureIds) {
        const modificationsDirectory = resolve(
            getPublishedAssetDirectory(structureId)
            ?? resolve(assetTypesDirectory, resolvePublishedAssetTypeName(structureId), structureId),
            'modifications',
        );
        if (!await pathExists(modificationsDirectory)) {
            continue;
        }

        const entries = await readdir(modificationsDirectory, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const candidateDirectory = resolve(modificationsDirectory, entry.name);
            // Hashed host-local folders are always stale under the variantId layout.
            if (
                !isHashedHostLocalModificationDirectoryName(entry.name)
                && hasReferencedArtifactDirectory(referencedDirectories, candidateDirectory)
            ) {
                continue;
            }

            await rm(candidateDirectory, { recursive: true, force: true });
            removedHostModificationDirectories += 1;
            logPublishDetail(`removed unreferenced modification artifact directory ${candidateDirectory}`);
        }
    }

    const sharedModificationsDirectory = resolve(sharedAssetsDirectory, 'modifications');
    if (!structureIds && await pathExists(sharedModificationsDirectory)) {
        const sharedEntries = await readdir(sharedModificationsDirectory, { withFileTypes: true });
        for (const entry of sharedEntries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const candidateDirectory = resolve(sharedModificationsDirectory, entry.name);
            if (isReferencedSharedModificationArtifactDirectory(entry.name, referencedDirectories)) {
                continue;
            }

            await rm(candidateDirectory, { recursive: true, force: true });
            removedSharedModificationDirectories += 1;
            logPublishDetail(`removed unreferenced shared modification artifact directory ${candidateDirectory}`);
        }
    }

    if (removedHostModificationDirectories > 0 || removedSharedModificationDirectories > 0) {
        logPublishSummary(
            `publish-manifest: pruned ${removedHostModificationDirectories + removedSharedModificationDirectories} unreferenced modification directories`
            + ` (${removedHostModificationDirectories} host, ${removedSharedModificationDirectories} shared)`,
        );
    }
}

function pruneRemovedStructureLocalizations(manifest, removedStructureIds) {
    if (!removedStructureIds || removedStructureIds.size === 0) {
        return manifest;
    }

    const removedLocalizationPrefixes = [...removedStructureIds]
        .map(id => normalizeId(id))
        .filter(Boolean)
        .flatMap(id => [
            `foxhole:structure:${id}:`,
            `foxhole:asset:${id}:`,
        ]);
    if (removedLocalizationPrefixes.length === 0) {
        return manifest;
    }

    return foxholeManifestSchema.parse({
        ...manifest,
        localizations: normalizeLocalizationBundles(manifest.localizations).map(bundle => ({
            ...bundle,
            strings: Object.fromEntries(Object.entries(bundle.strings ?? {}).filter(([key]) => !removedLocalizationPrefixes.some(prefix => key.startsWith(prefix)))),
        })),
    });
}

function normalizeSharedModificationPayloadValue(value) {
    if (Array.isArray(value)) {
        return value.map(normalizeSharedModificationPayloadValue);
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .filter(([, entryValue]) => typeof entryValue !== 'undefined')
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([entryKey, entryValue]) => [entryKey, normalizeSharedModificationPayloadValue(entryValue)]));
    }

    return value;
}

function createSharedModificationPayloadSignature(value) {
    return JSON.stringify(normalizeSharedModificationPayloadValue(value));
}

function createFallbackSharedModificationId(variantId, variantPayload, signature, diagnosticsContext = null) {
    const readableId = normalizeStandaloneModificationKeyComponent(
        variantPayload?.appliedModificationId
        ?? variantPayload?.modificationId
        ?? variantId
        ?? variantPayload?.name?.fallback,
    );
    const fullHashHex = createHash('sha256').update(signature).digest('hex');
    const truncatedHashHex = fullHashHex.slice(0, 12);
    const generatedSharedModificationId = readableId ? `${readableId}-${truncatedHashHex}` : truncatedHashHex;
    if (diagnosticsContext) {
        recordSharedModificationHashDiagnostic({
            kind: 'fallback-shared-modification-id-generated',
            ...cloneSharedModificationHashDiagnosticValue(diagnosticsContext),
            readableId,
            signature,
            fullHashHex,
            truncatedHashHex,
            generatedSharedModificationId,
            normalizedVariantPayload: cloneSharedModificationHashDiagnosticValue(normalizeSharedModificationPayloadValue(variantPayload)),
        });
    }

    return generatedSharedModificationId;
}

function stripSharedModificationContentHashSuffix(value) {
    let normalized = normalizeStandaloneModificationKeyComponent(value);
    while (/-[a-f0-9]{12}$/.test(normalized)) {
        normalized = normalized.slice(0, -13);
    }

    return normalized;
}

function resolveUniqueSharedModificationId(preferredSharedModificationId, signature, usedSharedModificationIds, diagnosticsContext = null) {
    const fullHashHex = createHash('sha256').update(signature).digest('hex');
    const hash = fullHashHex.slice(0, 12);
    const normalizedPreferredId = normalizeStandaloneModificationKeyComponent(preferredSharedModificationId);
    const hasSinglePreferredHash = /-[a-f0-9]{12}$/.test(normalizedPreferredId)
        && !/-[a-f0-9]{12}-[a-f0-9]{12}$/.test(normalizedPreferredId);
    const normalizedPreferredBaseId = stripSharedModificationContentHashSuffix(normalizedPreferredId);
    const baseId = hasSinglePreferredHash
        ? normalizedPreferredId
        : (normalizedPreferredBaseId ? `${normalizedPreferredBaseId}-${hash}` : hash);
    if (!usedSharedModificationIds.has(baseId)) {
        usedSharedModificationIds.add(baseId);
        if (diagnosticsContext) {
            recordSharedModificationHashDiagnostic({
                kind: 'shared-modification-id-accepted',
                ...cloneSharedModificationHashDiagnosticValue(diagnosticsContext),
                preferredSharedModificationId,
                normalizedPreferredSharedModificationId: normalizedPreferredId,
                signature,
                fullHashHex,
                truncatedHashHex: hash,
                hasSinglePreferredHash,
                normalizedPreferredBaseId,
                baseId,
                resolvedSharedModificationId: baseId,
                collisionSuffix: 1,
            });
        }

        return baseId;
    }

    const collisionMessage = `renderId collision for '${baseId}' (signature=${signature})`;
    if (diagnosticsContext) {
        recordSharedModificationHashDiagnostic({
            kind: 'shared-modification-id-collision-failed',
            ...cloneSharedModificationHashDiagnosticValue(diagnosticsContext),
            preferredSharedModificationId,
            normalizedPreferredSharedModificationId: normalizedPreferredId,
            signature,
            fullHashHex,
            truncatedHashHex: hash,
            hasSinglePreferredHash,
            normalizedPreferredBaseId,
            baseId,
            error: collisionMessage,
        });
    }

    throw new Error(collisionMessage);
}

function extractLocalSharedModificationPayload(variant) {
    if (!isPlainObject(variant)) {
        return {};
    }

    const {
        sharedModificationId: _sharedModificationId,
        subTypeIconUrl: _subTypeIconUrl,
        icons: _icons,
        previewUrl: _previewUrl,
        previewDirection: _previewDirection,
        sprite: _sprite,
        ...localPayload
    } = variant;

    if (isPlainObject(localPayload.cost) && Object.keys(localPayload.cost).length === 0) {
        delete localPayload.cost;
    }

    return localPayload;
}

function extractSharedModificationPayload(sharedModificationId, variant) {
    if (!isPlainObject(variant)) {
        return {};
    }

    const sourceIcons = isPlainObject(variant.icons) ? variant.icons : {};
    const sourceSprite = isPlainObject(variant.sprite) ? variant.sprite : {};
    const hasDefaultIcon = Boolean(sourceIcons.default || variant.iconUrl);
    const hasPreview = Boolean(variant.previewUrl);
    const hasRenderedVisual = Boolean(sourceIcons.rendered || hasPreview || sourceSprite.source);
    const hasSpriteMetadata = [
        sourceSprite.width,
        sourceSprite.height,
        sourceSprite.anchorX,
        sourceSprite.anchorY,
        sourceSprite.offsetX,
        sourceSprite.offsetY,
    ].some(value => typeof value !== 'undefined' && value !== null);
    const sharedCost = isPlainObject(variant.cost) && Object.keys(variant.cost).length > 0
        ? variant.cost
        : null;

    return {
        ...(sharedCost ? { cost: sharedCost } : {}),
        ...(hasDefaultIcon
            ? {
                icons: {
                    default: createGeneratedSharedModificationAssetUrl(sharedModificationId, '.icon.default'),
                    ...(hasPreview
                        ? { rendered: createGeneratedSharedModificationAssetUrl(sharedModificationId, '.icon.rendered') }
                        : {}),
                },
            }
            : {}),
        ...(hasPreview
            ? { previewUrl: createGeneratedSharedModificationAssetUrl(sharedModificationId, '.preview') }
            : {}),
        ...(variant.previewDirection ? { previewDirection: variant.previewDirection } : {}),
        ...(hasRenderedVisual || hasSpriteMetadata
            ? {
                sprite: {
                    ...(hasRenderedVisual
                        ? { source: createGeneratedSharedModificationAssetUrl(sharedModificationId, '.texture') }
                        : {}),
                    ...(typeof sourceSprite.width === 'number' ? { width: sourceSprite.width } : {}),
                    ...(typeof sourceSprite.height === 'number' ? { height: sourceSprite.height } : {}),
                    ...(typeof sourceSprite.anchorX === 'number' ? { anchorX: sourceSprite.anchorX } : {}),
                    ...(typeof sourceSprite.anchorY === 'number' ? { anchorY: sourceSprite.anchorY } : {}),
                    ...(typeof sourceSprite.offsetX === 'number' ? { offsetX: sourceSprite.offsetX } : {}),
                    ...(typeof sourceSprite.offsetY === 'number' ? { offsetY: sourceSprite.offsetY } : {}),
                },
            }
            : {}),
    };
}

function mergeSharedModificationPayload(existingPayload, nextPayload) {
    if (typeof existingPayload === 'undefined') {
        return nextPayload;
    }

    if (typeof nextPayload === 'undefined') {
        return existingPayload;
    }

    if (Array.isArray(existingPayload) || Array.isArray(nextPayload)) {
        return isJsonEqual(existingPayload, nextPayload) ? existingPayload : null;
    }

    if (isPlainObject(existingPayload) && isPlainObject(nextPayload)) {
        const merged = { ...existingPayload };
        for (const [entryKey, nextValue] of Object.entries(nextPayload)) {
            const mergedValue = mergeSharedModificationPayload(merged[entryKey], nextValue);
            if (mergedValue === null) {
                return null;
            }

            if (typeof mergedValue !== 'undefined') {
                merged[entryKey] = mergedValue;
            }
        }

        return merged;
    }

    return isJsonEqual(existingPayload, nextPayload) ? existingPayload : null;
}

function buildSharedModificationStore(manifest) {
    const sharedModificationById = new Map();
    const sharedModificationDefaultIconSourceById = new Map();
    const sharedModificationSourceById = new Map();
    const usedSharedModificationIds = new Set();
    const resolvedSharedModificationIdBySignature = new Map();

    function mergeSharedModificationSources(existingSources, nextSources) {
        const merged = {};
        for (const key of ['defaultIconSourceUrl', 'renderedIconSourceUrl', 'previewSourceUrl', 'textureSourceUrl']) {
            const value = existingSources?.[key] ?? nextSources?.[key] ?? null;
            if (value) {
                merged[key] = value;
            }
        }

        return merged;
    }

    function setSharedModificationSources(sharedModificationId, sources) {
        const normalizedSharedModificationId = normalizeId(sharedModificationId);
        if (!normalizedSharedModificationId) {
            return;
        }

        const mergedSources = mergeSharedModificationSources(sharedModificationSourceById.get(normalizedSharedModificationId), sources);
        if (Object.keys(mergedSources).length > 0) {
            sharedModificationSourceById.set(normalizedSharedModificationId, mergedSources);
        }
    }

    const assets = (manifest.assets ?? []).map(structure => ({
        ...structure,
        modifications: getStructurePublishedModificationSlots(structure).map(slot => ({
            ...slot,
            variants: sortObjectEntries(Object.fromEntries(Object.entries(slot.variants ?? {}).map(([variantId, variant]) => {
                if (resolvePublishedUpgradeVariantContext(slot, variantId, variant, null).isUpgrade === true) {
                    const { sharedModificationId: _sharedModificationId, ...hostLocalVariant } = variant;
                    return [variantId, hostLocalVariant];
                }

                const localVariantPayload = extractLocalSharedModificationPayload(variant);
                const sharedModificationSources = {
                    defaultIconSourceUrl: normalizePublishedIconAssetUrl(String(
                        variant?.icons?.default ?? variant?.iconUrl ?? '',
                    ).trim()) || null,
                    renderedIconSourceUrl: normalizePublishedIconAssetUrl(String(
                        variant?.icons?.rendered ?? variant?.previewIconUrl ?? '',
                    ).trim()) || null,
                    previewSourceUrl: String(variant?.previewUrl ?? '').trim() || null,
                    textureSourceUrl: String(variant?.sprite?.source ?? '').trim() || null,
                };
                const defaultIconSourceUrl = sharedModificationSources.defaultIconSourceUrl;
                const baseDiagnosticsContext = {
                    structureId: normalizeId(structure?.id),
                    structureCodeName: structure?.codeName ?? null,
                    slotName: slot?.name ?? null,
                    variantId,
                    variantSharedModificationId: variant?.sharedModificationId ?? null,
                    defaultIconSourceUrl,
                    normalizedLocalVariantPayload: cloneSharedModificationHashDiagnosticValue(normalizeSharedModificationPayloadValue(localVariantPayload)),
                };
                const localVariantPayloadSignature = createSharedModificationPayloadSignature(localVariantPayload);
                const normalizedVariantSharedModificationId = normalizeId(variant?.sharedModificationId);
                if (!normalizedVariantSharedModificationId) {
                    return [variantId, variant];
                }

                const preferredSharedModificationId = normalizedVariantSharedModificationId;
                if (normalizedVariantSharedModificationId) {
                    recordSharedModificationHashDiagnostic({
                        kind: 'preferred-shared-modification-id-from-variant',
                        ...cloneSharedModificationHashDiagnosticValue(baseDiagnosticsContext),
                        localVariantPayloadSignature,
                        normalizedVariantSharedModificationId,
                        generatedSharedModificationId: normalizedVariantSharedModificationId,
                    });
                }
                let sharedModificationId = preferredSharedModificationId;
                let sharedPayload = extractSharedModificationPayload(sharedModificationId, variant);
                const normalizedSharedPayload = cloneSharedModificationHashDiagnosticValue(normalizeSharedModificationPayloadValue(sharedPayload));
                const signature = createSharedModificationPayloadSignature(sharedPayload);
                const preferredSharedModificationAssetPathId = getSharedModificationAssetPathId(preferredSharedModificationId);
                const preferredSharedModificationAssetDirectory = resolve(sharedAssetsDirectory, 'modifications', preferredSharedModificationAssetPathId);
                const preferredSharedModificationSignatureKey = `${preferredSharedModificationAssetPathId}|${signature}`;

                const existingPreferredPayload = sharedModificationById.get(sharedModificationId);
                if (existingPreferredPayload) {
                    const mergedPreferredPayload = mergeSharedModificationPayload(existingPreferredPayload, sharedPayload);
                    if (mergedPreferredPayload) {
                        sharedModificationById.set(sharedModificationId, mergedPreferredPayload);
                        if (defaultIconSourceUrl && !sharedModificationDefaultIconSourceById.has(sharedModificationId)) {
                            sharedModificationDefaultIconSourceById.set(sharedModificationId, defaultIconSourceUrl);
                        }
                        setSharedModificationSources(sharedModificationId, sharedModificationSources);
                        recordSharedModificationHashDiagnostic({
                            kind: 'shared-modification-merged-into-existing-preferred',
                            ...cloneSharedModificationHashDiagnosticValue(baseDiagnosticsContext),
                            localVariantPayloadSignature,
                            preferredSharedModificationId,
                            sharedModificationId,
                            sharedPayloadSignature: signature,
                            preferredSharedModificationSignatureKey,
                            sharedModificationAssetPathId: preferredSharedModificationAssetPathId,
                            sharedModificationAssetDirectory: preferredSharedModificationAssetDirectory,
                            normalizedExistingSharedPayload: cloneSharedModificationHashDiagnosticValue(normalizeSharedModificationPayloadValue(existingPreferredPayload)),
                            normalizedSharedPayload,
                            normalizedMergedSharedPayload: cloneSharedModificationHashDiagnosticValue(normalizeSharedModificationPayloadValue(mergedPreferredPayload)),
                        });
                        return [variantId, {
                            ...localVariantPayload,
                            sharedModificationId,
                        }];
                    }

                    recordSharedModificationHashDiagnostic({
                        kind: 'shared-modification-preferred-id-conflict',
                        ...cloneSharedModificationHashDiagnosticValue(baseDiagnosticsContext),
                        localVariantPayloadSignature,
                        preferredSharedModificationId,
                        sharedModificationId,
                        sharedPayloadSignature: signature,
                        preferredSharedModificationSignatureKey,
                        sharedModificationAssetPathId: preferredSharedModificationAssetPathId,
                        sharedModificationAssetDirectory: preferredSharedModificationAssetDirectory,
                        normalizedExistingSharedPayload: cloneSharedModificationHashDiagnosticValue(normalizeSharedModificationPayloadValue(existingPreferredPayload)),
                        normalizedSharedPayload,
                    });

                    // Same renderId but host-specific pixels (e.g. pipe insulation): keep co-located variant.
                    const hostLocalVariant = { ...variant };
                    delete hostLocalVariant.sharedModificationId;
                    recordSharedModificationHashDiagnostic({
                        kind: 'shared-modification-host-local-fallback',
                        ...cloneSharedModificationHashDiagnosticValue(baseDiagnosticsContext),
                        localVariantPayloadSignature,
                        preferredSharedModificationId,
                        sharedPayloadSignature: signature,
                        preferredSharedModificationSignatureKey,
                        sharedModificationAssetPathId: preferredSharedModificationAssetPathId,
                        sharedModificationAssetDirectory: preferredSharedModificationAssetDirectory,
                        normalizedExistingSharedPayload: cloneSharedModificationHashDiagnosticValue(normalizeSharedModificationPayloadValue(existingPreferredPayload)),
                        normalizedSharedPayload,
                    });
                    return [variantId, hostLocalVariant];
                }

                const existingResolvedSharedModificationId = resolvedSharedModificationIdBySignature.get(preferredSharedModificationSignatureKey);

                if (existingResolvedSharedModificationId && sharedModificationById.has(existingResolvedSharedModificationId)) {
                    if (defaultIconSourceUrl && !sharedModificationDefaultIconSourceById.has(existingResolvedSharedModificationId)) {
                        sharedModificationDefaultIconSourceById.set(existingResolvedSharedModificationId, defaultIconSourceUrl);
                    }
                    setSharedModificationSources(existingResolvedSharedModificationId, sharedModificationSources);

                    const existingResolvedSharedModificationAssetPathId = getSharedModificationAssetPathId(existingResolvedSharedModificationId);
                    recordSharedModificationHashDiagnostic({
                        kind: 'shared-modification-reused-by-signature',
                        ...cloneSharedModificationHashDiagnosticValue(baseDiagnosticsContext),
                        localVariantPayloadSignature,
                        preferredSharedModificationId,
                        sharedPayloadSignature: signature,
                        preferredSharedModificationSignatureKey,
                        reusedSharedModificationId: existingResolvedSharedModificationId,
                        sharedModificationAssetPathId: existingResolvedSharedModificationAssetPathId,
                        sharedModificationAssetDirectory: resolve(sharedAssetsDirectory, 'modifications', existingResolvedSharedModificationAssetPathId),
                        normalizedSharedPayload,
                    });

                    return [variantId, {
                        ...localVariantPayload,
                        sharedModificationId: existingResolvedSharedModificationId,
                    }];
                }

                if (sharedModificationById.has(sharedModificationId)) {
                    sharedModificationId = resolveUniqueSharedModificationId(sharedModificationId, signature, usedSharedModificationIds, {
                        ...baseDiagnosticsContext,
                        localVariantPayloadSignature,
                        preferredSharedModificationId,
                        sharedPayloadSignature: signature,
                        preferredSharedModificationSignatureKey,
                        sharedModificationAssetPathId: preferredSharedModificationAssetPathId,
                        sharedModificationAssetDirectory: preferredSharedModificationAssetDirectory,
                        normalizedSharedPayload,
                    });
                    sharedPayload = extractSharedModificationPayload(sharedModificationId, variant);
                }

                resolvedSharedModificationIdBySignature.set(preferredSharedModificationSignatureKey, sharedModificationId);
                usedSharedModificationIds.add(sharedModificationId);
                sharedModificationById.set(sharedModificationId, sharedPayload);
                if (defaultIconSourceUrl) {
                    sharedModificationDefaultIconSourceById.set(sharedModificationId, defaultIconSourceUrl);
                }
                setSharedModificationSources(sharedModificationId, sharedModificationSources);

                const finalSharedModificationAssetPathId = getSharedModificationAssetPathId(sharedModificationId);
                recordSharedModificationHashDiagnostic({
                    kind: 'shared-modification-stored',
                    ...cloneSharedModificationHashDiagnosticValue(baseDiagnosticsContext),
                    localVariantPayloadSignature,
                    preferredSharedModificationId,
                    sharedModificationId,
                    sharedPayloadSignature: signature,
                    preferredSharedModificationSignatureKey,
                    sharedModificationAssetPathId: finalSharedModificationAssetPathId,
                    sharedModificationAssetDirectory: resolve(sharedAssetsDirectory, 'modifications', finalSharedModificationAssetPathId),
                    resolution: sharedModificationId === preferredSharedModificationId ? 'preferred' : 'collision-resolved',
                    normalizedSharedPayload: cloneSharedModificationHashDiagnosticValue(normalizeSharedModificationPayloadValue(sharedPayload)),
                });

                return [variantId, {
                    ...localVariantPayload,
                    sharedModificationId,
                }];
            }))),
        })),
    }));

    return attachSharedModificationSourceMetadata(
        attachSharedModificationDefaultIconSourceMetadata({
            ...manifest,
            assets,
            shared: {
                ...(manifest.shared ?? {}),
                modifications: sortObjectEntries(Object.fromEntries([...sharedModificationById.entries()])),
                packaging: sortObjectEntries(Object.fromEntries(Object.entries(manifest.shared?.packaging ?? {}))),
            },
        }, sharedModificationDefaultIconSourceById),
        sharedModificationSourceById,
    );
}

const legacyEntrenchmentAggregateRenderLayerIds = new Set(['walls', 'corners']);

function structureHasDirectionalEntrenchmentRenderLayers(manifestRenderLayersById) {
    return ['backwall', 'frontwall', 'leftwall', 'rightwall']
        .some(layerId => manifestRenderLayersById.has(layerId));
}

function filterLegacyEntrenchmentAggregateRenderLayerEntries(layerEntries, manifestRenderLayersById) {
    if (!structureHasDirectionalEntrenchmentRenderLayers(manifestRenderLayersById)) {
        return layerEntries;
    }

    return layerEntries.filter(entry =>
        !legacyEntrenchmentAggregateRenderLayerIds.has(normalizeId(entry?.id)));
}

function compareStructureRenderLayers(left, right) {
    const orderById = new Map([
        ['floor', 0],
        ['walls', 1],
        ['corners', 2],
        ['backtrim', 10],
        ['backramp', 10.25],
        ['span', 11],
        ['frontramp', 11.75],
        ['fronttrim', 12],
        ['backswitch', 10],
        ['underlay', 10.5],
        ['frontswitch', 12],
    ]);
    const leftOrder = orderById.get(normalizeId(left?.id)) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderById.get(normalizeId(right?.id)) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
    }

    return String(left?.id ?? '').localeCompare(String(right?.id ?? ''));
}

async function buildStructureSceneMetadata(renderScenesIndexDocument = null) {
    const metadataByKey = new Map();
    const indexedScenePaths = new Set();

    if (renderScenesIndexDocument?.scenes?.length) {
        for (const entry of renderScenesIndexDocument.scenes) {
            const outputPath = String(entry?.outputPath ?? '').trim();
            if (!outputPath) {
                continue;
            }

            indexedScenePaths.add(resolve(renderScenesDirectory, outputPath));
        }
    }

    const scenePaths = indexedScenePaths.size > 0
        ? [...indexedScenePaths]
        : null;

    if (scenePaths) {
        await Promise.all(scenePaths.map(async (filePath) => {
            if (!await pathExists(filePath)) {
                return;
            }

            try {
                const parsed = JSON.parse(await readFile(filePath, 'utf8'));
                const structureId = normalizeId(parsed?.structure?.id);
                const codeName = normalizeId(parsed?.structure?.codeName);
                const previewDirection = normalizeId(parsed?.render?.previewDirection);
                const metadata = {
                    hasMeshNodes: sceneHasMeshNodes(parsed),
                    previewDirection: previewDirection || null,
                };

                if (structureId) {
                    metadataByKey.set(structureId, metadata);
                }
                if (codeName) {
                    metadataByKey.set(codeName, metadata);
                }
            } catch {
            }
        }));

        if (metadataByKey.size > 0) {
            return metadataByKey;
        }
    }

    if (!await pathExists(renderScenesDirectory)) {
        return metadataByKey;
    }

    for await (const filePath of walkFiles(renderScenesDirectory)) {
        if (basename(filePath).toLowerCase() !== 'scene.json') {
            continue;
        }

        try {
            const parsed = JSON.parse(await readFile(filePath, 'utf8'));
            const structureId = normalizeId(parsed?.structure?.id);
            const codeName = normalizeId(parsed?.structure?.codeName);
            const previewDirection = normalizeId(parsed?.render?.previewDirection);
            const metadata = {
                hasMeshNodes: sceneHasMeshNodes(parsed),
                previewDirection: previewDirection || null,
            };

            if (structureId) {
                metadataByKey.set(structureId, metadata);
            }
            if (codeName) {
                metadataByKey.set(codeName, metadata);
            }
        } catch {
        }
    }

    return metadataByKey;
}

function resolveStructureSceneMetadata(structureSceneMetadata, structure) {
    const lookupKeys = [structure.id, structure.codeName, structure.legacyKey]
        .map(normalizeId)
        .filter(Boolean);

    for (const key of lookupKeys) {
        const metadata = structureSceneMetadata.get(key);
        if (metadata) {
            return metadata;
        }
    }

    return null;
}

function getCoLocatedStructureIconPublicUrl(structureId, assetKind) {
    const outputDirectory = getPublishedAssetDirectory(structureId)
        ?? resolve(assetTypesDirectory, 'structures', structureId);
    return toPublicFoxholeAssetUrl(resolve(
        outputDirectory,
        getCoLocatedStructureAssetFileName(structureId, assetKind),
    ));
}

function buildDowngradeStructureRenderLayersById(assets) {
    const downgradeRenderLayersById = new Map();

    for (const structure of assets ?? []) {
        const upgradeStructureId = normalizeId(normalizeStructureReferenceCodeName(structure?.upgradeStructureCodeName));
        const renderLayers = Array.isArray(structure?.renderLayers) ? structure.renderLayers : [];
        if (!upgradeStructureId || renderLayers.length === 0) {
            continue;
        }

        downgradeRenderLayersById.set(upgradeStructureId, renderLayers);
    }

    return downgradeRenderLayersById;
}

function buildDowngradeStructureIdByUpgradeId(assets) {
    const downgradeStructureIdByUpgradeId = new Map();

    for (const structure of assets ?? []) {
        const upgradeStructureId = normalizeId(normalizeStructureReferenceCodeName(structure?.upgradeStructureCodeName));
        const structureId = normalizeId(structure?.id);
        if (!upgradeStructureId || !structureId) {
            continue;
        }

        downgradeStructureIdByUpgradeId.set(upgradeStructureId, structureId);
    }

    return downgradeStructureIdByUpgradeId;
}

function resolveStructureRenderLayerComponentTags(manifestLayer, downgradeLayer) {
    const manifestTags = Array.isArray(manifestLayer?.componentTags)
        ? manifestLayer.componentTags.filter(Boolean)
        : (Array.isArray(manifestLayer?.ct) ? manifestLayer.ct.filter(Boolean) : []);
    if (manifestTags.length > 0) {
        return manifestTags;
    }

    return Array.isArray(downgradeLayer?.componentTags)
        ? downgradeLayer.componentTags.filter(Boolean)
        : (Array.isArray(downgradeLayer?.ct) ? downgradeLayer.ct.filter(Boolean) : []);
}

function normalizeFoundationRenderLayerComponentTags(structureId, layerId, componentTags) {
    const normalizedStructureId = normalizeId(structureId);
    const normalizedLayerId = normalizeId(layerId);
    if (normalizedStructureId !== 'foundation011x2t1' && normalizedStructureId !== 'foundation011x2t3') {
        return componentTags;
    }

    if (normalizedLayerId === 'frontleftpillar') {
        return ['Front', 'Left2'];
    }

    if (normalizedLayerId === 'frontrightpillar') {
        return ['Front', 'Right2'];
    }

    return componentTags;
}

function applyStructureRenderUrls(
    manifest,
    entriesByKey,
    structureSceneMetadata,
    modificationEntriesByKey,
    modificationEntriesByAssetId,
    structureLayerEntriesByStructureId,
    modificationLayerEntriesByAssetId,
    sharedPackagingEntriesByKey,
    structuresWithRawDestroyedRenders = new Set(),
    vehicleDestroyedPublishAllowlist = null,
    downgradeLookupAssets = null,
) {
    function resolveSourceModification(structure, variantId, variant) {
        const candidateIds = [
            String(variant?.modificationId ?? '').trim(),
            String(variant?.appliedModificationId ?? '').trim(),
            String(variantId ?? '').trim(),
        ].filter(Boolean);

        if (candidateIds.length === 0) {
            return null;
        }

        const normalizedCandidateIds = candidateIds.map(normalizeId);

        for (const [modificationId, modification] of Object.entries(structure?.modifications ?? {})) {
            if (normalizedCandidateIds.includes(normalizeId(modification?.appliedModificationId ?? modificationId))) {
                return [modificationId, modification];
            }
        }

        return null;
    }

    const sharedPackaging = sortObjectEntries({
        ...(manifest.shared?.packaging ?? {}),
        ...Object.fromEntries(Object.entries(sharedPackagingEntriesByKey ?? {}).map(([shippableType, entry]) => [shippableType, {
            ...(manifest.shared?.packaging?.[shippableType] ?? {}),
            ...(entry?.textureUrl ? { textureUrl: entry.textureUrl } : {}),
            ...(typeof entry?.width === 'number' ? { width: entry.width } : {}),
            ...(typeof entry?.height === 'number' ? { height: entry.height } : {}),
            ...(typeof entry?.anchorX === 'number' ? { anchorX: entry.anchorX } : {}),
            ...(typeof entry?.anchorY === 'number' ? { anchorY: entry.anchorY } : {}),
            ...(typeof entry?.offsetX === 'number' ? { offsetX: entry.offsetX } : {}),
            ...(typeof entry?.offsetY === 'number' ? { offsetY: entry.offsetY } : {}),
        }])),
    });

    const downgradeAssets = Array.isArray(downgradeLookupAssets) && downgradeLookupAssets.length > 0
        ? downgradeLookupAssets
        : manifest.assets;
    const downgradeStructureRenderLayersById = buildDowngradeStructureRenderLayersById(downgradeAssets);
    const downgradeStructureIdByUpgradeId = buildDowngradeStructureIdByUpgradeId(downgradeAssets);

    return foxholeManifestSchema.parse({
        ...manifest,
        shared: {
            ...(manifest.shared ?? {}),
            packaging: sharedPackaging,
        },
        assets: manifest.assets
            .filter(structure => !structure?.isUpgrade)
            .map(structure => {
                const {
                    destroyed: _legacyDestroyed,
                    packaged: _legacyPackaged,
                    colors: _legacyColors,
                    ...structureWithoutLegacyIcons
                } = structure;
                const sceneMetadata = resolveStructureSceneMetadata(structureSceneMetadata, structure);
                const isMeshlessScene = sceneMetadata?.hasMeshNodes === false;
                const renderEntry = isMeshlessScene
                    ? null
                    : resolveStructureRenderEntry(entriesByKey, structure);
                const structureColors = (Array.isArray(structure.colors) ? structure.colors : [])
                    .map(color => {
                        const colorHex = normalizeId(color?.hex);
                        if (!colorHex) {
                            return null;
                        }

                        const resolvedColor = renderEntry?.colors?.find(entry => normalizeId(entry?.hex) === colorHex) ?? null;
                        return {
                            ...color,
                            hex: colorHex,
                            ...(resolvedColor?.textureUrl ? { textureUrl: resolvedColor.textureUrl } : {}),
                            ...(resolvedColor?.previewUrl ? { previewUrl: resolvedColor.previewUrl } : {}),
                            ...(resolvedColor?.renderedIconUrl ? { renderedIconUrl: resolvedColor.renderedIconUrl } : {}),
                        };
                    })
                    .filter(Boolean);
                const defaultStructureColor = structureColors[0] ?? null;
                const hasPublishedColorVariants = structureColors.some(color => (
                    Boolean(color?.textureUrl || color?.previewUrl || color?.renderedIconUrl)
                ));
                const primaryColorTextureUrl = defaultStructureColor?.textureUrl ?? null;
                const structureDefaultIconUrl = structure?.icons?.default ?? structure?.iconUrl ?? null;
                const resolvedStructureDefaultIconUrl = structureDefaultIconUrl
                    ?? renderEntry?.defaultIconUrl
                    ?? null;
                const coLocatedRenderedIconUrl = getCoLocatedStructureIconPublicUrl(structure.id, 'icon.rendered');
                const structureRenderedIconUrl = defaultStructureColor?.renderedIconUrl
                    ?? coLocatedRenderedIconUrl
                    ?? resolvedStructureDefaultIconUrl;
                const meshlessFallbackUrl = isMeshlessScene ? structureDefaultIconUrl : null;
                const textureUrl = defaultStructureColor?.textureUrl ?? renderEntry?.textureUrl ?? meshlessFallbackUrl;
                const defaultTextureUrl = textureUrl ?? structure.variants.default?.textureUrl;
                const colonialTextureUrl = textureUrl ?? structure.variants.c?.textureUrl;
                const wardenTextureUrl = textureUrl ?? structure.variants.w?.textureUrl;
                const previewUrl = defaultStructureColor?.previewUrl ?? renderEntry?.previewUrl ?? meshlessFallbackUrl ?? structure.previewUrl;
                const previewDirection = renderEntry?.previewDirection
                    ?? sceneMetadata?.previewDirection
                    ?? structure.previewDirection;
                const destroyedRenderEntry = renderEntry?.destroyed ?? null;
                const structureId = normalizeId(structure.id);
                const structureHasRawDestroyedRenders = structuresWithRawDestroyedRenders.has(structureId)
                    && shouldPublishVehicleDestroyedVisual(structure, vehicleDestroyedPublishAllowlist);
                const destroyedDefaultIconUrl = structure?.destroyed?.icons?.default
                    ?? structure?.destroyed?.iconUrl
                    ?? destroyedRenderEntry?.defaultIconUrl
                    ?? (structureHasRawDestroyedRenders ? structureDefaultIconUrl : null)
                    ?? null;
                const destroyedRenderedIconUrl = destroyedRenderEntry?.renderedIconUrl
                    ?? structure?.destroyed?.icons?.rendered
                    ?? structure?.destroyed?.previewIconUrl
                    ?? destroyedDefaultIconUrl;
                const destroyedPreviewUrl = destroyedRenderEntry?.previewUrl ?? structure?.destroyed?.previewUrl ?? null;
                const destroyedTextureUrl = destroyedRenderEntry?.textureUrl ?? structure?.destroyed?.sprite?.source ?? structure?.destroyed?.textureUrl ?? null;
                const destroyedPreviewDirection = destroyedRenderEntry?.previewDirection ?? structure?.destroyed?.previewDirection ?? null;
                // Some vehicles expose a destroyed component without any renderable destroyed texture.
                // Drop the entire destroyed payload unless we can emit a destroyed sprite block.
                const hasPublishedDestroyedVisual = structureHasRawDestroyedRenders;
                const packagedRenderEntry = renderEntry?.packaged ?? null;
                const packagedTextureUrl = packagedRenderEntry?.textureUrl
                    ?? structure?.packaged?.sprite?.source
                    ?? structure?.packaged?.textureUrl
                    ?? null;
                const hasPublishedPackagedVisual = Boolean(
                    packagedTextureUrl
                    || structure?.packaged?.shippableType
                    || structure?.packaged?.palletOffset,
                );
                const structureLayerEntries = structureLayerEntriesByStructureId?.[normalizeId(structure.id)] ?? {};
                const manifestRenderLayersById = new Map(
                    (Array.isArray(structure.renderLayers) ? structure.renderLayers : [])
                        .map(layer => [normalizeId(layer?.id), layer])
                        .filter(([layerId]) => layerId),
                );
                const downgradeRenderLayersById = new Map(
                    (downgradeStructureRenderLayersById.get(normalizeId(structure.id)) ?? [])
                        .map(layer => [normalizeId(layer?.id), layer])
                        .filter(([layerId]) => layerId),
                );
                const downgradeStructureId = downgradeStructureIdByUpgradeId.get(normalizeId(structure.id)) ?? null;
                const downgradeLayerEntries = downgradeStructureId
                    ? structureLayerEntriesByStructureId?.[downgradeStructureId] ?? {}
                    : {};
                const renderLayers = shouldPublishStructureComponentRenderLayers(structure)
                    ? filterLegacyEntrenchmentAggregateRenderLayerEntries(
                        Object.values(structureLayerEntries).filter(entry => entry?.textureUrl),
                        manifestRenderLayersById,
                    ).sort(compareStructureRenderLayers)
                    : [];

                return {
                    ...structureWithoutLegacyIcons,
                    icons: hasPublishedColorVariants
                        ? { default: resolvedStructureDefaultIconUrl }
                        : {
                            default: resolvedStructureDefaultIconUrl,
                            rendered: previewUrl
                                ? (renderEntry?.renderedIconUrl ?? structureRenderedIconUrl ?? meshlessFallbackUrl)
                                : (resolvedStructureDefaultIconUrl ?? meshlessFallbackUrl),
                        },
                    ...(hasPublishedDestroyedVisual
                        ? {
                            destroyed: {
                                ...(structure?.destroyed?.componentName ? { componentName: structure.destroyed.componentName } : {}),
                                ...((destroyedDefaultIconUrl || destroyedRenderedIconUrl)
                                    ? {
                                        icons: {
                                            ...(destroyedDefaultIconUrl ? { default: destroyedDefaultIconUrl } : {}),
                                            ...(destroyedRenderedIconUrl ? { rendered: destroyedRenderedIconUrl } : {}),
                                        },
                                        ...(destroyedDefaultIconUrl ? { iconUrl: destroyedDefaultIconUrl } : {}),
                                        ...(destroyedRenderedIconUrl ? { previewIconUrl: destroyedRenderedIconUrl } : {}),
                                    }
                                    : {}),
                                ...(destroyedPreviewUrl ? { previewUrl: destroyedPreviewUrl } : {}),
                                ...(destroyedPreviewDirection ? { previewDirection: destroyedPreviewDirection } : {}),
                                ...(destroyedTextureUrl
                                    ? {
                                        sprite: {
                                            source: destroyedTextureUrl,
                                            width: destroyedRenderEntry?.textureWidth ?? structure?.destroyed?.sprite?.width,
                                            height: destroyedRenderEntry?.textureHeight ?? structure?.destroyed?.sprite?.height,
                                            anchorX: destroyedRenderEntry?.anchorX ?? structure?.destroyed?.sprite?.anchorX,
                                            anchorY: destroyedRenderEntry?.anchorY ?? structure?.destroyed?.sprite?.anchorY,
                                            offsetX: destroyedRenderEntry?.offsetX ?? structure?.destroyed?.sprite?.offsetX,
                                            offsetY: destroyedRenderEntry?.offsetY ?? structure?.destroyed?.sprite?.offsetY,
                                        },
                                        textureUrl: destroyedTextureUrl,
                                        textureWidth: destroyedRenderEntry?.textureWidth ?? structure?.destroyed?.textureWidth,
                                        textureHeight: destroyedRenderEntry?.textureHeight ?? structure?.destroyed?.textureHeight,
                                        anchorX: destroyedRenderEntry?.anchorX ?? structure?.destroyed?.anchorX,
                                        anchorY: destroyedRenderEntry?.anchorY ?? structure?.destroyed?.anchorY,
                                        offsetX: destroyedRenderEntry?.offsetX ?? structure?.destroyed?.offsetX,
                                        offsetY: destroyedRenderEntry?.offsetY ?? structure?.destroyed?.offsetY,
                                    }
                                    : {}),
                            },
                        }
                        : {}),
                    ...(hasPublishedPackagedVisual
                        ? {
                            packaged: {
                                ...(structure?.packaged?.shippableType ? { shippableType: structure.packaged.shippableType } : {}),
                                ...(structure?.packaged?.palletOffset ? { palletOffset: structure.packaged.palletOffset } : {}),
                                ...(packagedTextureUrl
                                    ? {
                                        sprite: {
                                            source: packagedTextureUrl,
                                            width: packagedRenderEntry?.textureWidth ?? structure?.packaged?.sprite?.width,
                                            height: packagedRenderEntry?.textureHeight ?? structure?.packaged?.sprite?.height,
                                            anchorX: packagedRenderEntry?.anchorX ?? structure?.packaged?.sprite?.anchorX,
                                            anchorY: packagedRenderEntry?.anchorY ?? structure?.packaged?.sprite?.anchorY,
                                            offsetX: packagedRenderEntry?.offsetX ?? structure?.packaged?.sprite?.offsetX,
                                            offsetY: packagedRenderEntry?.offsetY ?? structure?.packaged?.sprite?.offsetY,
                                        },
                                        textureUrl: packagedTextureUrl,
                                        textureWidth: packagedRenderEntry?.textureWidth ?? structure?.packaged?.textureWidth,
                                        textureHeight: packagedRenderEntry?.textureHeight ?? structure?.packaged?.textureHeight,
                                        anchorX: packagedRenderEntry?.anchorX ?? structure?.packaged?.anchorX,
                                        anchorY: packagedRenderEntry?.anchorY ?? structure?.packaged?.anchorY,
                                        offsetX: packagedRenderEntry?.offsetX ?? structure?.packaged?.offsetX,
                                        offsetY: packagedRenderEntry?.offsetY ?? structure?.packaged?.offsetY,
                                    }
                                    : {}),
                            },
                        }
                        : {}),
                    previewUrl: hasPublishedColorVariants ? undefined : previewUrl,
                    previewDirection,
                    ...(structureColors.length > 0 ? { colors: structureColors } : {}),
                    renderLayers: renderLayers.length > 0
                        ? renderLayers.map(entry => {
                            const manifestLayer = manifestRenderLayersById.get(normalizeId(entry.id));
                            const downgradeLayer = downgradeRenderLayersById.get(normalizeId(entry.id));
                            const componentTags = normalizeFoundationRenderLayerComponentTags(
                                structure.id,
                                entry.id,
                                resolveStructureRenderLayerComponentTags(manifestLayer, downgradeLayer),
                            );
                            const componentName = manifestLayer?.componentName ?? manifestLayer?.cn ?? null;
                            const downgradeEntry = downgradeLayerEntries[normalizeId(entry.id)];
                            const preferDowngradeOffsets = Number(structure?.tier) === 3 && downgradeEntry;
                            const offsetX = preferDowngradeOffsets && typeof downgradeEntry?.offsetX === 'number'
                                ? downgradeEntry.offsetX
                                : entry?.offsetX;
                            const offsetY = preferDowngradeOffsets && typeof downgradeEntry?.offsetY === 'number'
                                ? downgradeEntry.offsetY
                                : entry?.offsetY;
                            return {
                                id: entry.id,
                                textureUrl: entry.textureUrl,
                                ...(entry?.width ? { width: entry.width } : {}),
                                ...(entry?.height ? { height: entry.height } : {}),
                                ...(entry?.anchorX !== null && typeof entry?.anchorX !== 'undefined' ? { anchorX: entry.anchorX } : {}),
                                ...(entry?.anchorY !== null && typeof entry?.anchorY !== 'undefined' ? { anchorY: entry.anchorY } : {}),
                                ...(offsetX !== null && typeof offsetX !== 'undefined' ? { offsetX } : {}),
                                ...(offsetY !== null && typeof offsetY !== 'undefined' ? { offsetY } : {}),
                                ...(componentName ? { componentName } : {}),
                                ...(componentTags.length > 0 ? { componentTags } : {}),
                            };
                        })
                        : (Array.isArray(structure.renderLayers)
                            ? structure.renderLayers.filter(layer => String(layer?.textureUrl ?? '').trim())
                            : structure.renderLayers),
                    sprite: {
                        ...structure.sprite,
                        ...(renderEntry?.textureWidth ? { width: renderEntry.textureWidth } : {}),
                        ...(renderEntry?.textureHeight ? { height: renderEntry.textureHeight } : {}),
                        ...(renderEntry?.anchorX !== null && typeof renderEntry?.anchorX !== 'undefined' ? { anchorX: renderEntry.anchorX } : {}),
                        ...(renderEntry?.anchorY !== null && typeof renderEntry?.anchorY !== 'undefined' ? { anchorY: renderEntry.anchorY } : {}),
                        ...(renderEntry?.offsetX !== null && typeof renderEntry?.offsetX !== 'undefined' ? { offsetX: renderEntry.offsetX } : {}),
                        ...(renderEntry?.offsetY !== null && typeof renderEntry?.offsetY !== 'undefined' ? { offsetY: renderEntry.offsetY } : {}),
                    },
                    variants: {
                        ...(!hasPublishedColorVariants && defaultTextureUrl
                            ? { default: { textureUrl: defaultTextureUrl } }
                            : {}),
                        ...(colonialTextureUrl && colonialTextureUrl !== (primaryColorTextureUrl ?? defaultTextureUrl)
                            ? { c: { textureUrl: colonialTextureUrl } }
                            : {}),
                        ...(wardenTextureUrl && wardenTextureUrl !== (primaryColorTextureUrl ?? defaultTextureUrl)
                            ? { w: { textureUrl: wardenTextureUrl } }
                            : {}),
                    },
                    modifications: Object.fromEntries(Object.entries(structure.modifications ?? {}).map(([modificationId, modification]) => {
                        const modificationLookupKey = normalizeId(modification?.appliedModificationId ?? modificationId);
                        const renderEntry = modificationEntriesByAssetId?.[normalizeId(structure.id)]?.[modificationLookupKey] ?? null;
                        // Only keep explicitly seeded sharedModificationId values. Never derive
                        // from renderId — host-local fingerprint-divergent mods share a renderId
                        // without belonging in shared.modifications.
                        const preferredSharedModificationId = normalizeId(modificationLookupKey || modificationId) === 'default'
                            || modification?.isUpgrade === true
                            || renderEntryHasHostLocalModificationVisuals(structure.id, renderEntry)
                            ? null
                            : resolveSeededSharedModificationId(
                                renderEntry?.sharedModificationId,
                                modification?.sharedModificationId,
                            );
                        const nextModification = {
                            ...modification,
                            ...(renderEntry?.textureUrl ? { textureUrl: renderEntry.textureUrl } : {}),
                            ...(renderEntry?.iconUrl ? { iconUrl: renderEntry.iconUrl } : {}),
                            ...(renderEntry?.previewUrl ? { previewUrl: renderEntry.previewUrl } : {}),
                            ...(renderEntry?.previewDirection ? { previewDirection: renderEntry.previewDirection } : {}),
                            ...(renderEntry?.textureWidth ? { textureWidth: renderEntry.textureWidth } : {}),
                            ...(renderEntry?.textureHeight ? { textureHeight: renderEntry.textureHeight } : {}),
                            ...(renderEntry?.anchorX !== null && typeof renderEntry?.anchorX !== 'undefined' ? { anchorX: renderEntry.anchorX } : {}),
                            ...(renderEntry?.anchorY !== null && typeof renderEntry?.anchorY !== 'undefined' ? { anchorY: renderEntry.anchorY } : {}),
                            ...(renderEntry?.offsetX !== null && typeof renderEntry?.offsetX !== 'undefined' ? { offsetX: renderEntry.offsetX } : {}),
                            ...(renderEntry?.offsetY !== null && typeof renderEntry?.offsetY !== 'undefined' ? { offsetY: renderEntry.offsetY } : {}),
                            ...(renderEntry?.isUpgrade ? { isUpgrade: true } : {}),
                            ...(renderEntry?.upgradeName ? { upgradeName: renderEntry.upgradeName } : {}),
                            ...(renderEntry?.parentStructureId ? { parentStructureId: renderEntry.parentStructureId } : {}),
                            ...(renderEntry?.rootStructureId ? { rootStructureId: renderEntry.rootStructureId } : {}),
                            ...(renderEntry?.appliedModificationId ? { appliedModificationId: renderEntry.appliedModificationId } : {}),
                        };
                        if (preferredSharedModificationId) {
                            nextModification.sharedModificationId = preferredSharedModificationId;
                        } else {
                            delete nextModification.sharedModificationId;
                        }
                        return [modificationId, nextModification];
                    })),
                    modificationSlots: (structure.modificationSlots ?? []).map(slot => ({
                        ...slot,
                        variants: Object.fromEntries(Object.entries(slot.variants ?? {}).map(([variantId, variant]) => {
                            const sourceModificationEntry = resolveSourceModification(structure, variantId, variant);
                            const sourceModification = sourceModificationEntry?.[1] ?? null;
                            const assetScopedEntries = modificationEntriesByAssetId?.[normalizeId(structure.id)] ?? {};
                            const renderEntry = resolveAssetScopedModificationRenderEntry(
                                assetScopedEntries,
                                modificationEntriesByKey,
                                {
                                    variantId,
                                    variant,
                                },
                            );
                            const isUpgradeVariant = resolvePublishedUpgradeVariantContext(
                                slot,
                                variantId,
                                variant,
                                sourceModification,
                            ).isUpgrade === true;
                            const preferredSharedModificationId = normalizeId(variantId) === 'default'
                                || isUpgradeVariant
                                ? null
                                : resolveSeededSharedModificationId(
                                    renderEntry?.sharedModificationId,
                                    variant?.sharedModificationId,
                                    sourceModification?.sharedModificationId,
                                );
                            const modificationLayerLookupKeys = buildHostLocalModificationRenderLookupKeys({
                                variantId,
                                variant,
                                extraKeys: [preferredSharedModificationId],
                            });
                            const assetModificationLayerEntries = modificationLayerEntriesByAssetId?.[normalizeId(structure.id)] ?? {};
                            const modificationLayerEntries = modificationLayerLookupKeys
                                .map(lookupKey => assetModificationLayerEntries?.[lookupKey])
                                .find(entries => entries && Object.keys(entries).length > 0)
                                ?? null;
                            const modificationRenderLayers = modificationLayerEntries
                                ? Object.values(modificationLayerEntries)
                                    .filter(entry => entry?.textureUrl)
                                    .sort(compareStructureRenderLayers)
                                    .map(entry => ({
                                        id: entry.id,
                                        textureUrl: entry.textureUrl,
                                        ...(entry?.width ? { width: entry.width } : {}),
                                        ...(entry?.height ? { height: entry.height } : {}),
                                        ...(entry?.anchorX !== null && typeof entry?.anchorX !== 'undefined' ? { anchorX: entry.anchorX } : {}),
                                        ...(entry?.anchorY !== null && typeof entry?.anchorY !== 'undefined' ? { anchorY: entry.anchorY } : {}),
                                        ...(entry?.offsetX !== null && typeof entry?.offsetX !== 'undefined' ? { offsetX: entry.offsetX } : {}),
                                        ...(entry?.offsetY !== null && typeof entry?.offsetY !== 'undefined' ? { offsetY: entry.offsetY } : {}),
                                    }))
                                : [];
                            const nextVariant = {
                                ...variant,
                                ...(renderEntry?.textureUrl ? { textureUrl: renderEntry.textureUrl } : {}),
                                ...(!variant?.iconUrl && renderEntry?.iconUrl ? { iconUrl: renderEntry.iconUrl } : {}),
                                ...(renderEntry?.previewUrl ? { previewUrl: renderEntry.previewUrl } : {}),
                                ...(renderEntry?.previewDirection ? { previewDirection: renderEntry.previewDirection } : {}),
                                ...(renderEntry?.textureWidth ? { textureWidth: renderEntry.textureWidth } : {}),
                                ...(renderEntry?.textureHeight ? { textureHeight: renderEntry.textureHeight } : {}),
                                ...(renderEntry?.anchorX !== null && typeof renderEntry?.anchorX !== 'undefined' ? { anchorX: renderEntry.anchorX } : {}),
                                ...(renderEntry?.anchorY !== null && typeof renderEntry?.anchorY !== 'undefined' ? { anchorY: renderEntry.anchorY } : {}),
                                ...(renderEntry?.offsetX !== null && typeof renderEntry?.offsetX !== 'undefined' ? { offsetX: renderEntry.offsetX } : {}),
                                ...(renderEntry?.offsetY !== null && typeof renderEntry?.offsetY !== 'undefined' ? { offsetY: renderEntry.offsetY } : {}),
                                ...resolvePublishedUpgradeVariantContext(slot, variantId, variant, sourceModification),
                                ...(renderEntry?.isUpgrade ? { isUpgrade: true } : {}),
                                ...(renderEntry?.upgradeName ? { upgradeName: renderEntry.upgradeName } : {}),
                                ...(renderEntry?.parentStructureId ? { parentStructureId: renderEntry.parentStructureId } : {}),
                                ...(renderEntry?.rootStructureId ? { rootStructureId: renderEntry.rootStructureId } : {}),
                                ...(renderEntry?.appliedModificationId ? { appliedModificationId: renderEntry.appliedModificationId } : {}),
                                ...(modificationRenderLayers.length > 0 ? { renderLayers: modificationRenderLayers } : {}),
                            };
                            if (preferredSharedModificationId) {
                                nextVariant.sharedModificationId = preferredSharedModificationId;
                            } else {
                                delete nextVariant.sharedModificationId;
                            }
                            return [variantId, nextVariant];
                        })),
                    })),
                };
            }),
    });
}

function stripPublishedModificationSlotNoise(
    manifest,
    modificationEntriesByKey,
    modificationEntriesByAssetId,
    modificationLayerEntriesByAssetId = {},
) {
    const localizedStrings = new Map();
    const assetsById = new Map((manifest?.assets ?? [])
        .map(asset => {
            const assetId = normalizeId(asset?.id);
            return assetId ? [assetId, asset] : null;
        })
        .filter(Boolean));

    function createModificationLocalizationId(structureId, modificationId, field) {
        return `asset:${normalizeId(structureId)}:mod:${normalizeId(modificationId)}:${compactLocalizationId(field)}`;
    }

    function getLocalizedTextId(value, localizationId) {
        const nextId = typeof value?.id === 'string' ? value.id.trim() : '';
        return nextId || localizationId;
    }

    function getLocalizedTextFallback(value) {
        if (typeof value === 'string') {
            return value.trim();
        }

        return typeof value?.fallback === 'string' ? value.fallback.trim() : '';
    }

    function normalizeLocalizedText(value, localizationId, fallback) {
        const nextId = getLocalizedTextId(value, localizationId);
        const nextFallback = getLocalizedTextFallback(value) || String(fallback ?? '').trim();
        return {
            id: nextId,
            fallback: nextFallback,
        };
    }

    function getPreferredLocalizedTextValue(...values) {
        for (const value of values) {
            if (getLocalizedTextId(value, '') || getLocalizedTextFallback(value)) {
                return value;
            }
        }

        return values[0];
    }

    function resolveSourceModification(structure, variantId, variant) {
        const candidateIds = [
            String(variant?.modificationId ?? '').trim(),
            String(variant?.appliedModificationId ?? '').trim(),
            String(variantId ?? '').trim(),
        ].filter(Boolean);

        if (candidateIds.length === 0) {
            return null;
        }

        const normalizedCandidateIds = candidateIds.map(normalizeId);

        for (const [modificationId, modification] of Object.entries(structure?.modifications ?? {})) {
            if (normalizedCandidateIds.includes(normalizeId(modification?.appliedModificationId ?? modificationId))) {
                return [modificationId, modification];
            }
        }

        return null;
    }

    const assets = manifest.assets.map(structure => {
        const publishedModifications = (structure.modificationSlots ?? []).map(slot => ({
            name: slot.name,
            componentType: slot.componentType,
            ...(slot?.x !== null && typeof slot?.x !== 'undefined' ? { x: slot.x } : {}),
            ...(slot?.y !== null && typeof slot?.y !== 'undefined' ? { y: slot.y } : {}),
            ...(slot?.z !== null && typeof slot?.z !== 'undefined' ? { z: slot.z } : {}),
            ...(slot?.rotation !== null && typeof slot?.rotation !== 'undefined' ? { rotation: slot.rotation } : {}),
            isLinkedToSocket: slot.isLinkedToSocket === true,
            linkedSocketNames: Array.isArray(slot.linkedSocketNames) ? slot.linkedSocketNames : [],
            blockedByModSlotNames: Array.isArray(slot.blockedByModSlotNames) ? slot.blockedByModSlotNames : [],
            variants: Object.fromEntries(Object.entries(slot.variants ?? {})
                .filter(([variantId]) => normalizeId(variantId) !== 'default')
                .map(([variantId, variant]) => {
                    const sourceModificationEntry = resolveSourceModification(structure, variantId, variant);
                    const sourceModificationId = String(sourceModificationEntry?.[0] ?? variantId ?? '').trim() || String(variantId ?? '').trim();
                    const sourceModification = sourceModificationEntry?.[1] ?? null;
                    const targetStructureId = normalizeId(
                        variant?.appliedModificationId
                        ?? sourceModification?.appliedModificationId
                        ?? sourceModificationId,
                    );
                    const targetStructure = (variant?.isUpgrade === true || sourceModification?.isUpgrade === true) && targetStructureId
                        ? assetsById.get(targetStructureId) ?? null
                        : null;
                    const powerGridInfo = variant?.powerGridInfo ?? sourceModification?.powerGridInfo;
                    const buildSockets = Array.isArray(variant?.buildSockets) && variant.buildSockets.length > 0
                        ? variant.buildSockets
                        : (Array.isArray(sourceModification?.buildSockets) && sourceModification.buildSockets.length > 0 ? sourceModification.buildSockets : null);
                    const footprintPolygons = Array.isArray(variant?.footprintPolygons) && variant.footprintPolygons.length > 0
                        ? variant.footprintPolygons
                        : (Array.isArray(sourceModification?.footprintPolygons) && sourceModification.footprintPolygons.length > 0 ? sourceModification.footprintPolygons : null);
                    const fuelTanks = Array.isArray(variant?.fuelTanks) && variant.fuelTanks.length > 0
                        ? variant.fuelTanks
                        : (Array.isArray(sourceModification?.fuelTanks) && sourceModification.fuelTanks.length > 0 ? sourceModification.fuelTanks : null);
                    const conversionEntries = Array.isArray(variant?.conversionEntries) && variant.conversionEntries.length > 0
                        ? variant.conversionEntries
                        : (Array.isArray(sourceModification?.conversionEntries) && sourceModification.conversionEntries.length > 0 ? sourceModification.conversionEntries : null);
                    const cost = Object.keys(variant?.cost ?? {}).length > 0
                        ? variant.cost
                        : (Object.keys(sourceModification?.cost ?? {}).length > 0 ? sourceModification.cost : null);
                    const assetScopedEntries = modificationEntriesByAssetId?.[normalizeId(structure.id)] ?? {};
                    const renderEntry = resolveAssetScopedModificationRenderEntry(
                        assetScopedEntries,
                        modificationEntriesByKey,
                        {
                            variantId,
                            variant,
                            extraKeys: [sourceModificationId],
                        },
                    );
                    const localizedName = normalizeLocalizedText(
                        getPreferredLocalizedTextValue(targetStructure?.name, variant?.name, sourceModification?.name),
                        createModificationLocalizationId(structure.id, sourceModificationId, 'name'),
                        getLocalizedTextFallback(targetStructure?.name)
                        || getLocalizedTextFallback(variant?.name)
                        || getLocalizedTextFallback(sourceModification?.name)
                        || sourceModificationId,
                    );
                    const localizedDescription = normalizeLocalizedText(
                        getPreferredLocalizedTextValue(targetStructure?.description, variant?.description, sourceModification?.description),
                        createModificationLocalizationId(structure.id, sourceModificationId, 'description'),
                        getLocalizedTextFallback(targetStructure?.description)
                        || getLocalizedTextFallback(variant?.description)
                        || getLocalizedTextFallback(sourceModification?.description)
                        || '',
                    );

                    if (localizedName.id && localizedName.fallback) {
                        localizedStrings.set(localizedName.id, localizedName.fallback);
                    }
                    if (localizedDescription.id && typeof localizedDescription.fallback === 'string') {
                        localizedStrings.set(localizedDescription.id, localizedDescription.fallback);
                    }

                    const defaultIconUrl = variant?.icons?.default
                        ?? variant?.iconUrl
                        ?? sourceModification?.icons?.default
                        ?? sourceModification?.iconUrl
                        ?? targetStructure?.icons?.default
                        ?? targetStructure?.iconUrl
                        ?? renderEntry?.defaultIconUrl
                        ?? null;
                    const previewUrl = renderEntry?.previewUrl
                        ?? variant?.previewUrl
                        ?? sourceModification?.previewUrl
                        ?? null;
                    const renderedIconUrl = previewUrl
                        ? (renderEntry?.renderedIconUrl
                            ?? renderEntry?.iconUrl
                            ?? variant?.icons?.rendered
                            ?? defaultIconUrl)
                        : defaultIconUrl;
                    const spriteSource = renderEntry?.textureUrl
                        ?? variant?.sprite?.source
                        ?? sourceModification?.textureUrl
                        ?? targetStructure?.sprite?.source
                        ?? targetStructure?.previewUrl
                        ?? targetStructure?.previewIconUrl
                        ?? targetStructure?.icons?.rendered
                        ?? null;
                    const spriteWidth = renderEntry?.textureWidth ?? variant?.sprite?.width ?? sourceModification?.textureWidth;
                    const spriteHeight = renderEntry?.textureHeight ?? variant?.sprite?.height ?? sourceModification?.textureHeight;
                    const spriteAnchorX = (renderEntry && renderEntry.anchorX !== null && typeof renderEntry.anchorX !== 'undefined')
                        ? renderEntry.anchorX
                        : (variant?.sprite?.anchorX ?? sourceModification?.anchorX ?? targetStructure?.sprite?.anchorX);
                    const spriteAnchorY = (renderEntry && renderEntry.anchorY !== null && typeof renderEntry.anchorY !== 'undefined')
                        ? renderEntry.anchorY
                        : (variant?.sprite?.anchorY ?? sourceModification?.anchorY ?? targetStructure?.sprite?.anchorY);
                    const spriteOffsetX = (renderEntry && renderEntry.offsetX !== null && typeof renderEntry.offsetX !== 'undefined')
                        ? renderEntry.offsetX
                        : (variant?.sprite?.offsetX ?? sourceModification?.offsetX ?? targetStructure?.sprite?.offsetX);
                    const spriteOffsetY = (renderEntry && renderEntry.offsetY !== null && typeof renderEntry.offsetY !== 'undefined')
                        ? renderEntry.offsetY
                        : (variant?.sprite?.offsetY ?? sourceModification?.offsetY ?? targetStructure?.sprite?.offsetY);

                    const isUpgradeVariant = resolvePublishedUpgradeVariantContext(
                        slot,
                        variantId,
                        variant,
                        sourceModification,
                    ).isUpgrade === true;
                    const preferredSharedModificationId = normalizeId(variantId) === 'default'
                        || isUpgradeVariant
                        || renderEntryHasHostLocalModificationVisuals(structure.id, renderEntry)
                        || (
                            Array.isArray(variant?.renderLayers)
                            && variant.renderLayers.some(layer => isHostLocalModificationRenderUrl(structure.id, layer?.textureUrl ?? layer?.u))
                        )
                        ? null
                        : resolveSeededSharedModificationId(
                            renderEntry?.sharedModificationId,
                            variant?.sharedModificationId,
                            sourceModification?.sharedModificationId,
                        );
                    const parentStructureId = normalizeId(variant?.parentStructureId ?? sourceModification?.parentStructureId);
                    const rootStructureId = normalizeId(variant?.rootStructureId ?? sourceModification?.rootStructureId);
                    const appliedModificationId = normalizeId(variant?.appliedModificationId ?? sourceModification?.appliedModificationId);
                    const upgradeName = getLocalizedTextFallback(targetStructure?.name)
                        || variant?.upgradeName
                        || sourceModification?.upgradeName
                        || null;
                    const previewDirection = renderEntry?.previewDirection
                        ?? variant?.previewDirection
                        ?? sourceModification?.previewDirection
                        ?? targetStructure?.previewDirection
                        ?? null;
                    const modificationLayerLookupKeys = [
                        variant?.renderId,
                        variant?.sharedModificationId,
                        variantId,
                        variant?.modificationId,
                        variant?.appliedModificationId,
                        sourceModificationId,
                        preferredSharedModificationId,
                    ]
                        .map(normalizeId)
                        .filter(Boolean);
                    const assetModificationLayerEntries = modificationLayerEntriesByAssetId?.[normalizeId(structure.id)] ?? {};
                    const modificationLayerEntries = modificationLayerLookupKeys
                        .map(lookupKey => assetModificationLayerEntries?.[lookupKey])
                        .find(entries => entries && Object.keys(entries).length > 0)
                        ?? null;
                    const modificationRenderLayers = Array.isArray(variant?.renderLayers) && variant.renderLayers.length > 0
                        ? variant.renderLayers
                        : (modificationLayerEntries
                            ? Object.values(modificationLayerEntries)
                                .filter(entry => entry?.textureUrl)
                                .sort(compareStructureRenderLayers)
                                .map(entry => ({
                                    id: entry.id,
                                    textureUrl: entry.textureUrl,
                                    ...(entry?.width ? { width: entry.width } : {}),
                                    ...(entry?.height ? { height: entry.height } : {}),
                                    ...(entry?.anchorX !== null && typeof entry?.anchorX !== 'undefined' ? { anchorX: entry.anchorX } : {}),
                                    ...(entry?.anchorY !== null && typeof entry?.anchorY !== 'undefined' ? { anchorY: entry.anchorY } : {}),
                                    ...(entry?.offsetX !== null && typeof entry?.offsetX !== 'undefined' ? { offsetX: entry.offsetX } : {}),
                                    ...(entry?.offsetY !== null && typeof entry?.offsetY !== 'undefined' ? { offsetY: entry.offsetY } : {}),
                                }))
                            : []);

                    return [variantId, {
                        name: localizedName,
                        description: localizedDescription,
                        ...(variant?.requiredSocketConnectionMask !== null && typeof variant?.requiredSocketConnectionMask !== 'undefined'
                            ? { requiredSocketConnectionMask: variant.requiredSocketConnectionMask }
                            : {}),
                        ...(variant?.hiddenBySocketConnectionMask !== null && typeof variant?.hiddenBySocketConnectionMask !== 'undefined'
                            ? { hiddenBySocketConnectionMask: variant.hiddenBySocketConnectionMask }
                            : {}),
                        ...(powerGridInfo ? { powerGridInfo } : {}),
                        ...(buildSockets ? { buildSockets } : {}),
                        ...(footprintPolygons ? { footprintPolygons } : {}),
                        ...(fuelTanks ? { fuelTanks } : {}),
                        ...(conversionEntries ? { conversionEntries } : {}),
                        ...(cost ? { cost } : {}),
                        ...((defaultIconUrl || renderedIconUrl)
                            ? {
                                icons: {
                                    ...(defaultIconUrl ? { default: defaultIconUrl } : {}),
                                    ...(renderedIconUrl ? { rendered: renderedIconUrl } : {}),
                                },
                            }
                            : {}),
                        ...(previewUrl ? { previewUrl } : {}),
                        ...(previewDirection ? { previewDirection } : {}),
                        ...(spriteSource
                            ? {
                                sprite: {
                                    source: spriteSource,
                                    ...(typeof spriteWidth === 'number' ? { width: spriteWidth } : {}),
                                    ...(typeof spriteHeight === 'number' ? { height: spriteHeight } : {}),
                                    ...((spriteAnchorX !== null && typeof spriteAnchorX !== 'undefined') ? { anchorX: spriteAnchorX } : {}),
                                    ...((spriteAnchorY !== null && typeof spriteAnchorY !== 'undefined') ? { anchorY: spriteAnchorY } : {}),
                                    ...((spriteOffsetX !== null && typeof spriteOffsetX !== 'undefined') ? { offsetX: spriteOffsetX } : {}),
                                    ...((spriteOffsetY !== null && typeof spriteOffsetY !== 'undefined') ? { offsetY: spriteOffsetY } : {}),
                                },
                            }
                            : {}),
                        ...(modificationRenderLayers.length > 0 ? { renderLayers: modificationRenderLayers } : {}),
                        ...(isUpgradeVariant
                            ? { isUpgrade: true }
                            : {}),
                        ...(upgradeName ? { upgradeName } : {}),
                        ...(parentStructureId ? { parentStructureId } : {}),
                        ...(rootStructureId ? { rootStructureId } : {}),
                        ...(appliedModificationId ? { appliedModificationId } : {}),
                        ...(preferredSharedModificationId ? { sharedModificationId: preferredSharedModificationId } : {}),
                    }];
                })),
        })).filter(slot => Object.keys(slot.variants).length > 0);

        const { modificationSlots, modifications, ...publishedStructure } = structure;

        return {
            ...publishedStructure,
            modifications: publishedModifications,
        };
    });

    const localizations = normalizeLocalizationBundles(manifest.localizations).map(bundle => (
        bundle.locale === 'en'
            ? {
                ...bundle,
                strings: sortObjectEntries({
                    ...bundle.strings,
                    ...Object.fromEntries(localizedStrings),
                }),
            }
            : bundle
    ));

    return buildSharedModificationStore({
        ...manifest,
        assets,
        localizations,
    });
}

async function coLocateFallbackStructureAssets(
    manifest,
    generatedDirectory,
    sourceManifest = null,
    subtypeOverlayIconKeys = null,
    structuresWithDestroyedRenderScenes = null,
) {
    return publishStructureIconsForManifest({
        manifest,
        sourceManifest,
        getOutputDirectory: structureId => getPublishedAssetDirectory(structureId)
            ?? resolve(assetTypesDirectory, 'structures', structureId),
        toPublicAssetUrl: toPublicFoxholeAssetUrl,
        rawRenderedAssetTypesDirectory,
        generatedIconsDirectory: generatedDirectory,
        publicAssetsDirectory: publicFoxholeAssetsDirectory,
        resolveAssetTypeName: resolvePublishedAssetTypeName,
        skipExistingAssets,
        defaultWreckedSubtypeUrl: defaultWreckedSubtypeIconUrl,
        structuresWithDestroyedRenderScenes,
        publishConcurrency,
    });
}

function splitManifestLocalizations(manifest) {
    const localizationFiles = {};
    const inlineLocalizations = [];
    const localizationBundles = normalizeLocalizationBundles(manifest.localizations)
        .sort((left, right) => left.locale.localeCompare(right.locale));

    for (const bundle of localizationBundles) {
        const locale = bundle.locale;
        if (locale === 'en') {
            inlineLocalizations.push({
                locale,
                strings: bundle.strings,
            });
            continue;
        }

        localizationFiles[locale] = `localizations/${locale}.json`;
    }

    return {
        ...manifest,
        localizations: inlineLocalizations,
        localizationIndex: {
            defaultLocale: 'en',
            availableLocales: localizationBundles.map(bundle => bundle.locale),
            files: localizationFiles,
        },
    };
}

function applyPublishedCanBlueprintFlags(manifest, sourceManifest) {
    const canBlueprintById = new Map((sourceManifest?.assets ?? [])
        .map(structure => [normalizeId(structure?.id), structure?.canBlueprint === true])
        .filter(([structureId]) => structureId));

    return {
        ...manifest,
        assets: (manifest?.assets ?? []).map(structure => {
            const structureId = normalizeId(structure?.id);
            if (!structureId || canBlueprintById.get(structureId) !== true) {
                const { canBlueprint: _canBlueprint, ...structureWithoutCanBlueprint } = structure ?? {};
                return structureWithoutCanBlueprint;
            }

            return {
                ...structure,
                canBlueprint: true,
            };
        }),
    };
}

async function writeLocalizationFiles(directory, manifest) {
    for (const bundle of normalizeLocalizationBundles(manifest.localizations)
        .sort((left, right) => left.locale.localeCompare(right.locale))) {
        if (bundle.locale === 'en') {
            continue;
        }

        const outputPath = resolve(directory, `${bundle.locale}.json`);
        const didWrite = await writeTextFileIfChanged(outputPath, stringifyJsonAscii(bundle.strings));
        if (didWrite) {
            logPublishDetail(`wrote ${outputPath}`);
        }
    }
}

const sourceManifestPath = getPathValue(cliArgs, 'source-manifest', getPathValue(cliArgs, 'source', rawFoxWatchManifestPath));
const sharedModificationHashDiagnosticsSummary = {
    sourceManifestPath,
    publishedManifestPath,
    fixtureManifestPath,
    cliArgs: cloneSharedModificationHashDiagnosticValue(process.argv.slice(2)),
};

try {
    if (skipExistingAssets) {
        logPublishSummary('publish-manifest: reusing existing asset outputs (--skip-existing-assets)');
    }
    if (!isPublishVerbose()) {
        logPublishSummary(`publish-manifest: quiet logging enabled (concurrency ${publishConcurrency}; pass --verbose for per-file logs)`);
    }

    const sourceManifest = await loadSourceManifest(sourceManifestPath);
    let publishedManifestBeforeWrite = null;
    if (await pathExists(publishedManifestPath)) {
        try {
            publishedManifestBeforeWrite = await loadSourceManifest(publishedManifestPath, { seedSharedModificationIds: false });
        } catch (error) {
            logPublishWarn(`skipping published manifest preload because the existing published manifest is not in the assets-root shape: ${error}`);
        }
    }
    assertSafeUnfilteredPublish(sourceManifest, publishedManifestBeforeWrite, sourceManifestPath);
    const rebasedSourceManifestForDowngradeLookup = rebaseFoxholeManifestAssetUrls(
        sourceManifest,
        getManifestBaseAssetsUrl(sourceManifest),
        createFoxholeAssetsBaseUrl('/'),
    );
    const filteredSourceManifest = attachSourceStructureMetadata(applyTargetFilter(
        rebasedSourceManifestForDowngradeLookup,
        targetFilter,
    ), sourceManifest.__sourceStructureMetadataById);
    const manifestForPublish = attachSourceStructureMetadata(
        augmentTargetedOnlyPublishedStructures(
            hasTargetFilters(targetFilter) && publishedManifestBeforeWrite
                ? augmentPartialManifestWithPublishedContext(filteredSourceManifest, publishedManifestBeforeWrite)
                : filteredSourceManifest,
            publishedManifestBeforeWrite,
            targetFilter,
        ),
        sourceManifest.__sourceStructureMetadataById,
    );
    const renderScenesIndexDocument = await loadRenderScenesIndexDocument();
    const modificationRenderIndexDocument = await loadModificationRenderIndexDocument();
    assertUniqueHostModificationVariantRenderIds(modificationRenderIndexDocument);
    const structuresWithDestroyedRenderScenes = await loadStructureIdsWithDestroyedRenderScenes();
    const vehicleDestroyedPublishAllowlist = await loadVehicleDestroyedPublishAllowlist(assetOverridesDirectory);
    const manifestForPublishWithoutBogusDestroyed = foxholeManifestSchema.parse(
        sanitizeVehicleDestroyedVisuals(
            manifestForPublish,
            structuresWithDestroyedRenderScenes,
            vehicleDestroyedPublishAllowlist,
        ),
    );
    const manifestWithSeededSharedModificationIds = seedSharedModificationIdsFromRenderIndex(
        manifestForPublishWithoutBogusDestroyed,
        renderScenesIndexDocument,
        modificationRenderIndexDocument,
    );
    publishedAssetTypeById = buildPublishedAssetTypeLookup(manifestWithSeededSharedModificationIds);
    const explicitlyRemovedStructureIds = getExplicitlyRemovedStructureIdsForTargetedPublish();
    const referencedGeneratedIconKeys = hasTargetFilters(targetFilter)
        ? collectReferencedPublishedIconKeys(manifestWithSeededSharedModificationIds)
        : null;
    const scopedRawRenderedAssetTargets = buildScopedRawRenderedAssetTargets(
        manifestWithSeededSharedModificationIds,
        renderScenesIndexDocument,
        modificationRenderIndexDocument,
    );

    await removeStaleRootStructureArtifacts(manifestWithSeededSharedModificationIds);
    await removeStaleStructureArtifactDirectories(manifestWithSeededSharedModificationIds);
    await removeStructureArtifactsByIds(explicitlyRemovedStructureIds);
    await removeLegacyTypedLayoutArtifacts(manifestWithSeededSharedModificationIds);

    await generateSyntheticOilfieldAssets(manifestWithSeededSharedModificationIds);
    await syncRawRenderedAssetsToPublicDirectory(
        scopedRawRenderedAssetTargets,
        manifestWithSeededSharedModificationIds,
    );

    const structuresWithVisibleRawDestroyedRenders = await collectStructureIdsWithVisibleRawDestroyedRenders();
    const structuresWithRawDestroyedRenders = new Set();
    for (const structure of manifestWithSeededSharedModificationIds.assets ?? []) {
        const structureId = normalizeId(structure?.id);
        if (!structureId) {
            continue;
        }

        if (structuresWithVisibleRawDestroyedRenders.has(structureId)
            && structureHasResolvableDestroyedRenderScene(structure, structuresWithDestroyedRenderScenes)
            && shouldPublishVehicleDestroyedVisual(structure, vehicleDestroyedPublishAllowlist)) {
            structuresWithRawDestroyedRenders.add(structureId);
        }
    }

    const structureRenderEntries = await buildStructureRenderEntries(manifestWithSeededSharedModificationIds, scopedRawRenderedAssetTargets);
    const manifestWithRenderUrls = applyStructureRenderUrls(
        manifestWithSeededSharedModificationIds,
        structureRenderEntries.entriesByKey,
        await buildStructureSceneMetadata(renderScenesIndexDocument),
        structureRenderEntries.modificationEntriesByKey,
        structureRenderEntries.modificationEntriesByAssetId,
        structureRenderEntries.structureLayerEntriesByStructureId,
        structureRenderEntries.modificationLayerEntriesByAssetId,
        structureRenderEntries.sharedPackagingEntriesByKey,
        structuresWithRawDestroyedRenders,
        vehicleDestroyedPublishAllowlist,
        rebasedSourceManifestForDowngradeLookup.assets,
    );
    const manifestWithNormalizedIconUrls = foxholeManifestSchema.parse(normalizePublishedIconAssetUrls(manifestWithRenderUrls));
    const subtypeOverlayIconKeys = collectSubtypeOverlayIconKeys(manifestWithNormalizedIconUrls);
    const manifestWithCoLocatedFallbackAssets = await coLocateFallbackStructureAssets(
        manifestWithNormalizedIconUrls,
        generatedIconsDirectory,
        attachSourceStructureMetadata(manifestForPublish, sourceManifest.__sourceStructureMetadataById),
        subtypeOverlayIconKeys,
        structuresWithDestroyedRenderScenes,
    );
    const manifestWithStrippedSlotNoise = stripPublishedModificationSlotNoise(
        manifestWithCoLocatedFallbackAssets,
        structureRenderEntries.modificationEntriesByKey,
        structureRenderEntries.modificationEntriesByAssetId,
        structureRenderEntries.modificationLayerEntriesByAssetId,
    );
    const {
        manifest: manifestAfterHostLocalModDefaultIcons,
        coLocatedIconKeys: coLocatedSingleUseModDefaultIconKeys,
    } = await coLocateSingleUseHostLocalModificationDefaultIcons(manifestWithStrippedSlotNoise, {
        readIconSource: sourceUrl => readPublishedAssetUrlAsWebp(generatedIconsDirectory, sourceUrl),
        writeIconFile: writeFileIfChanged,
        resolvePublicAssetFilePath: getPublicFoxholeAssetFilePath,
    });
    // coLocate rebuilds the manifest via object spread, which drops non-enumerable
    // __sharedModification* source metadata. Reattach before shared default icon sync.
    const manifestWithCoLocatedModDefaultIcons = attachSharedModificationSourceMetadata(
        attachSharedModificationDefaultIconSourceMetadata(
            manifestAfterHostLocalModDefaultIcons,
            manifestWithStrippedSlotNoise.__sharedModificationDefaultIconSourceById,
        ),
        manifestWithStrippedSlotNoise.__sharedModificationSourceById,
    );
    await syncSharedModificationDefaultIconAssets(manifestWithCoLocatedModDefaultIcons);
    const authoredModificationOverrides = await loadAuthoredSharedModificationOverrides();
    const authoredStructurePreviewDirections = await loadAuthoredStructurePreviewDirections(assetOverridesDirectory);
    const authoredStructureMarkedCargoOverlays = await loadAuthoredStructureMarkedCargoOverlays(assetOverridesDirectory);
    const manifestWithPreservedAuthoredPreviewDirections = preserveAuthoredSharedModificationPreviewDirections(
        preserveAuthoredModificationPreviewDirections(
            preserveAuthoredStructureMarkedCargoOverlays(
                preserveAuthoredStructurePreviewDirections(
                    manifestWithCoLocatedModDefaultIcons,
                    manifestWithSeededSharedModificationIds,
                    authoredStructurePreviewDirections,
                ),
                manifestWithSeededSharedModificationIds,
                authoredStructureMarkedCargoOverlays,
            ),
            manifestWithSeededSharedModificationIds,
            authoredModificationOverrides,
        ),
        authoredModificationOverrides,
    );
    let publishedBaseManifest = null;
    if (hasTargetFilters(targetFilter)) {
        publishedBaseManifest = publishedManifestBeforeWrite;
    }

    const mergedManifest = publishedBaseManifest
        ? mergeManifestSubset(publishedBaseManifest, manifestWithPreservedAuthoredPreviewDirections, explicitlyRemovedStructureIds)
        : manifestWithPreservedAuthoredPreviewDirections;
    const mergedManifestWithoutUnavailableDestroyedVisuals = await stripUnavailableDestroyedVisuals(
        mergedManifest,
        structuresWithDestroyedRenderScenes,
        structuresWithVisibleRawDestroyedRenders,
        vehicleDestroyedPublishAllowlist,
    );
    await removeDestroyedArtifactsWithoutManifestEntry(mergedManifestWithoutUnavailableDestroyedVisuals);
    await removeStaleRootStructureArtifacts(mergedManifestWithoutUnavailableDestroyedVisuals);
    const removedUpgradeStructureIds = getRemovedUpgradeStructureIds(publishedManifestBeforeWrite, mergedManifestWithoutUnavailableDestroyedVisuals);
    const removedPublishedStructureIds = getRemovedStructureIds(publishedManifestBeforeWrite, mergedManifestWithoutUnavailableDestroyedVisuals);
    const removedStructureIds = new Set([
        ...explicitlyRemovedStructureIds,
        ...removedPublishedStructureIds,
        ...removedUpgradeStructureIds,
    ]);
    const prunedMergedManifest = removeDanglingStructureReferences(normalizePublishedModificationPath(pruneSharedModificationEntries(
        pruneRemovedStructureLocalizations(normalizePublishedModificationPath(mergedManifestWithoutUnavailableDestroyedVisuals), removedStructureIds),
    )));
    await removeStructureArtifactsByIds(removedPublishedStructureIds);
    await removeStructureArtifactsByIds(removedUpgradeStructureIds);
    await removeOrphanPublishedAssetDirectories(prunedMergedManifest);
    const referencedSharedGeneratedIconKeys = collectReferencedPublishedIconKeys(prunedMergedManifest);

    if (referencedSharedGeneratedIconKeys.size > 0) {
        await syncPublishedIconsToPublicDirectoryByKey(generatedIconsDirectory, publicIconsDirectory, referencedSharedGeneratedIconKeys);
    }

    const removedCoLocatedAwayIcons = await removePublicIconsByKey(
        publicIconsDirectory,
        new Set([...coLocatedSingleUseModDefaultIconKeys].filter(key => !referencedSharedGeneratedIconKeys.has(key))),
        {
            pathExists,
            unlink,
            walkFiles,
        },
    );
    if (removedCoLocatedAwayIcons > 0) {
        logPublishSummary(`publish-manifest: removed ${removedCoLocatedAwayIcons} icons after co-locating single-use mod defaults`);
    }

    await removeStaleSharedIconsForCoLocatedStructures(prunedMergedManifest);
    await syncCategoryIconAssets(prunedMergedManifest);
    await removeComposeTimeSubtypeIconsFromPublicDirectory(collectSubtypeOverlayIconKeys(prunedMergedManifest));

    if (!hasTargetFilters(targetFilter)) {
        await removeUnreferencedGeneratedModificationArtifactDirectories(prunedMergedManifest);
    } else {
        await removeUnreferencedGeneratedModificationArtifactDirectories(
            prunedMergedManifest,
            scopedRawRenderedAssetTargets.assetIds,
        );
    }

    const prunedMergedManifestWithCompactLocalizationIds = compactManifestLocalizationIds(prunedMergedManifest);

    await writeLocalizationFiles(publicLocalizationsDirectory, prunedMergedManifestWithCompactLocalizationIds);
    await writeLocalizationFiles(fixtureLocalizationsDirectory, prunedMergedManifestWithCompactLocalizationIds);

    const manifest = compactPublishedFoxholeManifest(normalizeOptionalStructureProperties(splitManifestLocalizations(
        applyPublishedCanBlueprintFlags(prunedMergedManifestWithCompactLocalizationIds, prunedMergedManifest),
    )));
    const serializedManifest = stringifyJsonAscii(manifest);

    const outputPaths = [
        publishedManifestPath,
        fixtureManifestPath,
    ];

    for (const outputPath of outputPaths) {
        const didWrite = await writeTextFileIfChanged(outputPath, serializedManifest);
        if (didWrite) {
            logPublishSummary(`publish-manifest: wrote ${outputPath}`);
        }
    }

    sharedModificationHashDiagnosticsSummary.outputPaths = outputPaths;
    sharedModificationHashDiagnosticsSummary.assetCount = Array.isArray(manifest?.assets) ? manifest.assets.length : 0;
    sharedModificationHashDiagnosticsSummary.sharedModificationCount = Object.keys(manifest?.shared?.modifications ?? {}).length;
    sharedModificationHashDiagnosticsSummary.localizationBundleCount = Array.isArray(manifest?.localizations) ? manifest.localizations.length : 0;
} catch (error) {
    sharedModificationHashDiagnosticsSummary.error = error instanceof Error
        ? {
            message: error.message,
            stack: error.stack ?? null,
        }
        : {
            message: String(error),
            stack: null,
        };
    throw error;
} finally {
    await writeSharedModificationHashDiagnostics(sharedModificationHashDiagnosticsSummary);
}
