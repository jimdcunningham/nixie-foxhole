import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import sharp from 'sharp';

import {
    DEFAULT_WRECKED_SUBTYPE_ICON_URL,
    getCoLocatedStructureAssetFileName,
    hasRawDestroyedRenderAssets,
    isAllowedRawSourcePath,
    isComposableIconAssetKind,
    isCopyOnlyAssetKind,
    normalizeIconContentDimensions,
    resolveRawIconSource,
    resolveSubtypeOverlayUrl,
    resolveSubtypeOverlayUrlForIconFallback,
    resolvePublishedIconWebpOptions,
    resolveRawVisualCopySource,
    shouldSyncRenderedAssetToPublic,
    stripUntrustworthyVehicleDestroyedVisuals,
    sanitizeVehicleDestroyedVisuals,
    structureHasPublishableNestedDestroyed,
    structureHasResolvableDestroyedRenderScene,
    collectStructureIdsWithDestroyedRenderScenesFromDirectory,
    writeCoLocatedIcon,
    writeCoLocatedCopy,
} from './publish-structure-icons.mjs';

const currentDir = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(currentDir, '../../../tests/fixtures/foxhole/icon-publish');

test('shouldSyncRenderedAssetToPublic rejects icon webp patterns', () => {
    assert.equal(shouldSyncRenderedAssetToPublic('wood.icon.default.webp'), false);
    assert.equal(shouldSyncRenderedAssetToPublic('wood.icon.rendered.webp'), false);
    assert.equal(shouldSyncRenderedAssetToPublic('ambulancec.destroyed.icon.rendered.webp'), false);
    assert.equal(shouldSyncRenderedAssetToPublic('wood.preview.webp'), true);
    assert.equal(shouldSyncRenderedAssetToPublic('wood.destroyed.preview.webp'), true);
    assert.equal(shouldSyncRenderedAssetToPublic('wood.texture.webp'), true);
});

test('isAllowedRawSourcePath rejects published asset paths', () => {
    const roots = {
        rawRenderedRoot: 'C:/tmp/rendered-assets/types',
        generatedIconsRoot: 'C:/tmp/foxhole-icons',
        publicAssetsRoot: 'C:/apps/public/foxhole/assets',
    };
    assert.equal(
        isAllowedRawSourcePath('C:/tmp/rendered-assets/types/items/wood/wood.icon.rendered.webp', roots),
        true,
    );
    assert.equal(
        isAllowedRawSourcePath('C:/apps/public/foxhole/assets/types/items/wood/wood.icon.rendered.webp', roots),
        false,
    );
});

test('resolveSubtypeOverlayUrl returns subTypeIconUrl for living structures', () => {
    const structure = { subTypeIconUrl: '/foxhole/assets/icons/metal.png' };
    assert.equal(
        resolveSubtypeOverlayUrl({ structure, sourceStructure: structure, assetKind: 'icon.default' }),
        '/foxhole/assets/icons/metal.png',
    );
    assert.equal(
        resolveSubtypeOverlayUrl({ structure, sourceStructure: structure, assetKind: 'icon.rendered' }),
        '/foxhole/assets/icons/metal.png',
    );
});

test('resolveSubtypeOverlayUrl returns wrecked default for standalone isDestroyed', () => {
    const structure = { isDestroyed: true };
    assert.equal(
        resolveSubtypeOverlayUrl({ structure, sourceStructure: structure, assetKind: 'icon.default' }),
        DEFAULT_WRECKED_SUBTYPE_ICON_URL,
    );
});

test('resolveSubtypeOverlayUrl returns wrecked default for valid nested destroyed icons', () => {
    const structure = {
        id: 'relictruck',
        categoryId: 'relics',
        destroyed: { componentName: 'DestroyedMesh' },
    };
    assert.equal(
        resolveSubtypeOverlayUrl({ structure, sourceStructure: structure, assetKind: 'destroyed.icon.rendered' }),
        DEFAULT_WRECKED_SUBTYPE_ICON_URL,
    );
    assert.equal(
        resolveSubtypeOverlayUrl({ structure, sourceStructure: structure, assetKind: 'destroyed.icon.default' }),
        DEFAULT_WRECKED_SUBTYPE_ICON_URL,
    );
});

