import sharp from 'sharp';

const CANDIDATE_OFFSETS_DEG = [0, 90, -90, 180];
const SAMPLE_SIZE = 128;
const ALPHA_THRESHOLD = 8;

function normalizeRotationDeg(value) {
    let deg = Number(value);
    if (!Number.isFinite(deg)) {
        return 0;
    }
    while (deg > 180) {
        deg -= 360;
    }
    while (deg <= -180) {
        deg += 360;
    }
    return deg;
}

function offsetRank(offset) {
    if (offset === 0) {
        return 0;
    }
    if (offset === 90) {
        return 1;
    }
    if (offset === -90) {
        return 2;
    }
    return 3;
}

function aspectKind(width, height) {
    if (!(width > 0) || !(height > 0)) {
        return 'unknown';
    }
    const ratio = width / height;
    if (ratio > 1.12) {
        return 'landscape';
    }
    if (ratio < 0.88) {
        return 'portrait';
    }
    return 'square';
}

function resolveAspectKind(width, height) {
    if (!(Number(width) > 0) || !(Number(height) > 0)) {
        return null;
    }
    return aspectKind(width, height);
}

function aspectCompatible(legacyKind, nixieKind, offset) {
    if (legacyKind === 'unknown' || nixieKind === 'unknown') {
        return true;
    }
    if (legacyKind === 'square' || nixieKind === 'square') {
        return true;
    }
    if (offset === 0 || offset === 180) {
        return legacyKind === nixieKind;
    }
    return legacyKind !== nixieKind;
}

function findAlphaBounds(data, width, height) {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const alpha = data[(y * width + x) * 4 + 3];
            if (alpha <= ALPHA_THRESHOLD) {
                continue;
            }
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }

    if (maxX < minX || maxY < minY) {
        return null;
    }

    return {
        left: minX,
        top: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
    };
}

