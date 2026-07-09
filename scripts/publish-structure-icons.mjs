import { access, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import sharp from 'sharp';

import { imageDataHasVisiblePixels } from './publish-render-utils.mjs';
import { composeSubtypeIcon } from './publish-icon-utils.mjs';
import { logPublishDetail, logPublishSummary } from './publish-log.mjs';
import { getDefaultPublishConcurrency, mapWithConcurrency } from './publish-concurrency.mjs';

export const DEFAULT_WRECKED_SUBTYPE_ICON_URL = '/foxhole/assets/icons/subtypewreckedicon.webp';
export const MAX_PUBLISHED_ICON_DIMENSION = 256;

const ICON_SOURCE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
export const LOSSLESS_PUBLISHED_ICON_WEBP_OPTIONS = { lossless: true, quality: 100, effort: 6 };
export const LOSSY_PUBLISHED_RENDER_WEBP_OPTIONS = { quality: 90 };
export const LOSSY_PUBLISHED_PREVIEW_WEBP_OPTIONS = { quality: 90, alphaQuality: 100 };

const OUTPUT_FILE_RETRY_DELAYS_MS = [50, 100, 250, 500, 1000, 2000, 4000];

function isRetryableOutputFileError(error) {
    const code = String(error?.code ?? '').toUpperCase();
    if (['EBUSY', 'EPERM', 'UNKNOWN', 'EMFILE', 'ENFILE'].includes(code)) {
        return true;
    }

    const message = String(error?.message ?? '').toLowerCase();
    return message.includes('operation not permitted')
        || message.includes('unknown error, open')
        || message.includes('resource busy or locked');
}

async function writeOutputFile(filePath, content) {
    for (let attempt = 0; ; attempt += 1) {
        try {
            await writeFile(filePath, content);
            return;
        } catch (error) {
            if (!isRetryableOutputFileError(error) || attempt >= OUTPUT_FILE_RETRY_DELAYS_MS.length) {
                throw error;
            }

            if (attempt >= 2) {
                await unlink(filePath).catch(() => {});
            }

            await new Promise(resolve => setTimeout(resolve, OUTPUT_FILE_RETRY_DELAYS_MS[attempt]));
        }
    }
}

const LOSSLESS_WEBP_OPTIONS = LOSSLESS_PUBLISHED_ICON_WEBP_OPTIONS;

const LIVING_ICON_KINDS = ['icon.default', 'icon.rendered', 'preview', 'texture'];
const DESTROYED_ICON_KINDS = [
    'destroyed.icon.default',
    'destroyed.icon.rendered',
    'destroyed.preview',
    'destroyed.texture',
];

export function normalizeId(value) {
    return String(value ?? '').trim().toLowerCase();
}

export function normalizeFileSystemPath(value) {
    return String(value ?? '').replace(/\\/g, '/').toLowerCase();
}

export function isComposableIconAssetKind(assetKind) {
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

export function isCopyOnlyAssetKind(assetKind) {
    switch (assetKind) {
        case 'preview':
        case 'texture':
        case 'destroyed.preview':
        case 'destroyed.texture':
            return true;
        default:
            return false;
    }
}

export function shouldSyncRenderedAssetToPublic(fileName) {
    const normalized = String(fileName ?? '').toLowerCase();
    if (normalized.endsWith('.icon.default.webp')) {
        return false;
    }
    if (normalized.endsWith('.icon.rendered.webp')) {
        return false;
    }
    if (normalized.includes('.destroyed.icon.')) {
        return false;
    }
    return true;
}

export function getCoLocatedStructureAssetFileName(structureId, assetKind) {
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

export function extractPublishedIconKey(value) {
    const match = String(value ?? '').match(/\/foxhole\/assets\/icons\/([^/]+)\.(png|jpe?g|webp)$/i);
    return match ? normalizeId(match[1]) : null;
}

export function isSharedPublishedIconUrl(value) {
    return /^\/foxhole\/assets\/icons\/[^/]+\.webp$/i.test(String(value ?? ''));
}

export function isAllowedRawSourcePath(filePath, { rawRenderedRoot, generatedIconsRoot, publicAssetsRoot }) {
    const normalizedPath = normalizeFileSystemPath(filePath);
    const normalizedRawRoot = normalizeFileSystemPath(rawRenderedRoot);
    const normalizedGeneratedRoot = normalizeFileSystemPath(generatedIconsRoot);
    const normalizedPublicRoot = normalizeFileSystemPath(publicAssetsRoot);

    if (normalizedPublicRoot && normalizedPath.startsWith(`${normalizedPublicRoot}/`)) {
        return false;
    }

    return normalizedPath.startsWith(`${normalizedRawRoot}/`)
        || normalizedPath.startsWith(`${normalizedGeneratedRoot}/`);
}

export function structureHasNestedDestroyed(structure) {
    return Boolean(structure?.destroyed);
}

const RAW_DESTROYED_RENDER_ASSET_KINDS = [
    'destroyed.texture',
    'destroyed.preview',
    'destroyed.icon.rendered',
];

export async function hasRawDestroyedRenderAssets(
    structureId,
    rawRenderedAssetTypesDirectory,
    resolveAssetTypeName,
) {
    const normalizedStructureId = normalizeId(structureId);
    if (!normalizedStructureId) {
        return false;
    }

    for (const assetKind of RAW_DESTROYED_RENDER_ASSET_KINDS) {
        const rawRenderedPath = getRawRenderedAssetPath(
            normalizedStructureId,
            assetKind,
            resolveAssetTypeName(normalizedStructureId),
            rawRenderedAssetTypesDirectory,
        );
        if (await pathExists(rawRenderedPath) && await imageFileHasVisiblePixelsFromPath(rawRenderedPath)) {
            return true;
        }
    }

    return false;
}

export async function structureHasPublishableNestedDestroyed(
    structure,
    rawRenderedAssetTypesDirectory,
    resolveAssetTypeName,
    structuresWithDestroyedRenderScenes = null,
) {
    if (!structureHasNestedDestroyed(structure)) {
        return false;
    }

    if (!structureHasResolvableDestroyedRenderScene(structure, structuresWithDestroyedRenderScenes)) {
        return false;
    }

    return hasRawDestroyedRenderAssets(
        structure?.id,
        rawRenderedAssetTypesDirectory,
        resolveAssetTypeName,
    );
}

export function resolvePublishedIconWebpOptions(assetKind) {
    switch (assetKind) {
        case 'icon.rendered':
        case 'destroyed.icon.rendered':
            return LOSSY_PUBLISHED_RENDER_WEBP_OPTIONS;
        case 'preview':
        case 'destroyed.preview':
        case 'texture':
        case 'destroyed.texture':
            return LOSSY_PUBLISHED_PREVIEW_WEBP_OPTIONS;
        case 'icon.default':
        case 'destroyed.icon.default':
        default:
            return LOSSLESS_PUBLISHED_ICON_WEBP_OPTIONS;
    }
}

export function structureIsStandaloneDestroyedCodename(structureId) {
    const normalizedStructureId = normalizeId(structureId);
    return normalizedStructureId.endsWith('destroyed')
        || normalizedStructureId.endsWith('breached');
}

export function structureNeedsWreckedSubtype(structure, sourceStructure, structureId = null) {
    return structure?.isDestroyed === true
        || structure?.isBreached === true
        || sourceStructure?.isDestroyed === true
        || sourceStructure?.isBreached === true
        || (structureId ? structureIsStandaloneDestroyedCodename(structureId) : false)
        || (structure?.id ? structureIsStandaloneDestroyedCodename(structure.id) : false)
        || (sourceStructure?.id ? structureIsStandaloneDestroyedCodename(sourceStructure.id) : false);
}

export function structurePrefersGeneratedDefaultIcon(structure, sourceStructure) {
    return structure?.generateDefaultIcon === true
        || sourceStructure?.generateDefaultIcon === true;
}

export function isPublishableDestroyedIconAssetKind(assetKind) {
    return assetKind === 'destroyed.icon.default' || assetKind === 'destroyed.icon.rendered';
}

export function isIconFallbackVisualAssetKind(assetKind) {
    return assetKind === 'preview' || assetKind === 'texture';
}

export async function collectStructureIdsWithDestroyedRenderScenesFromDirectory(renderScenesDirectory) {
    const structureIds = new Set();
    if (!renderScenesDirectory) {
        return structureIds;
    }

    let entries = [];
    try {
        entries = await readdir(renderScenesDirectory, { withFileTypes: true });
    } catch {
        return structureIds;
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const destroyedScenePath = resolve(renderScenesDirectory, entry.name, 'destroyed.scene.json');
        if (await pathExists(destroyedScenePath)) {
            structureIds.add(normalizeId(entry.name));
        }
    }

    return structureIds;
}

export function stripUntrustworthyVehicleDestroyedVisuals(manifest, structuresWithDestroyedRenderScenes) {
    return sanitizeVehicleDestroyedVisuals(manifest, structuresWithDestroyedRenderScenes, null);
}

export function sanitizeVehicleDestroyedVisuals(manifest, structuresWithDestroyedRenderScenes, allowlistedVehicleDestroyedIds = null) {
    let strippedNotAllowlisted = 0;
    let strippedUntrustworthy = 0;
    const assets = (manifest?.assets ?? []).map(structure => {
        if (!structure?.destroyed) {
            return structure;
        }

        const structureId = normalizeId(structure?.id);
        if (structure?.isVehicle === true) {
            if (allowlistedVehicleDestroyedIds && !allowlistedVehicleDestroyedIds.has(structureId)) {
                strippedNotAllowlisted += 1;
                const { destroyed, ...structureWithoutDestroyed } = structure;
                return structureWithoutDestroyed;
            }

            if (!structuresWithDestroyedRenderScenes?.has(structureId)) {
                strippedUntrustworthy += 1;
                const { destroyed, ...structureWithoutDestroyed } = structure;
                return structureWithoutDestroyed;
            }
        }

        return structure;
    });

    if (strippedNotAllowlisted > 0 || strippedUntrustworthy > 0) {
        logPublishSummary(
            `publish-manifest: stripped vehicle destroyed visuals`
            + ` (${strippedNotAllowlisted} not allowlisted, ${strippedUntrustworthy} missing destroyed.scene.json)`,
        );
    }

    return {
        ...manifest,
        assets,
    };
}

export function structureHasResolvableDestroyedRenderScene(structure, structuresWithDestroyedRenderScenes) {
    if (!structuresWithDestroyedRenderScenes) {
        return true;
    }

    if (structure?.isVehicle !== true) {
        return true;
    }

    const structureId = normalizeId(structure?.id);
    return structureId ? structuresWithDestroyedRenderScenes.has(structureId) : false;
}

export function resolveSubtypeOverlayUrlForIconFallback({
    structure,
    sourceStructure,
    assetKind,
    fellBackToIconDefault = false,
    defaultWreckedSubtypeUrl = DEFAULT_WRECKED_SUBTYPE_ICON_URL,
}) {
    if (!fellBackToIconDefault || !isIconFallbackVisualAssetKind(assetKind)) {
        return null;
    }

    return resolveSubtypeOverlayUrl({
        structure,
        sourceStructure,
        assetKind: 'icon.default',
        defaultWreckedSubtypeUrl,
    });
}

export function resolveSubtypeOverlayUrl({
    structure,
    sourceStructure,
    assetKind,
    defaultWreckedSubtypeUrl = DEFAULT_WRECKED_SUBTYPE_ICON_URL,
}) {
    if (!isComposableIconAssetKind(assetKind)) {
        return null;
    }

    const explicitSubtype = String(
        sourceStructure?.subTypeIconUrl
        ?? structure?.subTypeIconUrl
        ?? '',
    ).trim();
    if (explicitSubtype) {
        return explicitSubtype;
    }

    const needsWrecked = structureNeedsWreckedSubtype(
        structure,
        sourceStructure,
        structure?.id ?? sourceStructure?.id ?? null,
    )
        || isPublishableDestroyedIconAssetKind(assetKind);
    if (needsWrecked) {
        return defaultWreckedSubtypeUrl;
    }

    return null;
}

export function getStructureIconAssetKinds(structure) {
    const kinds = [...LIVING_ICON_KINDS];
    if (structureHasNestedDestroyed(structure)) {
        kinds.push(...DESTROYED_ICON_KINDS);
    }
    return kinds;
}

function getBlueprintIconUrlCandidates(structure, sourceStructure, assetKind) {
    const source = sourceStructure ?? structure;
    if (assetKind === 'destroyed.icon.default') {
        return [
            source?.destroyed?.icons?.default,
            source?.destroyed?.iconUrl,
            source?.icons?.default,
            source?.iconUrl,
            structure?.icons?.default,
            structure?.iconUrl,
        ].filter(Boolean);
    }
    if (assetKind === 'destroyed.icon.rendered') {
        return [
            source?.destroyed?.icons?.rendered,
            source?.destroyed?.previewIconUrl,
            source?.destroyed?.icons?.default,
            source?.destroyed?.iconUrl,
        ].filter(Boolean);
    }

    return [
        source?.icons?.default,
        source?.iconUrl,
        source?.previewUrl,
        structure?.icons?.default,
        structure?.iconUrl,
    ];
}

function getRawRenderedAssetPath(structureId, assetKind, assetTypeName, rawRenderedAssetTypesDirectory) {
    return resolve(
        rawRenderedAssetTypesDirectory,
        assetTypeName,
        structureId,
        getCoLocatedStructureAssetFileName(structureId, assetKind),
    );
}

async function pathExists(filePath) {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function readImageFileAsWebp(filePath, webpOptions = LOSSLESS_WEBP_OPTIONS) {
    const sourceContent = await readFile(filePath);
    if (extname(filePath).toLowerCase() === '.webp') {
        return sourceContent;
    }

    return sharp(sourceContent).webp(webpOptions).toBuffer();
}

export async function imageBufferHasVisiblePixels(content) {
    try {
        const { data } = await sharp(content)
            .ensureAlpha()
            .resize(32, 32, { fit: 'inside', withoutEnlargement: true })
            .raw()
            .toBuffer({ resolveWithObject: true });
        return imageDataHasVisiblePixels(data);
    } catch {
        return false;
    }
}

export async function imageFileHasVisiblePixelsFromPath(filePath) {
    try {
        const content = await readFile(filePath);
        const { data } = await sharp(content)
            .ensureAlpha()
            .resize(32, 32, { fit: 'inside', withoutEnlargement: true })
            .raw()
            .toBuffer({ resolveWithObject: true });
        return imageDataHasVisiblePixels(data);
    } catch {
        return false;
    }
}

export async function normalizeIconContentDimensions(content, webpOptions = LOSSLESS_WEBP_OPTIONS) {
    const metadata = await sharp(content).metadata();
    const width = Number(metadata.width ?? 0);
    const height = Number(metadata.height ?? 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return content;
    }

    const maxDimension = Math.max(width, height);
    if (maxDimension <= MAX_PUBLISHED_ICON_DIMENSION) {
        return sharp(content).webp(webpOptions).toBuffer();
    }

    return sharp(content)
        .resize({
            width: MAX_PUBLISHED_ICON_DIMENSION,
            height: MAX_PUBLISHED_ICON_DIMENSION,
            fit: 'inside',
            withoutEnlargement: true,
        })
        .webp(webpOptions)
        .toBuffer();
}

async function resolveGeneratedIconFilePath(iconUrl, generatedIconsDirectory) {
    const iconKey = extractPublishedIconKey(iconUrl);
    if (!iconKey) {
        return null;
    }

    for (const extension of ICON_SOURCE_EXTENSIONS) {
        const candidatePath = resolve(generatedIconsDirectory, `${iconKey}${extension}`);
        if (await pathExists(candidatePath)) {
            return candidatePath;
        }
    }

    return null;
}

async function readRawSourceFile(filePath, { rawRenderedRoot, generatedIconsRoot, publicAssetsRoot }) {
    if (!isAllowedRawSourcePath(filePath, { rawRenderedRoot, generatedIconsRoot, publicAssetsRoot })) {
        throw new Error(`refusing to read non-raw icon source: ${filePath}`);
    }

    return {
        sourceFilePath: filePath,
        content: await readImageFileAsWebp(filePath),
    };
}

export async function resolveRawIconSource({
    structureId,
    assetKind,
    structure,
    sourceStructure,
    rawRenderedAssetTypesDirectory,
    generatedIconsDirectory,
    publicAssetsDirectory,
    resolveAssetTypeName,
}) {
    const assetTypeName = resolveAssetTypeName(structureId);
    const rawRenderedRoot = rawRenderedAssetTypesDirectory;
    const roots = {
        rawRenderedRoot,
        generatedIconsRoot: generatedIconsDirectory,
        publicAssetsRoot: publicAssetsDirectory,
    };
    const preferGeneratedDefaultIcon = assetKind === 'icon.default'
        && structurePrefersGeneratedDefaultIcon(structure, sourceStructure);

    const rawRenderedPath = getRawRenderedAssetPath(
        structureId,
        assetKind,
        assetTypeName,
        rawRenderedAssetTypesDirectory,
    );
    if (await pathExists(rawRenderedPath) && isAllowedRawSourcePath(rawRenderedPath, roots)) {
        if (preferGeneratedDefaultIcon || await imageFileHasVisiblePixelsFromPath(rawRenderedPath)) {
            return readRawSourceFile(rawRenderedPath, roots);
        }
    }

    if (preferGeneratedDefaultIcon) {
        return null;
    }

    if (isComposableIconAssetKind(assetKind)
        && (assetKind === 'icon.rendered' || assetKind === 'destroyed.icon.rendered')) {
        for (const blueprintUrl of getBlueprintIconUrlCandidates(structure, sourceStructure, assetKind)) {
            const generatedIconPath = await resolveGeneratedIconFilePath(blueprintUrl, generatedIconsDirectory);
            if (!generatedIconPath) {
                continue;
            }

            return readRawSourceFile(generatedIconPath, roots);
        }
    }

    for (const blueprintUrl of getBlueprintIconUrlCandidates(structure, sourceStructure, assetKind)) {
        const generatedIconPath = await resolveGeneratedIconFilePath(blueprintUrl, generatedIconsDirectory);
        if (!generatedIconPath) {
            continue;
        }

        return readRawSourceFile(generatedIconPath, roots);
    }

    if (await pathExists(rawRenderedPath) && isAllowedRawSourcePath(rawRenderedPath, roots)) {
        return readRawSourceFile(rawRenderedPath, roots);
    }

    return null;
}

export async function resolveRawCopySource({
    structureId,
    assetKind,
    rawRenderedAssetTypesDirectory,
    resolveAssetTypeName,
}) {
    const assetTypeName = resolveAssetTypeName(structureId);
    const rawRenderedPath = getRawRenderedAssetPath(
        structureId,
        assetKind,
        assetTypeName,
        rawRenderedAssetTypesDirectory,
    );
    if (!await pathExists(rawRenderedPath)) {
        return null;
    }

    return {
        sourceFilePath: rawRenderedPath,
        content: await readFile(rawRenderedPath),
    };
}

export async function resolveRawVisualCopySource({
    structureId,
    assetKind,
    structure,
    sourceStructure,
    rawRenderedAssetTypesDirectory,
    generatedIconsDirectory,
    publicAssetsDirectory,
    resolveAssetTypeName,
}) {
    const rawCopy = await resolveRawCopySource({
        structureId,
        assetKind,
        rawRenderedAssetTypesDirectory,
        resolveAssetTypeName,
    });

    if (rawCopy?.content && await imageBufferHasVisiblePixels(rawCopy.content)) {
        return rawCopy;
    }

    if (assetKind.startsWith('destroyed.')) {
        return null;
    }

    const iconDefaultSource = await resolveRawIconSource({
        structureId,
        assetKind: 'icon.default',
        structure,
        sourceStructure,
        rawRenderedAssetTypesDirectory,
        generatedIconsDirectory,
        publicAssetsDirectory,
        resolveAssetTypeName,
    });
    if (!iconDefaultSource?.content) {
        return rawCopy;
    }

    return {
        sourceFilePath: iconDefaultSource.sourceFilePath,
        content: iconDefaultSource.content,
        fellBackToIconDefault: true,
    };
}

async function readSubtypeOverlaySource(subtypeOverlayUrl, generatedIconsDirectory, publicAssetsDirectory) {
    const normalizedSubtypeUrl = String(subtypeOverlayUrl ?? '').trim();
    if (!normalizedSubtypeUrl) {
        return null;
    }

    const generatedIconPath = await resolveGeneratedIconFilePath(normalizedSubtypeUrl, generatedIconsDirectory);
    if (generatedIconPath) {
        return {
            sourceFilePath: generatedIconPath,
            content: await readImageFileAsWebp(generatedIconPath),
        };
    }

    throw new Error(`missing subtype overlay source for ${normalizedSubtypeUrl}`);
}

export async function writeCoLocatedIcon({
    outputPath,
    rawSource,
    subtypeOverlayUrl,
    assetKind,
    generatedIconsDirectory,
    publicAssetsDirectory,
    skipExisting = false,
}) {
    if (skipExisting && await pathExists(outputPath)) {
        return {
            outputPath,
            wrote: false,
            composed: false,
        };
    }

    if (!rawSource?.content) {
        return {
            outputPath,
            wrote: false,
            composed: false,
        };
    }

    await mkdir(dirname(outputPath), { recursive: true });

    const webpOptions = resolvePublishedIconWebpOptions(assetKind);
    let outputContent = await normalizeIconContentDimensions(rawSource.content, webpOptions);
    let composed = false;

    const subtypeOverlay = isComposableIconAssetKind(assetKind) && subtypeOverlayUrl
        ? await readSubtypeOverlaySource(subtypeOverlayUrl, generatedIconsDirectory, publicAssetsDirectory)
        : null;

    if (subtypeOverlay) {
        outputContent = await composeSubtypeIcon(
            outputContent,
            subtypeOverlay.content,
            webpOptions,
        );
        composed = true;
    }

    await writeOutputFile(outputPath, outputContent);
    return {
        outputPath,
        wrote: true,
        composed,
        sourceFilePath: rawSource.sourceFilePath,
    };
}

export async function writeCoLocatedCopy({
    outputPath,
    rawSource,
    assetKind = null,
    subtypeOverlayUrl = null,
    generatedIconsDirectory = null,
    publicAssetsDirectory = null,
    skipExisting = false,
}) {
    if (skipExisting && await pathExists(outputPath)) {
        return {
            outputPath,
            wrote: false,
            composed: false,
        };
    }

    if (!rawSource?.content) {
        return {
            outputPath,
            wrote: false,
            composed: false,
        };
    }

    await mkdir(dirname(outputPath), { recursive: true });

    let outputContent = rawSource.content;
    let composed = false;
    const webpOptions = assetKind ? resolvePublishedIconWebpOptions(assetKind) : null;

    if (assetKind && rawSource.fellBackToIconDefault && subtypeOverlayUrl
        && generatedIconsDirectory && publicAssetsDirectory) {
        let iconContent = await normalizeIconContentDimensions(rawSource.content, webpOptions);
        const subtypeOverlay = await readSubtypeOverlaySource(
            subtypeOverlayUrl,
            generatedIconsDirectory,
            publicAssetsDirectory,
        );
        if (subtypeOverlay) {
            outputContent = await composeSubtypeIcon(
                iconContent,
                subtypeOverlay.content,
                webpOptions,
            );
            composed = true;
        } else {
            outputContent = iconContent;
        }
    } else if (assetKind && isCopyOnlyAssetKind(assetKind) && rawSource.fellBackToIconDefault && webpOptions) {
        outputContent = await sharp(rawSource.content).webp(webpOptions).toBuffer();
    }

    await writeOutputFile(outputPath, outputContent);
    return {
        outputPath,
        wrote: true,
        composed,
        sourceFilePath: rawSource.sourceFilePath,
    };
}

export async function publishStructureIconAsset({
    structureId,
    assetKind,
    structure,
    sourceStructure,
    outputDirectory,
    toPublicAssetUrl,
    rawRenderedAssetTypesDirectory,
    generatedIconsDirectory,
    publicAssetsDirectory,
    resolveAssetTypeName,
    skipExistingAssets = false,
    defaultWreckedSubtypeUrl = DEFAULT_WRECKED_SUBTYPE_ICON_URL,
}) {
    const outputPath = resolve(
        outputDirectory,
        getCoLocatedStructureAssetFileName(structureId, assetKind),
    );
    const subtypeOverlayUrl = resolveSubtypeOverlayUrl({
        structure,
        sourceStructure,
        assetKind,
        defaultWreckedSubtypeUrl,
    });

    if (isCopyOnlyAssetKind(assetKind)) {
        const rawSource = await resolveRawVisualCopySource({
            structureId,
            assetKind,
            structure,
            sourceStructure,
            rawRenderedAssetTypesDirectory,
            generatedIconsDirectory,
            publicAssetsDirectory,
            resolveAssetTypeName,
        });
        if (!rawSource?.fellBackToIconDefault
            && await pathExists(outputPath)
            && await imageFileHasVisiblePixelsFromPath(outputPath)) {
            return toPublicAssetUrl(outputPath);
        }

        const fallbackSubtypeOverlayUrl = resolveSubtypeOverlayUrlForIconFallback({
            structure,
            sourceStructure,
            assetKind,
            fellBackToIconDefault: rawSource?.fellBackToIconDefault === true,
            defaultWreckedSubtypeUrl,
        });
        const result = await writeCoLocatedCopy({
            outputPath,
            rawSource,
            assetKind,
            subtypeOverlayUrl: fallbackSubtypeOverlayUrl,
            generatedIconsDirectory,
            publicAssetsDirectory,
            skipExisting: skipExistingAssets,
        });
        if (result.wrote && result.composed) {
            logPublishDetail(`published icon-fallback ${result.sourceFilePath} -> ${outputPath} (with subtype)`);
        }
        return result.wrote || await pathExists(outputPath)
            ? toPublicAssetUrl(outputPath)
            : null;
    }

    const rawSource = await resolveRawIconSource({
        structureId,
        assetKind,
        structure,
        sourceStructure,
        rawRenderedAssetTypesDirectory,
        generatedIconsDirectory,
        publicAssetsDirectory,
        resolveAssetTypeName,
    });

    const result = await writeCoLocatedIcon({
        outputPath,
        rawSource,
        subtypeOverlayUrl,
        assetKind,
        generatedIconsDirectory,
        publicAssetsDirectory,
        skipExisting: skipExistingAssets,
    });

    if (result.wrote) {
        logPublishDetail(`published icon ${result.sourceFilePath} -> ${outputPath}${result.composed ? ' (with subtype)' : ''}`);
    }

    return result.wrote || await pathExists(outputPath)
        ? toPublicAssetUrl(outputPath)
        : null;
}

export async function publishStructureIconsForAsset({
    structure,
    sourceStructure,
    outputDirectory,
    toPublicAssetUrl,
    rawRenderedAssetTypesDirectory,
    generatedIconsDirectory,
    publicAssetsDirectory,
    resolveAssetTypeName,
    skipExistingAssets = false,
    defaultWreckedSubtypeUrl = DEFAULT_WRECKED_SUBTYPE_ICON_URL,
    structuresWithDestroyedRenderScenes = null,
}) {
    const structureId = normalizeId(structure?.id);
    if (!structureId) {
        return {};
    }

    const publishedUrls = {};
    const includeDestroyedKinds = await structureHasPublishableNestedDestroyed(
        structure,
        rawRenderedAssetTypesDirectory,
        resolveAssetTypeName,
        structuresWithDestroyedRenderScenes,
    );
    const assetKinds = includeDestroyedKinds
        ? [...LIVING_ICON_KINDS, ...DESTROYED_ICON_KINDS]
        : [...LIVING_ICON_KINDS];

    const publishedEntries = await Promise.all(assetKinds.map(async assetKind => {
        const publishedUrl = await publishStructureIconAsset({
            structureId,
            assetKind,
            structure,
            sourceStructure,
            outputDirectory,
            toPublicAssetUrl,
            rawRenderedAssetTypesDirectory,
            generatedIconsDirectory,
            publicAssetsDirectory,
            resolveAssetTypeName,
            skipExistingAssets,
            defaultWreckedSubtypeUrl,
        });

        return publishedUrl ? [assetKind, publishedUrl] : null;
    }));

    for (const entry of publishedEntries) {
        if (entry) {
            publishedUrls[entry[0]] = entry[1];
        }
    }

    return publishedUrls;
}

async function publishStructureManifestAsset({
    structure,
    sourceStructure,
    getOutputDirectory,
    toPublicAssetUrl,
    rawRenderedAssetTypesDirectory,
    generatedIconsDirectory,
    publicAssetsDirectory,
    resolveAssetTypeName,
    skipExistingAssets,
    defaultWreckedSubtypeUrl,
    structuresWithDestroyedRenderScenes,
}) {
    const structureId = normalizeId(structure?.id);
    const outputDirectory = structureId ? getOutputDirectory(structureId) : null;
    if (!structureId || !outputDirectory) {
        return structure;
    }

    const publishedUrls = await publishStructureIconsForAsset({
        structure,
        sourceStructure,
        outputDirectory,
        toPublicAssetUrl,
        rawRenderedAssetTypesDirectory,
        generatedIconsDirectory,
        publicAssetsDirectory,
        resolveAssetTypeName,
        skipExistingAssets,
        defaultWreckedSubtypeUrl,
        structuresWithDestroyedRenderScenes,
    });
    const includeDestroyedKinds = await structureHasPublishableNestedDestroyed(
        structure,
        rawRenderedAssetTypesDirectory,
        resolveAssetTypeName,
        structuresWithDestroyedRenderScenes,
    );

    const { iconUrl: _legacyIconUrl, previewIconUrl: _legacyPreviewIconUrl, ...structureWithoutLegacyIcons } = structure;
    const nextIcons = {
        ...(structure?.icons ?? {}),
        ...(publishedUrls['icon.default'] ? { default: publishedUrls['icon.default'] } : {}),
        ...(publishedUrls['icon.rendered'] ? { rendered: publishedUrls['icon.rendered'] } : {}),
    };
    return {
        ...structureWithoutLegacyIcons,
        ...(Object.keys(nextIcons).length > 0 ? { icons: nextIcons } : {}),
        ...(publishedUrls.preview ? { previewUrl: publishedUrls.preview } : {}),
        ...(publishedUrls.texture && structure?.variants?.default
            ? {
                variants: {
                    ...structure.variants,
                    default: {
                        ...structure.variants.default,
                        textureUrl: publishedUrls.texture,
                    },
                },
            }
            : {}),
        ...(includeDestroyedKinds && (publishedUrls['destroyed.icon.default']
            || publishedUrls['destroyed.icon.rendered']
            || publishedUrls['destroyed.preview']
            || publishedUrls['destroyed.texture'])
            ? {
                destroyed: {
                    ...structure.destroyed,
                    ...(publishedUrls['destroyed.icon.default'] || publishedUrls['destroyed.icon.rendered']
                        ? {
                            icons: {
                                ...(structure.destroyed?.icons ?? {}),
                                ...(publishedUrls['destroyed.icon.default']
                                    ? { default: publishedUrls['destroyed.icon.default'] }
                                    : {}),
                                ...(publishedUrls['destroyed.icon.rendered']
                                    ? { rendered: publishedUrls['destroyed.icon.rendered'] }
                                    : {}),
                            },
                        }
                        : {}),
                    ...(publishedUrls['destroyed.icon.default']
                        ? { iconUrl: publishedUrls['destroyed.icon.default'] }
                        : {}),
                    ...(publishedUrls['destroyed.icon.rendered']
                        ? { previewIconUrl: publishedUrls['destroyed.icon.rendered'] }
                        : {}),
                    ...(publishedUrls['destroyed.preview'] ? { previewUrl: publishedUrls['destroyed.preview'] } : {}),
                    ...(publishedUrls['destroyed.texture']
                        ? {
                            sprite: {
                                ...(structure.destroyed?.sprite ?? {}),
                                source: publishedUrls['destroyed.texture'],
                            },
                            textureUrl: publishedUrls['destroyed.texture'],
                        }
                        : {}),
                },
            }
            : {}),
    };
}

export async function publishStructureIconsForManifest({
    manifest,
    sourceManifest = null,
    getOutputDirectory,
    toPublicAssetUrl,
    rawRenderedAssetTypesDirectory,
    generatedIconsDirectory,
    publicAssetsDirectory,
    resolveAssetTypeName,
    skipExistingAssets = false,
    defaultWreckedSubtypeUrl = DEFAULT_WRECKED_SUBTYPE_ICON_URL,
    structuresWithDestroyedRenderScenes = null,
    publishConcurrency = getDefaultPublishConcurrency(),
}) {
    const sourceStructuresById = new Map((sourceManifest?.assets ?? [])
        .map(entry => {
            const structureId = normalizeId(entry?.id);
            return structureId ? [structureId, entry] : null;
        })
        .filter(Boolean));

    const assets = manifest?.assets ?? [];
    const startedAt = Date.now();
    const nextAssets = await mapWithConcurrency(
        assets,
        publishConcurrency,
        structure => publishStructureManifestAsset({
            structure,
            sourceStructure: normalizeId(structure?.id)
                ? sourceStructuresById.get(normalizeId(structure.id)) ?? null
                : null,
            getOutputDirectory,
            toPublicAssetUrl,
            rawRenderedAssetTypesDirectory,
            generatedIconsDirectory,
            publicAssetsDirectory,
            resolveAssetTypeName,
            skipExistingAssets,
            defaultWreckedSubtypeUrl,
            structuresWithDestroyedRenderScenes,
        }),
    );
    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

    logPublishSummary(
        `publish-manifest: co-located icons for ${nextAssets.length} manifest assets`
        + ` (concurrency ${publishConcurrency}, ${elapsedSeconds}s)`,
    );

    return {
        ...manifest,
        assets: nextAssets,
    };
}