test('resolveSubtypeOverlayUrl returns wrecked default for regular vehicle destroyed icons', () => {
    const structure = {
        id: 'truckliquidc',
        categoryId: 'vehicles',
        destroyed: { componentName: 'DestroyedMesh' },
    };
    assert.equal(
        resolveSubtypeOverlayUrl({ structure, sourceStructure: structure, assetKind: 'destroyed.icon.rendered' }),
        DEFAULT_WRECKED_SUBTYPE_ICON_URL,
    );
    assert.equal(
        resolveSubtypeOverlayUrl({ structure, sourceStructure: structure, assetKind: 'destroyed.icon.default' }),
        DEFAULT_WRECKED_SUBTYPE_ICON_URL,
    );
});

test('resolveSubtypeOverlayUrl skips wrecked overlay for living vehicle icons', () => {
    const structure = {
        id: 'truckliquidc',
        categoryId: 'vehicles',
        destroyed: { componentName: 'DestroyedMesh' },
    };
    assert.equal(
        resolveSubtypeOverlayUrl({ structure, sourceStructure: structure, assetKind: 'icon.rendered' }),
        null,
    );
});

test('collectStructureIdsWithDestroyedRenderScenesFromDirectory reads destroyed.scene.json files', async () => {
    const tempRoot = await mkdtemp(resolve(tmpdir(), 'foxwatch-destroyed-scenes-'));
    await mkdir(resolve(tempRoot, 'truckliquidc'), { recursive: true });
    await mkdir(resolve(tempRoot, 'truckw'), { recursive: true });
    await writeFile(resolve(tempRoot, 'truckliquidc', 'destroyed.scene.json'), '{}');
    await writeFile(resolve(tempRoot, 'truckw', 'scene.json'), '{}');

    const structureIds = await collectStructureIdsWithDestroyedRenderScenesFromDirectory(tempRoot);
    assert.equal(structureIds.has('truckliquidc'), true);
    assert.equal(structureIds.has('truckw'), false);

    await rm(tempRoot, { recursive: true, force: true });
});

test('stripUntrustworthyVehicleDestroyedVisuals removes vehicle destroyed without scene file', () => {
    const destroyedScenes = new Set(['truckliquidc']);
    const manifest = stripUntrustworthyVehicleDestroyedVisuals({
        assets: [
            { id: 'truckliquidc', isVehicle: true, destroyed: { componentName: 'DestroyedMesh' } },
            { id: 'truckw', isVehicle: true, destroyed: { componentName: 'DestroyedMesh' } },
            { id: 'facilitymine1', destroyed: { componentName: 'DestroyedMesh' } },
        ],
    }, destroyedScenes);

    assert.equal(manifest.assets[0].destroyed?.componentName, 'DestroyedMesh');
    assert.equal(manifest.assets[1].destroyed, undefined);
    assert.equal(manifest.assets[2].destroyed?.componentName, 'DestroyedMesh');
});

test('sanitizeVehicleDestroyedVisuals strips vehicles not on destroyed publish allowlist', () => {
    const destroyedScenes = new Set(['truckliquidc', 'truckw', 'fieldharvesterc']);
    const allowlist = new Set(['truckliquidc', 'fieldharvesterc']);
    const manifest = sanitizeVehicleDestroyedVisuals({
        assets: [
            { id: 'truckliquidc', isVehicle: true, destroyed: { componentName: 'DestroyedMesh' } },
            { id: 'truckw', isVehicle: true, destroyed: { componentName: 'DestroyedMesh' } },
            { id: 'fieldharvesterc', isVehicle: true, destroyed: { componentName: 'DestroyedMesh' } },
            { id: 'facilitymine1', destroyed: { componentName: 'DestroyedMesh' } },
        ],
    }, destroyedScenes, allowlist);

    assert.equal(manifest.assets[0].destroyed?.componentName, 'DestroyedMesh');
    assert.equal(manifest.assets[1].destroyed, undefined);
    assert.equal(manifest.assets[2].destroyed?.componentName, 'DestroyedMesh');
    assert.equal(manifest.assets[3].destroyed?.componentName, 'DestroyedMesh');
});

test('structureHasResolvableDestroyedRenderScene requires destroyed scene for vehicles', () => {
    const destroyedScenes = new Set(['truckliquidc']);
    assert.equal(
        structureHasResolvableDestroyedRenderScene(
            { id: 'truckliquidc', isVehicle: true },
            destroyedScenes,
        ),
        true,
    );
    assert.equal(
        structureHasResolvableDestroyedRenderScene(
            { id: 'truckw', isVehicle: true },
            destroyedScenes,
        ),
        false,
    );
    assert.equal(
        structureHasResolvableDestroyedRenderScene(
            { id: 'facilitymine1', isVehicle: false },
            destroyedScenes,
        ),
        true,
    );
});

