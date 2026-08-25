import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
    classifyDecodedAssetFile,
    createActiveDecodedAssetBundlePointer,
    createDecodedAssetBundleMetadata,
    createDecodedAssetBundlePaths,
} from './decoded-asset-bundle.mjs';

describe('FoxWatch decoded asset bundle', () => {
    it('preserves Unreal virtual paths beneath one PAK-addressed root', () => {
        const paths = createDecodedAssetBundlePaths(path.resolve('tmp/bundles'), 'pak-123');
        assert.equal(path.basename(paths.root), 'pak-123');
        assert.equal(paths.packageSnapshotRoot, paths.root);
        assert.equal(path.relative(paths.root, paths.packageDataRoot), 'packages');
        assert.equal(path.relative(paths.root, paths.inspectionPath), path.join('inspections', 'foxwatch-package-inspections.v1.json'));
        assert.equal(path.relative(paths.root, paths.assetRoot), 'assets');
        assert.equal(path.relative(paths.root, paths.iconRoot), 'icons');
    });

    it('classifies canonical decoded outputs by section', () => {
        const iconRoot = path.resolve('bundle/icons');
        assert.equal(classifyDecodedAssetFile(path.resolve('bundle/assets/War/Content/Meshes/Tank.glb'), iconRoot), 'geometry');
        assert.equal(classifyDecodedAssetFile(path.resolve('bundle/assets/War/Content/Materials/Tank.json'), iconRoot), 'materials');
        assert.equal(classifyDecodedAssetFile(path.resolve('bundle/assets/War/Content/Textures/Tank.png'), iconRoot), 'textures');
        assert.equal(classifyDecodedAssetFile(path.resolve('bundle/icons/War/Content/Textures/UI/TankIcon.png'), iconRoot), 'icons');
    });

    it('refuses to activate a package snapshot for another PAK', () => {
        const paths = createDecodedAssetBundlePaths(path.resolve('tmp/bundles'), 'pak-a');
        assert.throws(() => createDecodedAssetBundleMetadata({
            identity: {
                pakFingerprint: 'pak-a',
                assetContractVersions: {},
                assetImplementationFingerprint: 'implementation',
            },
            packageMetadata: { complete: true, pakFingerprint: 'pak-b' },
            inventory: {},
            paths,
        }), /does not match/);
    });

    it('activates only complete bundle metadata', () => {
        const paths = createDecodedAssetBundlePaths(path.resolve('tmp/bundles'), 'pak-a');
        const metadata = createDecodedAssetBundleMetadata({
            identity: {
                pakFingerprint: 'pak-a',
                steamBuildId: '42',
                assetContractVersions: { inspections: 1, geometry: 1, materials: 1, textures: 1, icons: 1 },
                assetImplementationFingerprint: 'implementation',
            },
            packageMetadata: {
                complete: true,
                schemaVersion: 3,
                pakFingerprint: 'pak-a',
                packageCount: 10,
                totalBytes: 100,
                unsupportedPackagePaths: [],
            },
            inventory: {
                inspections: { fileCount: 1, totalBytes: 10 },
                geometry: { fileCount: 1, totalBytes: 10 },
                materials: { fileCount: 1, totalBytes: 10 },
                textures: { fileCount: 1, totalBytes: 10 },
                icons: { fileCount: 1, totalBytes: 10 },
            },
            paths,
        });
        const pointer = createActiveDecodedAssetBundlePointer(metadata, paths);
        assert.equal(pointer.pakFingerprint, 'pak-a');
        assert.equal(pointer.inspectionPath, paths.inspectionPath);
        assert.equal(pointer.assetRoot, paths.assetRoot);
    });
});
