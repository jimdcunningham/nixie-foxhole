import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import sharp from 'sharp';

import {
    DEFAULT_WRECKED_SUBTYPE_ICON_URL,
    publishStructureIconsForManifest,
} from './publish-structure-icons.mjs';

const currentDir = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(currentDir, '../../../tests/fixtures/foxhole/icon-publish');

async function seedStructureLayout({
    tempRoot,
    structureId,
    blueprintFileName,
    blueprintKey,
    renderedFileName = null,
    defaultFileName = null,
    previewFileName = null,
    assetTypeName = 'structures',
}) {
    const rawRenderedRoot = resolve(tempRoot, 'rendered-assets/types');
    const generatedIconsRoot = resolve(tempRoot, 'foxhole-icons');
    const publicAssetsRoot = resolve(tempRoot, 'public/assets');
    const structureDir = resolve(rawRenderedRoot, assetTypeName, structureId);
    await mkdir(structureDir, { recursive: true });
    await mkdir(generatedIconsRoot, { recursive: true });

    await copyFile(
        resolve(fixtureRoot, blueprintFileName),
        resolve(generatedIconsRoot, `${blueprintKey}.png`),
    );
    await copyFile(
        resolve(fixtureRoot, 'subtype-wrecked-32.png'),
        resolve(generatedIconsRoot, 'subtypewreckedicon.png'),
    );
    await copyFile(
        resolve(fixtureRoot, 'subtype-salvage-32.png'),
        resolve(generatedIconsRoot, 'metal.png'),
    );

    if (defaultFileName) {
        await copyFile(
            resolve(fixtureRoot, defaultFileName),
            resolve(structureDir, `${structureId}.icon.default.webp`),
        );
    }

    if (renderedFileName) {
        await copyFile(
            resolve(fixtureRoot, renderedFileName),
            resolve(structureDir, `${structureId}.icon.rendered.webp`),
        );
    }

    if (previewFileName) {
        await copyFile(
            resolve(fixtureRoot, previewFileName),
            resolve(structureDir, `${structureId}.preview.webp`),
        );
    }

    return {
        rawRenderedRoot,
        generatedIconsRoot,
        publicAssetsRoot,
        outputDirectory: resolve(publicAssetsRoot, 'types', assetTypeName, structureId),
    };
}

async function readTopLeftPixel(filePath) {
    const { data } = await sharp(filePath).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    return [data[0], data[1], data[2], data[3]];
}

async function publishFixtureStructures(tempRoot, manifest, sourceManifest) {
    const generatedIconsRoot = resolve(tempRoot, 'foxhole-icons');
    const rawRenderedRoot = resolve(tempRoot, 'rendered-assets/types');
    const publicAssetsRoot = resolve(tempRoot, 'public/assets');

    return publishStructureIconsForManifest({
        manifest,
        sourceManifest,
        getOutputDirectory: structureId => resolve(publicAssetsRoot, 'types', 'structures', structureId),
        toPublicAssetUrl: filePath => `/foxhole/assets/${relative(publicAssetsRoot, filePath).replace(/\\/g, '/')}`,
        rawRenderedAssetTypesDirectory: rawRenderedRoot,
        generatedIconsDirectory: generatedIconsRoot,
        publicAssetsDirectory: publicAssetsRoot,
        resolveAssetTypeName: () => 'structures',
        skipExistingAssets: false,
        defaultWreckedSubtypeUrl: DEFAULT_WRECKED_SUBTYPE_ICON_URL,
    });
}