test('resolvePublishedIconWebpOptions uses lossy settings for rendered icons', () => {
    assert.deepEqual(resolvePublishedIconWebpOptions('icon.rendered'), { quality: 90 });
    assert.equal(resolvePublishedIconWebpOptions('icon.default').lossless, true);
    assert.deepEqual(resolvePublishedIconWebpOptions('preview'), { quality: 90, alphaQuality: 100 });
});

test('resolveRawVisualCopySource falls back to icon.default for blank preview', async () => {
    const tempRoot = await mkdtemp(resolve(tmpdir(), 'foxwatch-icon-preview-fallback-'));
    const rawRenderedRoot = resolve(tempRoot, 'rendered-assets/types');
    const generatedIconsRoot = resolve(tempRoot, 'foxhole-icons');
    const publicAssetsRoot = resolve(tempRoot, 'public/assets');
    await mkdir(resolve(rawRenderedRoot, 'items', 'aluminum'), { recursive: true });
    await mkdir(generatedIconsRoot, { recursive: true });
    await writeFile(
        resolve(rawRenderedRoot, 'items', 'aluminum', 'aluminum.preview.webp'),
        await readFile(resolve(fixtureRoot, 'blank-render-256.webp')),
    );
    await writeFile(
        resolve(generatedIconsRoot, 'aluminum.png'),
        await readFile(resolve(fixtureRoot, 'blueprint-128.png')),
    );

    const structure = { id: 'aluminum', iconUrl: '/foxhole/assets/icons/aluminum.png' };
    const source = await resolveRawVisualCopySource({
        structureId: 'aluminum',
        assetKind: 'preview',
        structure,
        sourceStructure: structure,
        rawRenderedAssetTypesDirectory: rawRenderedRoot,
        generatedIconsDirectory: generatedIconsRoot,
        publicAssetsDirectory: publicAssetsRoot,
        resolveAssetTypeName: () => 'items',
    });

    assert.equal(source.fellBackToIconDefault, true);
    const metadata = await sharp(source.content).metadata();
    assert.equal(metadata.width, 128);
    assert.equal(metadata.height, 128);
});

test('resolveRawIconSource invisible render falls back to blueprint', async () => {
    const tempRoot = await mkdtemp(resolve(tmpdir(), 'foxwatch-icon-publish-'));
    const rawRenderedRoot = resolve(tempRoot, 'rendered-assets/types');
    const generatedIconsRoot = resolve(tempRoot, 'foxhole-icons');
    const publicAssetsRoot = resolve(tempRoot, 'public/assets');
    await mkdir(resolve(rawRenderedRoot, 'items', 'wood'), { recursive: true });
    await mkdir(generatedIconsRoot, { recursive: true });
    await writeFile(
        resolve(rawRenderedRoot, 'items', 'wood', 'wood.icon.rendered.webp'),
        await readFile(resolve(fixtureRoot, 'blank-render-256.webp')),
    );
    await writeFile(
        resolve(generatedIconsRoot, 'wood.png'),
        await readFile(resolve(fixtureRoot, 'blueprint-128.png')),
    );

    const source = await resolveRawIconSource({
        structureId: 'wood',
        assetKind: 'icon.rendered',
        structure: { id: 'wood', iconUrl: '/foxhole/assets/icons/wood.png' },
        sourceStructure: { id: 'wood', iconUrl: '/foxhole/assets/icons/wood.png' },
        rawRenderedAssetTypesDirectory: rawRenderedRoot,
        generatedIconsDirectory: generatedIconsRoot,
        publicAssetsDirectory: publicAssetsRoot,
        resolveAssetTypeName: () => 'items',
    });

    assert.ok(source);
    assert.match(source.sourceFilePath, /wood\.png$/);
    const metadata = await sharp(source.content).metadata();
    assert.equal(metadata.width, 128);
    assert.equal(metadata.height, 128);
});

