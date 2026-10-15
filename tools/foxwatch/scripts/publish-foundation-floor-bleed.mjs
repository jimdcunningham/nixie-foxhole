import sharp from 'sharp';

const FOUNDATION_FLOOR_IDS = new Set([
    'foundation011x2t1',
    'foundation011x2t3',
    'foundation012x2t1',
    'foundation012x2t3',
    'foundation01t1',
    'foundation01t3',
    'foundation02t1',
    'foundation02t3',
]);

// Two texture pixels equal one board pixel at the Foxhole sprite scale.
export const FOUNDATION_FLOOR_BLEED_PIXELS = 2;

export function isFoundationFloorPublishedAsset(filePath) {
    const normalized = filePath.replaceAll('\\', '/').toLowerCase();
    const match = normalized.match(/\/types\/structures\/([^/]+)\/components\/floor\/(floor\.texture\.(?:webp|json))$/);
    return Boolean(match && FOUNDATION_FLOOR_IDS.has(match[1]));
}

export async function bleedFoundationFloorTexture(sourceContent) {
    // A lossy render would be compressed again here and blur the visible floor.
    let lossless = false;
    if (sourceContent.toString('ascii', 0, 4) === 'RIFF' && sourceContent.toString('ascii', 8, 12) === 'WEBP') {
        for (let offset = 12; offset + 8 <= sourceContent.length;) {
            const chunk = sourceContent.toString('ascii', offset, offset + 4);
            const length = sourceContent.readUInt32LE(offset + 4);
            if (chunk === 'VP8L') {
                lossless = true;
                break;
            }
            offset += 8 + length + (length & 1);
        }
    }
    if (!lossless) {
        throw new Error('Foundation floor render must be lossless WebP before bleed; rerender with --force-render.');
    }
    const { data, info } = await sharp(sourceContent).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const padding = FOUNDATION_FLOOR_BLEED_PIXELS;
    const outputWidth = width + padding * 2;
    const outputHeight = height + padding * 2;
    const output = Buffer.alloc(outputWidth * outputHeight * 4);

    for (let y = 0; y < height; y += 1) {
        data.copy(output, ((y + padding) * outputWidth + padding) * 4, y * width * 4, (y + 1) * width * 4);
    }

    // Extrude only the transparent edge. An opaque interior pixel supplies the
    // color, so the new overlap does not expose a dark antialiased fringe.
    for (let y = 0; y < outputHeight; y += 1) {
        for (let x = 0; x < outputWidth; x += 1) {
            const destinationIndex = (y * outputWidth + x) * 4;
            if (output[destinationIndex + 3] === 255) continue;

            let nearestIndex = -1;
            let nearestDistance = Infinity;
            // The source's outermost pixel can itself be antialiased. Search
            // one pixel farther inward so even the padded edge gets a solid
            // sample, while keeping the output only two pixels wider per side.
            for (let dy = -padding - 1; dy <= padding + 1; dy += 1) {
                const sourceY = y - padding + dy;
                if (sourceY < 0 || sourceY >= height) continue;
                for (let dx = -padding - 1; dx <= padding + 1; dx += 1) {
                    const sourceX = x - padding + dx;
                    if (sourceX < 0 || sourceX >= width) continue;
                    const sourceIndex = (sourceY * width + sourceX) * 4;
                    if (data[sourceIndex + 3] !== 255) continue;
                    const distance = dx * dx + dy * dy;
                    if (distance >= nearestDistance) continue;
                    nearestDistance = distance;
                    nearestIndex = sourceIndex;
                }
            }
            if (nearestIndex < 0) continue;
            data.copy(output, destinationIndex, nearestIndex, nearestIndex + 4);
        }
    }

    // Keep the published floor on the same lossy WebP policy as board textures.
    return sharp(output, { raw: { width: outputWidth, height: outputHeight, channels: 4 } })
        .webp({ quality: 90, alphaQuality: 100 })
        .toBuffer();
}

export function bleedFoundationFloorSidecar(sourceContent) {
    const sidecar = JSON.parse(sourceContent.toString('utf8'));
    const padding = FOUNDATION_FLOOR_BLEED_PIXELS;
    for (const key of ['width', 'height']) {
        if (!Number.isFinite(sidecar[key])) throw new Error(`Foundation floor sidecar is missing ${key}`);
        sidecar[key] += padding * 2;
    }
    for (const key of ['anchorPixelX', 'anchorPixelY', 'imageCenterPixelX', 'imageCenterPixelY']) {
        if (!Number.isFinite(sidecar[key])) throw new Error(`Foundation floor sidecar is missing ${key}`);
        sidecar[key] += padding;
    }
    return `${JSON.stringify(sidecar, null, 2)}\n`;
}
