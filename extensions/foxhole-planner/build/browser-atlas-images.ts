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
