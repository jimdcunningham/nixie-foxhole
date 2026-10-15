import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const mapSrc = fs.readFileSync(path.join(root, 'app/plugins/foxhole/legacy/plan-socket-id-map.ts'), 'utf8');
const mappedKeys = [...mapSrc.matchAll(/"([^"]+)": \{/g)].map(m => m[1]);
console.log('mapped foxhole keys', mappedKeys.length);

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/foxhole/assets/manifest.v1.json'), 'utf8'));
const keyMapSrc = fs.readFileSync(path.join(root, 'app/plugins/foxhole/legacy/plan-building-key-map.ts'), 'utf8');
const keyMap = Object.fromEntries([...keyMapSrc.matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map(m => [m[1], m[2]]));

const data = fs.readFileSync('C:/Code/game-kitchen/app/plugins/foxhole/data.js', 'utf8');

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
    const colon = normalized.lastIndexOf(':');
    if (colon >= 0 && colon < normalized.length - 1) {
        return normalized.slice(colon + 1);
    }
    return normalized;
}

const buildingsMatch = data.match(/"buildings"\s*:\s*\{/);
const open = data.indexOf('{', buildingsMatch.index + '"buildings"'.length);
const body = extractBalanced(data, open);

const samples = [
    'fortt1',
    'pipeline',
    'power_line',
    'materials_factory',
    'trench',
    'storage_box',
    'fuel_silo',
    'diesel_power_plant',
    'foundation_1x1',
    'townbase1',
    'seaport',
    'facilitypipe',
];

for (const legacyKey of samples) {
    const re = new RegExp(`\\n\\t\\t"${legacyKey}"\\s*:\\s*\\{`);
    const m = body.match(re);
    if (!m) {
        console.log(legacyKey, 'NOT FOUND in data.js');
        continue;
    }
    const objStart = body.indexOf('{', m.index + m[0].length - 1);
    const obj = extractBalanced(body, objStart);
    const textureBlock = obj.match(/"texture"\s*:\s*\{[\s\S]*?\}/);
    const tw = Number(textureBlock?.[0].match(/"width"\s*:\s*(-?[\d.]+)/)?.[1]);
    const th = Number(textureBlock?.[0].match(/"height"\s*:\s*(-?[\d.]+)/)?.[1]);
    const w = Number(obj.match(/^\s*"width"\s*:\s*(-?[\d.]+)/m)?.[1]);
    const l = Number(obj.match(/"length"\s*:\s*(-?[\d.]+)/)?.[1]);

    const socketsMatch = obj.match(/"sockets"\s*:\s*\[/);
    const legacySockets = [];
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
            legacySockets.push({
                id,
                x: Number(socketObj.match(/"x"\s*:\s*(-?[\d.]+)/)?.[1] ?? 0),
                y: Number(socketObj.match(/"y"\s*:\s*(-?[\d.]+)/)?.[1] ?? 0),
                r: Number(socketObj.match(/"rotation"\s*:\s*(-?[\d.]+)/)?.[1] ?? 0),
            });
        }
    }

    const foxholeKey = keyMap[legacyKey] ?? legacyKey;
    const asset = manifest.assets.find(a => a.id === foxholeKey);
    const layers = asset?.renderLayers || asset?.rl || [];
    const baseLayer = layers.find(layer => (layer.role || layer.r) === 'base' || (layer.role || layer.r) === 'preview')
        || layers[0];
    const nixieW = baseLayer?.width ?? baseLayer?.w ?? asset?.textureWidth ?? asset?.tw;
    const nixieH = baseLayer?.height ?? baseLayer?.h ?? asset?.textureHeight ?? asset?.th;

    const nixieSockets = (asset?.buildSockets || []).map(s => ({
        n: preferSocketName(s.n || s.name),
        x: s.x ?? 0,
        y: s.y ?? 0,
        r: normalizeRotationDeg(s.r ?? s.rotation ?? 0),
        full: s.n || s.name,
    })).filter(s => s.n && !String(s.full).includes(':'));

    const map = {};
    const block = mapSrc.match(new RegExp(`"${foxholeKey}": \\{([\\s\\S]*?)\\n\\t\\},`));
    if (block) {
        for (const e of block[1].matchAll(/"(\d+)": "([^"]+)"/g)) {
            map[e[1]] = e[2];
        }
    }

    // Score how well mapped sockets agree on rotation (legacy vs nixie), without fort heuristic.
    const rotAgreement = [];
    for (const [id, name] of Object.entries(map)) {
        const legacy = legacySockets.find(s => String(s.id) === id);
        const nixie = nixieSockets.find(s => s.n === name);
        if (!legacy || !nixie) {
            continue;
        }
        rotAgreement.push({
            id,
            name,
            legacyR: legacy.r,
            nixieR: nixie.r,
            delta: rotationDelta(legacy.r, nixie.r),
            legacyPos: { x: legacy.x, y: legacy.y },
            nixiePos: { x: nixie.x, y: nixie.y },
        });
    }

    console.log(JSON.stringify({
        legacyKey,
        foxholeKey,
        legacyTex: {
            tw,
            th,
            w,
            l,
            aspect: tw && th ? Number((tw / th).toFixed(3)) : null,
            landscape: tw && th ? tw >= th : null,
        },
        nixieTex: {
            w: nixieW,
            h: nixieH,
            aspect: nixieW && nixieH ? Number((nixieW / nixieH).toFixed(3)) : null,
            landscape: nixieW && nixieH ? nixieW >= nixieH : null,
        },
        aspectFlip: tw && th && nixieW && nixieH
            ? ((tw >= th) !== (nixieW >= nixieH))
            : null,
        legacySocketCount: legacySockets.length,
        nixieSocketCount: nixieSockets.length,
        idMap: map,
        rotAgreement,
    }, null, 2));
}
