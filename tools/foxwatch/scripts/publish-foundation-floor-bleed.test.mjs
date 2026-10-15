import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';

import {
    bleedFoundationFloorSidecar,
    bleedFoundationFloorTexture,
    FOUNDATION_FLOOR_BLEED_PIXELS,
    isFoundationFloorPublishedAsset,
} from './publish-foundation-floor-bleed.mjs';

test('only foundation floor textures and sidecars receive publication bleed', () => {
    const base = 'C:/assets/types/structures/foundation01t3/components/floor/floor.texture';
    assert.equal(isFoundationFloorPublishedAsset(`${base}.webp`), true);
    assert.equal(isFoundationFloorPublishedAsset(`${base}.json`), true);
    assert.equal(isFoundationFloorPublishedAsset(base.replaceAll('/', '\\') + '.webp'), true);
    assert.equal(isFoundationFloorPublishedAsset(base.replace('foundation01t3', 'facilitymine1') + '.webp'), false);
    assert.equal(isFoundationFloorPublishedAsset(base.replace('/floor/', '/walls/') + '.webp'), false);
    assert.equal(isFoundationFloorPublishedAsset(base.replace('floor.texture', 'floor.preview') + '.webp'), false);
});

test('foundation floor bleed extends solid edge pixels but preserves interior and distant transparency', async () => {
    const width = 12;
    const height = 12;
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (x < 1 || y < 1 || x + y > 13) continue;
            const index = (y * width + x) * 4;
            pixels[index] = x * 10;
            pixels[index + 1] = y * 10;
            pixels[index + 2] = 70;
            pixels[index + 3] = 255;
        }
    }
    const source = await sharp(pixels, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toBuffer();
    const published = await bleedFoundationFloorTexture(source);
    const { data, info } = await sharp(published).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pad = FOUNDATION_FLOOR_BLEED_PIXELS;
    const pixel = (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x + 1) * 4)];

    assert.equal(info.width, width + pad * 2);
    assert.equal(info.height, height + pad * 2);
    const interior = pixel(5 + pad, 5 + pad);
    assert.equal(interior[3], 255);
    for (const [channel, expected] of [50, 50, 70].entries()) {
        assert.ok(Math.abs(interior[channel] - expected) <= 4);
    }
    assert.equal(pixel(0, 7)[3], 255);
    assert.equal(pixel(15, 15)[3], 0);
});

test('foundation floor sidecar grows around its original center without shifting placement', () => {
    const original = {
        width: 320,
        height: 321,
        anchorPixelX: 160,
        anchorPixelY: 160.4999,
        imageCenterPixelX: 160,
        imageCenterPixelY: 160.5,
        offsetXPixels: 0,
        offsetYPixels: 0.0001,
        offsetX: 0,
        offsetY: 0.0001,
    };
    const published = JSON.parse(bleedFoundationFloorSidecar(Buffer.from(JSON.stringify(original))));
    assert.equal(published.width, 324);
    assert.equal(published.height, 325);
    assert.equal(published.anchorPixelX, 162);
    assert.equal(published.anchorPixelY, 162.4999);
    assert.equal(published.imageCenterPixelX / published.width, 0.5);
    assert.equal(published.imageCenterPixelY / published.height, 0.5);
    assert.equal(published.offsetYPixels, original.offsetYPixels);
    assert.equal(published.offsetY, original.offsetY);
});

test('foundation floor bleed keeps the board texture compact', async () => {
    const width = 96;
    const height = 96;
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const index = (y * width + x) * 4;
            const noise = (x * 71 + y * 43 + (x * y) % 137) % 256;
            pixels[index] = noise;
            pixels[index + 1] = (noise * 3) % 256;
            pixels[index + 2] = (x + y) % 256;
            pixels[index + 3] = x >= 2 && y >= 2 && x < width - 2 && y < height - 2 ? 255 : 0;
        }
    }
    const source = await sharp(pixels, { raw: { width, height, channels: 4 } })
        .webp({ lossless: true }).toBuffer();
    const published = await bleedFoundationFloorTexture(source);

    assert.ok(published.length < source.length,
        `foundation floor grew from ${source.length} to ${published.length} bytes`);
});


test('foundation floor bleed rejects an already lossy render', async () => {
    const source = await sharp(Buffer.alloc(8 * 8 * 4, 255),
        { raw: { width: 8, height: 8, channels: 4 } }).webp({ quality: 90 }).toBuffer();
    await assert.rejects(bleedFoundationFloorTexture(source), /must be lossless WebP/);
});