async function loadAlphaMask(filePath) {
    const { data, info } = await sharp(filePath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const bounds = findAlphaBounds(data, info.width, info.height);
    if (!bounds) {
        return null;
    }

    const cropped = await sharp(filePath)
        .ensureAlpha()
        .extract(bounds)
        .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .raw()
        .toBuffer({ resolveWithObject: true });

    const alpha = new Uint8Array(SAMPLE_SIZE * SAMPLE_SIZE);
    for (let index = 0; index < alpha.length; index++) {
        alpha[index] = cropped.data[index * 4 + 3] > ALPHA_THRESHOLD ? 255 : 0;
    }

    return {
        alpha,
        width: SAMPLE_SIZE,
        height: SAMPLE_SIZE,
        sourceWidth: info.width,
        sourceHeight: info.height,
        bounds,
    };
}

async function rotateAlphaMask(mask, degrees) {
    const normalized = normalizeRotationDeg(degrees);
    if (normalized === 0) {
        return mask;
    }

    const rgba = Buffer.alloc(SAMPLE_SIZE * SAMPLE_SIZE * 4);
    for (let index = 0; index < mask.alpha.length; index++) {
        const value = mask.alpha[index];
        rgba[index * 4] = value;
        rgba[index * 4 + 1] = value;
        rgba[index * 4 + 2] = value;
        rgba[index * 4 + 3] = value;
    }

    const { data, info } = await sharp(rgba, {
        raw: {
            width: SAMPLE_SIZE,
            height: SAMPLE_SIZE,
            channels: 4,
        },
    })
        .rotate(normalized, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const alpha = new Uint8Array(SAMPLE_SIZE * SAMPLE_SIZE);
    for (let index = 0; index < alpha.length; index++) {
        alpha[index] = data[index * 4 + 3] > ALPHA_THRESHOLD ? 255 : 0;
    }

    return {
        alpha,
        width: info.width,
        height: info.height,
        sourceWidth: mask.sourceWidth,
        sourceHeight: mask.sourceHeight,
        bounds: mask.bounds,
    };
}

export function scoreAlphaMaskPair(referenceMask, candidateMask) {
    let intersection = 0;
    let union = 0;
    let referenceArea = 0;
    let candidateArea = 0;

    for (let index = 0; index < referenceMask.alpha.length; index++) {
        const reference = referenceMask.alpha[index] > 0 ? 1 : 0;
        const candidate = candidateMask.alpha[index] > 0 ? 1 : 0;
        intersection += reference & candidate;
        union += reference | candidate;
        referenceArea += reference;
        candidateArea += candidate;
    }

    if (union === 0) {
        return {
            score: 0,
            iou: 0,
            dice: 0,
            coverage: 0,
        };
    }

    const iou = intersection / union;
    const dice = (2 * intersection) / (referenceArea + candidateArea || 1);
    const coverage = intersection / (referenceArea || 1);
    return {
        score: iou * 0.55 + dice * 0.35 + coverage * 0.10,
        iou,
        dice,
        coverage,
    };
}

export async function scoreLegacyNixieOrientation(options) {
    const legacyMask = await loadAlphaMask(options.legacyTexturePath);
    const nixieMask = await loadAlphaMask(options.nixieTexturePath);
    if (!legacyMask || !nixieMask) {
        return null;
    }

    // Prefer authored sprite/texture metadata over padded file canvases (e.g. 256² WebP).
    // Fall back to visible alpha bounds, never the padded source canvas alone.
    const legacyKind = options.legacyAspectKind
        ?? resolveAspectKind(options.legacyWidth, options.legacyHeight)
        ?? aspectKind(legacyMask.bounds.width, legacyMask.bounds.height);
    const nixieKind = options.nixieAspectKind
        ?? resolveAspectKind(options.nixieWidth, options.nixieHeight)
        ?? aspectKind(nixieMask.bounds.width, nixieMask.bounds.height);
    const results = [];

    for (const offset of CANDIDATE_OFFSETS_DEG) {
        if (!aspectCompatible(legacyKind, nixieKind, offset)) {
            continue;
        }
        const rotatedLegacy = await rotateAlphaMask(legacyMask, offset);
        const metrics = scoreAlphaMaskPair(nixieMask, rotatedLegacy);
        results.push({
            offset,
            ...metrics,
        });
    }

    if (!results.length) {
        return null;
    }

    results.sort((left, right) => {
        const delta = right.score - left.score;
        const involvesIdentityFlip = (left.offset === 0 && right.offset === 180)
            || (left.offset === 180 && right.offset === 0);
        // Same-aspect assets are often near 180-symmetric after contain-fit; prefer 0
        // unless 180 wins by a clear margin.
        const marginNeeded = involvesIdentityFlip ? 0.05 : 1e-6;
        if (Math.abs(delta) > marginNeeded) {
            return delta;
        }
        return offsetRank(left.offset) - offsetRank(right.offset);
    });

    const best = results[0];
    const second = results[1] ?? null;
    const margin = second ? Math.abs(best.score - second.score) : best.score;
    const confidence = best.score >= 0.95 && margin >= 0.01
        ? 'high'
        : best.score >= 0.82 && margin >= 0.03
            ? 'high'
            : best.score >= 0.70 && margin >= 0.005
                ? 'medium'
                : 'low';

    return {
        textureBakeDeltaDeg: best.offset,
        rotationOffsetDeg: normalizeRotationDeg(-best.offset),
        confidence,
        method: 'alpha-sample',
        alphaScore: Number(best.score.toFixed(4)),
        alphaIoU: Number(best.iou.toFixed(4)),
        alphaDice: Number(best.dice.toFixed(4)),
        alphaMargin: Number(margin.toFixed(4)),
        legacyAspect: legacyKind,
        nixieAspect: nixieKind,
        candidateScores: results.map(entry => ({
            offset: entry.offset,
            score: Number(entry.score.toFixed(4)),
            iou: Number(entry.iou.toFixed(4)),
        })),
    };
}