test('integration: six regression structures publish with expected icon behavior', async () => {
    const tempRoot = await mkdtemp(resolve(tmpdir(), 'foxwatch-icon-integration-'));
    const manifestSnippet = JSON.parse(await readFile(resolve(fixtureRoot, 'manifest-snippet.json'), 'utf8'));

    await seedStructureLayout({
        tempRoot,
        structureId: 'villagewsmallg1destroyed',
        blueprintFileName: 'blueprint-128.png',
        blueprintKey: 'villagewsmallg1destroyed',
        defaultFileName: 'visible-render-256.webp',
        renderedFileName: 'visible-render-256.webp',
    });
    await seedStructureLayout({
        tempRoot,
        structureId: 'trenchintdestroyedt1',
        blueprintFileName: 'blueprint-128.png',
        blueprintKey: 'trenchintt1',
    });
    await seedStructureLayout({
        tempRoot,
        structureId: 'facilitymineresource1',
        blueprintFileName: 'blueprint-128.png',
        blueprintKey: 'facilitymineresource1',
        renderedFileName: 'visible-render-256.webp',
    });
    await seedStructureLayout({
        tempRoot,
        structureId: 'wood',
        blueprintFileName: 'blueprint-128.png',
        blueprintKey: 'wood',
        renderedFileName: 'blank-render-256.webp',
        previewFileName: 'preview-copy.webp',
    });
    await seedStructureLayout({
        tempRoot,
        structureId: 'soldieruniformc',
        blueprintFileName: 'blueprint-128.png',
        blueprintKey: 'soldieruniformc',
        renderedFileName: 'blank-render-256.webp',
    });
    await seedStructureLayout({
        tempRoot,
        structureId: 'rpgammo',
        blueprintFileName: 'blueprint-100.png',
        blueprintKey: 'rpgammo',
        renderedFileName: 'blank-render-256.webp',
    });

    const manifest = {
        assets: manifestSnippet.assets.map(structure => ({
            ...structure,
            icons: {
                default: structure.iconUrl,
                rendered: `/foxhole/assets/types/structures/${structure.id}/${structure.id}.icon.rendered.webp`,
            },
            previewUrl: structure.id === 'wood'
                ? '/foxhole/assets/types/structures/wood/wood.preview.webp'
                : undefined,
        })),
    };

    const published = await publishFixtureStructures(tempRoot, manifest, { assets: manifestSnippet.assets });

    const village = published.assets.find(entry => entry.id === 'villagewsmallg1destroyed');
    const villageIconPath = resolve(tempRoot, 'public/assets/types/structures/villagewsmallg1destroyed/villagewsmallg1destroyed.icon.default.webp');
    assert.equal((await readTopLeftPixel(villageIconPath))[0], 255);
    assert.ok(village.icons.default.includes('villagewsmallg1destroyed.icon.default.webp'));

    const trenchIconPath = resolve(tempRoot, 'public/assets/types/structures/trenchintdestroyedt1/trenchintdestroyedt1.icon.default.webp');
    assert.equal((await readTopLeftPixel(trenchIconPath))[0], 255);

    const facilityRenderedPath = resolve(tempRoot, 'public/assets/types/structures/facilitymineresource1/facilitymineresource1.icon.rendered.webp');
    const facilityPixel = await readTopLeftPixel(facilityRenderedPath);
    assert.ok(facilityPixel[2] > 200);

    const woodRenderedPath = resolve(tempRoot, 'public/assets/types/structures/wood/wood.icon.rendered.webp');
    const woodMetadata = await sharp(woodRenderedPath).metadata();
    assert.equal(woodMetadata.width, 128);
    assert.equal(woodMetadata.height, 128);

    const soldierRenderedPath = resolve(tempRoot, 'public/assets/types/structures/soldieruniformc/soldieruniformc.icon.rendered.webp');
    const soldierPixel = await readTopLeftPixel(soldierRenderedPath);
    assert.ok(Math.abs(soldierPixel[0] - 40) <= 2);
    const soldier = published.assets.find(entry => entry.id === 'soldieruniformc');
    assert.equal(soldier.previewIsIconFallback, true);

    const rpgRenderedPath = resolve(tempRoot, 'public/assets/types/structures/rpgammo/rpgammo.icon.rendered.webp');
    const rpgMetadata = await sharp(rpgRenderedPath).metadata();
    assert.equal(rpgMetadata.width, 100);
    assert.equal(rpgMetadata.height, 100);

    const previewPath = resolve(tempRoot, 'public/assets/types/structures/wood/wood.preview.webp');
    assert.equal(
        (await readFile(previewPath)).equals(await readFile(resolve(fixtureRoot, 'preview-copy.webp'))),
        true,
    );
});
