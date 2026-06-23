import { access, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { imageDataHasVisiblePixels } from './publish-render-utils.mjs';
import { composeSubtypeIcon } from './publish-icon-utils.mjs';

import {
    createFoxholeAssetsBaseUrl,
    foxholeManifestSchema,
    normalizeFoxholePackagedPalletKey,
    rebaseFoxholeManifestAssetUrls,
} from '../../../apps/foxhole-planner/app/plugins/foxhole/nixie/manifest.ts';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDir, '..', '..', '..');
const foxholePlannerRoot = resolve(repositoryRoot, 'apps', 'foxhole-planner');
const publicFoxholeAssetsDirectory = resolve(foxholePlannerRoot, 'public', 'foxhole', 'assets');
const publishedManifestPath = resolve(publicFoxholeAssetsDirectory, 'manifest.v1.json');
const rawFoxWatchManifestPath = resolve(repositoryRoot, 'tools/foxwatch/tmp/foxwatch-manifest.v1.json');
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
const defaultWreckedSubtypeIconUrl = '/foxhole/assets/icons/subtypewreckedicon.webp';
const sharedModificationHashDiagnosticsDirectory = resolve(repositoryRoot, 'tools/foxwatch/tmp/diagnostics/shared-modification-hash');

const iconSourceExtensions = new Set(['.png', '.jpg', '.jpeg']);
const publishedImageSourceExtensions = ['.png', '.jpg', '.jpeg', '.webp'];
const rawRenderedImageSourceExtensions = ['.webp', ...iconSourceExtensions];
const losslessPublishedWebpOptions = { lossless: true, quality: 100, effort: 6 };
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
const renderVisibilityByFilePath = new Map();
const samePathSubtypeCompositionStateDirectory = resolve(repositoryRoot, 'tools/foxwatch/tmp/rendered-subtype-state');
let temporaryFileWriteSequence = 0;

const cliArgs = parseCliArgs(process.argv.slice(2));
const targetFilter = {
    only: new Set(getNormalizedValues(cliArgs, 'only').map(normalizeId)),
    category: new Set(getNormalizedValues(cliArgs, 'category').map(normalizeId)),
};
const skipExistingAssets = hasCliFlag(cliArgs, 'skip-existing-assets');
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

function createSharedModificationHashDiagnosticInput(value) {
    const raw = value == null ? '' : String(value);
    return {
        raw,
        normalized: normalizeStandaloneModificationIdentityPart(raw),
    };
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
    console.log(`wrote ${outputPath}`);
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

function attachSourceStructureMetadata(manifest, sourceStructureMetadataById) {
    if (!(sourceStructureMetadataById instanceof Map) || !manifest || typeof manifest !== 'object') {
        return manifest;
    }

    Object.defineProperty(manifest, '__sourceStructureMetadataById', {
        value: sourceStructureMetadataById,
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
    }, {
        m: null,
        c: null,
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
        loc: compactJsonValue(value.relativeLocation),
        scale: compactJsonValue(value.relativeScale),
    }, {
        mode: null,
        axis: null,
        length: null,
        interval: null,
        start: 0,
        end: 0,
        loc: [0, 0, 0],
        scale: [1, 1, 1],
    });
}

function compactConnector(value) {
    return compactNullableObject(value, {
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
        meshConfigs: [],
    }, {
        meshConfigs: entryValue => compactArray(entryValue, compactConnectorMeshConfig),
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
    }, {
        w: null,
        h: null,
        ax: null,
        ay: null,
        ox: 0,
        oy: 0,
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
        if (sharedModificationId && value.isUpgrade !== true) {
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
    const normalizedValue = isPlainObject(value)
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
        : value;
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
            console.warn(`failed to read localization bundle for ${locale} from ${localizationPath}: ${error}`);
        }
    }

    return foxholeManifestSchema.parse({
        ...manifest,
        localizations,
    });
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

            const rawSourceModificationById = new Map(Object.entries(rawStructure?.modifications ?? {})
                .map(([modificationId, modification]) => {
                    const normalizedModificationId = normalizeId(modification?.appliedModificationId ?? modificationId);
                    return normalizedModificationId ? [normalizedModificationId, modification] : null;
                })
                .filter(Boolean));
            const rawSlotsByName = new Map((rawStructure?.modificationSlots ?? [])
                .map(slot => {
                    const slotName = String(slot?.name ?? '').trim();
                    return slotName ? [slotName, slot] : null;
                })
                .filter(Boolean));

            return {
                ...structure,
                modificationSlots: (structure?.modificationSlots ?? []).map(slot => {
                    const rawSlot = rawSlotsByName.get(String(slot?.name ?? '').trim()) ?? null;
                    return {
                        ...slot,
                        variants: Object.fromEntries(Object.entries(slot?.variants ?? {}).map(([variantId, variant]) => {
                            const rawVariant = rawSlot?.variants?.[variantId] ?? null;
                            const rawSourceModification = rawSourceModificationById.get(normalizeId(
                                rawVariant?.modificationId
                                ?? rawVariant?.appliedModificationId
                                ?? variantId,
                            )) ?? null;
                            const seededSharedModificationId = normalizeId(variantId) === 'default' || rawVariant?.isUpgrade === true || rawSourceModification?.isUpgrade === true
                                ? null
                                : resolvePreferredSharedModificationId(
                                    variant?.sharedModificationId ?? rawVariant?.sharedModificationId ?? rawSourceModification?.sharedModificationId ?? null,
                                    variantId,
                                    {
                                        ...rawSourceModification,
                                        ...rawVariant,
                                    },
                                    variant?.previewDirection
                                    ?? rawVariant?.previewDirection
                                    ?? rawSourceModification?.previewDirection
                                    ?? structure?.previewDirection,
                                );

                            return [variantId, {
                                ...variant,
                                ...(seededSharedModificationId ? { sharedModificationId: seededSharedModificationId } : {}),
                            }];
                        })),
                    };
                }),
            };
        }),
    };
}

async function loadSourceManifest(manifestPath) {
    const rawManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!Array.isArray(rawManifest?.assets)) {
        throw new Error(`manifest at ${manifestPath} does not use the assets root`);
    }

    const manifest = seedAuthoredSharedModificationIds(rawManifest, foxholeManifestSchema.parse(rawManifest));
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

function buildScopedRawRenderedAssetTargets(manifest) {
    const assetIds = new Set((manifest?.assets ?? [])
        .flatMap(structure => [structure?.id, structure?.codeName, structure?.parentStructureId, structure?.rootStructureId])
        .map(normalizeId)
        .filter(Boolean));
    const sharedModificationIds = collectReferencedSharedModificationIds(buildSharedModificationStore(manifest));
    const sharedPackagingKeys = new Set([
        ...sharedPackagingTargetKeys,
        ...Object.keys(manifest?.shared?.packaging ?? {})
            .map(normalizeFoxholePackagedPalletKey)
            .filter(Boolean),
    ]);

    return {
        assetIds,
        sharedModificationIds,
        sharedPackagingKeys,
    };
}

