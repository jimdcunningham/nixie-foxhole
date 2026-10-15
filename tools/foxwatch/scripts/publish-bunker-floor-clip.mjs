import sharp from 'sharp';

const FIXED_SQUARE_BUNKER_IDS = /^(?:fortt[123]|ammoroomt[23]|artilleryait[123]|atgunait[123]|engineroomt[23]|fortflamet[23]|fortradart[123]|fortrampt[123]|medicalroomt[123]|mgait[123]|observationbunkert[123]|rifleait[123]|fortfirepitt[123]|fortartillerysheltert[123]|weatherstation)$/;
const CORNER_BUNKER_IDS = /^fortcornert[123]$/;
const FIXED_TRENCH_IDS = /^trencht[123]$/;
const FIXED_INTERSECTION_IDS = /^trenchintt[123]$/;
const INTERSECTION_FLOOR_SIZE_METERS = 5;
const TRENCH_FLOOR_LENGTH_METERS = 10;
const TRENCH_FLOOR_WIDTH_METERS = 3;
const BUNKER_FLOOR_HALF_SIZE_PIXELS = 160;

export function getBunkerFloorClipKind(filePath) {
    const normalized = String(filePath ?? '').replaceAll('\\', '/').toLowerCase();
    const match = normalized.match(/\/types\/structures\/([^/]+)\/components\/(floor|floormesh)\/\2\.texture\.(?:webp|json)$/);
    if (!match) return null;
    if (match[2] === 'floormesh' && match[1] !== 'weatherstation') return null;
    if (FIXED_SQUARE_BUNKER_IDS.test(match[1])) return 'square';
    if (CORNER_BUNKER_IDS.test(match[1])) return 'corner';
    if (FIXED_TRENCH_IDS.test(match[1])) return 'trench';
    if (FIXED_INTERSECTION_IDS.test(match[1])) return 'intersection';
    return null;
}

function isLosslessWebp(content) {
    if (content.toString('ascii', 0, 4) !== 'RIFF' || content.toString('ascii', 8, 12) !== 'WEBP') return false;
    for (let offset = 12; offset + 8 <= content.length;) {
        const length = content.readUInt32LE(offset + 4);
        if (content.toString('ascii', offset, offset + 4) === 'VP8L') return true;
        offset += 8 + length + (length & 1);
    }
    return false;
}

export function getBunkerFloorClipPoints(kind, anchorPixelX, anchorPixelY, pixelsPerMeter = 64) {
    if (kind !== 'square' && kind !== 'corner' && kind !== 'trench' && kind !== 'intersection') {
        throw new Error(`Unknown floor clip kind: ${kind}`);
    }
    if (kind === 'trench' || kind === 'intersection') {
        if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0) {
            throw new Error('Trench floor sidecar is missing a valid pixel scale.');
        }
        // Retain the 5 m socket footprint; the planner masks unused approaches beneath the walls.
        const length = kind === 'intersection' ? INTERSECTION_FLOOR_SIZE_METERS : TRENCH_FLOOR_LENGTH_METERS;
        const halfLength = length * pixelsPerMeter / 2;
        const width = kind === 'intersection' ? INTERSECTION_FLOOR_SIZE_METERS : TRENCH_FLOOR_WIDTH_METERS;
        const halfWidth = width * pixelsPerMeter / 2;
        return [[-halfLength, -halfWidth], [halfLength, -halfWidth],
            [halfLength, halfWidth], [-halfLength, halfWidth]]
            .map(([x, y]) => [x + anchorPixelX, y + anchorPixelY]);
    }
    const half = BUNKER_FLOOR_HALF_SIZE_PIXELS;
    const diagonalEnd = -half / 5;
    const points = kind === 'square'
        ? [[-half, -half], [half, -half], [half, half], [-half, half]]
        : [[-half, -half], [half, -half], [half, diagonalEnd], [diagonalEnd, half], [-half, half]];
    return points.map(([x, y]) => [x + anchorPixelX, y + anchorPixelY]);
}

function getBunkerFloorCrop(sidecarContent, kind) {
    const sidecar = JSON.parse(sidecarContent.toString('utf8'));
    const { width, height, anchorPixelX, anchorPixelY } = sidecar;
    if (![width, height, anchorPixelX, anchorPixelY].every(Number.isFinite)
        || width <= 0 || height <= 0 || !Number.isInteger(width) || !Number.isInteger(height)) {
        throw new Error('Bunker floor sidecar is missing valid dimensions or anchor.');
    }
    const points = getBunkerFloorClipPoints(kind, anchorPixelX, anchorPixelY,
        kind === 'trench' || kind === 'intersection' ? sidecar.pixelsPerMeter : 64);
    const left = Math.floor(Math.min(...points.map(([x]) => x)));
    const top = Math.floor(Math.min(...points.map(([, y]) => y)));
    const right = Math.ceil(Math.max(...points.map(([x]) => x)));
    const bottom = Math.ceil(Math.max(...points.map(([, y]) => y)));
    if (left < 0 || top < 0 || right > width || bottom > height) {
        throw new Error('Bunker floor clip extends outside the lossless render.');
    }
    return { sidecar, points, left, top, width: right - left, height: bottom - top };
}

export function cropBunkerFloorSidecar(sidecarContent, kind) {
    const crop = getBunkerFloorCrop(sidecarContent, kind);
    const anchorPixelX = crop.sidecar.anchorPixelX - crop.left;
    const anchorPixelY = crop.sidecar.anchorPixelY - crop.top;
    const imageCenterPixelX = crop.width / 2;
    const imageCenterPixelY = crop.height / 2;
    const offsetX = imageCenterPixelX - anchorPixelX;
    const offsetY = imageCenterPixelY - anchorPixelY;
    return Buffer.from(`${JSON.stringify({
        ...crop.sidecar,
        width: crop.width,
        height: crop.height,
        anchorPixelX,
        anchorPixelY,
        imageCenterPixelX,
        imageCenterPixelY,
        offsetXPixels: offsetX,
        offsetYPixels: offsetY,
        offsetX,
        offsetY,
    }, null, 2)}\n`);
}

export async function clipBunkerFloorTexture(sourceContent, sidecarContent, kind) {
    if (!isLosslessWebp(sourceContent)) {
        throw new Error('Floor render must be lossless WebP before clipping; rerender with --force-render.');
    }
    const crop = getBunkerFloorCrop(sidecarContent, kind);
    const sourceMetadata = await sharp(sourceContent).metadata();
    if (sourceMetadata.width !== crop.sidecar.width || sourceMetadata.height !== crop.sidecar.height) {
        throw new Error('Bunker floor sidecar dimensions do not match the lossless render.');
    }
    const polygon = crop.points.map(([x, y]) => `${x - crop.left},${y - crop.top}`).join(' ');
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${crop.width}" height="${crop.height}" viewBox="0 0 ${crop.width} ${crop.height}"><polygon points="${polygon}" fill="white"/></svg>`);
    return sharp(sourceContent)
        .extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height })
        .ensureAlpha()
        .composite([{ input: mask, blend: 'dest-in' }])
        .webp({ quality: 90, alphaQuality: 100, effort: 6 })
        .toBuffer();
}
