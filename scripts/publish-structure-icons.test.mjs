import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import sharp from 'sharp';

import {
    DEFAULT_WRECKED_SUBTYPE_ICON_URL,
    getCoLocatedStructureAssetFileName,
    isAllowedRawSourcePath,
    isComposableIconAssetKind,
    isCopyOnlyAssetKind,
    normalizeIconContentDimensions,
    resolveRawIconSource,
    resolveSubtypeOverlayUrl,
    shouldSyncRenderedAssetToPublic,
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

test('writeCoLocatedIcon applies subtype exactly once', async () => {
    const tempRoot = await mkdtemp(resolve(tmpdir(), 'foxwatch-icon-compose-'));
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

    const topLeft = await sharp(outputPath).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    const info = await sharp(outputPath).metadata();
    assert.equal(info.width, 128);
    assert.equal(info.height, 128);
    assert.equal(topLeft[0], 255);
    assert.equal(topLeft[1], 0);
    assert.equal(topLeft[2], 0);
});

test('normalizeIconContentDimensions does not upscale blueprint icons', async () => {
    const content = await readFile(resolve(fixtureRoot, 'blueprint-100.png'));
    const normalized = await normalizeIconContentDimensions(content);
    const metadata = await sharp(normalized).metadata();
    assert.equal(metadata.width, 100);
    assert.equal(metadata.height, 100);
});

test('preview asset kind does not compose subtype overlays', async () => {
    const tempRoot = await mkdtemp(resolve(tmpdir(), 'foxwatch-icon-preview-'));
    const outputPath = resolve(tempRoot, 'wood.preview.webp');

    const rawSource = {
        sourceFilePath: resolve(fixtureRoot, 'preview-copy.webp'),
        content: await readFile(resolve(fixtureRoot, 'preview-copy.webp')),
    };

    await writeCoLocatedCopy({
        outputPath,
        rawSource,
    });

    assert.equal(
        (await readFile(outputPath)).equals(rawSource.content),
        true,
    );
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