function matchesScopedRawRenderedAssetTargets(scopedTargets, outputPath) {
    if (!scopedTargets) {
        return true;
    }

    const location = parseAssetRelativeLocation(outputPath);
    if (!location) {
        return false;
    }

    if (location.scope === 'sharedModification') {
        return scopedTargets.sharedModificationIds.has(location.modificationId);
    }

    if (location.scope === 'sharedPackaging') {
        return scopedTargets.sharedPackagingKeys.has(location.shippableType);
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
        structures.push(partialStructuresById.get(structureId) ?? structure);
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

function preserveAuthoredStructurePreviewDirections(publishedManifest, sourceManifest) {
    const authoredPreviewDirectionById = new Map((sourceManifest?.assets ?? [])
        .map(structure => [normalizeId(structure?.id), normalizeId(structure?.previewDirection)])
        .filter(([structureId, previewDirection]) => structureId && previewDirection));

    return {
        ...publishedManifest,
        assets: (publishedManifest?.assets ?? []).map(structure => {
            const structureId = normalizeId(structure?.id);
            if (!structureId) {
                return structure;
            }

            const authoredPreviewDirection = authoredPreviewDirectionById.get(structureId);
            if (!authoredPreviewDirection || normalizeId(structure?.previewDirection)) {
                return structure;
            }

            return {
                ...structure,
                previewDirection: authoredPreviewDirection,
            };
        }),
    };
}

function getExplicitlyRemovedStructureIds(filter, partialManifest) {
    if (filter.only.size === 0) {
        return new Set();
    }

    const presentIds = new Set((partialManifest?.assets ?? [])
        .flatMap(structure => [structure?.id, structure?.codeName])
        .map(normalizeId)
        .filter(Boolean));

    return new Set([...filter.only].filter(id => !presentIds.has(id)));
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
            console.warn(`removed dangling upgradeStructureCodeName ${normalizedUpgradeStructureCodeName} from ${structureLabel}`);
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

                console.warn(`removed dangling conversionCodeName ${normalizedCodeName} from ${structureLabel}`);
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
            console.warn(`removed dangling destroyedStructureCodeName ${normalizedDestroyedStructureCodeName} from ${structureLabel}`);
            removedReferenceCount += 1;
            nextStructure = {
                ...nextStructure,
                destroyedStructureCodeName: null,
            };
        }

        return nextStructure;
    });

    if (removedReferenceCount > 0) {
        console.warn(`removed ${removedReferenceCount} dangling structure reference(s) from published manifest`);
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
        console.log(`converted ${filePath} -> ${outputPath}`);
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
        console.log(`removed ${filePath}`);
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

            const outputPath = resolve(publicDirectory, `${fileKey}.webp`);
            if (await shouldReuseExistingAssetOutput(outputPath)) {
                copiedKeys.add(fileKey);
                continue;
            }

            const { sourceFilePath, content } = await readPublishedIconSourceFile(directory, `${fileKey}.webp`);
            if (await writeFileIfChanged(outputPath, content)) {
                console.log(`copied ${sourceFilePath} -> ${outputPath}`);
            }
            copiedKeys.add(fileKey);
        }
    }

    for (const fileKey of allowedKeys ?? []) {
        if (copiedKeys.has(fileKey)) {
            continue;
        }

        try {
            const outputPath = resolve(publicDirectory, `${fileKey}.webp`);
            if (await shouldReuseExistingAssetOutput(outputPath)) {
                continue;
            }

            const { sourceFilePath, content } = await readPublishedIconSourceFile(directory, `${fileKey}.webp`);
            if (await writeFileIfChanged(outputPath, content)) {
                console.log(`copied fallback icon ${sourceFilePath} -> ${outputPath}`);
            }
        } catch (error) {
            console.warn(`skipping fallback icon ${fileKey}: ${error}`);
        }
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

async function syncRawRenderedAssetsToPublicDirectory(scopedTargets = null) {
    for (const rawRootDirectory of [rawRenderedAssetTypesDirectory, rawRenderedSharedAssetsDirectory]) {
        if (!await pathExists(rawRootDirectory)) {
            continue;
        }

        for await (const filePath of walkFiles(rawRootDirectory)) {
            const extension = extname(filePath).toLowerCase();
            if (extension !== '.json' && extension !== '.webp') {
                continue;
            }

            const outputPath = resolveRawRenderedAssetPublicOutputPath(filePath);
            if (!outputPath || !matchesScopedRawRenderedAssetTargets(scopedTargets, outputPath)) {
                continue;
            }

            if (await shouldReuseExistingAssetOutput(outputPath)) {
                continue;
            }

            await mkdir(dirname(outputPath), { recursive: true });
            try {
                if (extension === '.json') {
                    await writeFileIfChanged(outputPath, await readFileWithRetries(filePath));
                } else {
                    await writeFileIfChanged(outputPath, await readImageContentAsWebp(filePath, resolveRawRenderedAssetWebpOptions(outputPath)));
                }

                console.log(`synced raw render ${filePath} -> ${outputPath}`);
            } catch (error) {
                if (!isRetryableFileSystemError(error) || !await pathExists(outputPath)) {
                    throw error;
                }

                console.warn(`skipping locked raw render ${filePath} -> ${outputPath}: ${error}`);
            }
        }
    }
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

    for (const [sharedModificationId, modification] of Object.entries(manifest?.shared?.modifications ?? {})) {
        const sharedDefaultIconUrl = String(modification?.icons?.default ?? modification?.iconUrl ?? '').trim();
        if (!sharedDefaultIconUrl) {
            continue;
        }

        const normalizedSharedModificationId = normalizeId(sharedModificationId);
        const sharedModificationSources = sharedModificationSourceById.get(normalizedSharedModificationId);
        const sourceEntries = [
            ['.icon.default', sharedModificationSources?.defaultIconSourceUrl ?? sharedModificationDefaultIconSourceById.get(normalizedSharedModificationId) ?? null],
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
                console.log(`co-located ${source.sourceFilePath} -> ${outputFilePath}`);
            } catch (error) {
                console.warn(`skipping shared modification asset ${fileSuffix} for ${sharedModificationId} from ${sourceUrl}: ${error}`);
            }
        }
    }
}

function collectReferencedPublishedIconKeys(manifest, options = {}) {
    const includeSubtypeIcons = options.includeSubtypeIcons ?? true;
    const keys = new Set();

    function addValue(value) {
        const key = extractPublishedIconKey(value);
        if (key) {
            keys.add(key);
        }
    }

    for (const structure of manifest?.assets ?? []) {
        if (includeSubtypeIcons) {
            addValue(structure?.subTypeIconUrl);
        }
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
                if (includeSubtypeIcons) {
                    addValue(variant?.subTypeIconUrl);
                }
                addValue(variant?.icons?.default ?? variant?.iconUrl);
                addValue(variant?.icons?.rendered ?? variant?.renderedIconUrl);
                addValue(variant?.previewUrl);
                addValue(variant?.sprite?.source ?? variant?.textureUrl);
            }
        }
    }

    for (const modification of Object.values(manifest?.shared?.modifications ?? {})) {
        if (includeSubtypeIcons) {
            addValue(modification?.subTypeIconUrl);
        }
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
            geometryCenterPixelX: baseSize / 2,
            geometryCenterPixelY: baseSize / 2,
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

    return null;
}

function normalizeStandaloneModificationKeyComponent(value) {
    return normalizeId(value)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function normalizeStandaloneModificationIdentityPart(value) {
    return String(value ?? '').trim().toLowerCase();
}

function getStandaloneModificationIdentityText(value) {
    if (typeof value === 'string') {
        return value;
    }

    if (isPlainObject(value)) {
        if (typeof value.fallback === 'string' && value.fallback.trim()) {
            return value.fallback;
        }

        if (typeof value.id === 'string' && value.id.trim()) {
            return value.id;
        }
    }

    return '';
}

function buildRenderGeneratorStyleSharedModificationIdComputation(variantId, variant, structurePreviewDirection) {
    const previewDirection = normalizeId(variant?.previewDirection) || normalizeId(structurePreviewDirection) || 'se';
    const variantIdInput = createSharedModificationHashDiagnosticInput(variantId);
    const templateActorPathInput = createSharedModificationHashDiagnosticInput(variant?.templateActorPath);
    const templateMeshPathInput = createSharedModificationHashDiagnosticInput(variant?.templateMeshPath);
    const previewMeshPathInput = createSharedModificationHashDiagnosticInput(variant?.previewMeshPath);
    const nameInput = createSharedModificationHashDiagnosticInput(getStandaloneModificationIdentityText(variant?.name));
    const descriptionInput = createSharedModificationHashDiagnosticInput(getStandaloneModificationIdentityText(variant?.description));
    const previewDirectionInput = createSharedModificationHashDiagnosticInput(previewDirection);
    const identity = [
        variantIdInput.normalized,
        templateActorPathInput.normalized,
        templateMeshPathInput.normalized,
        previewMeshPathInput.normalized,
        nameInput.normalized,
        descriptionInput.normalized,
        previewDirectionInput.normalized,
    ].join('|');
    const normalizedVariantId = normalizeStandaloneModificationKeyComponent(variantId);
    const fullHashHex = createHash('sha256').update(identity).digest('hex');
    const truncatedHashHex = fullHashHex.slice(0, 12);
    return {
        previewDirection,
        variantIdInput,
        templateActorPathInput,
        templateMeshPathInput,
        previewMeshPathInput,
        nameInput,
        descriptionInput,
        previewDirectionInput,
        identity,
        normalizedVariantId,
        fullHashHex,
        truncatedHashHex,
        generatedSharedModificationId: normalizedVariantId ? `${normalizedVariantId}-${truncatedHashHex}` : truncatedHashHex,
    };
}

function createRenderGeneratorStyleSharedModificationId(variantId, variant, structurePreviewDirection, diagnosticsContext = null) {
    const computation = buildRenderGeneratorStyleSharedModificationIdComputation(variantId, variant, structurePreviewDirection);
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
            inputs: {
                variantId: computation.variantIdInput,
                templateActorPath: computation.templateActorPathInput,
                templateMeshPath: computation.templateMeshPathInput,
                previewMeshPath: computation.previewMeshPathInput,
                name: computation.nameInput,
                description: computation.descriptionInput,
                previewDirection: computation.previewDirectionInput,
            },
        });
    }

    return computation.generatedSharedModificationId;
}

function hasStandaloneModificationContentHashSuffix(value) {
    return /-[a-f0-9]{12}(?:-\d+)?$/.test(normalizeId(value));
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
            const metadata = await sharp(filePath).metadata();
            const width = Number(metadata.width ?? 0);
            const height = Number(metadata.height ?? 0);
            if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
                return false;
            }

            const { data } = await sharp(filePath)
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

async function hasPublishedDestroyedVisual(structure) {
    const destroyedSourceUrl = structure?.destroyed?.sprite?.source ?? structure?.destroyed?.textureUrl ?? null;
    if (await hasVisiblePublishedAssetUrl(destroyedSourceUrl)) {
        return true;
    }

    const structureId = normalizeId(structure?.id);
    if (!structureId) {
        return false;
    }

    const destroyedTextureFilePath = getPublishedStructureVariantTextureFilePath(structureId, 'destroyed');
    if (!destroyedTextureFilePath || !await pathExists(destroyedTextureFilePath)) {
        return false;
    }

    return await imageFileHasVisiblePixels(destroyedTextureFilePath);
}

async function stripUnavailableDestroyedVisuals(manifest) {
    return foxholeManifestSchema.parse({
        ...manifest,
        assets: await Promise.all((manifest?.assets ?? []).map(async structure => {
            if (!structure?.destroyed) {
                return structure;
            }

            if (await hasPublishedDestroyedVisual(structure)) {
                return structure;
            }

            const { destroyed, ...structureWithoutDestroyed } = structure;
            return structureWithoutDestroyed;
        })),
    });
}

