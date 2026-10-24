import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

/** Decode a browser atlas cell while the publisher may replace its source file. */
export async function readBrowserAtlasImage(filePath: string): Promise<Buffer> {
    // libvips caches filename-backed readers beyond toBuffer(). A retained Windows
    // handle denies the publisher's atomic rename while this build watcher lives.
    return sharp(await readFile(filePath))
        .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .ensureAlpha().raw().toBuffer();
}

/** The publisher and bundled authoring build produce identical UI atlas bytes. */
export async function createBrowserAtlas(files: readonly string[]): Promise<Buffer> {
    if (files.length > 64) throw new Error('A browser atlas holds at most 64 images.');
    const images = await Promise.all(files.map(readBrowserAtlasImage));
    const pixels = Buffer.alloc(2048 * 2048 * 4);
    for (const [index, image] of images.entries()) for (let row = 0; row < 256; row++) {
        image.copy(pixels, ((Math.floor(index / 8) * 256 + row) * 2048 + (index % 8) * 256) * 4, row * 256 * 4, (row + 1) * 256 * 4);
    }
    return sharp(pixels, { raw: { width: 2048, height: 2048, channels: 4 } }).webp({ lossless: true, effort: 6 }).toBuffer();
}
