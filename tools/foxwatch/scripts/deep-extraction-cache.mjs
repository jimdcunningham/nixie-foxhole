import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEEP_EXTRACTION_CACHE_SCHEMA_VERSION = 3;

// These are contracts for the generic decoded bundle, not hashes of the
// current FoxWatch implementation. Bump only the section whose canonical
// output changes. Optimizations and downstream manifest/render changes must
// not throw away decoded game assets.
export const DECODED_ASSET_CONTRACT_VERSIONS = Object.freeze({
    inspections: 1,
    geometry: 1,
    materials: 1,
    textures: 1,
    icons: 1,
});

const ASSET_EXPORT_SOURCE_FILES = [
    'FoxWatchAssetMeshExportProbe.cs',
    'FoxWatchAssetMeshExporter.cs',
    'FoxWatchAssetTextureExporter.cs',
    'FoxWatchManifestAssetExtractor.cs',
    'FoxWatchService.csproj',
];

export async function computeDeepExtractorFingerprint(sourceFingerprint, runtimeDirectory) {
    if (!sourceFingerprint) {
        throw new Error('Deep extractor fingerprint requires a source fingerprint.');
    }

    const runtimeEntries = [];
    for (const filePath of await walkRuntimeFiles(runtimeDirectory)) {
        const fileName = path.basename(filePath);
        if (!/\.(?:dll|exe|json)$/i.test(fileName)
            || /^FoxWatchService\.(?:dll|exe|deps\.json|runtimeconfig\.json)$/i.test(fileName)) {
            continue;
        }
        const bytes = await fs.readFile(filePath);
        runtimeEntries.push([
            path.relative(runtimeDirectory, filePath).replaceAll('\\', '/'),
            bytes.length,
            sha256(bytes),
        ]);
    }
    runtimeEntries.sort(([left], [right]) => left.localeCompare(right));
    if (runtimeEntries.length === 0) {
        throw new Error(`Deep extractor fingerprint found no runtime dependencies in ${runtimeDirectory}.`);
    }

    return sha256(JSON.stringify({ sourceFingerprint, runtimeEntries }));
}

export async function computeDeepAssetFingerprint(repoRoot, runtimeDirectory) {
    const sourceEntries = [];
    for (const fileName of ASSET_EXPORT_SOURCE_FILES) {
        const filePath = path.join(repoRoot, 'tools', 'foxwatch', fileName);
        const bytes = await fs.readFile(filePath);
        sourceEntries.push([fileName, bytes.length, sha256(bytes)]);
    }

    const runtimeEntries = [];
    for (const filePath of await walkRuntimeFiles(runtimeDirectory)) {
        const fileName = path.basename(filePath);
        if (!/\.dll$/i.test(fileName) || /^FoxWatchService\.dll$/i.test(fileName)) {
            continue;
        }
        const bytes = await fs.readFile(filePath);
        runtimeEntries.push([
            path.relative(runtimeDirectory, filePath).replaceAll('\\', '/'),
            bytes.length,
            sha256(bytes),
        ]);
    }
    runtimeEntries.sort(([left], [right]) => left.localeCompare(right));
    if (runtimeEntries.length === 0) {
        throw new Error(`Deep asset fingerprint found no runtime dependencies in ${runtimeDirectory}.`);
    }

    return sha256(JSON.stringify({ sourceEntries, runtimeEntries }));
}

export function createRawManifestCacheKey({ pakInventory, extractorFingerprint }) {
    if (!pakInventory?.fingerprint || !extractorFingerprint) {
        throw new Error('Raw manifest cache key requires PAK and extractor fingerprints.');
    }
    return sha256(JSON.stringify({
        schemaVersion: 1,
        pakFingerprint: pakInventory.fingerprint,
        extractorFingerprint,
    }));
}

export function createDeepExtractionCacheIdentity({
    pakInventory,
    extractorFingerprint,
    assetFingerprint = extractorFingerprint,
    assetOutputRoot,
    iconOutputRoot,
}) {
    if (!pakInventory?.fingerprint) {
        throw new Error('Deep extraction cache identity requires a PAK fingerprint.');
    }
    if (!extractorFingerprint) {
        throw new Error('Deep extraction cache identity requires an extractor fingerprint.');
    }
    if (!assetFingerprint) {
        throw new Error('Deep extraction cache identity requires an asset fingerprint.');
    }

    return {
        schemaVersion: DEEP_EXTRACTION_CACHE_SCHEMA_VERSION,
        pakFingerprint: pakInventory.fingerprint,
        steamBuildId: pakInventory.steamBuildId ?? null,
        extractorFingerprint,
        assetImplementationFingerprint: assetFingerprint,
        assetContractVersions: { ...DECODED_ASSET_CONTRACT_VERSIONS },
        assetOutputRoot,
        iconOutputRoot,
    };
}

export function deepExtractionCacheMatches(cached, expected) {
    return cached?.schemaVersion === DEEP_EXTRACTION_CACHE_SCHEMA_VERSION
        && cached?.pakFingerprint === expected.pakFingerprint
        && sectionContractsMatch(cached?.assetContractVersions, expected.assetContractVersions)
        && cached?.assetOutputRoot === expected.assetOutputRoot
        && cached?.iconOutputRoot === expected.iconOutputRoot;
}

export function deepExtractionRunMatches(started, finished) {
    return deepExtractionCacheMatches(started, finished)
        && started?.extractorFingerprint === finished?.extractorFingerprint
        && started?.assetImplementationFingerprint === finished?.assetImplementationFingerprint;
}

export function resolveInvalidatedDecodedAssetSections(cached, expected) {
    const allSections = Object.keys(expected?.assetContractVersions ?? DECODED_ASSET_CONTRACT_VERSIONS);
    if (cached?.schemaVersion !== DEEP_EXTRACTION_CACHE_SCHEMA_VERSION
        || cached?.pakFingerprint !== expected?.pakFingerprint
        || cached?.assetOutputRoot !== expected?.assetOutputRoot
        || cached?.iconOutputRoot !== expected?.iconOutputRoot) {
        return allSections;
    }

    const invalidated = new Set();
    for (const section of allSections) {
        if (cached?.assetContractVersions?.[section] !== expected?.assetContractVersions?.[section]) {
            invalidated.add(section);
        }
    }

    // Texture package references are discovered while exporting material
    // metadata. Rebuild material sidecars whenever the texture contract moves
    // so the texture plan is complete without scanning the PAK a second time.
    if (invalidated.has('textures')) {
        invalidated.add('materials');
    }
    return [...invalidated];
}

function sectionContractsMatch(cached, expected) {
    if (!cached || !expected) {
        return false;
    }
    const expectedEntries = Object.entries(expected);
    return expectedEntries.length === Object.keys(cached).length
        && expectedEntries.every(([section, version]) => cached[section] === version);
}

async function walkRuntimeFiles(directoryPath) {
    const files = [];
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...await walkRuntimeFiles(entryPath));
        } else if (entry.isFile()) {
            files.push(entryPath);
        }
    }
    return files;
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