async function readImageDimensions(filePath) {
    try {
        const metadata = await sharp(filePath).metadata();
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
        const offsetX = Number(parsed.offsetXPixels ?? parsed.offsetX ?? NaN);
        const offsetY = Number(parsed.offsetYPixels ?? parsed.offsetY ?? NaN);

        if (typeof parsed.mode === 'string' && parsed.mode.trim().toLowerCase() !== 'topdown') {
            return null;
        }

        return {
            width: Number.isFinite(width) && width > 0 ? width : null,
            height: Number.isFinite(height) && height > 0 ? height : null,
            anchorX: Number.isFinite(anchorPixelX) && Number.isFinite(width) && width > 0
                ? anchorPixelX / width
                : null,
            anchorY: Number.isFinite(anchorPixelY) && Number.isFinite(height) && height > 0
                ? anchorPixelY / height
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
    if (!layerId || !normalizedStructureId) {
        return;
    }

    structureLayerEntriesByStructureId[normalizedStructureId] ??= {};
    const entry = structureLayerEntriesByStructureId[normalizedStructureId][layerId] ?? { id: layerId };
    entry.textureUrl = publicPath;
    await applyTextureMetadata(entry, filePath, 'width', 'height');
    structureLayerEntriesByStructureId[normalizedStructureId][layerId] = entry;
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

async function collectAssetRenderEntries(entriesByKey, modificationEntriesByKey, modificationEntriesByAssetId, structureLayerEntriesByStructureId, sharedPackagingEntriesByKey, filePath) {
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
        const key = normalizeId(fileName.slice(0, -'.destroyed.icon.default.webp'.length));
        entriesByKey[key] ??= {};
        entriesByKey[key].destroyed ??= {};
        assignIconRenderUrl(entriesByKey[key].destroyed, publicPath, 'default');
        return;
    }

    if (normalized.endsWith('.destroyed.texture.webp')) {
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

async function buildStructureRenderEntries(manifest, scopedTargets = null) {
    const entriesByKey = {};
    const modificationEntriesByKey = {};
    const modificationEntriesByAssetId = {};
    const structureLayerEntriesByStructureId = {};
    const sharedPackagingEntriesByKey = {};
    const candidateDirectories = [assetTypesDirectory, sharedAssetsDirectory];
    if (!(await Promise.all(candidateDirectories.map(directory => pathExists(directory)))).some(Boolean)) {
        return {
            entriesByKey,
            modificationEntriesByKey,
            modificationEntriesByAssetId,
            structureLayerEntriesByStructureId,
            sharedPackagingEntriesByKey,
        };
    }

    for (const directory of candidateDirectories) {
        if (!await pathExists(directory)) {
            continue;
        }

        for await (const filePath of walkFiles(directory)) {
            if (!matchesScopedRawRenderedAssetTargets(scopedTargets, filePath)) {
                continue;
            }

            await collectAssetRenderEntries(
                entriesByKey,
                modificationEntriesByKey,
                modificationEntriesByAssetId,
                structureLayerEntriesByStructureId,
                sharedPackagingEntriesByKey,
                filePath,
            );
        }
    }

    await applySharedModificationConsumerEntries(modificationEntriesByKey, modificationEntriesByAssetId);
    applyUpgradeStructureConsumerEntries(manifest, entriesByKey, modificationEntriesByAssetId);

    return {
        entriesByKey,
        modificationEntriesByKey,
        modificationEntriesByAssetId,
        structureLayerEntriesByStructureId,
        sharedPackagingEntriesByKey,
    };
}

function cloneRenderEntry(entry) {
    return entry ? { ...entry } : entry;
}

async function applySharedModificationConsumerEntries(modificationEntriesByKey, modificationEntriesByAssetId) {
    if (!await pathExists(renderScenesIndexPath)) {
        return;
    }

    let renderScenesIndexDocument;
    try {
        renderScenesIndexDocument = JSON.parse(await readFile(renderScenesIndexPath, 'utf8'));
    } catch (error) {
        console.warn(`failed to read render scene index from ${renderScenesIndexPath}: ${error}`);
        return;
    }

    for (const entry of renderScenesIndexDocument?.scenes ?? []) {
        const structureId = normalizeId(entry?.structureId);
        const consumers = Array.isArray(entry?.consumers) ? entry.consumers : [];
        if (consumers.length === 0) {
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
                console.log(`removed stale artifact ${outputPath}`);
            }
        }
    }
}

async function removeStaleStructureArtifactDirectories(manifest) {
    const structureIds = new Set((manifest?.assets ?? [])
        .map(structure => normalizeId(structure?.id))
        .filter(Boolean));

    for (const structureId of structureIds) {
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
            console.log(`removed stale artifact directory ${directory}`);
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
        console.log(`removed stale shared artifact directory ${directory}`);
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
            console.log(`removed orphan published asset directory ${directory}`);
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
            console.log(`removed structure artifact directory ${directory}`);
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
                console.log(`removed legacy typed artifact ${outputPath}`);
            }
        }
    }

    const legacySharedModsDirectory = resolve(assetTypesDirectory, 'structures', 'mods');
    if (await pathExists(legacySharedModsDirectory)) {
        await rm(legacySharedModsDirectory, { recursive: true, force: true });
        console.log(`removed legacy typed artifact directory ${legacySharedModsDirectory}`);
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
        console.log(`removed legacy shared modification artifact directory ${sharedModificationPath}`);
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

async function removeUnreferencedGeneratedModificationArtifactDirectories(manifest) {
    const referencedDirectories = collectReferencedPublicAssetDirectories(manifest);
    const structureIds = new Set((manifest?.assets ?? [])
        .map(structure => normalizeId(structure?.id))
        .filter(Boolean));

    for (const structureId of structureIds) {
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
            if (hasReferencedArtifactDirectory(referencedDirectories, candidateDirectory)) {
                continue;
            }

            await rm(candidateDirectory, { recursive: true, force: true });
            console.log(`removed unreferenced modification artifact directory ${candidateDirectory}`);
        }
    }

    const sharedModificationsDirectory = resolve(sharedAssetsDirectory, 'modifications');
    if (!await pathExists(sharedModificationsDirectory)) {
        return;
    }

    const sharedEntries = await readdir(sharedModificationsDirectory, { withFileTypes: true });
    for (const entry of sharedEntries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const candidateDirectory = resolve(sharedModificationsDirectory, entry.name);
        if (hasReferencedArtifactDirectory(referencedDirectories, candidateDirectory)) {
            continue;
        }

        await rm(candidateDirectory, { recursive: true, force: true });
        console.log(`removed unreferenced shared modification artifact directory ${candidateDirectory}`);
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

    let suffix = 2;
    while (usedSharedModificationIds.has(`${baseId}-${suffix}`)) {
        suffix += 1;
    }

    const resolvedId = `${baseId}-${suffix}`;
    usedSharedModificationIds.add(resolvedId);
    if (diagnosticsContext) {
        recordSharedModificationHashDiagnostic({
            kind: 'shared-modification-id-collision-resolved',
            ...cloneSharedModificationHashDiagnosticValue(diagnosticsContext),
            preferredSharedModificationId,
            normalizedPreferredSharedModificationId: normalizedPreferredId,
            signature,
            fullHashHex,
            truncatedHashHex: hash,
            hasSinglePreferredHash,
            normalizedPreferredBaseId,
            baseId,
            resolvedSharedModificationId: resolvedId,
            collisionSuffix: suffix,
        });
    }

    return resolvedId;
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
    const hasDefaultIcon = Boolean(sourceIcons.default);
    const hasRenderedVisual = Boolean(sourceIcons.rendered || variant.previewUrl || sourceSprite.source);
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
                    ...(hasRenderedVisual
                        ? { rendered: createGeneratedSharedModificationAssetUrl(sharedModificationId, '.icon.rendered') }
                        : {}),
                },
            }
            : {}),
        ...(hasRenderedVisual
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
                if (variant?.isUpgrade === true) {
                    const { sharedModificationId: _sharedModificationId, ...localVariant } = variant ?? {};
                    return [variantId, localVariant];
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
                const preferredSharedModificationId = normalizedVariantSharedModificationId
                    || createFallbackSharedModificationId(
                        variantId,
                        localVariantPayload,
                        localVariantPayloadSignature,
                        {
                            ...baseDiagnosticsContext,
                            localVariantPayloadSignature,
                        },
                    );
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

function compareStructureRenderLayers(left, right) {
    const orderById = new Map([
        ['floor', 0],
        ['walls', 1],
        ['corners', 2],
        ['backtrim', 10],
        ['span', 11],
        ['fronttrim', 12],
    ]);
    const leftOrder = orderById.get(normalizeId(left?.id)) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderById.get(normalizeId(right?.id)) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
    }

    return String(left?.id ?? '').localeCompare(String(right?.id ?? ''));
}

async function buildStructureSceneMetadata() {
    const metadataByKey = new Map();
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

function applyStructureRenderUrls(
    manifest,
    entriesByKey,
    structureSceneMetadata,
    modificationEntriesByKey,
    modificationEntriesByAssetId,
    structureLayerEntriesByStructureId,
    sharedPackagingEntriesByKey,
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
                const structureDefaultIconUrl = structure?.icons?.default ?? structure?.iconUrl ?? null;
                const resolvedStructureDefaultIconUrl = structureDefaultIconUrl
                    ?? renderEntry?.defaultIconUrl
                    ?? null;
                const structureRenderedIconUrl = defaultStructureColor?.renderedIconUrl ?? structure?.icons?.rendered ?? structure?.previewIconUrl ?? resolvedStructureDefaultIconUrl;
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
                const destroyedDefaultIconUrl = structure?.destroyed?.icons?.default
                    ?? structure?.destroyed?.iconUrl
                    ?? structureDefaultIconUrl
                    ?? destroyedRenderEntry?.defaultIconUrl
                    ?? null;
                const destroyedRenderedIconUrl = destroyedRenderEntry?.renderedIconUrl ?? structure?.destroyed?.icons?.rendered ?? structure?.destroyed?.previewIconUrl ?? destroyedDefaultIconUrl;
                const destroyedPreviewUrl = destroyedRenderEntry?.previewUrl ?? structure?.destroyed?.previewUrl ?? null;
                const destroyedTextureUrl = destroyedRenderEntry?.textureUrl ?? structure?.destroyed?.sprite?.source ?? structure?.destroyed?.textureUrl ?? null;
                const destroyedPreviewDirection = destroyedRenderEntry?.previewDirection ?? structure?.destroyed?.previewDirection ?? null;
                // Some vehicles expose a destroyed component without any renderable destroyed texture.
                // Drop the entire destroyed payload unless we can emit a destroyed sprite block.
                const hasPublishedDestroyedVisual = Boolean(destroyedTextureUrl);
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
                const renderLayers = Object.values(structureLayerEntries)
                    .filter(entry => entry?.textureUrl)
                    .sort(compareStructureRenderLayers);

                return {
                    ...structureWithoutLegacyIcons,
                    icons: {
                        default: resolvedStructureDefaultIconUrl,
                        rendered: renderEntry?.renderedIconUrl ?? structureRenderedIconUrl ?? meshlessFallbackUrl,
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
                    previewUrl,
                    previewDirection,
                    ...(structureColors.length > 0 ? { colors: structureColors } : {}),
                    renderLayers: renderLayers.length > 0
                        ? renderLayers.map(entry => ({
                            id: entry.id,
                            textureUrl: entry.textureUrl,
                            ...(entry?.width ? { width: entry.width } : {}),
                            ...(entry?.height ? { height: entry.height } : {}),
                            ...(entry?.anchorX !== null && typeof entry?.anchorX !== 'undefined' ? { anchorX: entry.anchorX } : {}),
                            ...(entry?.anchorY !== null && typeof entry?.anchorY !== 'undefined' ? { anchorY: entry.anchorY } : {}),
                            ...(entry?.offsetX !== null && typeof entry?.offsetX !== 'undefined' ? { offsetX: entry.offsetX } : {}),
                            ...(entry?.offsetY !== null && typeof entry?.offsetY !== 'undefined' ? { offsetY: entry.offsetY } : {}),
                        }))
                        : structure.renderLayers,
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
                        ...(defaultTextureUrl ? { default: { textureUrl: defaultTextureUrl } } : {}),
                        ...(colonialTextureUrl && colonialTextureUrl !== defaultTextureUrl ? { c: { textureUrl: colonialTextureUrl } } : {}),
                        ...(wardenTextureUrl && wardenTextureUrl !== defaultTextureUrl ? { w: { textureUrl: wardenTextureUrl } } : {}),
                    },
                    modifications: Object.fromEntries(Object.entries(structure.modifications ?? {}).map(([modificationId, modification]) => {
                        const modificationLookupKey = normalizeId(modification?.appliedModificationId ?? modificationId);
                        const renderEntry = modificationEntriesByAssetId?.[normalizeId(structure.id)]?.[modificationLookupKey] ?? null;
                        const preferredSharedModificationId = modification?.isUpgrade === true
                            ? null
                            : resolvePreferredSharedModificationId(
                                modification?.sharedModificationId ?? renderEntry?.sharedModificationId ?? null,
                                modificationLookupKey || modificationId,
                                modification,
                                renderEntry?.previewDirection ?? modification?.previewDirection ?? structure?.previewDirection,
                            );
                        return [modificationId, {
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
                            ...(preferredSharedModificationId ? { sharedModificationId: preferredSharedModificationId } : {}),
                        }];
                    })),
                    modificationSlots: (structure.modificationSlots ?? []).map(slot => ({
                        ...slot,
                        variants: Object.fromEntries(Object.entries(slot.variants ?? {}).map(([variantId, variant]) => {
                            const sourceModificationEntry = resolveSourceModification(structure, variantId, variant);
                            const sourceModification = sourceModificationEntry?.[1] ?? null;
                            const assetScopedEntries = modificationEntriesByAssetId?.[normalizeId(structure.id)] ?? {};
                            const assetScopedLookupKeys = [
                                variantId,
                                variant?.id,
                                variant?.appliedModificationId,
                            ]
                                .map(normalizeId)
                                .filter(Boolean);
                            const renderEntry = assetScopedLookupKeys
                                .map(lookupKey => assetScopedEntries?.[lookupKey])
                                .find(Boolean)
                                ?? modificationEntriesByKey?.[normalizeId(variantId)];
                            const preferredSharedModificationId = normalizeId(variantId) === 'default' || variant?.isUpgrade === true || sourceModification?.isUpgrade === true
                                ? null
                                : resolvePreferredSharedModificationId(
                                    variant?.sharedModificationId ?? sourceModification?.sharedModificationId ?? renderEntry?.sharedModificationId ?? null,
                                    variantId,
                                    {
                                        ...sourceModification,
                                        ...variant,
                                    },
                                    renderEntry?.previewDirection
                                    ?? variant?.previewDirection
                                    ?? sourceModification?.previewDirection
                                    ?? structure?.previewDirection,
                                );
                            return [variantId, {
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
                                ...(renderEntry?.isUpgrade ? { isUpgrade: true } : {}),
                                ...(renderEntry?.upgradeName ? { upgradeName: renderEntry.upgradeName } : {}),
                                ...(renderEntry?.parentStructureId ? { parentStructureId: renderEntry.parentStructureId } : {}),
                                ...(renderEntry?.rootStructureId ? { rootStructureId: renderEntry.rootStructureId } : {}),
                                ...(renderEntry?.appliedModificationId ? { appliedModificationId: renderEntry.appliedModificationId } : {}),
                                ...(preferredSharedModificationId ? { sharedModificationId: preferredSharedModificationId } : {}),
                            }];
                        })),
                    })),
                };
            }),
    });
}