test('resolveRawIconSource destroyed.icon.default falls back to living blueprint icon', async () => {
    const tempRoot = await mkdtemp(resolve(tmpdir(), 'foxwatch-icon-publish-'));
    const rawRenderedRoot = resolve(tempRoot, 'rendered-assets/types');
    const generatedIconsRoot = resolve(tempRoot, 'foxhole-icons');
    const publicAssetsRoot = resolve(tempRoot, 'public/assets');
    await mkdir(resolve(rawRenderedRoot, 'vehicles', 'gunboatw'), { recursive: true });
    await mkdir(generatedIconsRoot, { recursive: true });
    await writeFile(
        resolve(generatedIconsRoot, 'gunboatw.png'),
        await readFile(resolve(fixtureRoot, 'blueprint-128.png')),
    );

    const structure = {
        id: 'gunboatw',
        iconUrl: '/foxhole/assets/icons/gunboatw.png',
        destroyed: { componentName: 'DestroyedMesh' },
    };
    const source = await resolveRawIconSource({
        structureId: 'gunboatw',
        assetKind: 'destroyed.icon.default',
        structure,
        sourceStructure: structure,
        rawRenderedAssetTypesDirectory: rawRenderedRoot,
        generatedIconsDirectory: generatedIconsRoot,
        publicAssetsDirectory: publicAssetsRoot,
        resolveAssetTypeName: () => 'vehicles',
    });

    assert.ok(source);
    assert.match(source.sourceFilePath, /gunboatw\.png$/);
});

test('writeCoLocatedIcon composes wrecked subtype onto default icons', async () => {
    const tempRoot = await mkdtemp(resolve(tmpdir(), 'foxwatch-icon-compose-default-'));
    const generatedIconsRoot = resolve(tempRoot, 'foxhole-icons');
    const outputPath = resolve(tempRoot, 'output', 'wood.icon.default.webp');

    await mkdir(generatedIconsRoot, { recursive: true });
    await writeFile(resolve(generatedIconsRoot, 'subtypewreckedicon.png'), await readFile(resolve(fixtureRoot, 'subtype-wrecked-32.png')));

    const rawSource = {
        sourceFilePath: resolve(fixtureRoot, 'blueprint-128.png'),
        content: await readFile(resolve(fixtureRoot, 'blueprint-128.png')),
    };

    await writeCoLocatedIcon({
        outputPath,
        rawSource,
        subtypeOverlayUrl: DEFAULT_WRECKED_SUBTYPE_ICON_URL,
        assetKind: 'icon.default',
        generatedIconsDirectory: generatedIconsRoot,
        publicAssetsDirectory: resolve(tempRoot, 'public'),
    });

    const region = 80;
    const { data } = await sharp(outputPath).extract({ left: 0, top: 0, width: region, height: region }).raw().toBuffer({ resolveWithObject: true });
    let visibleCornerPixels = 0;
    for (let y = 0; y < region; y += 1) {
        for (let x = 0; x < region; x += 1) {
            const index = (y * region + x) * 4;
            if (data[index + 3] > 10) {
                visibleCornerPixels += 1;
            }
        }
    }
    assert.ok(visibleCornerPixels > 0);
});

test('normalizeIconContentDimensions does not upscale blueprint icons', async () => {
    const content = await readFile(resolve(fixtureRoot, 'blueprint-100.png'));
    const normalized = await normalizeIconContentDimensions(content);
    const metadata = await sharp(normalized).metadata();
    assert.equal(metadata.width, 100);
    assert.equal(metadata.height, 100);
});

test('preview asset kind does not compose subtype overlays for rendered copies', async () => {
    const tempRoot = await mkdtemp(resolve(tmpdir(), 'foxwatch-icon-preview-'));
    const outputPath = resolve(tempRoot, 'wood.preview.webp');

    const rawSource = {
        sourceFilePath: resolve(fixtureRoot, 'preview-copy.webp'),
        content: await readFile(resolve(fixtureRoot, 'preview-copy.webp')),
    };

    const result = await writeCoLocatedCopy({
        outputPath,
        rawSource,
        assetKind: 'preview',
    });

    assert.equal(result.composed, false);
    assert.equal(
        (await readFile(outputPath)).equals(rawSource.content),
        true,
    );

    await rm(tempRoot, { recursive: true, force: true });
});

