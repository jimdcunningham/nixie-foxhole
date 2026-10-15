import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreLegacyNixieOrientation } from './orientation-alpha-sample.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GAME_KITCHEN = process.env.GAME_KITCHEN_PATH || 'C:/Code/game-kitchen';
const PLANNER_ROOT = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.resolve(PLANNER_ROOT, 'public/foxhole/assets/manifest.v1.json');
const KEY_MAP_PATH = path.resolve(PLANNER_ROOT, 'app/plugins/foxhole/legacy/plan-building-key-map.ts');
const OUT_TS = path.resolve(PLANNER_ROOT, 'app/plugins/foxhole/legacy/plan-orientation-map.ts');
const OUT_JSON = path.resolve(__dirname, 'orientation-map.json');
const ORIENTATION_OVERRIDES_PATH = path.resolve(__dirname, 'orientation-overrides.json');
const ORIENTATION_QA_PATH = path.resolve(__dirname, 'orientation-qa.json');

const CANDIDATE_OFFSETS_DEG = [0, 90, -90, 180];
/** Legacy `assignRange` centers arcs at π/2; Nixie uses `r`/`rotation` with 0 = +X. */
const LEGACY_RANGE_FACING_DEFAULT_DEG = 90;

function extractBalanced(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '{') {
            depth++;
        } else if (text[i] === '}') {
            depth--;
            if (depth === 0) {
                return text.slice(open, i + 1);
            }
        }
    }
    return null;
}

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

function rotationDelta(a, b) {
    return Math.abs(normalizeRotationDeg(a - b));
}

function preferSocketName(name) {
    const normalized = String(name ?? '').trim();
    if (!normalized) {
        return '';
    }
    const colon = normalized.lastIndexOf(':');
    if (colon >= 0 && colon < normalized.length - 1) {
        return normalized.slice(colon + 1);
    }
    return normalized;
}

function isFoundationSocketName(name) {
    return /foundation/i.test(String(name ?? ''));
}

