import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
    computeDeepAssetFingerprint,
    computeDeepExtractorFingerprint,
    createRawManifestCacheKey,
    createDeepExtractionCacheIdentity,
    deepExtractionCacheMatches,
    deepExtractionRunMatches,
    resolveInvalidatedDecodedAssetSections,
} from './deep-extraction-cache.mjs';
import { buildPakInventory } from './pipeline-core.mjs';

describe('FoxWatch deep extraction cache identity', () => {
    it('keys decoded assets to the PAK and explicit canonical contracts', () => {
        const expected = createDeepExtractionCacheIdentity({
            pakInventory: { fingerprint: 'pak-a', steamBuildId: '123' },
            extractorFingerprint: 'extractor-a',
            assetFingerprint: 'asset-a',
            assetOutputRoot: 'assets',
            iconOutputRoot: 'icons',
        });

        assert.equal(deepExtractionCacheMatches(expected, expected), true);
        assert.equal(deepExtractionCacheMatches({ ...expected, pakFingerprint: 'pak-b' }, expected), false);
        assert.equal(deepExtractionCacheMatches({ ...expected, extractorFingerprint: 'extractor-b' }, expected), true);
        assert.equal(deepExtractionCacheMatches({ ...expected, assetImplementationFingerprint: 'asset-b' }, expected), true);
        assert.equal(deepExtractionCacheMatches({
            ...expected,
            assetContractVersions: { ...expected.assetContractVersions, geometry: 2 },
        }, expected), false);
        assert.equal(deepExtractionCacheMatches({ ...expected, schemaVersion: 0 }, expected), false);
        assert.equal(deepExtractionCacheMatches(null, expected), false);
        assert.equal(deepExtractionRunMatches(expected, expected), true);
        assert.equal(deepExtractionRunMatches({
            ...expected,
            assetImplementationFingerprint: 'asset-b',
        }, expected), false);
    });

    it('invalidates only changed bundle sections and material discovery for textures', () => {
        const expected = createDeepExtractionCacheIdentity({
            pakInventory: { fingerprint: 'pak-a', steamBuildId: '123' },
            extractorFingerprint: 'extractor-a',
            assetFingerprint: 'asset-a',
            assetOutputRoot: 'assets',
            iconOutputRoot: 'icons',
        });
        assert.deepEqual(resolveInvalidatedDecodedAssetSections(expected, expected), []);
        assert.deepEqual(resolveInvalidatedDecodedAssetSections({
            ...expected,
            assetContractVersions: { ...expected.assetContractVersions, geometry: 0 },
        }, expected), ['geometry']);
        assert.deepEqual(new Set(resolveInvalidatedDecodedAssetSections({
            ...expected,
            assetContractVersions: { ...expected.assetContractVersions, textures: 0 },
        }, expected)), new Set(['materials', 'textures']));
        assert.deepEqual(
            new Set(resolveInvalidatedDecodedAssetSections({ ...expected, pakFingerprint: 'pak-b' }, expected)),
            new Set(['inspections', 'geometry', 'materials', 'textures', 'icons']),
        );
    });

    it('keys raw manifest reuse to both the PAK and complete extractor implementation', () => {
        const first = createRawManifestCacheKey({
            pakInventory: { fingerprint: 'pak-a' },
            extractorFingerprint: 'extractor-a',
        });
        assert.notEqual(first, createRawManifestCacheKey({
            pakInventory: { fingerprint: 'pak-b' },
            extractorFingerprint: 'extractor-a',
        }));
        assert.notEqual(first, createRawManifestCacheKey({
            pakInventory: { fingerprint: 'pak-a' },
            extractorFingerprint: 'extractor-b',
        }));
    });

    it('changes the PAK fingerprint for Steam build or file inventory changes', async () => {
        const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foxwatch-pak-inventory-'));
        try {
            const steamAppsRoot = path.join(temporaryRoot, 'steamapps');
            const pakRoot = path.join(steamAppsRoot, 'common', 'Foxhole', 'War', 'Content', 'Paks');
            await fs.mkdir(pakRoot, { recursive: true });
            const manifestPath = path.join(steamAppsRoot, 'appmanifest_505460.acf');
            const pakPath = path.join(pakRoot, 'War-WindowsNoEditor.pak');
            await fs.writeFile(manifestPath, '"buildid" "100"\n');
            await fs.writeFile(pakPath, 'first');

            const first = await buildPakInventory(pakRoot);
            await fs.writeFile(manifestPath, '"buildid" "101"\n');
            const buildChanged = await buildPakInventory(pakRoot);
            await fs.writeFile(pakPath, 'second-version');
            const pakChanged = await buildPakInventory(pakRoot);

            assert.equal(first.steamBuildId, '100');
            assert.equal(buildChanged.steamBuildId, '101');
            assert.notEqual(buildChanged.fingerprint, first.fingerprint);
            assert.notEqual(pakChanged.fingerprint, buildChanged.fingerprint);
        } finally {
            await fs.rm(temporaryRoot, { recursive: true, force: true });
        }
    });

    it('changes the extractor fingerprint for source or runtime dependency changes', async () => {
        const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foxwatch-extractor-runtime-'));
        try {
            await fs.writeFile(path.join(runtimeRoot, 'FoxWatchService.dll'), 'service-a');
            await fs.writeFile(path.join(runtimeRoot, 'CUE4Parse.dll'), 'cue-a');

            const first = await computeDeepExtractorFingerprint('source-a', runtimeRoot);
            const sourceChanged = await computeDeepExtractorFingerprint('source-b', runtimeRoot);
            await fs.writeFile(path.join(runtimeRoot, 'FoxWatchService.dll'), 'service-b');
            assert.equal(await computeDeepExtractorFingerprint('source-a', runtimeRoot), first);
            await fs.writeFile(path.join(runtimeRoot, 'CUE4Parse.dll'), 'cue-b');
            const dependencyChanged = await computeDeepExtractorFingerprint('source-a', runtimeRoot);

            assert.notEqual(sourceChanged, first);
            assert.notEqual(dependencyChanged, first);
        } finally {
            await fs.rm(runtimeRoot, { recursive: true, force: true });
        }
    });

    it('keeps scheduler-only changes out of the exported asset fingerprint', async () => {
        const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foxwatch-asset-fingerprint-'));
        try {
            const sourceRoot = path.join(temporaryRoot, 'tools', 'foxwatch');
            const runtimeRoot = path.join(temporaryRoot, 'runtime');
            await fs.mkdir(sourceRoot, { recursive: true });
            await fs.mkdir(runtimeRoot, { recursive: true });
            for (const fileName of [
                'FoxWatchAssetMeshExportProbe.cs',
                'FoxWatchAssetMeshExporter.cs',
                'FoxWatchAssetTextureExporter.cs',
                'FoxWatchManifestAssetExtractor.cs',
                'FoxWatchService.csproj',
            ]) {
                await fs.writeFile(path.join(sourceRoot, fileName), fileName);
            }
            await fs.writeFile(path.join(runtimeRoot, 'FoxWatchService.dll'), 'service-a');
            await fs.writeFile(path.join(runtimeRoot, 'CUE4Parse.dll'), 'cue-a');

            const first = await computeDeepAssetFingerprint(temporaryRoot, runtimeRoot);
            await fs.writeFile(path.join(runtimeRoot, 'FoxWatchService.dll'), 'service-b');
            assert.equal(await computeDeepAssetFingerprint(temporaryRoot, runtimeRoot), first);
            await fs.writeFile(path.join(runtimeRoot, 'CUE4Parse.dll'), 'cue-b');
            assert.notEqual(await computeDeepAssetFingerprint(temporaryRoot, runtimeRoot), first);
        } finally {
            await fs.rm(temporaryRoot, { recursive: true, force: true });
        }
    });
});
