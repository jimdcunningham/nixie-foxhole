import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentDirectory, '..', '..', '..');
const defaultLegacyDataPath = path.resolve(repositoryRoot, '..', 'game-kitchen', 'app', 'plugins', 'foxhole', 'data.js');
const assetManifestPath = path.resolve(repositoryRoot, 'packages', 'extensions', 'foxhole', 'public', 'foxhole', 'assets', 'manifest.v1.json');
const assetOverridesDirectory = path.resolve(repositoryRoot, 'tools', 'foxwatch', 'asset-overrides');
const boardPixelsPerMeter = 32;
const legacyUpgradeParentAssetId = {
    ammunition_factory: 'facilityfactoryammo',
    coal_refinery: 'facilityrefinerycoal',
    diesel_power_plant: 'facilitypowerdiesel',
    materials_factory: 'facilityrefinery1',
    metalworks_factory: 'facilityrefinery2',
    oil_refinery: 'facilityrefineryoil',
    oil_well: 'facilitymineoil',
    power_station: 'facilitypoweroil',
    stationary_harvester_coal: 'facilitymineresource4',
    stationary_harvester_components: 'facilitymineresource2',
    stationary_harvester_scrap: 'facilitymineresource1',
    stationary_harvester_sulfur: 'facilitymineresource3',
    water_pump: 'facilityminewater',
};

const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (!argument.startsWith('--')) continue;
    argumentsByName.set(argument, process.argv[index + 1]?.startsWith('--') ? null : process.argv[index + 1] ?? null);
}

const apply = argumentsByName.has('--apply');
const legacyDataPath = path.resolve(argumentsByName.get('--legacy') ?? defaultLegacyDataPath);

async function pathExists(targetPath) {
    try {
        await access(targetPath);
        return true;
    } catch {
        return false;
    }
}

function collectLegacyHitAreas(value, entries = [], seen = new Set(), pathSegments = []) {
    if (!value || typeof value !== 'object' || seen.has(value)) return entries;
    seen.add(value);

    if (Array.isArray(value)) {
        for (const child of value) collectLegacyHitAreas(child, entries, seen);
        return entries;
    }

    if (typeof value.codeName === 'string'
        && Array.isArray(value.hitArea)
        && value.hitArea.length > 0
        && value.hitArea.every(polygon => Array.isArray(polygon?.shape) && polygon.shape.length >= 6 && polygon.shape.length % 2 === 0)) {
        entries.push({
            codeName: value.codeName,
            polygons: value.hitArea,
            pathSegments,
        });
    }

    for (const [key, child] of Object.entries(value)) collectLegacyHitAreas(child, entries, seen, [...pathSegments, key]);
    return entries;
}

function toMeters(value) {
    return Math.round((value / boardPixelsPerMeter) * 1000) / 1000;
}

function normalizeModificationId(value) {
    return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const legacyModule = await import(pathToFileURL(legacyDataPath).href);
const legacyEntries = collectLegacyHitAreas(legacyModule.default?.buildings);
const assetManifest = JSON.parse(await readFile(assetManifestPath, 'utf8'));
const assetByCodeName = new Map(assetManifest.assets.map(asset => [String(asset.codeName ?? '').toLowerCase(), asset]));
const assetById = new Map(assetManifest.assets.map(asset => [asset.id, asset]));
const desiredByAssetId = new Map();
const unmatchedLegacyCodeNames = [];

for (const entry of legacyEntries) {
    const [legacyParentKey, upgradeContainer] = entry.pathSegments;
    const isUpgrade = upgradeContainer === 'upgrades' && Boolean(legacyUpgradeParentAssetId[legacyParentKey]);
    const asset = isUpgrade
        ? assetById.get(legacyUpgradeParentAssetId[legacyParentKey])
        : assetByCodeName.get(entry.codeName.toLowerCase());
    if (!asset) {
        unmatchedLegacyCodeNames.push(entry.codeName);
        continue;
    }

    const lineOfSightPolygons = entry.polygons.map(polygon => ({
        shape: polygon.shape.map(toMeters),
    }));
    if (!isUpgrade) {
        if (desiredByAssetId.has(asset.id)) {
            throw new Error(`multiple legacy hit areas resolve to '${asset.id}'`);
        }
        desiredByAssetId.set(asset.id, { lineOfSightPolygons, modificationId: null });
        continue;
    }

    const variant = asset.modifications
        ?.flatMap(slot => Object.entries(slot.variants ?? {}))
        .find(([variantId, candidate]) => {
            return normalizeModificationId(candidate.codeName ?? variantId) === normalizeModificationId(entry.codeName);
        });
    if (!variant) {
        unmatchedLegacyCodeNames.push(entry.codeName);
        continue;
    }
    const [modificationId] = variant;
    const targetKey = `${asset.id}/${modificationId}`;
    if (desiredByAssetId.has(targetKey)) {
        throw new Error(`multiple legacy hit areas resolve to '${targetKey}'`);
    }
    desiredByAssetId.set(targetKey, { lineOfSightPolygons, modificationId });
}

const imported = [];
const skippedExisting = [];
for (const [targetKey, target] of [...desiredByAssetId.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const [assetId] = targetKey.split('/');
    const overridePath = path.join(assetOverridesDirectory, assetId, 'manifest.json');
    const override = await pathExists(overridePath)
        ? JSON.parse(await readFile(overridePath, 'utf8'))
        : {};

    const existingPolygons = target.modificationId
        ? override.modifications?.[target.modificationId]?.lineOfSightPolygons
        : override.lineOfSightPolygons;
    if (Array.isArray(existingPolygons) && existingPolygons.length > 0) {
        skippedExisting.push(targetKey);
        continue;
    }

    imported.push(targetKey);
    if (apply) {
        if (target.modificationId) {
            override.modifications ??= {};
            override.modifications[target.modificationId] ??= {};
            override.modifications[target.modificationId].lineOfSightPolygons = target.lineOfSightPolygons;
        } else {
            override.lineOfSightPolygons = target.lineOfSightPolygons;
        }
        await mkdir(path.dirname(overridePath), { recursive: true });
        await writeFile(overridePath, `${JSON.stringify(override, null, 2)}\n`);
    }
}

console.log(JSON.stringify({
    mode: apply ? 'applied' : 'dry-run',
    imported,
    skippedExisting,
    unmatchedLegacyCodeNames: unmatchedLegacyCodeNames.sort(),
}, null, 2));
