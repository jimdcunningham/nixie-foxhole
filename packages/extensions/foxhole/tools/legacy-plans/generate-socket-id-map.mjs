import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { exfilLegacySocketsFromDataJs } from './exfil-legacy-sockets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GAME_KITCHEN = process.env.GAME_KITCHEN_PATH || 'C:/Code/game-kitchen';
const ORIENTATION_MAP_PATH = path.resolve(__dirname, '../../app/plugins/foxhole/legacy/plan-orientation-map.ts');
const OUT_TS = path.resolve(__dirname, '../../../../../extensions/foxhole-planner/src/legacy-plan-socket-id-map.ts');
const OUT_JSON = path.resolve(__dirname, 'socket-map.json');
const SOCKET_OVERRIDES_PATH = path.resolve(__dirname, 'socket-overrides.json');
const SOCKET_QA_PATH = path.resolve(__dirname, 'socket-qa.json');

/** Legacy meters → cm. Nixie buildSockets are authored in centimeters. */
const LEGACY_METERS_TO_CM = 100;
/** Reject position pairs farther than this (cm) unless name/tag forces a match. */
const MAX_POSITION_RESIDUAL_CM = 120;
/** Soft score falloff distance for position (cm). */
const POSITION_SCORE_RADIUS_CM = 400;

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