function stripPublishedModificationSlotNoise(manifest, modificationEntriesByKey, modificationEntriesByAssetId) {
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
                    const assetScopedLookupKeys = [
                        variantId,
                        variant?.modificationId,
                        variant?.appliedModificationId,
                        sourceModificationId,
                    ]
                        .map(normalizeId)
                        .filter(Boolean);
                    const renderEntry = assetScopedLookupKeys
                        .map(lookupKey => assetScopedEntries?.[lookupKey])
                        .find(Boolean)
                        ?? modificationEntriesByKey?.[normalizeId(variantId)]
                        ?? null;
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
                        ?? sourceModification?.icons?.default
                        ?? sourceModification?.iconUrl
                        ?? targetStructure?.icons?.default
                        ?? targetStructure?.iconUrl
                        ?? renderEntry?.defaultIconUrl
                        ?? null;
                    const renderedIconUrl = renderEntry?.renderedIconUrl
                        ?? renderEntry?.iconUrl
                        ?? targetStructure?.icons?.rendered
                        ?? targetStructure?.previewIconUrl
                        ?? targetStructure?.previewUrl
                        ?? variant?.icons?.rendered
                        ?? sourceModification?.iconUrl
                        ?? defaultIconUrl;
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

                    const preferredSharedModificationId = variant?.isUpgrade === true || sourceModification?.isUpgrade === true
                        ? null
                        : resolvePreferredSharedModificationId(
                            variant?.sharedModificationId ?? sourceModification?.sharedModificationId ?? renderEntry?.sharedModificationId ?? null,
                            variantId,
                            {
                                ...sourceModification,
                                ...variant,
                                name: getStandaloneModificationIdentityText(variant?.name)
                                    || getStandaloneModificationIdentityText(sourceModification?.name),
                                description: getStandaloneModificationIdentityText(variant?.description)
                                    || getStandaloneModificationIdentityText(sourceModification?.description),
                            },
                            renderEntry?.previewDirection
                            ?? variant?.previewDirection
                            ?? sourceModification?.previewDirection
                            ?? structure?.previewDirection,
                            {
                                structureId: normalizeId(structure?.id),
                                structureCodeName: structure?.codeName ?? null,
                                slotName: slot?.name ?? null,
                                variantId,
                                variantSharedModificationId: variant?.sharedModificationId ?? null,
                                sourceModificationSharedModificationId: sourceModification?.sharedModificationId ?? null,
                                renderEntrySharedModificationId: renderEntry?.sharedModificationId ?? null,
                                variantPreviewDirection: variant?.previewDirection ?? null,
                                sourceModificationPreviewDirection: sourceModification?.previewDirection ?? null,
                                renderEntryPreviewDirection: renderEntry?.previewDirection ?? null,
                                structurePreviewDirection: structure?.previewDirection ?? null,
                                variantSnapshot: cloneSharedModificationHashDiagnosticValue({
                                    templateActorPath: variant?.templateActorPath ?? sourceModification?.templateActorPath ?? null,
                                    templateMeshPath: variant?.templateMeshPath ?? sourceModification?.templateMeshPath ?? null,
                                    previewMeshPath: variant?.previewMeshPath ?? sourceModification?.previewMeshPath ?? null,
                                    name: getStandaloneModificationIdentityText(variant?.name)
                                        || getStandaloneModificationIdentityText(sourceModification?.name)
                                        || null,
                                    description: getStandaloneModificationIdentityText(variant?.description)
                                        || getStandaloneModificationIdentityText(sourceModification?.description)
                                        || null,
                                }),
                            },
                        );
                    const parentStructureId = normalizeId(variant?.parentStructureId ?? sourceModification?.parentStructureId);
                    const rootStructureId = normalizeId(variant?.rootStructureId ?? sourceModification?.rootStructureId);
                    const appliedModificationId = normalizeId(variant?.appliedModificationId ?? sourceModification?.appliedModificationId);
                    const upgradeName = getLocalizedTextFallback(targetStructure?.name)
                        || variant?.upgradeName
                        || sourceModification?.upgradeName
                        || null;
                    const previewUrl = renderEntry?.previewUrl
                        ?? variant?.previewUrl
                        ?? sourceModification?.previewUrl
                        ?? targetStructure?.previewUrl
                        ?? targetStructure?.previewIconUrl
                        ?? targetStructure?.icons?.rendered
                        ?? null;
                    const previewDirection = renderEntry?.previewDirection
                        ?? variant?.previewDirection
                        ?? sourceModification?.previewDirection
                        ?? targetStructure?.previewDirection
                        ?? null;

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
                        ...(variant?.isUpgrade === true || sourceModification?.isUpgrade === true ? { isUpgrade: true } : {}),
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

async function coLocateFallbackStructureAssets(manifest, generatedDirectory, sourceManifest = null) {
    const copiedAssetUrls = new Map();
    const sourceStructureById = new Map((sourceManifest?.assets ?? [])
        .map(structure => [normalizeId(structure?.id), structure])
        .filter(([structureId]) => Boolean(structureId)));
    const sourceStructureMetadataById = sourceManifest?.__sourceStructureMetadataById instanceof Map
        ? sourceManifest.__sourceStructureMetadataById
        : new Map();

    function normalizeFileSystemPath(value) {
        return String(value ?? '').replace(/\\/g, '/').toLowerCase();
    }

    function getPublishedAssetFilePath(sourceUrl) {
        if (!String(sourceUrl ?? '').startsWith(createFoxholeAssetsBaseUrl('/'))) {
            return null;
        }

        const sourceRelativePath = sourceUrl.replace(`${createFoxholeAssetsBaseUrl('/')}`, '').replace(/\//g, '\\');
        return resolve(publicFoxholeAssetsDirectory, sourceRelativePath);
    }

    function getCoLocatedStructureAssetFileName(structureId, assetKind) {
        switch (assetKind) {
            case 'destroyed.icon.default':
                return `${structureId}.destroyed.icon.default.webp`;
            case 'destroyed.icon.rendered':
                return `${structureId}.destroyed.icon.rendered.webp`;
            case 'destroyed.preview':
                return `${structureId}.destroyed.preview.webp`;
            case 'destroyed.texture':
                return `${structureId}.destroyed.texture.webp`;
            case 'icon.rendered':
                return `${structureId}.icon.rendered.webp`;
            case 'preview':
                return `${structureId}.preview.webp`;
            case 'texture':
                return `${structureId}.texture.webp`;
            case 'icon.default':
            default:
                return `${structureId}.icon.default.webp`;
        }
    }

    function getCoLocatedStructureAssetOutputPath(structureId, assetKind) {
        const outputDirectory = getPublishedAssetDirectory(structureId) ?? resolve(assetTypesDirectory, 'structures', structureId);
        return resolve(outputDirectory, getCoLocatedStructureAssetFileName(structureId, assetKind));
    }

    function isSubtypeComposableStructureAssetKind(assetKind) {
        switch (assetKind) {
            case 'icon.default':
            case 'icon.rendered':
            case 'destroyed.icon.default':
            case 'destroyed.icon.rendered':
                return true;
            default:
                return false;
        }
    }

    async function readCoLocatedAssetSourceFile(sourceUrl) {
        const normalizedSourceUrl = String(sourceUrl ?? '').trim();
        if (!normalizedSourceUrl) {
            throw new Error('missing co-located asset source url');
        }

        if (isSharedPublishedIconUrl(normalizedSourceUrl)) {
            try {
                return await readPublishedIconSourceFile(generatedDirectory, normalizedSourceUrl);
            } catch (error) {
                const persistedSourceFilePath = getPublishedAssetFilePath(normalizedSourceUrl);
                if (persistedSourceFilePath && await pathExists(persistedSourceFilePath)) {
                    return {
                        sourceFilePath: persistedSourceFilePath,
                        content: await readFileWithRetries(persistedSourceFilePath),
                    };
                }

                throw error;
            }
        }

        const sourceFilePath = getPublishedAssetFilePath(normalizedSourceUrl);
        if (sourceFilePath) {
            const rawRenderedSourceFilePath = await resolveRawRenderedAssetSourceInputPathForPublishedOutput(sourceFilePath);
            const effectiveSourceFilePath = rawRenderedSourceFilePath ?? sourceFilePath;
            return {
                sourceFilePath: effectiveSourceFilePath,
                content: await readImageContentAsWebp(effectiveSourceFilePath),
            };
        }

        return readPublishedIconSourceFile(generatedDirectory, normalizedSourceUrl);
    }

    async function buildCoLocatedDefaultIconContent(sourceUrl, subTypeIconUrl, assetKind = 'icon.default') {
        const source = await readCoLocatedAssetSourceFile(sourceUrl);
        const normalizedSubTypeIconUrl = String(subTypeIconUrl ?? '').trim();
        if (!normalizedSubTypeIconUrl) {
            return source;
        }

        try {
            const subTypeIconSource = await readCoLocatedAssetSourceFile(normalizedSubTypeIconUrl);
            return {
                sourceFilePath: source.sourceFilePath,
                subTypeSourceFilePath: subTypeIconSource.sourceFilePath,
                content: await composeSubtypeIcon(
                    source.content,
                    subTypeIconSource.content,
                    resolveSubtypeComposedAssetWebpOptions(assetKind),
                ),
            };
        } catch (error) {
            console.warn(`failed to compose subtype icon ${normalizedSubTypeIconUrl} onto ${sourceUrl}: ${error}`);
            return source;
        }
    }

    async function getFileModifiedTime(filePath) {
        try {
            return (await stat(filePath)).mtimeMs;
        } catch {
            return null;
        }
    }

    function getSamePathSubtypeCompositionStatePath(outputFilePath) {
        const outputPathKey = createHash('sha1')
            .update(normalizeFileSystemPath(outputFilePath))
            .digest('hex');
        return resolve(samePathSubtypeCompositionStateDirectory, `${outputPathKey}.json`);
    }

    async function readSamePathSubtypeCompositionState(outputFilePath) {
        const statePath = getSamePathSubtypeCompositionStatePath(outputFilePath);
        try {
            return JSON.parse(await readFileWithRetries(statePath, 'utf8'));
        } catch {
            return null;
        }
    }

    async function writeSamePathSubtypeCompositionState(outputFilePath, subTypeSourceFilePath, baseSourceFilePath = null) {
        const outputModifiedTimeMs = await getFileModifiedTime(outputFilePath);
        if (!Number.isFinite(outputModifiedTimeMs)) {
            return;
        }

        const normalizedSubTypeSourceFilePath = normalizeFileSystemPath(subTypeSourceFilePath);
        const subTypeSourceModifiedTimeMs = await getFileModifiedTime(subTypeSourceFilePath);
        const normalizedBaseSourceFilePath = baseSourceFilePath
            ? normalizeFileSystemPath(baseSourceFilePath)
            : null;
        const baseSourceModifiedTimeMs = baseSourceFilePath
            ? await getFileModifiedTime(baseSourceFilePath)
            : null;
        const statePath = getSamePathSubtypeCompositionStatePath(outputFilePath);
        await mkdir(dirname(statePath), { recursive: true });
        await writeFileWithRetries(statePath, JSON.stringify({
            outputFilePath: normalizeFileSystemPath(outputFilePath),
            outputModifiedTimeMs,
            subTypeSourceFilePath: normalizedSubTypeSourceFilePath,
            subTypeSourceModifiedTimeMs: Number.isFinite(subTypeSourceModifiedTimeMs)
                ? subTypeSourceModifiedTimeMs
                : null,
            baseSourceFilePath: normalizedBaseSourceFilePath,
            baseSourceModifiedTimeMs: Number.isFinite(baseSourceModifiedTimeMs)
                ? baseSourceModifiedTimeMs
                : null,
        }));
    }

    function hasFreshSamePathSubtypeCompositionState(
        state,
        outputFilePath,
        outputModifiedTimeMs,
        subTypeSourceFilePath,
        subTypeSourceModifiedTimeMs,
        baseSourceFilePath,
        baseSourceModifiedTimeMs,
    ) {
        if (!state || !Number.isFinite(outputModifiedTimeMs)) {
            return false;
        }

        return state.outputFilePath === normalizeFileSystemPath(outputFilePath)
            && state.outputModifiedTimeMs === outputModifiedTimeMs
            && state.subTypeSourceFilePath === normalizeFileSystemPath(subTypeSourceFilePath)
            && (state.subTypeSourceModifiedTimeMs ?? null) === (Number.isFinite(subTypeSourceModifiedTimeMs)
                ? subTypeSourceModifiedTimeMs
                : null)
            && (state.baseSourceFilePath ?? null) === (baseSourceFilePath
                ? normalizeFileSystemPath(baseSourceFilePath)
                : null)
            && (state.baseSourceModifiedTimeMs ?? null) === (Number.isFinite(baseSourceModifiedTimeMs)
                ? baseSourceModifiedTimeMs
                : null);
    }

    async function ensureSubtypeCompositedCoLocatedStructureAssetUrl(structureId, assetKind, subTypeIconUrl, baseSourceUrl = null) {
        const normalizedSubTypeIconUrl = String(subTypeIconUrl ?? '').trim();
        const normalizedBaseSourceUrl = String(baseSourceUrl ?? '').trim();
        const outputFilePath = getCoLocatedStructureAssetOutputPath(structureId, assetKind);
        if (!isSubtypeComposableStructureAssetKind(assetKind)
            || !normalizedSubTypeIconUrl
            || !await pathExists(outputFilePath)) {
            return null;
        }

        const outputUrl = toPublicFoxholeAssetUrl(outputFilePath);
        if (skipExistingAssets) {
            return outputUrl;
        }

        if (!normalizedBaseSourceUrl) {
            return outputUrl;
        }

        try {
            const baseSource = await readCoLocatedAssetSourceFile(normalizedBaseSourceUrl);
            if (normalizeFileSystemPath(baseSource.sourceFilePath) === normalizeFileSystemPath(outputFilePath)) {
                return outputUrl;
            }

            const subTypeIconSource = await readCoLocatedAssetSourceFile(normalizedSubTypeIconUrl);
            const outputModifiedTimeMs = await getFileModifiedTime(outputFilePath);
            const baseSourceModifiedTimeMs = await getFileModifiedTime(baseSource.sourceFilePath);
            const subTypeSourceModifiedTimeMs = await getFileModifiedTime(subTypeIconSource.sourceFilePath);
            const existingState = await readSamePathSubtypeCompositionState(outputFilePath);
            if (hasFreshSamePathSubtypeCompositionState(
                existingState,
                outputFilePath,
                outputModifiedTimeMs,
                subTypeIconSource.sourceFilePath,
                subTypeSourceModifiedTimeMs,
                baseSource.sourceFilePath,
                baseSourceModifiedTimeMs,
            )) {
                return outputUrl;
            }

            const composed = await buildCoLocatedDefaultIconContent(normalizedBaseSourceUrl, normalizedSubTypeIconUrl, assetKind);
            if (!composed.subTypeSourceFilePath) {
                return outputUrl;
            }

            await writeFileWithRetries(outputFilePath, composed.content);
            await writeSamePathSubtypeCompositionState(outputFilePath, composed.subTypeSourceFilePath, baseSource.sourceFilePath);
            console.log(`co-located ${baseSource.sourceFilePath} -> ${outputFilePath}`);
            return outputUrl;
        } catch (error) {
            console.warn(`failed to compose subtype icon onto ${outputFilePath}: ${error}`);
            return outputUrl;
        }
    }

    async function resolveExistingCoLocatedStructureAssetUrl(structureId, assetKind) {
        const outputFilePath = getCoLocatedStructureAssetOutputPath(structureId, assetKind);
        try {
            await access(outputFilePath);
            return toPublicFoxholeAssetUrl(outputFilePath);
        } catch {
            return null;
        }
    }

    async function resolveCoLocatedStructureAssetUrl(structureId, sourceUrl, assetKind = 'icon.default', subTypeIconUrl = null) {
        const normalizedSourceUrl = String(sourceUrl ?? '').trim();
        const normalizedSubTypeIconUrl = String(subTypeIconUrl ?? '').trim();
        if (!normalizedSourceUrl) {
            return null;
        }

        const publishedSourceFilePath = getPublishedAssetFilePath(normalizedSourceUrl);
        const outputDirectory = getPublishedAssetDirectory(structureId) ?? resolve(assetTypesDirectory, 'structures', structureId);
        const requiresTypedAssetRelocation = Boolean(publishedSourceFilePath)
            && normalizeFileSystemPath(dirname(publishedSourceFilePath)) !== normalizeFileSystemPath(outputDirectory);
        const canComposeFromPublishedAsset = isSubtypeComposableStructureAssetKind(assetKind)
            && Boolean(normalizedSubTypeIconUrl)
            && Boolean(publishedSourceFilePath)
            && await pathExists(publishedSourceFilePath);

        if (!isSharedPublishedIconUrl(normalizedSourceUrl) && !canComposeFromPublishedAsset && !requiresTypedAssetRelocation) {
            return normalizedSourceUrl;
        }

        const cacheKey = `${structureId}|${assetKind}`;
        const cached = copiedAssetUrls.get(cacheKey);
        if (cached) {
            return await cached;
        }

        const pending = (async () => {
            const outputFileName = getCoLocatedStructureAssetFileName(structureId, assetKind);
            const outputFilePath = resolve(outputDirectory, outputFileName);
            const outputUrl = toPublicFoxholeAssetUrl(outputFilePath);
            if (await shouldReuseExistingAssetOutput(outputFilePath)) {
                return outputUrl;
            }

            const rawRenderedSourceFilePath = publishedSourceFilePath
                ? await resolveRawRenderedAssetSourceInputPathForPublishedOutput(publishedSourceFilePath)
                : null;

            if (normalizedSourceUrl === outputUrl && !rawRenderedSourceFilePath && await pathExists(outputFilePath)) {
                return outputUrl;
            }

            await mkdir(outputDirectory, { recursive: true });

            try {
                const { sourceFilePath, content } = isSubtypeComposableStructureAssetKind(assetKind)
                    ? await buildCoLocatedDefaultIconContent(normalizedSourceUrl, normalizedSubTypeIconUrl, assetKind)
                    : await readCoLocatedAssetSourceFile(normalizedSourceUrl);
                await writeFileWithRetries(outputFilePath, content);
                console.log(`co-located ${sourceFilePath} -> ${outputFilePath}`);
                return outputUrl;
            } catch (error) {
                console.warn(`skipping co-located ${assetKind} for ${structureId} from ${normalizedSourceUrl}: ${error}`);
                return normalizedSourceUrl;
            }
        })();

        copiedAssetUrls.set(cacheKey, pending);
        return await pending;
    }

    async function resolveStructureAssetAliasUrl(structureId, sourceUrl, assetKind = 'icon.default', subTypeIconUrl = null) {
        const normalizedSourceUrl = String(sourceUrl ?? '').trim();
        if (!normalizedSourceUrl) {
            return null;
        }

        const cacheKey = `${structureId}|alias|${assetKind}`;
        const cached = copiedAssetUrls.get(cacheKey);
        if (cached) {
            return await cached;
        }

        const pending = (async () => {
            const outputDirectory = getPublishedAssetDirectory(structureId) ?? resolve(assetTypesDirectory, 'structures', structureId);
            const outputFileName = getCoLocatedStructureAssetFileName(structureId, assetKind);
            const outputFilePath = resolve(outputDirectory, outputFileName);
            const outputUrl = toPublicFoxholeAssetUrl(outputFilePath);

            if (await shouldReuseExistingAssetOutput(outputFilePath)) {
                return outputUrl;
            }

            if (normalizedSourceUrl === outputUrl) {
                return outputUrl;
            }

            await mkdir(outputDirectory, { recursive: true });

            if (!isSharedPublishedIconUrl(normalizedSourceUrl) && !getPublishedAssetFilePath(normalizedSourceUrl)) {
                return normalizedSourceUrl;
            }

            try {
                const source = isSubtypeComposableStructureAssetKind(assetKind)
                    ? await buildCoLocatedDefaultIconContent(normalizedSourceUrl, subTypeIconUrl, assetKind)
                    : await readCoLocatedAssetSourceFile(normalizedSourceUrl);
                await writeFileWithRetries(outputFilePath, source.content);
                console.log(`co-located ${source.sourceFilePath} -> ${outputFilePath}`);
                return outputUrl;
            } catch (error) {
                console.warn(`skipping co-located alias ${assetKind} for ${structureId} from ${normalizedSourceUrl}: ${error}`);
                return normalizedSourceUrl;
            }
        })();

        copiedAssetUrls.set(cacheKey, pending);
        return await pending;
    }

    async function forceCoLocatedStructureAssetFallbackUrl(structureId, sourceUrl, assetKind = 'icon.default', subTypeIconUrl = null) {
        const normalizedSourceUrl = String(sourceUrl ?? '').trim();
        if (!normalizedSourceUrl) {
            return null;
        }
        const outputFilePath = getCoLocatedStructureAssetOutputPath(structureId, assetKind);
        const outputUrl = toPublicFoxholeAssetUrl(outputFilePath);

        if (await shouldReuseExistingAssetOutput(outputFilePath)) {
            return outputUrl;
        }

        if (normalizedSourceUrl === outputUrl && await pathExists(outputFilePath)) {
            return outputUrl;
        }

        await mkdir(dirname(outputFilePath), { recursive: true });

        try {
            const source = isSubtypeComposableStructureAssetKind(assetKind)
                ? await buildCoLocatedDefaultIconContent(normalizedSourceUrl, subTypeIconUrl, assetKind)
                : await readCoLocatedAssetSourceFile(normalizedSourceUrl);
            await writeFileWithRetries(outputFilePath, source.content);
            console.log(`co-located ${source.sourceFilePath} -> ${outputFilePath}`);
            return outputUrl;
        } catch (error) {
            console.warn(`skipping forced co-located ${assetKind} for ${structureId} from ${normalizedSourceUrl}: ${error}`);
            return null;
        }
    }

    async function resolveExistingPublishedStructureAssetUrl(structureId, assetKinds) {
        for (const assetKind of assetKinds) {
            const candidateUrl = await resolveExistingCoLocatedStructureAssetUrl(structureId, assetKind);
            if (candidateUrl) {
                return candidateUrl;
            }
        }

        return null;
    }

    async function syncMissingStructureDefaultIconFallbacks(publishedManifest) {
        for (const structure of publishedManifest.assets ?? []) {
            const sourceStructure = sourceStructureById.get(normalizeId(structure.id)) ?? null;
            const explicitDefaultIconSourceUrl = normalizePublishedIconAssetUrl(String(
                structure.subTypeIconUrl
                    ? (sourceStructure?.iconUrl ?? sourceStructure?.icons?.default ?? '')
                    : (sourceStructure?.icons?.default ?? sourceStructure?.iconUrl ?? ''),
            ).trim()) || null;
            const publishedDefaultIconSourceUrl = normalizePublishedIconAssetUrl(String(
                structure?.icons?.default ?? structure?.iconUrl ?? '',
            ).trim()) || null;
            const authoritativeDefaultIconSourceUrl = publishedDefaultIconSourceUrl ?? explicitDefaultIconSourceUrl;

            if (authoritativeDefaultIconSourceUrl) {
                const existingDefaultIconUrl = await resolveExistingCoLocatedStructureAssetUrl(structure.id, 'icon.default');
                if (existingDefaultIconUrl) {
                    await ensureSubtypeCompositedCoLocatedStructureAssetUrl(
                        structure.id,
                        'icon.default',
                        structure.subTypeIconUrl,
                        authoritativeDefaultIconSourceUrl,
                    );
                } else {
                    await resolveCoLocatedStructureAssetUrl(
                        structure.id,
                        authoritativeDefaultIconSourceUrl,
                        'icon.default',
                        structure.subTypeIconUrl,
                    );
                }
            }

            if (!structure.destroyed) {
                continue;
            }

            const explicitDestroyedDefaultIconSourceUrl = normalizePublishedIconAssetUrl(String(
                sourceStructure?.destroyed?.icons?.default
                ?? sourceStructure?.destroyed?.iconUrl
                ?? explicitDefaultIconSourceUrl
                ?? sourceStructure?.icons?.default
                ?? sourceStructure?.iconUrl
                ?? '',
            ).trim()) || null;
            const publishedDestroyedDefaultIconSourceUrl = normalizePublishedIconAssetUrl(String(
                structure?.destroyed?.icons?.default
                ?? structure?.destroyed?.iconUrl
                ?? '',
            ).trim()) || null;
            const authoritativeDestroyedDefaultIconSourceUrl = publishedDestroyedDefaultIconSourceUrl ?? explicitDestroyedDefaultIconSourceUrl;

            if (!authoritativeDestroyedDefaultIconSourceUrl) {
                continue;
            }

            const existingDestroyedDefaultIconUrl = await resolveExistingCoLocatedStructureAssetUrl(structure.id, 'destroyed.icon.default');
            if (existingDestroyedDefaultIconUrl) {
                await ensureSubtypeCompositedCoLocatedStructureAssetUrl(
                    structure.id,
                    'destroyed.icon.default',
                    structure.subTypeIconUrl ?? defaultWreckedSubtypeIconUrl,
                    authoritativeDestroyedDefaultIconSourceUrl,
                );
            } else {
                await resolveCoLocatedStructureAssetUrl(
                    structure.id,
                    authoritativeDestroyedDefaultIconSourceUrl,
                    'destroyed.icon.default',
                    structure.subTypeIconUrl ?? defaultWreckedSubtypeIconUrl,
                );
            }
        }
    }

    async function resolveCoLocatedModificationAssetUrl(structureId, variantId, sourceUrl, renderedIconUrl, textureUrl, previewUrl, subTypeIconUrl = null) {
        if (!isSharedPublishedIconUrl(sourceUrl)) {
            return sourceUrl;
        }

        const normalizedStructureId = normalizeId(structureId);
        const normalizedVariantId = normalizeId(variantId);
        if (!normalizedStructureId || !normalizedVariantId) {
            return sourceUrl;
        }

        const cacheKey = `${normalizedStructureId}|${normalizedVariantId}`;
        const cached = copiedAssetUrls.get(cacheKey);
        if (cached) {
            return await cached;
        }

        const pending = (async () => {
            const candidateRenderUrl = [renderedIconUrl, textureUrl, previewUrl, sourceUrl]
                .map(value => String(value ?? '').trim())
                .find(value => value.startsWith(createFoxholeAssetsBaseUrl('/')) && value.includes('/modifications/'));
            const outputDirectory = candidateRenderUrl
                ? dirname(resolve(
                    publicFoxholeAssetsDirectory,
                    candidateRenderUrl
                        .replace(`${createFoxholeAssetsBaseUrl('/')}`, '')
                        .replace(/\//g, '\\'),
                ))
                : resolve(
                    getPublishedAssetDirectory(normalizedStructureId)
                    ?? resolve(assetTypesDirectory, resolvePublishedAssetTypeName(normalizedStructureId), normalizedStructureId),
                    'modifications',
                    normalizedVariantId,
                );

            function getOutputFilePath(assetKind) {
                return resolve(outputDirectory, `${normalizedVariantId}.${assetKind}.webp`);
            }

            const outputFilePath = getOutputFilePath('icon.default');
            const outputUrl = toPublicFoxholeAssetUrl(outputFilePath);

            await mkdir(outputDirectory, { recursive: true });

            try {
                if (!await shouldReuseExistingAssetOutput(outputFilePath)) {
                    const { sourceFilePath, content } = await buildCoLocatedDefaultIconContent(sourceUrl, subTypeIconUrl, 'icon.default');
                    await writeFileWithRetries(outputFilePath, content);
                    console.log(`co-located ${sourceFilePath} -> ${outputFilePath}`);
                }

                for (const [assetKind, assetSourceUrl] of [
                    ['icon.rendered', renderedIconUrl],
                    ['preview', previewUrl],
                    ['texture', textureUrl],
                ]) {
                    const normalizedAssetSourceUrl = String(assetSourceUrl ?? '').trim();
                    if (!normalizedAssetSourceUrl) {
                        continue;
                    }

                    const assetOutputFilePath = getOutputFilePath(assetKind);
                    const assetOutputUrl = toPublicFoxholeAssetUrl(assetOutputFilePath);
                    if (await shouldReuseExistingAssetOutput(assetOutputFilePath)) {
                        continue;
                    }

                    if (normalizedAssetSourceUrl === assetOutputUrl && await pathExists(assetOutputFilePath)) {
                        continue;
                    }

                    try {
                        const source = await readCoLocatedAssetSourceFile(normalizedAssetSourceUrl);
                        await writeFileWithRetries(assetOutputFilePath, source.content);
                        console.log(`co-located ${source.sourceFilePath} -> ${assetOutputFilePath}`);
                    } catch (error) {
                        console.warn(`skipping co-located modification ${assetKind} for ${normalizedStructureId}/${normalizedVariantId} from ${normalizedAssetSourceUrl}: ${error}`);
                    }
                }

                return outputUrl;
            } catch (error) {
                console.warn(`skipping co-located modification icon for ${normalizedStructureId}/${normalizedVariantId} from ${sourceUrl}: ${error}`);
                return sourceUrl;
            }
        })();

        copiedAssetUrls.set(cacheKey, pending);
        return await pending;
    }

    const coLocatedManifest = foxholeManifestSchema.parse({
        ...manifest,
        assets: await Promise.all(manifest.assets.map(async structure => {
            const sourceStructure = sourceStructureById.get(normalizeId(structure.id)) ?? null;
            const sourceStructureMetadata = sourceStructureMetadataById.get(normalizeId(structure.id)) ?? null;
            const { iconUrl: _legacyIconUrl, previewIconUrl: _legacyPreviewIconUrl, ...structureWithoutLegacyIcons } = structure;
            const existingDefaultIconUrl = await resolveExistingCoLocatedStructureAssetUrl(structure.id, 'icon.default');
            const existingRenderedIconUrl = await resolveExistingCoLocatedStructureAssetUrl(structure.id, 'icon.rendered');
            const existingPreviewUrl = await resolveExistingCoLocatedStructureAssetUrl(structure.id, 'preview');
            const existingTextureUrl = await resolveExistingCoLocatedStructureAssetUrl(structure.id, 'texture');
            const existingDestroyedDefaultIconUrl = await resolveExistingCoLocatedStructureAssetUrl(structure.id, 'destroyed.icon.default');
            const existingDestroyedRenderedIconUrl = await resolveExistingCoLocatedStructureAssetUrl(structure.id, 'destroyed.icon.rendered');
            const existingDestroyedPreviewUrl = await resolveExistingCoLocatedStructureAssetUrl(structure.id, 'destroyed.preview');
            const existingDestroyedTextureUrl = await resolveExistingCoLocatedStructureAssetUrl(structure.id, 'destroyed.texture');
            const explicitDefaultIconSourceUrl = normalizePublishedIconAssetUrl(String(
                structure.subTypeIconUrl
                    ? (sourceStructure?.iconUrl ?? sourceStructure?.icons?.default ?? '')
                    : (sourceStructure?.icons?.default ?? sourceStructure?.iconUrl ?? ''),
            ).trim()) || null;
            const publishedDefaultIconSourceUrl = normalizePublishedIconAssetUrl(String(
                structure?.icons?.default ?? structure?.iconUrl ?? '',
            ).trim()) || null;
            const defaultIconSourceUrl = publishedDefaultIconSourceUrl ?? explicitDefaultIconSourceUrl;
            const fallbackIconUrl = defaultIconSourceUrl
                ? (await resolveCoLocatedStructureAssetUrl(
                    structure.id,
                    defaultIconSourceUrl,
                    'icon.default',
                    structure.subTypeIconUrl,
                ) ?? existingDefaultIconUrl)
                : null;
            const fallbackPreviewUrl = await resolveCoLocatedStructureAssetUrl(structure.id, structure.previewUrl, 'preview') ?? existingPreviewUrl;
            const fallbackTextureUrl = await resolveCoLocatedStructureAssetUrl(structure.id, structure.variants.default?.textureUrl, 'texture') ?? existingTextureUrl;
            const renderedSubTypeIconUrl = structure.isDestroyed === true || structure.isBreached === true
                ? structure.subTypeIconUrl
                : null;
            const fallbackRenderedIconUrl = await resolveCoLocatedStructureAssetUrl(
                structure.id,
                structure.icons?.rendered ?? structure.previewIconUrl,
                'icon.rendered',
                renderedSubTypeIconUrl,
            ) ?? existingRenderedIconUrl;
            const defaultFallbackSourceUrl = defaultIconSourceUrl;
            const canPreserveExistingDefaultIcon = Boolean(defaultIconSourceUrl)
                && existingDefaultIconUrl;
            const preservedExistingDefaultIconUrl = canPreserveExistingDefaultIcon
                ? (await ensureSubtypeCompositedCoLocatedStructureAssetUrl(
                    structure.id,
                    'icon.default',
                    structure.subTypeIconUrl,
                    defaultFallbackSourceUrl,
                ) ?? existingDefaultIconUrl)
                : null;
            const ensuredDefaultIconUrl = preservedExistingDefaultIconUrl ?? (defaultIconSourceUrl
                ? (fallbackIconUrl ?? existingDefaultIconUrl)
                : null);
            const destroyedSubTypeIconUrl = structure.destroyed
                ? (structure.subTypeIconUrl ?? defaultWreckedSubtypeIconUrl)
                : null;
            const fallbackDestroyedPreviewUrl = structure.destroyed
                ? (await resolveCoLocatedStructureAssetUrl(
                    structure.id,
                    structure.destroyed?.previewUrl,
                    'destroyed.preview',
                ) ?? existingDestroyedPreviewUrl)
                : null;
            const fallbackDestroyedTextureUrl = structure.destroyed
                ? (await resolveCoLocatedStructureAssetUrl(
                    structure.id,
                    structure.destroyed?.sprite?.source ?? structure.destroyed?.textureUrl,
                    'destroyed.texture',
                ) ?? existingDestroyedTextureUrl)
                : null;
            const destroyedRenderedIconSourceUrl = structure.destroyed?.icons?.rendered
                ?? structure.destroyed?.previewIconUrl
                ?? existingDestroyedRenderedIconUrl
                ?? fallbackDestroyedPreviewUrl
                ?? fallbackDestroyedTextureUrl
                ?? null;
            const fallbackDestroyedRenderedIconUrl = structure.destroyed
                ? (await resolveCoLocatedStructureAssetUrl(
                    structure.id,
                    destroyedRenderedIconSourceUrl,
                    'destroyed.icon.rendered',
                    destroyedSubTypeIconUrl,
                ) ?? existingDestroyedRenderedIconUrl)
                : null;
            const explicitDestroyedDefaultIconSourceUrl = normalizePublishedIconAssetUrl(String(
                sourceStructure?.destroyed?.icons?.default
                ?? sourceStructure?.destroyed?.iconUrl
                ?? explicitDefaultIconSourceUrl
                ?? sourceStructure?.icons?.default
                ?? sourceStructure?.iconUrl
                ?? '',
            ).trim()) || null;
            const publishedDestroyedDefaultIconSourceUrl = normalizePublishedIconAssetUrl(String(
                structure?.destroyed?.icons?.default
                ?? structure?.destroyed?.iconUrl
                ?? '',
            ).trim()) || null;
            const destroyedDefaultIconSourceUrl = publishedDestroyedDefaultIconSourceUrl ?? explicitDestroyedDefaultIconSourceUrl;
            const fallbackDestroyedDefaultIconUrl = structure.destroyed && destroyedDefaultIconSourceUrl
                ? (await resolveCoLocatedStructureAssetUrl(
                    structure.id,
                    destroyedDefaultIconSourceUrl,
                    'destroyed.icon.default',
                    destroyedSubTypeIconUrl,
                ) ?? existingDestroyedDefaultIconUrl)
                : null;
            const destroyedDefaultFallbackSourceUrl = destroyedDefaultIconSourceUrl;
            const canPreserveGeneratedDestroyedDefaultIcon = Boolean(destroyedDefaultIconSourceUrl)
                && existingDestroyedDefaultIconUrl;
            const preservedGeneratedDestroyedDefaultIconUrl = canPreserveGeneratedDestroyedDefaultIcon
                ? await ensureSubtypeCompositedCoLocatedStructureAssetUrl(
                    structure.id,
                    'destroyed.icon.default',
                    destroyedSubTypeIconUrl,
                    destroyedDefaultFallbackSourceUrl,
                )
                : null;
            const ensuredDestroyedDefaultIconUrl = structure.destroyed
                ? (destroyedDefaultIconSourceUrl
                    ? (preservedGeneratedDestroyedDefaultIconUrl ?? fallbackDestroyedDefaultIconUrl ?? existingDestroyedDefaultIconUrl)
                    : null)
                : null;

            return {
                ...structureWithoutLegacyIcons,
                icons: {
                    default: ensuredDefaultIconUrl,
                    rendered: fallbackRenderedIconUrl,
                },
                ...(structure.destroyed
                    ? {
                        destroyed: {
                            ...structure.destroyed,
                            ...(Object.keys({
                                ...(ensuredDestroyedDefaultIconUrl ? { default: ensuredDestroyedDefaultIconUrl } : {}),
                                ...(fallbackDestroyedRenderedIconUrl ? { rendered: fallbackDestroyedRenderedIconUrl } : {}),
                            }).length > 0
                                ? {
                                    icons: {
                                        ...(structure.destroyed.icons ?? {}),
                                        ...(ensuredDestroyedDefaultIconUrl ? { default: ensuredDestroyedDefaultIconUrl } : {}),
                                        ...(fallbackDestroyedRenderedIconUrl ? { rendered: fallbackDestroyedRenderedIconUrl } : {}),
                                    },
                                }
                                : {}),
                            ...(ensuredDestroyedDefaultIconUrl ? { iconUrl: ensuredDestroyedDefaultIconUrl } : {}),
                            ...(fallbackDestroyedRenderedIconUrl ? { previewIconUrl: fallbackDestroyedRenderedIconUrl } : {}),
                            ...(fallbackDestroyedPreviewUrl ? { previewUrl: fallbackDestroyedPreviewUrl } : {}),
                            ...(fallbackDestroyedTextureUrl
                                ? {
                                    sprite: {
                                        ...(structure.destroyed.sprite ?? {}),
                                        source: fallbackDestroyedTextureUrl,
                                    },
                                    textureUrl: fallbackDestroyedTextureUrl,
                                }
                                : {}),
                        },
                    }
                    : {}),
                previewUrl: fallbackPreviewUrl,
                variants: {
                    ...structure.variants,
                    ...(fallbackTextureUrl
                        ? {
                            default: {
                                ...(structure.variants.default ?? {}),
                                textureUrl: fallbackTextureUrl,
                            },
                        }
                        : {}),
                },
                modificationSlots: await Promise.all((structure.modificationSlots ?? []).map(async slot => ({
                    ...slot,
                    variants: Object.fromEntries(await Promise.all(Object.entries(slot.variants ?? {}).map(async ([variantKey, variant]) => {
                        const coLocatedDefaultIconUrl = await resolveCoLocatedModificationAssetUrl(
                            structure.id,
                            variant?.appliedModificationId ?? variant?.id ?? variantKey,
                            variant?.icons?.default ?? variant?.iconUrl,
                            variant?.icons?.rendered ?? variant?.previewIconUrl,
                            variant?.textureUrl,
                            variant?.previewUrl,
                            variant?.subTypeIconUrl,
                        );
                        const nextIcons = {
                            ...(variant?.icons ?? {}),
                            ...(coLocatedDefaultIconUrl ? { default: coLocatedDefaultIconUrl } : {}),
                        };
                        return [variantKey, {
                            ...variant,
                            ...(Object.keys(nextIcons).length > 0 ? { icons: nextIcons } : {}),
                            iconUrl: coLocatedDefaultIconUrl ?? variant?.iconUrl,
                        }];
                    }))),
                }))),
            };
        })),
    });

    await syncMissingStructureDefaultIconFallbacks(coLocatedManifest);
    return coLocatedManifest;
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
            console.log(`wrote ${outputPath}`);
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
        console.log('publish-manifest: reusing existing asset outputs (--skip-existing-assets)');
    }

    const sourceManifest = await loadSourceManifest(sourceManifestPath);
    let publishedManifestBeforeWrite = null;
    if (await pathExists(publishedManifestPath)) {
        try {
            publishedManifestBeforeWrite = await loadSourceManifest(publishedManifestPath);
        } catch (error) {
            console.warn(`skipping published manifest preload because the existing published manifest is not in the assets-root shape: ${error}`);
        }
    }
    assertSafeUnfilteredPublish(sourceManifest, publishedManifestBeforeWrite, sourceManifestPath);
    const filteredSourceManifest = attachSourceStructureMetadata(applyTargetFilter(
        rebaseFoxholeManifestAssetUrls(
            sourceManifest,
            getManifestBaseAssetsUrl(sourceManifest),
            createFoxholeAssetsBaseUrl('/'),
        ),
        targetFilter,
    ), sourceManifest.__sourceStructureMetadataById);
    publishedAssetTypeById = buildPublishedAssetTypeLookup(filteredSourceManifest);
    const explicitlyRemovedStructureIds = getExplicitlyRemovedStructureIds(targetFilter, filteredSourceManifest);
    const referencedGeneratedIconKeys = hasTargetFilters(targetFilter)
        ? collectReferencedPublishedIconKeys(filteredSourceManifest)
        : null;
    const scopedRawRenderedAssetTargets = buildScopedRawRenderedAssetTargets(filteredSourceManifest);

    await removeStaleRootStructureArtifacts(filteredSourceManifest);
    await removeStaleStructureArtifactDirectories(filteredSourceManifest);
    await removeStructureArtifactsByIds(explicitlyRemovedStructureIds);
    await removeLegacyTypedLayoutArtifacts(filteredSourceManifest);

    await generateSyntheticOilfieldAssets(filteredSourceManifest);
    await syncRawRenderedAssetsToPublicDirectory(scopedRawRenderedAssetTargets);

    const structureRenderEntries = await buildStructureRenderEntries(filteredSourceManifest, scopedRawRenderedAssetTargets);
    const manifestWithRenderUrls = applyStructureRenderUrls(
        filteredSourceManifest,
        structureRenderEntries.entriesByKey,
        await buildStructureSceneMetadata(),
        structureRenderEntries.modificationEntriesByKey,
        structureRenderEntries.modificationEntriesByAssetId,
        structureRenderEntries.structureLayerEntriesByStructureId,
        structureRenderEntries.sharedPackagingEntriesByKey,
    );
    const manifestWithNormalizedIconUrls = foxholeManifestSchema.parse(normalizePublishedIconAssetUrls(manifestWithRenderUrls));
    const manifestWithCoLocatedFallbackAssets = await coLocateFallbackStructureAssets(manifestWithNormalizedIconUrls, generatedIconsDirectory, filteredSourceManifest);
    const manifestWithStrippedSlotNoise = stripPublishedModificationSlotNoise(
        manifestWithCoLocatedFallbackAssets,
        structureRenderEntries.modificationEntriesByKey,
        structureRenderEntries.modificationEntriesByAssetId,
    );
    await syncSharedModificationDefaultIconAssets(manifestWithStrippedSlotNoise);
    const manifestWithPreservedAuthoredPreviewDirections = preserveAuthoredStructurePreviewDirections(
        manifestWithStrippedSlotNoise,
        filteredSourceManifest,
    );
    let publishedBaseManifest = null;
    if (hasTargetFilters(targetFilter)) {
        publishedBaseManifest = publishedManifestBeforeWrite;
    }

    const mergedManifest = publishedBaseManifest
        ? mergeManifestSubset(publishedBaseManifest, manifestWithPreservedAuthoredPreviewDirections, explicitlyRemovedStructureIds)
        : manifestWithPreservedAuthoredPreviewDirections;
    const mergedManifestWithoutUnavailableDestroyedVisuals = await stripUnavailableDestroyedVisuals(mergedManifest);
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

    await syncCategoryIconAssets(prunedMergedManifest);

    await removeUnreferencedGeneratedModificationArtifactDirectories(prunedMergedManifest);

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
            console.log(`wrote ${outputPath}`);
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
