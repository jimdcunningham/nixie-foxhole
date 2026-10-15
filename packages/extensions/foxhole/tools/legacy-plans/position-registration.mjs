import sharp from 'sharp';

const BOARD_PIXELS_PER_SAMPLE = 4;
const ALPHA_THRESHOLD = 64;
const COORDINATE_BIAS = 4096;
const COORDINATE_STRIDE = 8192;

function pack(x, y) {
    return (x + COORDINATE_BIAS) * COORDINATE_STRIDE + y + COORDINATE_BIAS;
}

/** Sample a rendered sprite in board coordinates, preserving its original origin. */
export async function samplePlacedAlpha(filePath, width, height, topLeftX, topLeftY,
    rotationDeg = 0, boardPixelsPerSample = BOARD_PIXELS_PER_SAMPLE) {
    const sampleWidth = Math.max(1, Math.round(width / boardPixelsPerSample));
    const sampleHeight = Math.max(1, Math.round(height / boardPixelsPerSample));
    const { data, info } = await sharp(filePath)
        .ensureAlpha()
        .resize(sampleWidth, sampleHeight, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const angle = rotationDeg * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const points = [];
    const occupied = new Set();
    let sumX = 0;
    let sumY = 0;
    for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
            if (data[(y * info.width + x) * info.channels + 3] <= ALPHA_THRESHOLD) {
                continue;
            }
            const localX = (topLeftX + (x + 0.5) * width / info.width) / boardPixelsPerSample;
            const localY = (topLeftY + (y + 0.5) * height / info.height) / boardPixelsPerSample;
            const px = Math.round(localX * cos - localY * sin);
            const py = Math.round(localX * sin + localY * cos);
            const key = pack(px, py);
            if (occupied.has(key)) {
                continue;
            }
            occupied.add(key);
            points.push({ x: px, y: py });
            sumX += px;
            sumY += py;
        }
    }
    if (!points.length) {
        return null;
    }
    return {
        points,
        occupied,
        centroid: { x: sumX / points.length, y: sumY / points.length },
    };
}

function overlapScore(legacy, nixie, dx, dy) {
    let intersection = 0;
    for (const point of nixie.points) {
        if (legacy.occupied.has(pack(point.x + dx, point.y + dy))) {
            intersection++;
        }
    }
    return 2 * intersection / (legacy.points.length + nixie.points.length);
}

/** Return the translation of the Nixie origin that overlaps the legacy image. */
export function registerAlphaTranslation(legacy, nixie) {
    const centerX = Math.round(legacy.centroid.x - nixie.centroid.x);
    const centerY = Math.round(legacy.centroid.y - nixie.centroid.y);
    const originScore = overlapScore(legacy, nixie, 0, 0);
    let best = { dx: 0, dy: 0, score: originScore };
    const consider = (dx, dy) => {
        const score = overlapScore(legacy, nixie, dx, dy);
        if (score > best.score) {
            best = { dx, dy, score };
        }
    };
    for (let dy = centerY - 30; dy <= centerY + 30; dy += 3) {
        for (let dx = centerX - 30; dx <= centerX + 30; dx += 3) {
            consider(dx, dy);
        }
    }
    const coarse = best;
    for (let dy = coarse.dy - 4; dy <= coarse.dy + 4; dy++) {
        for (let dx = coarse.dx - 4; dx <= coarse.dx + 4; dx++) {
            consider(dx, dy);
        }
    }
    return {
        x: best.dx * BOARD_PIXELS_PER_SAMPLE,
        y: best.dy * BOARD_PIXELS_PER_SAMPLE,
        score: Math.round(best.score * 10000) / 10000,
        originScore: Math.round(originScore * 10000) / 10000,
        areaRatio: Math.round(Math.min(legacy.points.length, nixie.points.length)
            / Math.max(legacy.points.length, nixie.points.length) * 10000) / 10000,
    };
}

/** Refine a coarse board-pixel correction without searching the full-resolution image globally. */
export function refineAlphaTranslation(legacy, nixie, coarseX, coarseY, radius = BOARD_PIXELS_PER_SAMPLE) {
    const originScore = overlapScore(legacy, nixie, 0, 0);
    let best = { x: coarseX, y: coarseY, score: overlapScore(legacy, nixie, coarseX, coarseY) };
    for (let y = coarseY - radius; y <= coarseY + radius; y += 1) {
        for (let x = coarseX - radius; x <= coarseX + radius; x += 1) {
            const score = overlapScore(legacy, nixie, x, y);
            if (score > best.score) best = { x, y, score };
        }
    }
    return {
        x: best.x,
        y: best.y,
        score: Math.round(best.score * 10000) / 10000,
        originScore: Math.round(originScore * 10000) / 10000,
        areaRatio: Math.round(Math.min(legacy.points.length, nixie.points.length)
            / Math.max(legacy.points.length, nixie.points.length) * 10000) / 10000,
    };
}
