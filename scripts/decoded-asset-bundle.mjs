import path from 'node:path';

export const DECODED_ASSET_BUNDLE_SCHEMA_VERSION = 1;
export const DECODED_PACKAGE_SNAPSHOT_SCHEMA_VERSION = 3;

export function createDecodedAssetBundlePaths(bundleRoot, pakFingerprint) {
    if (!pakFingerprint) {
        throw new Error('Decoded asset bundle requires a PAK fingerprint.');
    }
    const root = path.join(bundleRoot, pakFingerprint);
    return {
        root,
        packageSnapshotRoot: root,
        packageDataRoot: path.join(root, 'packages'),
        inspectionRoot: path.join(root, 'inspections'),
        inspectionPath: path.join(root, 'inspections', 'foxwatch-package-inspections.v1.json'),
        assetRoot: path.join(root, 'assets'),
        iconRoot: path.join(root, 'icons'),
        metadataPath: path.join(root, 'decoded-asset-bundle.v1.json'),
        cacheStampPath: path.join(root, 'deep-extraction-cache.v1.json'),
    };
}

export function createDecodedAssetBundleMetadata({
    identity,
    packageMetadata,
    inventory,
    paths,
    completedAt = new Date().toISOString(),
}) {
    if (!identity?.pakFingerprint || packageMetadata?.complete !== true) {
        throw new Error('Decoded asset bundle metadata requires verified PAK and package snapshot identities.');
    }
    if (packageMetadata.pakFingerprint !== identity.pakFingerprint) {
        throw new Error('Decoded package snapshot does not match the decoded asset bundle PAK.');
    }
    return {
        schemaVersion: DECODED_ASSET_BUNDLE_SCHEMA_VERSION,
        complete: true,
        pakFingerprint: identity.pakFingerprint,
        steamBuildId: identity.steamBuildId ?? null,
        assetContractVersions: identity.assetContractVersions,
        assetImplementationFingerprint: identity.assetImplementationFingerprint,
        completedAt,
        sections: {
            packages: {
                schemaVersion: packageMetadata.schemaVersion,
                packageCount: packageMetadata.packageCount,
                totalBytes: packageMetadata.totalBytes,
                unsupportedPackageCount: packageMetadata.unsupportedPackagePaths?.length ?? 0,
                root: paths.packageDataRoot,
            },
            inspections: inventory.inspections,
            geometry: inventory.geometry,
            materials: inventory.materials,
            textures: inventory.textures,
            icons: inventory.icons,
        },
    };
}

export function classifyDecodedAssetFile(filePath, iconRoot = null) {
    if (iconRoot && isWithinPath(iconRoot, filePath)) {
        return 'icons';
    }
    switch (path.extname(filePath).toLowerCase()) {
        case '.glb':
        case '.gltf':
            return 'geometry';
        case '.json':
            return 'materials';
        case '.png':
        case '.jpg':
        case '.jpeg':
        case '.webp':
        case '.hdr':
        case '.exr':
            return 'textures';
        default:
            return null;
    }
}

export function decodedAssetSectionOwnsFile(section, filePath, iconRoot = null) {
    return classifyDecodedAssetFile(filePath, iconRoot) === section;
}

export function createActiveDecodedAssetBundlePointer(metadata, paths) {
    if (metadata?.complete !== true || metadata?.schemaVersion !== DECODED_ASSET_BUNDLE_SCHEMA_VERSION) {
        throw new Error('Cannot activate an incomplete decoded asset bundle.');
    }
    return {
        schemaVersion: 1,
        pakFingerprint: metadata.pakFingerprint,
        steamBuildId: metadata.steamBuildId ?? null,
        bundleRoot: paths.root,
        inspectionPath: paths.inspectionPath,
        assetRoot: paths.assetRoot,
        iconRoot: paths.iconRoot,
        metadataPath: paths.metadataPath,
        activatedAt: new Date().toISOString(),
    };
}

function isWithinPath(parentPath, candidatePath) {
    const relativePath = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}
