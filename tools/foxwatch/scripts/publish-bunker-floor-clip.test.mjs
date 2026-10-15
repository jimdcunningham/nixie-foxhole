import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';

import { clipBunkerFloorTexture, cropBunkerFloorSidecar, getBunkerFloorClipKind, getBunkerFloorClipPoints } from './publish-bunker-floor-clip.mjs';

const FLOOR_PATH = 'C:/assets/types/structures/fortfirepitt1/components/floor/floor.texture.webp';

test('only fixed bunker and trench floors are clipped during publication', () => {
    assert.equal(getBunkerFloorClipKind(FLOOR_PATH), 'square');
    assert.equal(getBunkerFloorClipKind(FLOOR_PATH.replace('fortfirepitt1', 'fortflamet3')), 'square');
    assert.equal(getBunkerFloorClipKind(FLOOR_PATH.replace('fortfirepitt1', 'fortcornert2')), 'corner');
    assert.equal(getBunkerFloorClipKind(FLOOR_PATH.replace('fortfirepitt1/components/floor/floor', 'weatherstation/components/floormesh/floormesh')), 'square');
    for (const id of ['trencht1', 'trencht2', 'trencht3']) {
        assert.equal(getBunkerFloorClipKind(FLOOR_PATH.replace('fortfirepitt1', id)), 'trench');
    }
    assert.equal(getBunkerFloorClipKind(FLOOR_PATH.replace('fortfirepitt1', 'trenchempt2')), null);
    assert.equal(getBunkerFloorClipKind(FLOOR_PATH.replace('/floor/', '/roof/')), null);
    assert.equal(getBunkerFloorClipKind(FLOOR_PATH.replace('.webp', '.json')), 'square');
});

test('trench publication clip uses the 10 m by 3 m footprint', () => {
    assert.deepEqual(getBunkerFloorClipPoints('trench', 400, 200, 64), [
        [80, 104], [720, 104], [720, 296], [80, 296],
    ]);
});

test('corner publication clip keeps the unconnected diagonal footprint', () => {
    assert.deepEqual(getBunkerFloorClipPoints('corner', 250, 250), [
        [90, 90], [410, 90], [410, 218], [218, 410], [90, 410],
    ]);
});

test('floor clipping uses the authored anchor rather than the image center', () => {
    const imageCenter = 237.5;
    const offset = 2.6480548083782196;
    const points = getBunkerFloorClipPoints('square', imageCenter - offset, 232.5 + 4.614518880844116);
    assert.equal(points[0][0] - imageCenter + offset, -160);
    assert.equal(points[1][0] - imageCenter + offset, 160);
});

test('bunker floor cropping preserves world placement and interior pixels', async () => {
    const width = 500;
    const height = 500;
    const pixels = Buffer.alloc(width * height * 4, 255);
    const source = await sharp(pixels, { raw: { width, height, channels: 4 } })
        .webp({ lossless: true }).toBuffer();
    const sidecar = Buffer.from(JSON.stringify({ width, height, anchorPixelX: 249.25, anchorPixelY: 252.5 }));
    const square = await clipBunkerFloorTexture(source, sidecar, 'square');
    const corner = await clipBunkerFloorTexture(source, sidecar, 'corner');
    const publishedSidecar = JSON.parse(cropBunkerFloorSidecar(sidecar, 'square').toString());
    const decodedSquare = await sharp(square).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const decodedCorner = await sharp(corner).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = ({ data, info }, x, y) => data[(y * info.width + x) * 4 + 3];

    assert.equal(source.toString('ascii', 12, 16), 'VP8L');
    assert.equal(decodedSquare.info.width, 321);
    assert.equal(decodedSquare.info.height, 321);
    assert.equal(publishedSidecar.width, decodedSquare.info.width);
    assert.equal(publishedSidecar.height, decodedSquare.info.height);
    assert.equal(publishedSidecar.anchorPixelX, 160.25);
    assert.equal(publishedSidecar.anchorPixelY, 160.5);
    assert.equal(publishedSidecar.offsetX, publishedSidecar.imageCenterPixelX - publishedSidecar.anchorPixelX);
    assert.equal(publishedSidecar.offsetY, publishedSidecar.imageCenterPixelY - publishedSidecar.anchorPixelY);
    assert.equal(249.25 - 89, publishedSidecar.anchorPixelX);
    assert.equal(alpha(decodedSquare, 160, 160), 255);
    assert.equal(alpha(decodedCorner, 260, 260), 0);
    assert.equal(alpha(decodedCorner, 10, 260), 255);
});