test('preview and texture compose subtype overlays when falling back to icon.default', async () => {
    const tempRoot = await mkdtemp(resolve(tmpdir(), 'foxwatch-icon-fallback-subtype-'));
    const iconsDir = resolve(tempRoot, 'foxhole-icons');
    const publicDir = resolve(tempRoot, 'public/assets');
    await mkdir(iconsDir, { recursive: true });
    await mkdir(publicDir, { recursive: true });

    const subtypeIconPath = resolve(iconsDir, 'subtypemetal.png');
    await copyFile(resolve(fixtureRoot, 'subtype-wrecked-32.png'), subtypeIconPath);

    const structure = { subTypeIconUrl: '/foxhole/assets/icons/subtypemetal.png' };
    const rawSource = {
        sourceFilePath: resolve(fixtureRoot, 'blueprint-100.png'),
        content: await readFile(resolve(fixtureRoot, 'blueprint-100.png')),
        fellBackToIconDefault: true,
    };

    for (const assetKind of ['preview', 'texture']) {
        const outputPath = resolve(tempRoot, `wood.${assetKind}.webp`);
        const subtypeOverlayUrl = resolveSubtypeOverlayUrlForIconFallback({
            structure,
            sourceStructure: structure,
            assetKind,
            fellBackToIconDefault: true,
        });
        assert.equal(subtypeOverlayUrl, '/foxhole/assets/icons/subtypemetal.png');

        const result = await writeCoLocatedCopy({
            outputPath,
            rawSource,
            assetKind,
            subtypeOverlayUrl,
            generatedIconsDirectory: iconsDir,
            publicAssetsDirectory: publicDir,
        });
        assert.equal(result.composed, true);

        const region = 40;
        const { data } = await sharp(outputPath).extract({ left: 0, top: 0, width: region, height: region }).raw().toBuffer({ resolveWithObject: true });
        let visibleCornerPixels = 0;
        for (let index = 3; index < data.length; index += 4) {
            if (data[index] > 10) {
                visibleCornerPixels += 1;
            }
        }
        assert.ok(visibleCornerPixels > 0, `expected subtype overlay in ${assetKind}`);
    }
});

test('asset kind helpers classify composable and copy-only kinds', () => {
    assert.equal(isComposableIconAssetKind('icon.default'), true);
    assert.equal(isComposableIconAssetKind('destroyed.icon.rendered'), true);
    assert.equal(isCopyOnlyAssetKind('preview'), true);
    assert.equal(isCopyOnlyAssetKind('destroyed.texture'), true);
    assert.equal(isComposableIconAssetKind('preview'), false);
    assert.equal(isCopyOnlyAssetKind('icon.rendered'), false);
});

test('getCoLocatedStructureAssetFileName maps destroyed icon kinds', () => {
    assert.equal(
        getCoLocatedStructureAssetFileName('wood', 'destroyed.icon.rendered'),
        'wood.destroyed.icon.rendered.webp',
    );
});

test('nested destroyed assets require raw destroyed renders', async () => {
    const tempRoot = await mkdtemp(resolve(tmpdir(), 'foxwatch-icon-destroyed-'));
    const rawRenderedRoot = resolve(tempRoot, 'rendered-assets/types/vehicles/truckliquidc');
    await mkdir(rawRenderedRoot, { recursive: true });
    await copyFile(
        resolve(fixtureRoot, 'visible-render-256.webp'),
        resolve(rawRenderedRoot, 'truckliquidc.destroyed.texture.webp'),
    );

    const structure = {
        id: 'truckliquidc',
        isVehicle: true,
        destroyed: { componentName: 'DestroyedMesh' },
    };
    const resolveAssetTypeName = () => 'vehicles';
    const destroyedRenderScenes = new Set(['truckliquidc']);

    assert.equal(
        await hasRawDestroyedRenderAssets('truckliquidc', resolve(tempRoot, 'rendered-assets/types'), resolveAssetTypeName),
        true,
    );
    assert.equal(
        await structureHasPublishableNestedDestroyed(
            structure,
            resolve(tempRoot, 'rendered-assets/types'),
            resolveAssetTypeName,
            destroyedRenderScenes,
        ),
        true,
    );
    assert.equal(
        await structureHasPublishableNestedDestroyed(
            { id: 'truckw', isVehicle: true, destroyed: { componentName: 'DestroyedMesh' } },
            resolve(tempRoot, 'rendered-assets/types'),
            resolveAssetTypeName,
            destroyedRenderScenes,
        ),
        false,
    );
});

test('destroyed preview copy does not fall back to icon.default', async () => {
    const tempRoot = await mkdtemp(resolve(tmpdir(), 'foxwatch-icon-destroyed-copy-'));
    await mkdir(resolve(tempRoot, 'rendered-assets/types/vehicles/truckw'), { recursive: true });
    await mkdir(resolve(tempRoot, 'foxhole-icons'), { recursive: true });

    const source = await resolveRawVisualCopySource({
        structureId: 'truckw',
        assetKind: 'destroyed.preview',
        structure: { id: 'truckw', destroyed: { componentName: 'DestroyedMesh' } },
        sourceStructure: null,
        rawRenderedAssetTypesDirectory: resolve(tempRoot, 'rendered-assets/types'),
        generatedIconsDirectory: resolve(tempRoot, 'foxhole-icons'),
        publicAssetsDirectory: resolve(tempRoot, 'public/assets'),
        resolveAssetTypeName: () => 'vehicles',
    });

    assert.equal(source, null);
});
