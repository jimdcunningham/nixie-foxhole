import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, extname, join, basename, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDir, '..', '..', '..');
const foxholePlannerRoot = resolve(repositoryRoot, 'apps', 'foxhole-planner');
const foxholeDataDirectory = resolve(process.env.FOXHOLE_DATA_DIR ?? resolve(repositoryRoot, 'tools', 'foxwatch', 'tmp', 'pak-assets'));
const rawFoxWatchMapDataPath = resolve(repositoryRoot, 'tools', 'foxwatch', 'tmp', 'foxwatch-map-data.v1.json');
const mapIconsOverridePath = resolve(repositoryRoot, 'tools', 'foxwatch', 'asset-overrides', 'map-icons.json');
const publishedMapRoot = resolve(foxholePlannerRoot, 'public', 'foxhole', 'assets', 'maps');
const publishedMapDataPath = resolve(publishedMapRoot, 'map-data.v1.json');
const fixtureMapDataPath = resolve(repositoryRoot, 'tests', 'fixtures', 'foxhole', 'map-data.v1.fixture.json');
const maskPath = resolve(currentDir, 'RegionMask.png');
const mapIconSourceDirectory = resolve(foxholeDataDirectory, 'War', 'Content', 'Textures', 'UI', 'MapIcons');
const processedMapsDirectory = resolve(foxholeDataDirectory, 'War', 'Content', 'Textures', 'UI', 'HexMaps', 'Processed');
const immImportDirectory = resolve(currentDir, 'IMM');
const tmpMapIconsDirectory = resolve(repositoryRoot, 'tools', 'foxwatch', 'tmp', 'map-icons', 'raw');
const publishedMapIconsDirectory = resolve(publishedMapRoot, 'MapIcons');

const skippedMaps = new Set(['FoxholeFestivalMap', 'MapHomeRegionC', 'MapHomeRegionW']);
const immLossyDirectories = new Set(['BaseMap', 'BaseMapFull', 'BaseMapFullNoPeaks', 'BaseMapTopo']);
const immSkippedDirectories = new Set(['Wells', 'UnderwaterRocksMask']);
const teamColors = {
    COLONIALS: { r: 21, g: 38, b: 18, alpha: 255 },
    WARDENS: { r: 36, g: 86, b: 130, alpha: 255 },
};