test('bunker floor clipping rejects lossy source renders', async () => {
    const source = await sharp(Buffer.alloc(32 * 32 * 4, 255),
        { raw: { width: 32, height: 32, channels: 4 } }).webp({ quality: 90 }).toBuffer();
    await assert.rejects(clipBunkerFloorTexture(source,
        Buffer.from(JSON.stringify({ width: 32, height: 32, anchorPixelX: 16, anchorPixelY: 16 })), 'square'),
    /must be lossless WebP/);
});

test('trench floor cropping retains its world anchor and only the footprint pixels', async () => {
    const width = 800;
    const height = 400;
    const source = await sharp(Buffer.alloc(width * height * 4, 255),
        { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toBuffer();
    const sidecar = Buffer.from(JSON.stringify({
        width, height, pixelsPerMeter: 64, anchorPixelX: 400.25, anchorPixelY: 200.5,
    }));
    const published = await clipBunkerFloorTexture(source, sidecar, 'trench');
    const metadata = await sharp(published).metadata();
    const cropped = JSON.parse(cropBunkerFloorSidecar(sidecar, 'trench').toString());

    assert.equal(metadata.width, 641);
    assert.equal(metadata.height, 193);
    assert.equal(cropped.width, metadata.width);
    assert.equal(cropped.height, metadata.height);
    assert.equal(cropped.anchorPixelX, 320.25);
    assert.equal(cropped.anchorPixelY, 96.5);
    assert.equal(cropped.offsetX, metadata.width / 2 - cropped.anchorPixelX);
    assert.equal(cropped.offsetY, metadata.height / 2 - cropped.anchorPixelY);
});


test('intersection publication trims only completed tier floors to the centered 5 m socket footprint', () => {
    for (const id of ['trenchintt1', 'trenchintt2', 'trenchintt3']) {
        assert.equal(getBunkerFloorClipKind(FLOOR_PATH.replace('fortfirepitt1', id)), 'intersection');
    }
    for (const id of ['trenchintbuildsite', 'trenchintdestroyedt1', 'trenchintdestroyedt2', 'trenchintdestroyedt3']) {
        assert.equal(getBunkerFloorClipKind(FLOOR_PATH.replace('fortfirepitt1', id)), null);
    }
    assert.deepEqual(getBunkerFloorClipPoints('intersection', 250, 240, 64), [
        [90, 80], [410, 80], [410, 400], [90, 400],
    ]);
    assert.deepEqual(getBunkerFloorClipPoints('intersection', 125, 120, 32), [
        [45, 40], [205, 40], [205, 200], [45, 200],
    ]);
});

test('intersection cropping preserves its fractional world anchor and removes exterior pixels', async () => {
    const width = 475;
    const height = 465;
    const source = await sharp(Buffer.alloc(width * height * 4, 255),
        { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toBuffer();
    const sidecar = Buffer.from(JSON.stringify({
        width, height, pixelsPerMeter: 64, anchorPixelX: 234.85194519162178, anchorPixelY: 237.11451888084412,
    }));
    const published = await clipBunkerFloorTexture(source, sidecar, 'intersection');
    const decoded = await sharp(published).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const cropped = JSON.parse(cropBunkerFloorSidecar(sidecar, 'intersection').toString());
    assert.equal(decoded.info.width, 321);
    assert.equal(decoded.info.height, 321);
    assert.equal(cropped.width, decoded.info.width);
    assert.equal(cropped.height, decoded.info.height);
    assert.equal(cropped.anchorPixelX + 74, 234.85194519162178);
    assert.equal(cropped.anchorPixelY + 77, 237.11451888084412);
    assert.equal(cropped.offsetX, 160.5 - cropped.anchorPixelX);
    assert.equal(cropped.offsetY, 160.5 - cropped.anchorPixelY);
    assert.equal(decoded.data[(160 * 321 + 160) * 4 + 3], 255);
    assert.throws(() => cropBunkerFloorSidecar(Buffer.from(JSON.stringify({ width, height,
        anchorPixelX: 234, anchorPixelY: 237, pixelsPerMeter: 0 })), 'intersection'), /valid pixel scale/);
});