function rotatePoint(x, y, originX, originY, degrees) {
    const rad = (degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = x - originX;
    const dy = y - originY;
    return {
        x: originX + dx * cos - dy * sin,
        y: originY + dx * sin + dy * cos,
    };
}

function applyFrameOffsetToLegacySocket(socket, origin, rotationOffsetDeg) {
    const rotated = rotatePoint(socket.x, socket.y, origin.x, origin.y, rotationOffsetDeg);
    return {
        ...socket,
        x: rotated.x,
        y: rotated.y,
        rotation: normalizeRotationDeg(socket.rotation + rotationOffsetDeg),
    };
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

function resolveLegacyTexturePath(gameKitchen, textureSrc) {
    const normalizedSrc = String(textureSrc ?? '').trim().replace(/\\/g, '/');
    if (!normalizedSrc) {
        return null;
    }
    const fileName = path.basename(normalizedSrc);
    // data.js uses paths like ../Vehicles/foo.webp or ../Structures/foo.webp
    const underTextures = normalizedSrc.replace(/^\.\.\//, '');
    const textureRoots = [
        path.join(gameKitchen, 'public/assets/foxhole/game/Textures'),
        path.join(gameKitchen, '.output/public/assets/foxhole/game/Textures'),
    ];
    const candidates = [];
    for (const root of textureRoots) {
        candidates.push(path.join(root, underTextures));
        candidates.push(path.join(root, 'Structures', fileName));
        candidates.push(path.join(root, 'Vehicles', fileName));
        candidates.push(path.join(root, 'Blueprints', fileName));
    }
    candidates.push(
        path.join(gameKitchen, 'app/plugins/foxhole', normalizedSrc),
        path.join(gameKitchen, 'app/plugins', normalizedSrc.replace(/^\.\.\//, '')),
    );
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

function resolveNixieTexturePath(foxholeKey) {
    const normalizedKey = String(foxholeKey ?? '').trim();
    if (!normalizedKey) {
        return null;
    }
    const typeRoots = ['structures', 'vehicles', 'items'];
    const baseRoots = [
        path.join(PLANNER_ROOT, 'public/foxhole/assets/types'),
        path.join(PLANNER_ROOT, '.output/public/foxhole/assets/types'),
    ];
    const candidates = [];
    for (const base of baseRoots) {
        for (const typeRoot of typeRoots) {
            candidates.push(path.join(base, typeRoot, normalizedKey, `${normalizedKey}.texture.webp`));
        }
    }
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

function extractLegacyBuildings(dataPath) {
    const src = fs.readFileSync(dataPath, 'utf8');
    const buildingsMatch = src.match(/"buildings"\s*:\s*\{/);
    if (!buildingsMatch || buildingsMatch.index === undefined) {
        throw new Error('buildings block not found');
    }
    const open = src.indexOf('{', buildingsMatch.index + '"buildings"'.length);
    const body = extractBalanced(src, open);
    /** @type {Record<string, { textureWidth: number | null; textureHeight: number | null; textureSrc: string | null; sockets: Array<{ id: number; name?: string; x: number; y: number; rotation: number; }>; ranges: Array<{ type: string; arc: number; facingDeg: number; }>; }>} */
    const byKey = {};

    for (const m of body.matchAll(/\n\t\t"([^"]+)"\s*:\s*\{/g)) {
        const buildingKey = m[1];
        const objStart = body.indexOf('{', m.index + m[0].length - 1);
        const obj = extractBalanced(body, objStart);
        if (!obj) {
            continue;
        }
        const textureBlock = obj.match(/"texture"\s*:\s*\{[\s\S]*?\}/);
        const textureWidth = Number(textureBlock?.[0].match(/"width"\s*:\s*(-?[\d.]+)/)?.[1]);
        const textureHeight = Number(textureBlock?.[0].match(/"height"\s*:\s*(-?[\d.]+)/)?.[1]);
        const textureSrc = textureBlock?.[0].match(/"src"\s*:\s*"([^"]+)"/)?.[1] ?? null;

        const sockets = [];
        const socketsMatch = obj.match(/"sockets"\s*:\s*\[/);
        if (socketsMatch) {
            const arrayStart = obj.indexOf('[', socketsMatch.index);
            let depth = 0;
            let end = -1;
            for (let i = arrayStart; i < obj.length; i++) {
                if (obj[i] === '[') {
                    depth++;
                } else if (obj[i] === ']') {
                    depth--;
                    if (depth === 0) {
                        end = i;
                        break;
                    }
                }
            }
            if (end >= 0) {
                const arrayBody = obj.slice(arrayStart, end + 1);
                for (const socketMatch of arrayBody.matchAll(/\{/g)) {
                    const before = arrayBody.slice(0, socketMatch.index);
                    const braceDepth = (before.match(/\{/g)?.length ?? 0) - (before.match(/\}/g)?.length ?? 0);
                    if (braceDepth !== 0) {
                        continue;
                    }
                    const socketObj = extractBalanced(arrayBody, socketMatch.index);
                    const id = Number(socketObj.match(/"id"\s*:\s*(-?\d+)/)?.[1]);
                    if (!Number.isFinite(id)) {
                        continue;
                    }
                    sockets.push({
                        id,
                        name: socketObj.match(/"name"\s*:\s*"([^"]+)"/)?.[1],
                        x: Number(socketObj.match(/"x"\s*:\s*(-?[\d.]+)/)?.[1] ?? 0),
                        y: Number(socketObj.match(/"y"\s*:\s*(-?[\d.]+)/)?.[1] ?? 0),
                        rotation: normalizeRotationDeg(socketObj.match(/"rotation"\s*:\s*(-?[\d.]+)/)?.[1] ?? 0),
                    });
                }
            }
        }

        byKey[buildingKey] = {
            textureWidth: Number.isFinite(textureWidth) ? textureWidth : null,
            textureHeight: Number.isFinite(textureHeight) ? textureHeight : null,
            textureSrc,
            sockets,
            ranges: extractDirectedRangesFromObjectText(obj, 'legacy'),
        };
    }

    return byKey;
}

/**
 * Parse directed (arc) ranges only. Facing uses angle/direction — never x/y.
 * Legacy cones default to +90°; Nixie uses compact `r` / `rotation` (default 0).
 */
function extractDirectedRangesFromObjectText(obj, side) {
    const rangesMatch = obj.match(/"ranges"\s*:\s*\[/);
    if (!rangesMatch) {
        return [];
    }
    const arrayStart = obj.indexOf('[', rangesMatch.index);
    let depth = 0;
    let end = -1;
    for (let i = arrayStart; i < obj.length; i++) {
        if (obj[i] === '[') {
            depth++;
        } else if (obj[i] === ']') {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }
    if (end < 0) {
        return [];
    }

    const ranges = [];
    const arrayBody = obj.slice(arrayStart, end + 1);
    for (const rangeMatch of arrayBody.matchAll(/\{/g)) {
        const before = arrayBody.slice(0, rangeMatch.index);
        const braceDepth = (before.match(/\{/g)?.length ?? 0) - (before.match(/\}/g)?.length ?? 0);
        if (braceDepth !== 0) {
            continue;
        }
        const rangeObj = extractBalanced(arrayBody, rangeMatch.index);
        const type = rangeObj.match(/"type"\s*:\s*"([^"]+)"/)?.[1]
            ?? rangeObj.match(/"t"\s*:\s*"([^"]+)"/)?.[1]
            ?? '';
        const arc = Number(rangeObj.match(/"arc"\s*:\s*(-?[\d.]+)/)?.[1]
            ?? rangeObj.match(/"a"\s*:\s*(-?[\d.]+)/)?.[1]);
        if (!type || !Number.isFinite(arc) || arc <= 0 || arc >= 359.9) {
            continue;
        }
        const rawRotation = Number(rangeObj.match(/"rotation"\s*:\s*(-?[\d.]+)/)?.[1]
            ?? rangeObj.match(/"r"\s*:\s*(-?[\d.]+)/)?.[1]
            ?? 0);
        const facingDeg = side === 'legacy'
            ? normalizeRotationDeg(LEGACY_RANGE_FACING_DEFAULT_DEG + (rawRotation || 0))
            : normalizeRotationDeg(rawRotation || 0);
        ranges.push({ type, arc, facingDeg });
    }
    return ranges;
}

function expandNixieRanges(rawRanges) {
    if (!Array.isArray(rawRanges)) {
        return [];
    }
    const ranges = [];
    for (const raw of rawRanges) {
        const type = String(raw?.t ?? raw?.type ?? '').trim();
        const arc = Number(raw?.a ?? raw?.arc ?? NaN);
        if (!type || !Number.isFinite(arc) || arc <= 0 || arc >= 359.9) {
            continue;
        }
        const rawRotation = Number(raw?.r ?? raw?.rotation ?? 0);
        ranges.push({
            type,
            arc,
            facingDeg: normalizeRotationDeg(Number.isFinite(rawRotation) ? rawRotation : 0),
        });
    }
    return ranges;
}

function loadKeyMap() {
    const src = fs.readFileSync(KEY_MAP_PATH, 'utf8');
    const map = {};
    for (const m of src.matchAll(/"([^"]+)":\s*"([^"]+)"/g)) {
        map[m[1]] = m[2];
    }
    return map;
}

function expandNixieSocket(raw) {
    return {
        name: String(raw?.name ?? raw?.n ?? '').trim(),
        preferredName: preferSocketName(raw?.name ?? raw?.n),
        x: raw?.x != null ? Number(raw.x) : 0,
        y: raw?.y != null ? Number(raw.y) : 0,
        rotation: normalizeRotationDeg(raw?.rotation ?? raw?.r ?? 0),
    };
}

function dedupeNixieSockets(sockets) {
    const byPreferred = new Map();
    for (const socket of sockets) {
        const preferred = socket.preferredName;
        if (!preferred) {
            continue;
        }
        const existing = byPreferred.get(preferred);
        if (!existing || (String(existing.name).includes(':') && !String(socket.name).includes(':'))) {
            byPreferred.set(preferred, socket);
        }
    }
    return [...byPreferred.values()].filter(socket => !isFoundationSocketName(socket.preferredName));
}

/** Building-local origin. Socket-centroid origins collapse single-socket proximity to zero. */
const BUILDING_ORIGIN = { x: 0, y: 0 };

function polarAngleDeg(x, y) {
    return normalizeRotationDeg((Math.atan2(y, x) * 180) / Math.PI);
}

/**
 * Score one candidate frame offset by projecting legacy sockets around the building
 * origin into Nixie sprite space (fitted scale), preferring angular proximity.
 */
function scoreOrientedMatch(legacySockets, nixieSockets, rotationOffsetDeg) {
    const oriented = legacySockets.map(socket => (
        applyFrameOffsetToLegacySocket(socket, BUILDING_ORIGIN, rotationOffsetDeg)
    ));
    const used = new Set();
    let total = 0;
    let matched = 0;
    const rotResiduals = [];
    const angleResiduals = [];
    let meanDistRatio = 0;
    let distSamples = 0;

    for (const legacy of oriented) {
        let best = null;
        let bestScore = -Infinity;
        const legacyRadius = Math.hypot(legacy.x, legacy.y);
        const legacyAngle = polarAngleDeg(legacy.x, legacy.y);

        for (const nixie of nixieSockets) {
            if (!nixie.preferredName || used.has(nixie.preferredName)) {
                continue;
            }

            const nameBonus = legacy.name
                && preferSocketName(legacy.name) === nixie.preferredName
                ? 40
                : 0;
            const rotScore = Math.max(0, 180 - rotationDelta(legacy.rotation, nixie.rotation));
            const nixieRadius = Math.hypot(nixie.x, nixie.y);
            const nixieAngle = polarAngleDeg(nixie.x, nixie.y);
            const angleDelta = legacyRadius > 1e-6 && nixieRadius > 1e-6
                ? rotationDelta(legacyAngle, nixieAngle)
                : 180;
            const angleScore = Math.max(0, 180 - angleDelta);

            let posScore = 0;
            let dist = Number.POSITIVE_INFINITY;
            if (legacyRadius > 1e-6 && nixieRadius > 1e-6) {
                const scale = nixieRadius / legacyRadius;
                const predictedX = legacy.x * scale;
                const predictedY = legacy.y * scale;
                dist = Math.hypot(predictedX - nixie.x, predictedY - nixie.y);
                // Forgiving: legacy sockets were hand-placed. Normalize by radius.
                const relativeDist = dist / nixieRadius;
                posScore = Math.max(0, 200 - relativeDist * 200);
            }

            // Angle/position dominate; facing is secondary (legacy facings are noisy).
            const score = angleScore * 3 + posScore * 1.5 + rotScore * 0.35 + nameBonus;
            if (score > bestScore) {
                bestScore = score;
                best = {
                    name: nixie.preferredName,
                    rotDelta: rotationDelta(legacy.rotation, nixie.rotation),
                    angleDelta,
                    dist,
                    nixieRadius,
                };
            }
        }

        // Threshold is intentionally soft — single power sockets still need to vote.
        if (best && bestScore > 120) {
            used.add(best.name);
            matched += 1;
            total += bestScore;
            rotResiduals.push(best.rotDelta);
            angleResiduals.push(best.angleDelta);
            if (Number.isFinite(best.dist) && best.nixieRadius > 1e-6) {
                meanDistRatio += best.dist / best.nixieRadius;
                distSamples += 1;
            }
        }
    }

    const meanResidual = rotResiduals.length
        ? rotResiduals.reduce((sum, value) => sum + value, 0) / rotResiduals.length
        : 180;
    const meanAngleResidual = angleResiduals.length
        ? angleResiduals.reduce((sum, value) => sum + value, 0) / angleResiduals.length
        : 180;
    const avgDistRatio = distSamples ? meanDistRatio / distSamples : 1;
    return {
        score: total + matched * 80 - meanAngleResidual * 2 - meanResidual * 0.25 - avgDistRatio * 40,
        matched,
        meanResidual,
        meanAngleResidual,
        avgDistRatio,
    };
}

function scoreFromSockets(legacy, nixieSockets, legacyKind, nixieKind, spriteOffsetX, spriteOffsetY) {
    if (legacy.sockets.length < 1 || nixieSockets.length < 1) {
        return null;
    }

    let best = null;
    for (const offset of CANDIDATE_OFFSETS_DEG) {
        const result = scoreOrientedMatch(legacy.sockets, nixieSockets, offset);
        const aspectBonus = (() => {
            if (legacyKind === 'unknown' || nixieKind === 'unknown') {
                return 0;
            }
            if (offset === 0 || offset === 180) {
                return legacyKind === nixieKind ? 40 : -60;
            }
            return legacyKind !== nixieKind && legacyKind !== 'square' && nixieKind !== 'square' ? 60 : -20;
        })();
        const score = result.score + aspectBonus;
        // Prefer 0, then ±90 over 180 on ties — 180 often wins facing-only matches.
        const offsetRank = offset === 0 ? 0 : offset === 90 ? 1 : offset === -90 ? 2 : 3;
        const bestRank = best
            ? (best.offset === 0 ? 0 : best.offset === 90 ? 1 : best.offset === -90 ? 2 : 3)
            : 99;
        const better = !best
            || score > best.totalScore + 1e-6
            || (Math.abs(score - best.totalScore) <= 1e-6 && offsetRank < bestRank);
        if (better) {
            best = {
                offset,
                totalScore: score,
                matched: result.matched,
                meanResidual: result.meanResidual,
                meanAngleResidual: result.meanAngleResidual,
            };
        }
    }

    const confidence = best.matched >= 2 && best.meanAngleResidual <= 25
        ? 'high'
        : best.matched >= 1 && best.meanAngleResidual <= 45
            ? 'medium'
            : 'low';

    return {
        rotationOffsetDeg: best.offset,
        confidence,
        method: 'socket-frame',
        matchedSockets: best.matched,
        meanResidualDeg: Number(best.meanResidual.toFixed(1)),
        meanAngleResidualDeg: Number(best.meanAngleResidual.toFixed(1)),
        legacyAspect: legacyKind,
        nixieAspect: nixieKind,
        spriteOffsetX,
        spriteOffsetY,
    };
}

function estimateFromAspect(legacyKind, nixieKind, spriteOffsetX, spriteOffsetY) {
    const base = (() => {
        if (legacyKind === 'unknown' || nixieKind === 'unknown' || legacyKind === 'square' || nixieKind === 'square') {
            return { rotationOffsetDeg: 0, confidence: 'low', method: 'aspect-default' };
        }
        if (legacyKind === nixieKind) {
            return { rotationOffsetDeg: 0, confidence: 'medium', method: 'aspect-same' };
        }
        // Categorical flip only — ±90 both swap axes, so sign is unknown here.
        return { rotationOffsetDeg: 90, confidence: 'low', method: 'aspect-flip' };
    })();
    return {
        ...base,
        legacyAspect: legacyKind,
        nixieAspect: nixieKind,
        spriteOffsetX,
        spriteOffsetY,
    };
}

/**
 * Numeric width/height fit after each candidate rotation.
 * ±90 both map (w,h)→(h,w), so this picks flip-vs-identity strongly but cannot pick the sign.
 */
function dimensionFitForOffset(legacyW, legacyH, nixieW, nixieH, offsetDeg) {
    if (!(legacyW > 0) || !(legacyH > 0) || !(nixieW > 0) || !(nixieH > 0)) {
        return null;
    }
    const swapped = Math.abs(offsetDeg) === 90;
    const rw = swapped ? legacyH : legacyW;
    const rh = swapped ? legacyW : legacyH;
    const ratioLegacy = rw / rh;
    const ratioNixie = nixieW / nixieH;
    const ratioErr = Math.abs(Math.log(ratioLegacy / ratioNixie));
    const scale = Math.sqrt((nixieW / rw) * (nixieH / rh));
    const sizeErr = (
        Math.abs(rw * scale - nixieW) / nixieW
        + Math.abs(rh * scale - nixieH) / nixieH
    ) / 2;
    return {
        ratioErr,
        sizeErr,
        score: 1 / (1 + ratioErr * 4 + sizeErr * 3),
    };
}

function scoreFromDimensions(legacyW, legacyH, nixieW, nixieH, legacyKind, nixieKind, spriteOffsetX, spriteOffsetY) {
    const identity = dimensionFitForOffset(legacyW, legacyH, nixieW, nixieH, 0);
    const flipped = dimensionFitForOffset(legacyW, legacyH, nixieW, nixieH, 90);
    if (!identity || !flipped) {
        return estimateFromAspect(legacyKind, nixieKind, spriteOffsetX, spriteOffsetY);
    }

    const preferFlip = flipped.score > identity.score + 0.08;
    const preferSame = identity.score > flipped.score + 0.08;
    const clear = Math.abs(flipped.score - identity.score) >= 0.15
        && Math.min(identity.ratioErr, flipped.ratioErr) < 0.12;

    if (preferFlip) {
        return {
            // Sign still unknown from dims alone; default +90, overrides/range/sockets decide.
            rotationOffsetDeg: 90,
            confidence: clear ? 'medium' : 'low',
            method: 'dimension-fit-flip',
            dimensionFitScore: Number(flipped.score.toFixed(4)),
            dimensionFitMargin: Number((flipped.score - identity.score).toFixed(4)),
            legacyAspect: legacyKind,
            nixieAspect: nixieKind,
            spriteOffsetX,
            spriteOffsetY,
        };
    }
    if (preferSame) {
        // Strong same-aspect numeric fit is enough to trust identity (vehicles/aircraft).
        // Flip sign is still ambiguous from dims alone, so flip stays medium/low.
        const high = clear
            && identity.score >= 0.95
            && (identity.score - flipped.score) >= 0.25
            && legacyKind === nixieKind
            && legacyKind !== 'square'
            && nixieKind !== 'square';
        return {
            rotationOffsetDeg: 0,
            confidence: high ? 'high' : clear ? 'medium' : 'low',
            method: 'dimension-fit-same',
            dimensionFitScore: Number(identity.score.toFixed(4)),
            dimensionFitMargin: Number((identity.score - flipped.score).toFixed(4)),
            legacyAspect: legacyKind,
            nixieAspect: nixieKind,
            spriteOffsetX,
            spriteOffsetY,
        };
    }

    return estimateFromAspect(legacyKind, nixieKind, spriteOffsetX, spriteOffsetY);
}

function isFlipOffset(offsetDeg) {
    return Math.abs(Number(offsetDeg) || 0) === 90;
}

function loadOrientationOverrides() {
    if (!fs.existsSync(ORIENTATION_OVERRIDES_PATH)) {
        return {};
    }
    const raw = JSON.parse(fs.readFileSync(ORIENTATION_OVERRIDES_PATH, 'utf8'));
    const map = {};
    for (const [key, value] of Object.entries(raw)) {
        if (key.startsWith('_')) {
            continue;
        }
        const offset = normalizeRotationDeg(value);
        if (offset === 0 || offset === 90 || offset === -90 || offset === 180) {
            map[key] = offset;
        }
    }
    return map;
}

function loadOrientationQa() {
    if (!fs.existsSync(ORIENTATION_QA_PATH)) {
        return { confirmed: [], skipClipboard: {} };
    }
    const raw = JSON.parse(fs.readFileSync(ORIENTATION_QA_PATH, 'utf8'));
    return {
        confirmed: Array.isArray(raw.confirmed)
            ? raw.confirmed.map(key => String(key).trim()).filter(Boolean)
            : [],
        skipClipboard: raw.skipClipboard && typeof raw.skipClipboard === 'object'
            ? raw.skipClipboard
            : {},
    };
}

/**
 * Score import offsets from directed range facing only (ignore range x/y).
 * Import offset F satisfies legacyFacing - F ≈ nixieFacing (world cones align).
 */
function scoreFromRanges(legacyRanges, nixieRanges, legacyKind, nixieKind, spriteOffsetX, spriteOffsetY) {
    if (!legacyRanges?.length || !nixieRanges?.length) {
        return null;
    }

    const pairs = [];
    const usedNixie = new Set();
    for (const legacy of legacyRanges) {
        const matchIndex = nixieRanges.findIndex((nixie, index) => (
            !usedNixie.has(index) && nixie.type === legacy.type
        ));
        if (matchIndex < 0) {
            continue;
        }
        usedNixie.add(matchIndex);
        pairs.push({ legacy, nixie: nixieRanges[matchIndex] });
    }
    if (!pairs.length && legacyRanges.length === 1 && nixieRanges.length === 1) {
        pairs.push({ legacy: legacyRanges[0], nixie: nixieRanges[0] });
    }
    if (!pairs.length) {
        return null;
    }

    let best = null;
    for (const offset of CANDIDATE_OFFSETS_DEG) {
        let residualSum = 0;
        for (const { legacy, nixie } of pairs) {
            // World: R + legacyFacing ≡ R + F + nixieFacing ⇒ F = legacyFacing - nixieFacing
            residualSum += rotationDelta(legacy.facingDeg - offset, nixie.facingDeg);
        }
        const meanResidual = residualSum / pairs.length;
        const aspectBonus = (() => {
            if (legacyKind === 'unknown' || nixieKind === 'unknown') {
                return 0;
            }
            if (offset === 0 || offset === 180) {
                return legacyKind === nixieKind ? 5 : -10;
            }
            return legacyKind !== nixieKind && legacyKind !== 'square' && nixieKind !== 'square' ? 8 : -4;
        })();
        // Lower residual is better; convert to a score for ranking.
        const score = (180 - meanResidual) + aspectBonus + pairs.length * 10;
        const offsetRank = offset === 0 ? 0 : offset === 90 ? 1 : offset === -90 ? 2 : 3;
        const bestRank = best
            ? (best.offset === 0 ? 0 : best.offset === 90 ? 1 : best.offset === -90 ? 2 : 3)
            : 99;
        const better = !best
            || score > best.totalScore + 1e-6
            || (Math.abs(score - best.totalScore) <= 1e-6 && offsetRank < bestRank);
        if (better) {
            best = {
                offset,
                totalScore: score,
                matched: pairs.length,
                meanResidual,
            };
        }
    }

    const confidence = best.meanResidual <= 5 && best.matched >= 1
        ? 'high'
        : best.meanResidual <= 20
            ? 'medium'
            : 'low';

    return {
        rotationOffsetDeg: best.offset,
        confidence,
        method: 'range-facing',
        matchedRanges: best.matched,
        meanAngleResidualDeg: Number(best.meanResidual.toFixed(1)),
        legacyAspect: legacyKind,
        nixieAspect: nixieKind,
        spriteOffsetX,
        spriteOffsetY,
    };
}

function attachAlphaMeta(entry, alphaEntry) {
    if (!alphaEntry) {
        return entry;
    }
    return {
        ...entry,
        alphaScore: alphaEntry.alphaScore,
        alphaMargin: alphaEntry.alphaMargin,
        textureBakeDeltaDeg: alphaEntry.textureBakeDeltaDeg,
    };
}

function chooseOrientationEntry(alphaEntry, socketEntry, rangeEntry, aspectEntry) {
    // When alpha cannot pick the sign of a 90° flip, prefer range facing (direction only),
    // then socket angular proximity.
    const alphaSignAmbiguous = Boolean(
        alphaEntry
        && (alphaEntry.alphaMargin ?? 0) < 0.03
        && (Math.abs(alphaEntry.rotationOffsetDeg) === 90 || Math.abs(alphaEntry.textureBakeDeltaDeg ?? 0) === 90),
    );

    if (rangeEntry && rangeEntry.confidence !== 'low' && (
        alphaSignAmbiguous
        || !alphaEntry
        || (alphaEntry.confidence === 'low' && (rangeEntry.meanAngleResidualDeg ?? 180) <= 15)
    )) {
        return attachAlphaMeta({
            ...rangeEntry,
            method: alphaSignAmbiguous
                ? 'range-facing+alpha-ambiguous'
                : 'range-facing',
            confidence: rangeEntry.confidence === 'medium' && alphaSignAmbiguous
                ? 'high'
                : rangeEntry.confidence,
        }, alphaEntry);
    }

    if (socketEntry && alphaSignAmbiguous && Math.abs(socketEntry.rotationOffsetDeg) === 90) {
        return {
            ...socketEntry,
            alphaScore: alphaEntry?.alphaScore,
            alphaMargin: alphaEntry?.alphaMargin,
            textureBakeDeltaDeg: alphaEntry?.textureBakeDeltaDeg,
            method: socketEntry.confidence === 'low' ? 'socket-frame' : 'socket-frame+alpha-ambiguous',
            confidence: socketEntry.confidence === 'low' ? 'medium' : socketEntry.confidence,
        };
    }

    // Weak alpha that disagrees with a clear numeric width/height fit: trust dims for
    // flip-vs-identity only (±90 sign still needs range/socket/manual override).
    const dimFamilyClear = Boolean(
        aspectEntry
        && String(aspectEntry.method).startsWith('dimension-fit')
        && aspectEntry.confidence !== 'low'
        && (aspectEntry.dimensionFitMargin ?? 0) >= 0.15,
    );
    if (dimFamilyClear && alphaEntry && alphaEntry.confidence === 'low') {
        const alphaFlip = isFlipOffset(alphaEntry.rotationOffsetDeg);
        const dimFlip = isFlipOffset(aspectEntry.rotationOffsetDeg);
        if (alphaFlip !== dimFlip) {
            return attachAlphaMeta({
                ...aspectEntry,
                method: `${aspectEntry.method}+alpha-family`,
            }, alphaEntry);
        }
        if (alphaFlip && dimFlip) {
            // Keep alpha's ±90 sign but promote confidence from the dim evidence.
            return {
                ...alphaEntry,
                confidence: 'medium',
                method: 'alpha-sample+dimension-fit',
                dimensionFitScore: aspectEntry.dimensionFitScore,
                dimensionFitMargin: aspectEntry.dimensionFitMargin,
            };
        }
    }

    if (alphaEntry) {
        const preferAlpha = alphaEntry.confidence !== 'low'
            || (alphaEntry.alphaMargin ?? 0) >= 0.03
            || (!socketEntry && !rangeEntry)
            || (socketEntry?.confidence === 'low' && (!rangeEntry || rangeEntry.confidence === 'low'))
            || socketEntry?.rotationOffsetDeg === alphaEntry.rotationOffsetDeg
            || rangeEntry?.rotationOffsetDeg === alphaEntry.rotationOffsetDeg;

        if (preferAlpha) {
            const entry = { ...alphaEntry };
            if (rangeEntry && rangeEntry.rotationOffsetDeg === alphaEntry.rotationOffsetDeg) {
                entry.confidence = alphaEntry.confidence === 'high' ? 'high' : 'medium';
                entry.method = 'alpha-sample+range-agree';
                entry.matchedRanges = rangeEntry.matchedRanges;
                if (rangeEntry.meanAngleResidualDeg != null) {
                    entry.meanAngleResidualDeg = rangeEntry.meanAngleResidualDeg;
                }
            } else if (socketEntry && socketEntry.rotationOffsetDeg === alphaEntry.rotationOffsetDeg) {
                entry.confidence = alphaEntry.confidence === 'high' ? 'high' : 'medium';
                entry.method = 'alpha-sample+socket-agree';
                entry.matchedSockets = socketEntry.matchedSockets;
                entry.meanResidualDeg = socketEntry.meanResidualDeg;
                if (socketEntry.meanAngleResidualDeg != null) {
                    entry.meanAngleResidualDeg = socketEntry.meanAngleResidualDeg;
                }
            } else if (dimFamilyClear && isFlipOffset(alphaEntry.rotationOffsetDeg) === isFlipOffset(aspectEntry.rotationOffsetDeg)) {
                entry.confidence = alphaEntry.confidence === 'high' ? 'high' : 'medium';
                entry.method = entry.method.includes('dimension') ? entry.method : 'alpha-sample+dimension-fit';
                entry.dimensionFitScore = aspectEntry.dimensionFitScore;
                entry.dimensionFitMargin = aspectEntry.dimensionFitMargin;
            }
            return entry;
        }
    }

    if (rangeEntry && rangeEntry.confidence !== 'low') {
        return attachAlphaMeta(rangeEntry, alphaEntry);
    }

    if (socketEntry) {
        return socketEntry.confidence !== 'low'
            ? attachAlphaMeta(socketEntry, alphaEntry)
            : socketEntry;
    }

    if (alphaEntry) {
        return alphaEntry;
    }

    if (rangeEntry) {
        return rangeEntry;
    }

    return aspectEntry;
}

function serializeEntryFields(entry) {
    const fields = [
        `\t\trotationOffsetDeg: ${entry.rotationOffsetDeg},`,
        `\t\tconfidence: ${JSON.stringify(entry.confidence)},`,
        `\t\tmethod: ${JSON.stringify(entry.method)},`,
    ];
    if (entry.matchedSockets != null) {
        fields.push(`\t\tmatchedSockets: ${entry.matchedSockets},`);
    }
    if (entry.matchedRanges != null) {
        fields.push(`\t\tmatchedRanges: ${entry.matchedRanges},`);
    }
    if (entry.meanResidualDeg != null) {
        fields.push(`\t\tmeanResidualDeg: ${entry.meanResidualDeg},`);
    }
    if (entry.meanAngleResidualDeg != null) {
        fields.push(`\t\tmeanAngleResidualDeg: ${entry.meanAngleResidualDeg},`);
    }
    if (entry.alphaScore != null) {
        fields.push(`\t\talphaScore: ${entry.alphaScore},`);
    }
    if (entry.alphaMargin != null) {
        fields.push(`\t\talphaMargin: ${entry.alphaMargin},`);
    }
    if (entry.textureBakeDeltaDeg != null) {
        fields.push(`\t\ttextureBakeDeltaDeg: ${entry.textureBakeDeltaDeg},`);
    }
    if (entry.dimensionFitScore != null) {
        fields.push(`\t\tdimensionFitScore: ${entry.dimensionFitScore},`);
    }
    if (entry.dimensionFitMargin != null) {
        fields.push(`\t\tdimensionFitMargin: ${entry.dimensionFitMargin},`);
    }
    if (entry.legacyAspect) {
        fields.push(`\t\tlegacyAspect: ${JSON.stringify(entry.legacyAspect)},`);
    }
    if (entry.nixieAspect) {
        fields.push(`\t\tnixieAspect: ${JSON.stringify(entry.nixieAspect)},`);
    }
    if (entry.spriteOffsetX) {
        fields.push(`\t\tspriteOffsetX: ${entry.spriteOffsetX},`);
    }
    if (entry.spriteOffsetY) {
        fields.push(`\t\tspriteOffsetY: ${entry.spriteOffsetY},`);
    }
    return fields;
}

async function main() {
    const gameKitchen = process.argv.includes('--game-kitchen')
        ? process.argv[process.argv.indexOf('--game-kitchen') + 1]
        : DEFAULT_GAME_KITCHEN;
    const dataPath = path.join(gameKitchen, 'app/plugins/foxhole/data.js');
    const legacyByKey = extractLegacyBuildings(dataPath);
    const keyMap = loadKeyMap();
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
    const assetById = new Map(assets.map(asset => [asset.id, asset]));

    /** @type {Record<string, object>} */
    const byFoxholeKey = {};

    const seen = new Set();
    for (const [legacyKey, legacy] of Object.entries(legacyByKey)) {
        const foxholeKey = keyMap[legacyKey] ?? legacyKey;
        if (seen.has(foxholeKey)) {
            continue;
        }
        const asset = assetById.get(foxholeKey);
        if (!asset) {
            continue;
        }
        seen.add(foxholeKey);

        const nixieW = asset.sprite?.width ?? asset.sprite?.w ?? null;
        const nixieH = asset.sprite?.height ?? asset.sprite?.h ?? null;
        const isSplineConnector = String(asset.connector?.splineComponentName ?? '') === 'SplineConnector';
        const legacyKind = aspectKind(legacy.textureWidth, legacy.textureHeight);
        const nixieKind = aspectKind(nixieW, nixieH);
        const spriteOffsetX = asset.sprite?.offsetX ?? asset.sprite?.ox ?? 0;
        const spriteOffsetY = asset.sprite?.offsetY ?? asset.sprite?.oy ?? 0;

        if (isSplineConnector) {
            byFoxholeKey[foxholeKey] = {
                rotationOffsetDeg: 0,
                confidence: 'skip',
                method: 'spline-connector',
                legacyAspect: legacyKind,
                nixieAspect: nixieKind,
                spriteOffsetX,
                spriteOffsetY,
            };
            continue;
        }

        const nixieSockets = dedupeNixieSockets((asset.buildSockets ?? []).map(expandNixieSocket));
        const legacyTexturePath = resolveLegacyTexturePath(gameKitchen, legacy.textureSrc);
        const nixieTexturePath = resolveNixieTexturePath(foxholeKey);

        let alphaEntry = null;
        if (legacyTexturePath && nixieTexturePath) {
            alphaEntry = await scoreLegacyNixieOrientation({
                legacyTexturePath,
                nixieTexturePath,
                legacyWidth: legacy.textureWidth,
                legacyHeight: legacy.textureHeight,
                nixieWidth: nixieW,
                nixieHeight: nixieH,
            });
            if (alphaEntry) {
                // Keep authored aspects on the entry for the map (not padded-file aspects).
                alphaEntry.legacyAspect = legacyKind;
                alphaEntry.nixieAspect = nixieKind;
                alphaEntry.spriteOffsetX = spriteOffsetX;
                alphaEntry.spriteOffsetY = spriteOffsetY;
            }
        }

        const socketEntry = scoreFromSockets(
            legacy,
            nixieSockets,
            legacyKind,
            nixieKind,
            spriteOffsetX,
            spriteOffsetY,
        );
        const rangeEntry = scoreFromRanges(
            legacy.ranges,
            expandNixieRanges(asset.ranges),
            legacyKind,
            nixieKind,
            spriteOffsetX,
            spriteOffsetY,
        );
        const aspectEntry = scoreFromDimensions(
            legacy.textureWidth,
            legacy.textureHeight,
            nixieW,
            nixieH,
            legacyKind,
            nixieKind,
            spriteOffsetX,
            spriteOffsetY,
        );
        const chosen = chooseOrientationEntry(alphaEntry, socketEntry, rangeEntry, aspectEntry);

        byFoxholeKey[foxholeKey] = chosen;
    }

    const overrides = loadOrientationOverrides();
    let overrideCount = 0;
    for (const [foxholeKey, offset] of Object.entries(overrides)) {
        const existing = byFoxholeKey[foxholeKey];
        byFoxholeKey[foxholeKey] = {
            ...(existing ?? {
                matchedSockets: 0,
                meanResidualDeg: 0,
                meanAngleResidualDeg: 0,
            }),
            rotationOffsetDeg: offset,
            confidence: 'high',
            method: 'manual-override',
        };
        overrideCount += 1;
    }

    const qa = loadOrientationQa();
    let confirmedCount = 0;
    for (const foxholeKey of qa.confirmed) {
        const existing = byFoxholeKey[foxholeKey];
        if (!existing || existing.method === 'manual-override') {
            continue;
        }
        byFoxholeKey[foxholeKey] = {
            ...existing,
            confidence: 'high',
            method: existing.method?.includes('qa-confirmed')
                ? existing.method
                : `${existing.method}+qa-confirmed`,
        };
        confirmedCount += 1;
    }

    const histogram = { '0': 0, '90': 0, '-90': 0, '180': 0 };
    const methodCounts = {};
    for (const entry of Object.values(byFoxholeKey)) {
        histogram[String(entry.rotationOffsetDeg)] = (histogram[String(entry.rotationOffsetDeg)] ?? 0) + 1;
        methodCounts[entry.method] = (methodCounts[entry.method] ?? 0) + 1;
    }

    const sorted = Object.entries(byFoxholeKey).sort(([a], [b]) => a.localeCompare(b));
    const body = sorted.map(([foxholeKey, entry]) => {
        const fields = serializeEntryFields(entry);
        return `\t${JSON.stringify(foxholeKey)}: {\n${fields.join('\n')}\n\t},`;
    }).join('\n');

    const ts = `/**
 * Legacy → Nixie asset frame orientation offsets (degrees).
 *
 * \`rotationOffsetDeg\` is added to legacy entity rotation so the placed asset
 * faces the same way in Nixie. Generated by alpha-sampling legacy vs Nixie
 * board textures under candidate bake deltas {0,±90,180}, with range-facing
 * (direction only), socket-frame scoring, and numeric width/height fit to
 * resolve flip-vs-identity. ±90 sign still needs range/socket/manual override
 * when alpha is ambiguous. Spline connectors are forced to 0.
 *
 * Manual overrides: tools/legacy-plans/orientation-overrides.json
 * Visual QA confirms: tools/legacy-plans/orientation-qa.json
 * Regenerate: npm run legacy:generate-orientation-map
 */
export type LegacyPlanOrientationEntry = {
\trotationOffsetDeg: number;
\tconfidence: 'high' | 'medium' | 'low' | 'skip';
\tmethod: string;
\tmatchedSockets?: number;
\tmatchedRanges?: number;
\tmeanResidualDeg?: number;
\tmeanAngleResidualDeg?: number;
\talphaScore?: number;
\talphaMargin?: number;
\ttextureBakeDeltaDeg?: number;
\tdimensionFitScore?: number;
\tdimensionFitMargin?: number;
\tlegacyAspect?: string;
\tnixieAspect?: string;
\tspriteOffsetX?: number;
\tspriteOffsetY?: number;
};

export const LEGACY_PLAN_ORIENTATION_MAP: Readonly<Record<string, LegacyPlanOrientationEntry>> = {
${body}
};

export function resolveLegacyPlanOrientationOffsetDeg(foxholeKey: string): number {
\treturn LEGACY_PLAN_ORIENTATION_MAP[String(foxholeKey ?? '').trim()]?.rotationOffsetDeg ?? 0;
}
`;

    fs.writeFileSync(OUT_TS, ts);
    fs.writeFileSync(OUT_JSON, `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        count: sorted.length,
        histogram,
        byMethod: methodCounts,
        byConfidence: sorted.reduce((acc, [, entry]) => {
            acc[entry.confidence] = (acc[entry.confidence] ?? 0) + 1;
            return acc;
        }, {}),
        nonZeroSample: sorted.filter(([, entry]) => entry.rotationOffsetDeg !== 0).slice(0, 40),
    }, null, '\t')}\n`);

    console.log({
        mapped: sorted.length,
        histogram,
        byMethod: methodCounts,
        manualOverrides: overrideCount,
        qaConfirmed: confirmedCount,
        wrote: OUT_TS,
        nonZero: sorted.filter(([, entry]) => entry.rotationOffsetDeg !== 0).length,
        highConfNonZero: sorted.filter(([, entry]) => entry.rotationOffsetDeg !== 0 && entry.confidence === 'high').length,
        alphaSampled: sorted.filter(([, entry]) => String(entry.method).includes('alpha-sample')).length,
    });
}

export {
    expandNixieRanges,
    scoreFromRanges,
    scoreFromDimensions,
    chooseOrientationEntry,
    resolveLegacyTexturePath,
    resolveNixieTexturePath,
    LEGACY_RANGE_FACING_DEFAULT_DEG,
};

const isDirectRun = process.argv[1]
    && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isDirectRun) {
    await main();
}
