import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import sharp from 'sharp';

import { imageDataHasVisiblePixels } from './publish-render-utils.mjs';
import { composeSubtypeIcon } from './publish-icon-utils.mjs';

export const DEFAULT_WRECKED_SUBTYPE_ICON_URL = '/foxhole/assets/icons/subtypewreckedicon.webp';
export const MAX_PUBLISHED_ICON_DIMENSION = 256;

const ICON_SOURCE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const LOSSLESS_WEBP_OPTIONS = { lossless: true, quality: 100, effort: 6 };

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

export function structureNeedsWreckedSubtype(structure, sourceStructure) {
    return structure?.isDestroyed === true
        || structure?.isBreached === true
        || sourceStructure?.isDestroyed === true
        || sourceStructure?.isBreached === true;
}

export function structurePrefersGeneratedDefaultIcon(structure, sourceStructure) {
    return structure?.generateDefaultIcon === true
        || sourceStructure?.generateDefaultIcon === true;
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

    const needsWrecked = structureNeedsWreckedSubtype(structure, sourceStructure)
        || assetKind.startsWith('destroyed.');
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
    if (assetKind === 'destroyed.icon.default' || assetKind === 'destroyed.icon.rendered') {
        return [
            source?.destroyed?.icons?.default,
            source?.destroyed?.iconUrl,
            source?.destroyed?.icons?.rendered,
            source?.destroyed?.previewIconUrl,
            source?.icons?.default,
            source?.iconUrl,
        ];
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
        const { data } = await sharp(filePath)
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

    let outputContent = await normalizeIconContentDimensions(rawSource.content);
    let composed = false;

    const subtypeOverlay = isComposableIconAssetKind(assetKind) && subtypeOverlayUrl
        ? await readSubtypeOverlaySource(subtypeOverlayUrl, generatedIconsDirectory, publicAssetsDirectory)
        : null;

    if (subtypeOverlay) {
        outputContent = await composeSubtypeIcon(
            outputContent,
            subtypeOverlay.content,
            LOSSLESS_WEBP_OPTIONS,
        );
        composed = true;
    }

    await writeFile(outputPath, outputContent);
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
    skipExisting = false,
}) {
    if (skipExisting && await pathExists(outputPath)) {
        return {
            outputPath,
            wrote: false,
        };
    }

    if (!rawSource?.content) {
        return {
            outputPath,
            wrote: false,
        };
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, rawSource.content);
    return {
        outputPath,
        wrote: true,
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
        const rawSource = await resolveRawCopySource({
            structureId,
            assetKind,
            rawRenderedAssetTypesDirectory,
            resolveAssetTypeName,
        });
        const result = await writeCoLocatedCopy({
            outputPath,
            rawSource,
            skipExisting: skipExistingAssets,
        });
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
        console.log(`published icon ${result.sourceFilePath} -> ${outputPath}${result.composed ? ' (with subtype)' : ''}`);
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
}) {
    const structureId = normalizeId(structure?.id);
    if (!structureId) {
        return {};
    }

    const publishedUrls = {};
    for (const assetKind of getStructureIconAssetKinds(structure)) {
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
        if (publishedUrl) {
            publishedUrls[assetKind] = publishedUrl;
        }
    }

    return publishedUrls;
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
}) {
    const sourceStructuresById = new Map((sourceManifest?.assets ?? [])
        .map(entry => {
            const structureId = normalizeId(entry?.id);
            return structureId ? [structureId, entry] : null;
        })
        .filter(Boolean));

    const nextAssets = [];
    for (const structure of manifest?.assets ?? []) {
        const structureId = normalizeId(structure?.id);
        const sourceStructure = structureId ? sourceStructuresById.get(structureId) ?? null : null;
        const outputDirectory = getOutputDirectory(structureId);
        if (!structureId || !outputDirectory) {
            nextAssets.push(structure);
            continue;
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
        });

        const { iconUrl: _legacyIconUrl, previewIconUrl: _legacyPreviewIconUrl, ...structureWithoutLegacyIcons } = structure;
        const nextIcons = {
            ...(structure?.icons ?? {}),
            ...(publishedUrls['icon.default'] ? { default: publishedUrls['icon.default'] } : {}),
            ...(publishedUrls['icon.rendered'] ? { rendered: publishedUrls['icon.rendered'] } : {}),
        };
        nextAssets.push({
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
            ...(structureHasNestedDestroyed(structure)
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
        });
    }

    return {
        ...manifest,
        assets: nextAssets,
    };
}