export function normalizeRotationDeg(value) {
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

export function rotationDelta(a, b) {
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

function expandSocket(raw) {
    return {
        name: String(raw?.name ?? raw?.n ?? '').trim(),
        preferredName: preferSocketName(raw?.name ?? raw?.n),
        x: raw?.x != null ? Number(raw.x) : 0,
        y: raw?.y != null ? Number(raw.y) : 0,
        rotation: normalizeRotationDeg(raw?.rotation ?? raw?.r ?? 0),
    };
}

/** Cardinal fort sockets are rotation-stable: 0/90/180/270 → Front/Right/Back/Left. */
export function cardinalFortSocketName(rotationDeg) {
    const rot = normalizeRotationDeg(rotationDeg);
    if (rotationDelta(rot, 0) <= 1) {
        return 'FrontFortSocket';
    }
    if (rotationDelta(rot, 90) <= 1) {
        return 'RightFortSocket';
    }
    if (rotationDelta(rot, 180) <= 1) {
        return 'BackFortSocket';
    }
    if (rotationDelta(rot, -90) <= 1 || rotationDelta(rot, 270) <= 1) {
        return 'LeftFortSocket';
    }
    return null;
}

function isFoundationSocketName(name) {
    return /foundation/i.test(String(name ?? ''));
}

function dedupeNixieSockets(sockets) {
    /** Prefer short names over `FortCommon:...` duplicates. */
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
    return [...byPreferred.values()];
}

function extractLegacySockets(dataPath) {
    const src = fs.readFileSync(dataPath, 'utf8');
    const buildingsMatch = src.match(/"buildings"\s*:\s*\{/);
    if (!buildingsMatch || buildingsMatch.index === undefined) {
        throw new Error('buildings block not found');
    }
    const open = src.indexOf('{', buildingsMatch.index + '"buildings"'.length);
    const body = extractBalanced(src, open);
    /** @type {Record<string, Array<{ id: number; x: number; y: number; rotation: number; name: string; }>>} */
    const byKey = {};

    for (const m of body.matchAll(/\n\t\t"([^"]+)"\s*:\s*\{/g)) {
        const buildingKey = m[1];
        const objStart = body.indexOf('{', m.index + m[0].length - 1);
        const obj = extractBalanced(body, objStart);
        if (!obj) {
            continue;
        }
        const socketsMatch = obj.match(/"sockets"\s*:\s*\[/);
        if (!socketsMatch || socketsMatch.index === undefined) {
            continue;
        }
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
        if (end < 0) {
            continue;
        }
        const arrayBody = obj.slice(arrayStart, end + 1);
        const sockets = [];
        for (const socketMatch of arrayBody.matchAll(/\{/g)) {
            const socketObj = extractBalanced(arrayBody, socketMatch.index);
            if (!socketObj || socketObj.length < 3) {
                continue;
            }
            const before = arrayBody.slice(0, socketMatch.index);
            const braceDepth = (before.match(/\{/g)?.length ?? 0) - (before.match(/\}/g)?.length ?? 0);
            if (braceDepth !== 0) {
                continue;
            }
            const id = Number(socketObj.match(/"id"\s*:\s*(-?\d+)/)?.[1]);
            if (!Number.isFinite(id)) {
                continue;
            }
            sockets.push({
                id,
                x: Number(socketObj.match(/"x"\s*:\s*(-?[\d.]+)/)?.[1] ?? 0),
                y: Number(socketObj.match(/"y"\s*:\s*(-?[\d.]+)/)?.[1] ?? 0),
                rotation: normalizeRotationDeg(socketObj.match(/"rotation"\s*:\s*(-?[\d.]+)/)?.[1] ?? 0),
                name: socketObj.match(/"name"\s*:\s*"([^"]+)"/)?.[1] ?? '',
                cap: socketObj.match(/"cap"\s*:\s*"([^"]+)"/)?.[1] ?? '',
            });
        }
        if (sockets.length) {
            byKey[buildingKey] = sockets;
        }

        const upgradesMatch = obj.match(/"upgrades"\s*:\s*\{/);
        if (!upgradesMatch || upgradesMatch.index === undefined) {
            continue;
        }
        const upgradesOpen = obj.indexOf('{', upgradesMatch.index + '"upgrades"'.length);
        const upgradesBody = extractBalanced(obj, upgradesOpen);
        if (!upgradesBody) {
            continue;
        }
        for (const upgradeMatch of upgradesBody.matchAll(/\n\t+"([^"]+)"\s*:\s*\{/g)) {
            const before = upgradesBody.slice(0, upgradeMatch.index);
            const depthUp = (before.match(/\{/g)?.length ?? 0) - (before.match(/\}/g)?.length ?? 0);
            if (depthUp !== 1) {
                continue;
            }
            const upgradeKey = upgradeMatch[1];
            const upgradeStart = upgradesBody.indexOf('{', upgradeMatch.index + upgradeMatch[0].length - 1);
            const upgradeObj = extractBalanced(upgradesBody, upgradeStart);
            if (!upgradeObj || !/"codeName"\s*:/.test(upgradeObj)) {
                continue;
            }
            if (sockets.length) {
                byKey[`${buildingKey}_${upgradeKey}`] = sockets;
            }
        }
    }

    return byKey;
}

function loadOrientationOffsets() {
    /** @type {Record<string, number>} */
    const offsets = {};
    if (!fs.existsSync(ORIENTATION_MAP_PATH)) {
        return offsets;
    }
    const src = fs.readFileSync(ORIENTATION_MAP_PATH, 'utf8');
    for (const m of src.matchAll(/"([^"]+)":\s*\{[\s\S]*?rotationOffsetDeg:\s*(-?\d+)/g)) {
        offsets[m[1]] = Number(m[2]);
    }
    return offsets;
}

function loadSocketOverrides() {
    if (!fs.existsSync(SOCKET_OVERRIDES_PATH)) {
        return {};
    }
    const raw = JSON.parse(fs.readFileSync(SOCKET_OVERRIDES_PATH, 'utf8'));
    /** @type {Record<string, Record<string, string>>} */
    const overrides = {};
    for (const [key, value] of Object.entries(raw)) {
        if (key.startsWith('_') || !value || typeof value !== 'object' || Array.isArray(value)) {
            continue;
        }
        /** @type {Record<string, string>} */
        const mapping = {};
        for (const [socketId, socketName] of Object.entries(value)) {
            const name = String(socketName ?? '').trim();
            if (!name) {
                continue;
            }
            mapping[String(socketId)] = name;
        }
        if (Object.keys(mapping).length) {
            overrides[key] = mapping;
        }
    }
    return overrides;
}

function loadSocketQa() {
    if (!fs.existsSync(SOCKET_QA_PATH)) {
        return { confirmed: [] };
    }
    const raw = JSON.parse(fs.readFileSync(SOCKET_QA_PATH, 'utf8'));
    return {
        confirmed: Array.isArray(raw.confirmed) ? raw.confirmed.map(String) : [],
    };
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

export function applyOrientationToLegacySockets(legacySockets, rotationOffsetDeg) {
    if (!rotationOffsetDeg) {
        return legacySockets;
    }
    const xs = legacySockets.map(socket => socket.x);
    const ys = legacySockets.map(socket => socket.y);
    const origin = {
        x: xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0,
        y: ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0,
    };
    return legacySockets.map(socket => {
        const rotated = rotatePoint(socket.x, socket.y, origin.x, origin.y, rotationOffsetDeg);
        return {
            ...socket,
            x: rotated.x,
            y: rotated.y,
            rotation: normalizeRotationDeg(socket.rotation + rotationOffsetDeg),
        };
    });
}

function legacyOriginOf(legacySockets) {
    const xs = legacySockets.map(socket => socket.x);
    const ys = legacySockets.map(socket => socket.y);
    return {
        x: xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0,
        y: ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0,
    };
}

/**
 * Fill remaining unmatched legacy sockets using name + pipe flow heuristics.
 * Never overwrites an existing mapping. Works for base and upgrade assets —
 * facility pipe sockets often fail position scoring after orientation.
 */
export function fillSocketsByFlowAndName(legacySockets, nixieSockets, existingMapping = {}) {
    /** @type {Record<string, string>} */
    const mapping = { ...existingMapping };
    const used = new Set(Object.values(mapping));

    const available = () => nixieSockets.filter(socket => !used.has(socket.name));
    const byFlow = () => {
        const open = available();
        return {
            out: open.filter(socket => /output/i.test(socket.name)),
            in: open.filter(socket => /input/i.test(socket.name)),
            power: open.filter(socket => /power/i.test(socket.name)),
        };
    };

    // Pass 1: exact legacy name → Nixie name for still-unmapped ids.
    for (const legacy of legacySockets) {
        const id = String(legacy.id);
        if (mapping[id]) {
            continue;
        }
        const legacyName = preferSocketName(legacy.name);
        if (!legacyName) {
            continue;
        }
        const hit = available().find(socket => socket.preferredName.toLowerCase() === legacyName.toLowerCase());
        if (hit) {
            mapping[id] = hit.name;
            used.add(hit.name);
        }
    }

    // Pass 2: flow tags for anonymous pipe sockets.
    for (const legacy of legacySockets) {
        const id = String(legacy.id);
        if (mapping[id]) {
            continue;
        }
        const flow = String(legacy.flow ?? '').toLowerCase();
        const flows = byFlow();
        let candidates = [];
        if (flow === 'out') {
            candidates = flows.out;
        } else if (flow === 'in') {
            candidates = flows.in;
        } else if (flow === 'power' || /power/i.test(legacy.name ?? '')) {
            candidates = flows.power;
        }
        if (candidates.length === 1) {
            mapping[id] = candidates[0].name;
            used.add(candidates[0].name);
        }
    }

    // Pass 3: if exactly one legacy and one Nixie remain, pair them.
    const unresolvedLegacy = legacySockets.filter(socket => !mapping[String(socket.id)]);
    const unresolvedNixie = available();
    if (unresolvedLegacy.length === 1 && unresolvedNixie.length === 1) {
        mapping[String(unresolvedLegacy[0].id)] = unresolvedNixie[0].name;
        used.add(unresolvedNixie[0].name);
    }

    const added = Object.keys(mapping).length - Object.keys(existingMapping).length;
    if (added <= 0) {
        return null;
    }

    return {
        mapping,
        confidence: Object.keys(mapping).length === legacySockets.length ? 'medium' : 'low',
        method: 'flow-name',
        matchedSockets: Object.keys(mapping).length,
        unmatchedLegacy: Math.max(0, legacySockets.length - Object.keys(mapping).length),
        unmatchedNixie: Math.max(0, nixieSockets.length - Object.keys(mapping).length),
        coverage: Object.keys(mapping).length / Math.max(1, legacySockets.length),
        details: {},
    };
}

/** @deprecated use fillSocketsByFlowAndName */
export function matchUpgradeVariantSockets(legacySockets, baseNixieSockets, allNixieSockets) {
    const baseNames = new Set(baseNixieSockets.map(socket => socket.name));
    const variantOnly = allNixieSockets.filter(socket => !baseNames.has(socket.name));
    return fillSocketsByFlowAndName(legacySockets, variantOnly.length ? variantOnly : allNixieSockets, {});
}

/**
 * Score one legacy↔Nixie socket pair.
 * Position is primary: legacy Left/Right are board ±X while Nixie Left/Right are ±Y.
 * Rotation is a tie-breaker, not the decider.
 */
export function scoreSocketPair(legacy, nixie, legacyOrigin) {
    const lx = (legacy.x - legacyOrigin.x) * LEGACY_METERS_TO_CM;
    const ly = (legacy.y - legacyOrigin.y) * LEGACY_METERS_TO_CM;
    const distCm = Math.hypot(lx - nixie.x, ly - nixie.y);
    const posScore = Math.max(0, POSITION_SCORE_RADIUS_CM - distCm);
    const rotResidualDeg = rotationDelta(legacy.rotation, nixie.rotation);
    const rotScore = Math.max(0, 180 - rotResidualDeg) * 0.25;

    let nameScore = 0;
    if (legacy.name && preferSocketName(legacy.name).toLowerCase() === nixie.preferredName.toLowerCase()) {
        nameScore = 500;
    }
    if (!String(nixie.name).includes(':')) {
        nameScore += 5;
    }
    if (isFoundationSocketName(nixie.preferredName)) {
        const legacyDistFromOrigin = Math.hypot(legacy.x - legacyOrigin.x, legacy.y - legacyOrigin.y);
        if (legacyDistFromOrigin > 0.5) {
            nameScore -= 1000;
        }
    }

    return {
        score: nameScore + posScore + rotScore,
        distCm,
        rotResidualDeg,
        lx,
        ly,
    };
}

/** Map legacy authored `cap` to a Nixie connector socket name when present. */
export function cardinalFromLegacyCap(cap) {
    const normalized = String(cap ?? '').trim().toLowerCase();
    if (normalized === 'front') {
        return 'FrontSocket';
    }
    if (normalized === 'back') {
        return 'BackSocket';
    }
    if (normalized === 'left') {
        return 'LeftSocket';
    }
    if (normalized === 'right') {
        return 'RightSocket';
    }
    return null;
}

function socketsLackPositions(legacySockets) {
    return legacySockets.every(socket => Math.hypot(Number(socket.x) || 0, Number(socket.y) || 0) < 0.01);
}

function matchByLegacyCap(legacySockets, preferredNames) {
    /** @type {Record<string, string>} */
    const mapping = {};
    const used = new Set();
    for (const legacy of legacySockets) {
        const fromCap = cardinalFromLegacyCap(legacy.cap);
        if (!fromCap || !preferredNames.has(fromCap) || used.has(fromCap)) {
            continue;
        }
        mapping[String(legacy.id)] = fromCap;
        used.add(fromCap);
    }
    return mapping;
}

function matchByFortCardinal(legacySockets, preferredNames) {
    /** @type {Record<string, string>} */
    const mapping = {};
    const used = new Set();
    for (const legacy of legacySockets) {
        const fortName = cardinalFortSocketName(legacy.rotation);
        if (!fortName || !preferredNames.has(fortName) || used.has(fortName)) {
            continue;
        }
        mapping[String(legacy.id)] = fortName;
        used.add(fortName);
    }
    return mapping;
}

/**
 * Greedy global assignment by pair score (highest first).
 */
export function matchSocketsByScore(legacySockets, nixieSockets) {
    const preferredNixie = dedupeNixieSockets(nixieSockets);
    const preferredNames = new Set(preferredNixie.map(socket => socket.preferredName));
    const origin = legacyOriginOf(legacySockets);
    const hasFortSockets = [...preferredNames].some(name => /FortSocket$/i.test(name));
    const lackPositions = socketsLackPositions(legacySockets);

    /** @type {Record<string, string>} */
    let mapping = {};
    let method = 'position-frame';

    if (hasFortSockets) {
        const fortMapping = matchByFortCardinal(legacySockets, preferredNames);
        const fortCoverage = Object.keys(fortMapping).length / Math.max(1, legacySockets.length);
        if (fortCoverage >= 0.75) {
            mapping = fortMapping;
            method = 'fort-cardinal';
        }
    } else if (lackPositions && legacySockets.some(socket => socket.cap)) {
        // Connector sockets are often authored with cap/rotation only (no x/y).
        const capMapping = matchByLegacyCap(legacySockets, preferredNames);
        if (Object.keys(capMapping).length) {
            mapping = capMapping;
            method = 'cap-frame';
        }
    }

    const usedLegacy = new Set(Object.keys(mapping));
    const usedNixie = new Set(Object.values(mapping));
    /** @type {Array<{ id: string; preferred: string; score: number; distCm: number; rotResidualDeg: number; secondScore: number; }>} */
    const candidates = [];

    for (const legacy of legacySockets) {
        const id = String(legacy.id);
        if (usedLegacy.has(id)) {
            continue;
        }
        /** @type {Array<{ preferred: string; score: number; distCm: number; rotResidualDeg: number; }>} */
        const ranked = [];
        for (const nixie of preferredNixie) {
            const preferred = nixie.preferredName;
            if (!preferred || usedNixie.has(preferred)) {
                continue;
            }
            const pair = scoreSocketPair(legacy, nixie, origin);
            ranked.push({
                preferred,
                score: pair.score,
                distCm: pair.distCm,
                rotResidualDeg: pair.rotResidualDeg,
            });
        }
        ranked.sort((left, right) => right.score - left.score || left.distCm - right.distCm);
        for (const entry of ranked) {
            candidates.push({
                id,
                preferred: entry.preferred,
                score: entry.score,
                distCm: entry.distCm,
                rotResidualDeg: entry.rotResidualDeg,
                secondScore: ranked[1]?.score ?? 0,
            });
        }
    }

    candidates.sort((left, right) => right.score - left.score || left.distCm - right.distCm);

    /** @type {Record<string, { name: string; distCm: number; rotResidualDeg: number; score: number; margin: number; }>} */
    const details = {};
    for (const [id, name] of Object.entries(mapping)) {
        details[id] = {
            name,
            distCm: 0,
            rotResidualDeg: 0,
            score: 1000,
            margin: 1000,
        };
    }

    for (const candidate of candidates) {
        if (usedLegacy.has(candidate.id) || usedNixie.has(candidate.preferred)) {
            continue;
        }
        if (candidate.distCm > MAX_POSITION_RESIDUAL_CM && candidate.score < 500) {
            continue;
        }
        mapping[candidate.id] = candidate.preferred;
        usedLegacy.add(candidate.id);
        usedNixie.add(candidate.preferred);
        details[candidate.id] = {
            name: candidate.preferred,
            distCm: candidate.distCm,
            rotResidualDeg: candidate.rotResidualDeg,
            score: candidate.score,
            margin: candidate.score - candidate.secondScore,
        };
        if (method === 'fort-cardinal') {
            method = 'fort-cardinal+position-frame';
        } else if (method === 'cap-frame') {
            method = 'cap-frame+position-frame';
        }
    }

    return summarizeMatch({
        mapping,
        details,
        method,
        legacyCount: legacySockets.length,
        nixieCount: preferredNixie.length,
    });
}

function summarizeMatch(options) {
    const {
        mapping,
        details,
        method,
        legacyCount,
        nixieCount,
    } = options;
    const matchedIds = Object.keys(mapping);
    const matched = matchedIds.length;
    const residuals = matchedIds.map(id => details[id]?.distCm ?? 0);
    const rotResiduals = matchedIds.map(id => details[id]?.rotResidualDeg ?? 0);
    const margins = matchedIds.map(id => details[id]?.margin ?? 0);
    const meanResidualCm = residuals.length
        ? residuals.reduce((sum, value) => sum + value, 0) / residuals.length
        : null;
    const meanRotResidualDeg = rotResiduals.length
        ? rotResiduals.reduce((sum, value) => sum + value, 0) / rotResiduals.length
        : null;
    const meanMargin = margins.length
        ? margins.reduce((sum, value) => sum + value, 0) / margins.length
        : null;
    const coverage = matched / Math.max(1, legacyCount);
    const unmatchedLegacy = Math.max(0, legacyCount - matched);
    const unmatchedNixie = Math.max(0, nixieCount - matched);

    let confidence = 'low';
    if (matched === 0) {
        confidence = 'skip';
    } else if (
        coverage >= 0.99
        && (meanResidualCm ?? 999) <= 25
        && unmatchedLegacy === 0
    ) {
        confidence = 'high';
    } else if (coverage >= 0.75 && (meanResidualCm ?? 999) <= 100) {
        confidence = 'medium';
    }

    return {
        mapping,
        confidence,
        method,
        matchedSockets: matched,
        unmatchedLegacy,
        unmatchedNixie,
        meanResidualCm: meanResidualCm == null ? undefined : Number(meanResidualCm.toFixed(2)),
        meanRotResidualDeg: meanRotResidualDeg == null ? undefined : Number(meanRotResidualDeg.toFixed(2)),
        meanMargin: meanMargin == null ? undefined : Number(meanMargin.toFixed(2)),
        coverage: Number(coverage.toFixed(4)),
        details,
    };
}

function serializeMappingFields(mapping) {
    return Object.entries(mapping)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([id, name]) => `\t\t${JSON.stringify(id)}: ${JSON.stringify(name)},`)
        .join('\n');
}

function serializeMetaFields(entry) {
    const fields = [
        `\t\tconfidence: ${JSON.stringify(entry.confidence)},`,
        `\t\tmethod: ${JSON.stringify(entry.method)},`,
    ];
    if (entry.matchedSockets != null) {
        fields.push(`\t\tmatchedSockets: ${entry.matchedSockets},`);
    }
    if (entry.unmatchedLegacy != null) {
        fields.push(`\t\tunmatchedLegacy: ${entry.unmatchedLegacy},`);
    }
    if (entry.unmatchedNixie != null) {
        fields.push(`\t\tunmatchedNixie: ${entry.unmatchedNixie},`);
    }
    if (entry.meanResidualCm != null) {
        fields.push(`\t\tmeanResidualCm: ${entry.meanResidualCm},`);
    }
    if (entry.meanRotResidualDeg != null) {
        fields.push(`\t\tmeanRotResidualDeg: ${entry.meanRotResidualDeg},`);
    }
    if (entry.meanMargin != null) {
        fields.push(`\t\tmeanMargin: ${entry.meanMargin},`);
    }
    if (entry.orientationOffsetDeg != null && entry.orientationOffsetDeg !== 0) {
        fields.push(`\t\torientationOffsetDeg: ${entry.orientationOffsetDeg},`);
    }
    return fields;
}

/**
 * Nixie sockets for a resolved structure, including sockets contributed by
 * selected modification variants (facility upgrades).
 */
export function collectEffectiveNixieSockets(asset, structure, modificationVariantIds = {}) {
    /** @type {Map<string, any>} */
    const byName = new Map();
    const push = raw => {
        const expanded = expandSocket(raw);
        if (!expanded.name) {
            return;
        }
        if (!byName.has(expanded.name)) {
            byName.set(expanded.name, expanded);
        }
    };

    for (const socket of structure?.buildSockets ?? []) {
        push(socket);
    }
    for (const socket of asset?.buildSockets ?? []) {
        push(socket);
    }
    for (const coupler of structure?.railCouplers ?? []) {
        push({
            name: coupler.name,
            x: coupler.x,
            y: coupler.y,
            rotation: coupler.rotation,
        });
    }
    for (const coupler of asset?.railCouplers ?? []) {
        push({
            name: coupler.name,
            x: coupler.x,
            y: coupler.y,
            rotation: coupler.rotation,
        });
    }

    const variantIds = modificationVariantIds && typeof modificationVariantIds === 'object'
        ? Object.values(modificationVariantIds)
        : [];
    for (const slot of asset?.modificationSlots ?? []) {
        for (const variant of slot.variants ?? []) {
            const selected = variantIds.includes(variant.id)
                || variantIds.includes(variant.appliedModificationId)
                || variantIds.includes(variant.modificationId);
            if (!selected) {
                continue;
            }
            for (const socket of variant.buildSockets ?? []) {
                push(socket);
            }
        }
    }

    return [...byName.values()];
}

async function main() {
    const gameKitchen = process.argv.includes('--game-kitchen')
        ? process.argv[process.argv.indexOf('--game-kitchen') + 1]
        : DEFAULT_GAME_KITCHEN;
    const dataPath = path.join(gameKitchen, 'app/plugins/foxhole/data.js');

    // Always refresh the loader-faithful exfil first.
    const legacyByKey = exfilLegacySocketsFromDataJs(dataPath);
    fs.writeFileSync(
        path.join(__dirname, 'legacy-sockets.exfil.json'),
        `${JSON.stringify({
            generatedAt: new Date().toISOString(),
            source: dataPath,
            semantics: 'loader-flatten + socket-id merge (child overlays parent by id)',
            buildingCount: Object.keys(legacyByKey).length,
            socketCount: Object.values(legacyByKey).reduce((sum, sockets) => sum + sockets.length, 0),
            buildings: legacyByKey,
        }, null, '\t')}\n`,
    );

    const orientationOffsets = loadOrientationOffsets();
    const overrides = loadSocketOverrides();
    const qa = loadSocketQa();

    const { buildFoxholeStructureCatalog } = await import(
        pathToFileURL(path.join(__dirname, '../../app/plugins/foxhole/nixie/catalog.ts')).href
    );
    const { getFoxholeManifest } = await import(
        pathToFileURL(path.join(__dirname, '../../app/plugins/foxhole/nixie/manifest.ts')).href
    );
    const { LegacyPlanFacilityUpgradeResolver } = await import(
        pathToFileURL(path.join(__dirname, '../../app/plugins/foxhole/legacy/plan-facility-upgrade.ts')).href
    );
    const { resolveLegacyPlanBuildingKey } = await import(
        pathToFileURL(path.join(__dirname, '../../app/plugins/foxhole/legacy/plan-building-key-map.ts')).href
    );

    const catalog = buildFoxholeStructureCatalog(getFoxholeManifest('/foxhole/assets/'));
    const facilityResolver = new LegacyPlanFacilityUpgradeResolver(catalog);

    /** @type {Record<string, any>} */
    const byLegacyKey = {};
    let orientedBuildings = 0;
    let upgradeMapped = 0;

    for (const [legacyKey, legacySocketsRaw] of Object.entries(legacyByKey)) {
        if (!legacySocketsRaw?.length) {
            continue;
        }

        const resolved = facilityResolver.resolve(legacyKey)
            ?? (() => {
                const foxholeKey = resolveLegacyPlanBuildingKey(legacyKey);
                if (!foxholeKey || !catalog.structureByKey[foxholeKey]) {
                    return null;
                }
                return {
                    foxholeKey,
                    modificationVariantIds: {},
                    kind: 'structure',
                };
            })();
        if (!resolved) {
            continue;
        }

        const asset = catalog.assetByKey[resolved.foxholeKey] ?? null;
        const structure = catalog.structureByKey[resolved.foxholeKey] ?? null;
        if (!asset && !structure) {
            continue;
        }

        const nixieSockets = collectEffectiveNixieSockets(
            asset,
            structure,
            resolved.modificationVariantIds,
        );
        if (!nixieSockets.length) {
            continue;
        }

        const rotationOffsetDeg = orientationOffsets[resolved.foxholeKey] ?? 0;
        if (rotationOffsetDeg) {
            orientedBuildings += 1;
        }

        // Emplacement pads are not build sockets — skip them so we never invent
        // mappings like trenchemp*"8" → TrenchEmpCommonSockets.
        const legacySocketsForMatch = (legacySocketsRaw ?? [])
            .filter(socket => String(socket?.type ?? '').trim().toLowerCase() !== 'emplacement');
        if (!legacySocketsForMatch.length) {
            continue;
        }
        const legacySockets = applyOrientationToLegacySockets(legacySocketsForMatch, rotationOffsetDeg);
        let scored = matchSocketsByScore(legacySockets, nixieSockets);
        if ((scored.unmatchedLegacy ?? 0) > 0 || !Object.keys(scored.mapping).length) {
            const filled = fillSocketsByFlowAndName(legacySocketsForMatch, nixieSockets, scored.mapping);
            if (filled) {
                scored = {
                    ...scored,
                    ...filled,
                    method: Object.keys(scored.mapping).length
                        ? `${scored.method}+${filled.method}`
                        : filled.method,
                };
            }
        }
        if (!Object.keys(scored.mapping).length) {
            continue;
        }

        const isUpgrade = resolved.kind === 'structure+mod'
            || Object.keys(resolved.modificationVariantIds ?? {}).length > 0;
        if (isUpgrade) {
            upgradeMapped += 1;
        }

        byLegacyKey[legacyKey] = {
            ...scored,
            orientationOffsetDeg: rotationOffsetDeg,
            foxholeKey: resolved.foxholeKey,
            modificationVariantIds: resolved.modificationVariantIds ?? {},
            kind: resolved.kind ?? 'structure',
        };

        // Keep foxholeKey alias for base (non-upgrade) keys so existing lookups
        // and overrides keyed by foxhole id continue to work.
        if (
            resolved.kind !== 'structure+mod'
            && Object.keys(resolved.modificationVariantIds ?? {}).length === 0
            && resolved.foxholeKey !== legacyKey
            && !byLegacyKey[resolved.foxholeKey]
        ) {
            byLegacyKey[resolved.foxholeKey] = {
                ...byLegacyKey[legacyKey],
                method: `${scored.method}+foxhole-alias`,
            };
        }
    }

    let overrideCount = 0;
    for (const [overrideKey, mapping] of Object.entries(overrides)) {
        const existing = byLegacyKey[overrideKey];
        byLegacyKey[overrideKey] = {
            mapping: { ...mapping },
            confidence: 'high',
            method: 'manual-override',
            matchedSockets: Object.keys(mapping).length,
            unmatchedLegacy: 0,
            unmatchedNixie: 0,
            orientationOffsetDeg: existing?.orientationOffsetDeg
                ?? orientationOffsets[overrideKey]
                ?? orientationOffsets[existing?.foxholeKey]
                ?? 0,
            foxholeKey: existing?.foxholeKey ?? overrideKey,
            modificationVariantIds: existing?.modificationVariantIds ?? {},
            kind: existing?.kind ?? 'structure',
        };
        overrideCount += 1;
    }

    let confirmedCount = 0;
    for (const confirmedKey of qa.confirmed) {
        for (const [mapKey, existing] of Object.entries(byLegacyKey)) {
            if (existing.method === 'manual-override') {
                continue;
            }
            if (mapKey !== confirmedKey && existing.foxholeKey !== confirmedKey) {
                continue;
            }
            if ((existing.unmatchedLegacy ?? 0) > 0 || (existing.coverage ?? 0) < 0.9) {
                continue;
            }
            byLegacyKey[mapKey] = {
                ...existing,
                confidence: 'high',
                method: existing.method?.includes('qa-confirmed')
                    ? existing.method
                    : `${existing.method}+qa-confirmed`,
            };
            confirmedCount += 1;
        }
    }

    const sorted = Object.entries(byLegacyKey).sort(([a], [b]) => a.localeCompare(b));
    const mapBody = sorted.map(([legacyKey, entry]) => {
        const entries = serializeMappingFields(entry.mapping);
        return `\t${JSON.stringify(legacyKey)}: {\n${entries}\n\t},`;
    }).join('\n');

    const metaBody = sorted.map(([legacyKey, entry]) => {
        const fields = serializeMetaFields(entry);
        if (entry.foxholeKey && entry.foxholeKey !== legacyKey) {
            fields.push(`\t\tfoxholeKey: ${JSON.stringify(entry.foxholeKey)},`);
        }
        if (entry.kind) {
            fields.push(`\t\tkind: ${JSON.stringify(entry.kind)},`);
        }
        return `\t${JSON.stringify(legacyKey)}: {\n${fields.join('\n')}\n\t},`;
    }).join('\n');

    const ts = `/**
 * Legacy socketData.id → Nixie buildSocket name.
 *
 * Keys are legacy building keys from data.js after loader-style upgrade flatten
 * (\`parent_upgrade\`). Base foxholeKeys are also aliased when they differ so
 * existing lookups keep working. Facility upgrades that only gain sockets on
 * the child are keyed by the full legacy upgrade id.
 *
 * Generated by scored matching of exfil'd legacy sockets to manifest
 * buildSockets (including modification variant sockets). Position is primary;
 * rotation is a tie-breaker. Orientation offsets from plan-orientation-map are
 * applied before scoring.
 *
 * Exfil: npm run legacy:exfil-sockets
 * Manual overrides: tools/legacy-plans/socket-overrides.json
 * Visual QA confirms: tools/legacy-plans/socket-qa.json
 * Regenerate: npm run legacy:generate-socket-id-map
 */
export type LegacyPlanSocketMatchEntry = {
\tconfidence: 'high' | 'medium' | 'low' | 'skip';
\tmethod: string;
\tmatchedSockets?: number;
\tunmatchedLegacy?: number;
\tunmatchedNixie?: number;
\tmeanResidualCm?: number;
\tmeanRotResidualDeg?: number;
\tmeanMargin?: number;
\torientationOffsetDeg?: number;
\tfoxholeKey?: string;
\tkind?: string;
};

export const LEGACY_PLAN_SOCKET_ID_MAP: Readonly<Record<string, Readonly<Record<string, string>>>> = {
${mapBody}
};

export const LEGACY_PLAN_SOCKET_MATCH_META: Readonly<Record<string, LegacyPlanSocketMatchEntry>> = {
${metaBody}
};

export function resolveLegacyPlanSocketName(
\tlegacyOrFoxholeKey: string,
\tlegacySocketId: string | number,
\toptions: { legacyKey?: string | null; foxholeKey?: string | null; } = {},
): string | null {
\tconst id = String(legacySocketId);
\tconst candidates = [
\t\toptions.legacyKey,
\t\tlegacyOrFoxholeKey,
\t\toptions.foxholeKey,
\t]
\t\t.map(value => String(value ?? '').trim())
\t\t.filter(Boolean);
\tfor (const key of candidates) {
\t\tconst mapping = LEGACY_PLAN_SOCKET_ID_MAP[key];
\t\tif (mapping?.[id]) {
\t\t\treturn mapping[id];
\t\t}
\t}
\treturn null;
}

/** Resolve the serialized legacy socket id for an already-resolved Nixie socket name. */
export function resolveLegacyPlanSocketId(
\tlegacyOrFoxholeKey: string,
\tsocketName: string,
\toptions: { legacyKey?: string | null; foxholeKey?: string | null; } = {},
): string | null {
\tconst normalizedSocketName = String(socketName ?? '').trim();
\tif (!normalizedSocketName) {
\t\treturn null;
\t}
\tconst candidates = [
\t\toptions.legacyKey,
\t\tlegacyOrFoxholeKey,
\t\toptions.foxholeKey,
\t]
\t\t.map(value => String(value ?? '').trim())
\t\t.filter(Boolean);
\tfor (const key of candidates) {
\t\tconst mapping = LEGACY_PLAN_SOCKET_ID_MAP[key];
\t\tconst match = Object.entries(mapping ?? {}).find(([, mappedSocketName]) => mappedSocketName === normalizedSocketName);
\t\tif (match) {
\t\t\treturn match[0];
\t\t}
\t}
\treturn null;
}

export function resolveLegacyPlanSocketMatchMeta(legacyOrFoxholeKey: string): LegacyPlanSocketMatchEntry | null {
\treturn LEGACY_PLAN_SOCKET_MATCH_META[String(legacyOrFoxholeKey ?? '').trim()] ?? null;
}
`;

    const byConfidence = sorted.reduce((acc, [, entry]) => {
        acc[entry.confidence] = (acc[entry.confidence] ?? 0) + 1;
        return acc;
    }, /** @type {Record<string, number>} */ ({}));
    const byMethod = sorted.reduce((acc, [, entry]) => {
        acc[entry.method] = (acc[entry.method] ?? 0) + 1;
        return acc;
    }, /** @type {Record<string, number>} */ ({}));

    fs.writeFileSync(OUT_TS, ts);
    fs.writeFileSync(OUT_JSON, `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        count: sorted.length,
        upgradeMapped,
        byConfidence,
        byMethod,
        lowConfidence: sorted
            .filter(([, entry]) => entry.confidence === 'low' || entry.confidence === 'skip')
            .map(([legacyKey, entry]) => ({
                legacyKey,
                foxholeKey: entry.foxholeKey,
                confidence: entry.confidence,
                method: entry.method,
                matchedSockets: entry.matchedSockets,
                unmatchedLegacy: entry.unmatchedLegacy,
                meanResidualCm: entry.meanResidualCm,
            })),
        sample: sorted.slice(0, 20).map(([legacyKey, entry]) => ({
            legacyKey,
            foxholeKey: entry.foxholeKey,
            mapping: entry.mapping,
            confidence: entry.confidence,
            method: entry.method,
            meanResidualCm: entry.meanResidualCm,
        })),
        waterPumpElectric: byLegacyKey.water_pump_electric_water ?? null,
    }, null, '\t')}\n`);

    console.log({
        legacyBuildingsWithSockets: Object.keys(legacyByKey).length,
        mappedBuildings: sorted.length,
        mappedSockets: sorted.reduce((sum, [, entry]) => sum + Object.keys(entry.mapping).length, 0),
        upgradeMapped,
        orientedBuildings,
        manualOverrides: overrideCount,
        qaConfirmed: confirmedCount,
        byConfidence,
        byMethod,
        waterPumpElectric: byLegacyKey.water_pump_electric_water?.mapping ?? null,
        wrote: OUT_TS,
        dump: OUT_JSON,
    });
}

const isDirectRun = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
    main().catch(error => {
        console.error(error);
        process.exit(1);
    });
}