async function pathExists(path) {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

async function loadJsonFile(path) {
    return JSON.parse(await readFile(path, 'utf8'));
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

async function ensureDir(path) {
    await mkdir(path, { recursive: true });
}

async function clearDirectory(path) {
    await rm(path, { recursive: true, force: true });
    await ensureDir(path);
}

function normalizeIMMMapLookupKey(value) {
    return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function createIMMTextureKeyLookup(maps) {
    const textureKeyLookup = new Map();
    for (const [mapKey, mapData] of Object.entries(maps ?? {})) {
        const textureKey = mapData?.textureKey;
        const iconKey = typeof mapData?.icon === 'string'
            ? basename(mapData.icon, extname(mapData.icon))
            : undefined;
        const variants = [
            mapKey,
            textureKey,
            textureKey?.replace(/^Map/, ''),
            iconKey,
            iconKey?.replace(/^Map/, ''),
            mapData?.name,
        ];
        for (const variant of variants) {
            const normalizedKey = normalizeIMMMapLookupKey(variant);
            if (normalizedKey && !textureKeyLookup.has(normalizedKey)) {
                textureKeyLookup.set(normalizedKey, textureKey);
            }
        }
    }
    return textureKeyLookup;
}

function getIMMTextureCandidates(fileName) {
    const extension = extname(fileName);
    const parts = fileName.slice(0, -extension.length).split('-');
    const rawName = parts[parts.length - 1];
    return [...new Set([
        rawName,
        rawName.startsWith('Map') ? rawName.slice(3) : rawName,
        rawName.startsWith('Map') ? rawName : `Map${rawName}`,
        rawName.endsWith('Map') ? rawName.slice(0, -3) : rawName,
    ].filter(Boolean))];
}

function getIMMTextureKey(fileName, textureKeyLookup) {
    for (const candidate of getIMMTextureCandidates(fileName)) {
        const textureKey = textureKeyLookup.get(normalizeIMMMapLookupKey(candidate));
        if (textureKey) {
            return textureKey;
        }
    }

    return undefined;
}

async function exportAllSourceMapIconsToTmp() {
    await clearDirectory(tmpMapIconsDirectory);
    if (!await pathExists(mapIconSourceDirectory)) {
        console.warn(`map icon source directory not found: ${mapIconSourceDirectory}`);
        return;
    }

    for (const fileName of await readdir(mapIconSourceDirectory)) {
        if (extname(fileName).toLowerCase() !== '.png') {
            continue;
        }

        await copyFile(join(mapIconSourceDirectory, fileName), join(tmpMapIconsDirectory, fileName));
    }
}

function readTrackedFileFromGit(relativePath) {
    try {
        return execFileSync('git', ['show', `HEAD:${relativePath.replace(/\\/g, '/')}`], {
            cwd: repositoryRoot,
            encoding: null,
            maxBuffer: 20 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        return null;
    }
}

async function buildExistingIconFallbacks(mapIconsOverride) {
    const fallbacks = new Map();

    for (const [, icon] of Object.entries(mapIconsOverride?.mapIcons ?? {})) {
        const textureName = String(icon?.textureName ?? '').trim();
        if (!textureName || fallbacks.has(textureName)) {
            continue;
        }

        const publishedWebpSourcePath = resolve(publishedMapIconsDirectory, `${textureName}.webp`);
        if (await pathExists(publishedWebpSourcePath)) {
            fallbacks.set(textureName, await readFile(publishedWebpSourcePath));
            continue;
        }

        let trackedBuffer = readTrackedFileFromGit(`apps/foxhole-planner/public/foxhole/assets/maps/MapIcons/${textureName}.webp`);
        if (!trackedBuffer) {
            trackedBuffer = readTrackedFileFromGit(`apps/foxhole-planner/public/foxhole/assets/game/Textures/UI/MapIcons/${textureName}.webp`);
        }
        if (!trackedBuffer) {
            trackedBuffer = readTrackedFileFromGit(`apps/foxhole-planner/public/foxhole/assets/game/Textures/UI/MapIcons/${textureName}.webp`);
        }
        if (trackedBuffer) {
            fallbacks.set(textureName, trackedBuffer);
        }
    }

    return fallbacks;
}

async function resolveCuratedMapIconSource(textureName, fallbackSources) {
    const pngSourcePath = join(mapIconSourceDirectory, `${textureName}.png`);
    if (await pathExists(pngSourcePath)) {
        return await readFile(pngSourcePath);
    }

    const fallbackSourceBuffer = fallbackSources.get(textureName);
    if (fallbackSourceBuffer) {
        return fallbackSourceBuffer;
    }

    return null;
}

async function publishCuratedMapIcons(mapIconsOverride) {
    const fallbackSources = await buildExistingIconFallbacks(mapIconsOverride);
    await clearDirectory(publishedMapIconsDirectory);
    await ensureDir(resolve(publishedMapIconsDirectory, 'COLONIALS'));
    await ensureDir(resolve(publishedMapIconsDirectory, 'WARDENS'));

    const mapIcons = Object.entries(mapIconsOverride?.mapIcons ?? {});
    for (const [, icon] of mapIcons) {
        const textureName = String(icon?.textureName ?? '').trim();
        if (!textureName) {
            continue;
        }

        const sourcePath = await resolveCuratedMapIconSource(textureName, fallbackSources);
        if (!sourcePath) {
            console.warn(`missing source map icon: ${textureName}`);
            continue;
        }

        const sourceBuffer = sourcePath;

        await sharp(sourceBuffer)
            .webp({ quality: 100, lossless: true })
            .toFile(resolve(publishedMapIconsDirectory, `${textureName}.webp`));

        for (const [teamId, color] of Object.entries(teamColors)) {
            await sharp(sourceBuffer)
                .ensureAlpha()
                .tint(color)
                .modulate({ brightness: 0.4 })
                .webp({ quality: 100, lossless: true })
                .toFile(resolve(publishedMapIconsDirectory, teamId, `${textureName}.webp`));
        }
    }
}

async function publishProcessedMapImages(publishedMapData) {
    const knownTextureKeys = new Set(
        Object.values(publishedMapData?.maps ?? {})
            .map(map => String(map?.textureKey ?? '').trim())
            .filter(Boolean),
    );
    const iconDirectory = resolve(publishedMapRoot, 'HexMaps', 'Icons');
    const processedDirectory = resolve(publishedMapRoot, 'HexMaps', 'Processed');

    for (const directory of [iconDirectory, processedDirectory]) {
        await clearDirectory(directory);
    }

    console.info(`publishing processed map images for ${knownTextureKeys.size} known texture keys`);

    if (!await pathExists(processedMapsDirectory)) {
        console.warn(`processed map source directory not found: ${processedMapsDirectory}`);
        return;
    }

    for (const fileName of await readdir(processedMapsDirectory)) {
        if (extname(fileName).toLowerCase() !== '.png') {
            continue;
        }

        const textureKey = basename(fileName, extname(fileName));
        if (skippedMaps.has(textureKey) || !knownTextureKeys.has(textureKey)) {
            continue;
        }

        console.info(`publishing processed map images for ${textureKey}`);

        const sourcePath = join(processedMapsDirectory, fileName);
        await sharp(sourcePath)
            .resize({ width: 128, height: 111 })
            .webp({ quality: 90 })
            .toFile(resolve(iconDirectory, `${textureKey}.webp`));

        const processedBuffer = await sharp(sourcePath)
            .median(8)
            .sharpen()
            .resize({ width: 2048, height: 1776 })
            .raw()
            .toBuffer({ resolveWithObject: true });

        await sharp(processedBuffer.data, {
            raw: {
                width: processedBuffer.info.width,
                height: processedBuffer.info.height,
                channels: processedBuffer.info.channels,
            },
        })
            .ensureAlpha()
            .composite([{ input: maskPath, blend: 'dest-in' }])
            .webp({ quality: 90 })
            .toFile(resolve(processedDirectory, `${textureKey}.webp`));
    }
}

async function importIMMMapFiles(publishedMapData) {
    const immDirectory = resolve(publishedMapRoot, 'IMM');
    await clearDirectory(immDirectory);

    console.info(`publishing IMM assets from ${immImportDirectory}`);

    if (!await pathExists(immImportDirectory)) {
        console.warn(`IMM source directory not found: ${immImportDirectory}`);
        return;
    }

    const textureKeyLookup = createIMMTextureKeyLookup(publishedMapData?.maps ?? {});
    const stats = {
        directoriesVisited: 0,
        exportedFiles: 0,
        skippedUnknownTextureKey: 0,
        skippedTooSmall: 0,
        skippedMap: 0,
        skippedNonPng: 0,
    };

    async function walk(dirPath, rootDir = dirPath) {
        stats.directoriesVisited += 1;
        const relativeDirLabel = dirPath === rootDir ? '.' : relative(rootDir, dirPath).replace(/\\/g, '/');
        console.info(`scanning IMM directory ${relativeDirLabel}`);

        for (const entry of await readdir(dirPath, { withFileTypes: true })) {
            const filePath = join(dirPath, entry.name);
            if (entry.isDirectory()) {
                if (dirPath === rootDir && immSkippedDirectories.has(entry.name)) {
                    console.info(`skipping IMM directory ${entry.name}`);
                    continue;
                }
                await walk(filePath, rootDir);
                continue;
            }

            if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.png') {
                stats.skippedNonPng += 1;
                continue;
            }

            const textureCandidates = getIMMTextureCandidates(entry.name);
            if (textureCandidates.some(candidate => skippedMaps.has(candidate))) {
                stats.skippedMap += 1;
                console.info(`skipping IMM file for excluded map ${entry.name}`);
                continue;
            }

            const textureKey = getIMMTextureKey(entry.name, textureKeyLookup);
            if (!textureKey) {
                stats.skippedUnknownTextureKey += 1;
                console.warn(`skipping IMM file with unknown textureKey: ${filePath}`);
                continue;
            }

            const relativeDirPath = dirPath === rootDir ? '' : relative(rootDir, dirPath);
            const relativeDirKey = relativeDirPath.replace(/\\/g, '/');
            const webpOptions = immLossyDirectories.has(relativeDirKey) ? { quality: 90 } : { lossless: true };
            const metadata = await sharp(filePath).metadata();
            if ((metadata.width ?? 0) < 2048 || (metadata.height ?? 0) < 1776) {
                stats.skippedTooSmall += 1;
                console.warn(`skipping IMM file too small to crop: ${filePath}`);
                continue;
            }

            const left = Math.floor(((metadata.width ?? 0) - 2048) / 2);
            const top = Math.floor(((metadata.height ?? 0) - 1776) / 2);

            const exportDir = relativeDirPath ? resolve(immDirectory, relativeDirPath) : immDirectory;
            const outputPath = resolve(exportDir, `${textureKey}.webp`);
            await ensureDir(dirname(outputPath));
            console.info(`publishing IMM file ${entry.name} -> ${relativeDirLabel}/${textureKey}.webp`);
            await sharp(filePath)
                .extract({ left, top, width: 2048, height: 1776 })
                .ensureAlpha()
                .composite([{ input: maskPath, blend: 'dest-in' }])
                .webp(webpOptions)
                .toFile(outputPath);
            stats.exportedFiles += 1;
        }
    }

    await walk(immImportDirectory);
    console.info(`finished publishing IMM assets: directories=${stats.directoriesVisited}, exported=${stats.exportedFiles}, skippedUnknownTextureKey=${stats.skippedUnknownTextureKey}, skippedTooSmall=${stats.skippedTooSmall}, skippedMap=${stats.skippedMap}, skippedNonPng=${stats.skippedNonPng}`);
}

async function writeMarkerFile(outputPath, content) {
    await ensureDir(dirname(outputPath));
    await writeFile(outputPath, `${content}\n`, 'utf8');
}

async function writeJsonFile(outputPath, value) {
    await ensureDir(dirname(outputPath));
    await writeFile(outputPath, stringifyJsonAscii(value), 'utf8');
}

async function publishMapData(publishedMapData) {
    console.info(`publishing map-data JSON to ${publishedMapDataPath}`);
    await writeJsonFile(publishedMapDataPath, publishedMapData);
    console.info(`publishing map-data fixture to ${fixtureMapDataPath}`);
    await writeJsonFile(fixtureMapDataPath, publishedMapData);
}

export async function main() {
    console.info(`loading published map-data input from ${rawFoxWatchMapDataPath}`);
    const publishedMapData = await loadJsonFile(rawFoxWatchMapDataPath);
    console.info(`loading map icon overrides from ${mapIconsOverridePath}`);
    const mapIconsOverride = await loadJsonFile(mapIconsOverridePath);

    console.info('starting foxhole map asset publish');
    await publishMapData(publishedMapData);
    console.info(`exporting raw source map icons to ${tmpMapIconsDirectory}`);
    await exportAllSourceMapIconsToTmp();
    console.info(`publishing curated map icons to ${publishedMapIconsDirectory}`);
    await publishCuratedMapIcons(mapIconsOverride);
    await publishProcessedMapImages(publishedMapData);
    await importIMMMapFiles(publishedMapData);
    await writeMarkerFile(resolve(repositoryRoot, 'tools', 'foxwatch', 'tmp', 'map-assets.last-run.txt'), new Date().toISOString());
    console.info('finished foxhole map asset publish');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error('failed to publish foxhole map assets:', error);
        process.exitCode = 1;
    });
}