/**
 * Exfil legacy building sockets the way foxhole loader.js flattens upgrades.
 *
 * loader.js does:
 *   Object.assign({}, building, clearedTier, upgrade, …)
 * so an upgrade's `sockets` array replaces the parent array when present.
 * When `sockets` is absent, the parent list is kept.
 *
 * Import semantics (per migration guidance): when both parent and child define
 * sockets, merge by socket id so children can overwrite individual ids without
 * dropping unrelated parent sockets.
 *
 * Usage:
 *   node ./tools/legacy-plans/exfil-legacy-sockets.mjs
 *   node ./tools/legacy-plans/exfil-legacy-sockets.mjs --game-kitchen C:/Code/game-kitchen
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GAME_KITCHEN = process.env.GAME_KITCHEN_PATH || 'C:/Code/game-kitchen';
const OUT_JSON = path.join(__dirname, 'legacy-sockets.exfil.json');

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

function parseSocketsArray(objText) {
    const socketsMatch = objText.match(/"sockets"\s*:\s*\[/);
    if (!socketsMatch || socketsMatch.index === undefined) {
        return null;
    }
    const arrayStart = objText.indexOf('[', socketsMatch.index);
    let depth = 0;
    let end = -1;
    for (let i = arrayStart; i < objText.length; i++) {
        if (objText[i] === '[') {
            depth++;
        } else if (objText[i] === ']') {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }
    if (end < 0) {
        return null;
    }
    const arrayBody = objText.slice(arrayStart, end + 1);
    /** @type {Array<{ id: number; x: number; y: number; rotation: number; name: string; cap: string; flow: string; type: string; }>} */
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
        // Only capture string socket types (e.g. "emplacement"). Tag arrays are ignored.
        const typeMatch = socketObj.match(/"type"\s*:\s*"([^"]+)"/);
        sockets.push({
            id,
            x: Number(socketObj.match(/"x"\s*:\s*(-?[\d.]+)/)?.[1] ?? 0),
            y: Number(socketObj.match(/"y"\s*:\s*(-?[\d.]+)/)?.[1] ?? 0),
            rotation: normalizeRotationDeg(socketObj.match(/"rotation"\s*:\s*(-?[\d.]+)/)?.[1] ?? 0),
            name: socketObj.match(/"name"\s*:\s*"([^"]+)"/)?.[1] ?? '',
            cap: socketObj.match(/"cap"\s*:\s*"([^"]+)"/)?.[1] ?? '',
            flow: socketObj.match(/"flow"\s*:\s*"([^"]+)"/)?.[1] ?? '',
            type: typeMatch?.[1] ?? '',
        });
    }
    return sockets;
}

/**
 * Parent sockets inherited; child sockets overlay by id when present.
 * @param {Array<{ id: number; }> | null | undefined} parentSockets
 * @param {Array<{ id: number; }> | null | undefined} childSockets
 * @param {boolean} childDefined whether the child object declared a sockets field
 */
export function mergeLegacySocketsById(parentSockets, childSockets, childDefined) {
    if (!childDefined) {
        return parentSockets ? parentSockets.map(socket => ({ ...socket })) : [];
    }
    /** @type {Map<number, any>} */
    const byId = new Map();
    for (const socket of parentSockets ?? []) {
        byId.set(socket.id, { ...socket });
    }
    for (const socket of childSockets ?? []) {
        byId.set(socket.id, { ...socket });
    }
    return [...byId.values()].sort((left, right) => left.id - right.id);
}

/**
 * Parse data.js and flatten upgrades like loader.js (`parent_upgrade` keys).
 * @returns {Record<string, Array<{ id: number; x: number; y: number; rotation: number; name: string; cap: string; flow: string; }>>}
 */
export function exfilLegacySocketsFromDataJs(dataPath) {
    const src = fs.readFileSync(dataPath, 'utf8');
    const buildingsMatch = src.match(/"buildings"\s*:\s*\{/);
    if (!buildingsMatch || buildingsMatch.index === undefined) {
        throw new Error(`buildings block not found in ${dataPath}`);
    }
    const open = src.indexOf('{', buildingsMatch.index + '"buildings"'.length);
    const body = extractBalanced(src, open);
    if (!body) {
        throw new Error('Failed to parse buildings object');
    }

    /** @type {Record<string, any[]>} */
    const byKey = {};

    for (const m of body.matchAll(/\n\t\t"([^"]+)"\s*:\s*\{/g)) {
        const buildingKey = m[1];
        const objStart = body.indexOf('{', m.index + m[0].length - 1);
        const obj = extractBalanced(body, objStart);
        if (!obj) {
            continue;
        }

        const parentSockets = parseSocketsArray(obj) ?? [];
        if (parentSockets.length) {
            byKey[buildingKey] = parentSockets.map(socket => ({ ...socket }));
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
            if (/"reference"\s*:/.test(upgradeObj)) {
                continue;
            }

            const childDefined = /"sockets"\s*:\s*\[/.test(upgradeObj);
            const childSockets = childDefined ? (parseSocketsArray(upgradeObj) ?? []) : null;
            const merged = mergeLegacySocketsById(parentSockets, childSockets, childDefined);
            if (!merged.length) {
                continue;
            }
            byKey[`${buildingKey}_${upgradeKey}`] = merged;
        }
    }

    return byKey;
}

function main() {
    const argv = process.argv.slice(2);
    let gameKitchen = DEFAULT_GAME_KITCHEN;
    let outPath = OUT_JSON;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--game-kitchen') {
            gameKitchen = String(argv[++i] ?? gameKitchen);
        } else if (argv[i] === '--out') {
            outPath = path.resolve(String(argv[++i] ?? outPath));
        }
    }

    const dataPath = path.join(gameKitchen, 'app/plugins/foxhole/data.js');
    if (!fs.existsSync(dataPath)) {
        throw new Error(`game-kitchen data.js not found at ${dataPath}`);
    }

    const byKey = exfilLegacySocketsFromDataJs(dataPath);
    const keys = Object.keys(byKey).sort();
    const upgradeKeys = keys.filter(key => key.includes('_'));
    const payload = {
        generatedAt: new Date().toISOString(),
        source: dataPath,
        semantics: 'loader-flatten + socket-id merge (child overlays parent by id)',
        buildingCount: keys.length,
        upgradeCount: upgradeKeys.length,
        socketCount: keys.reduce((sum, key) => sum + byKey[key].length, 0),
        buildings: byKey,
    };

    fs.writeFileSync(outPath, `${JSON.stringify(payload, null, '\t')}\n`, 'utf8');
    console.log({
        buildingCount: payload.buildingCount,
        upgradeCount: payload.upgradeCount,
        socketCount: payload.socketCount,
        sampleUpgrades: upgradeKeys.filter(key => key.includes('water_pump') || key.includes('electric')).slice(0, 10),
        waterPumpElectric: byKey.water_pump_electric_water ?? null,
        wrote: outPath,
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
