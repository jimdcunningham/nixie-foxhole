import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exfilLegacySocketsFromDataJs } from './exfil-legacy-sockets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLANNER_ROOT = path.resolve(__dirname, '../..');
const ORIENTATION_MAP_PATH = path.resolve(PLANNER_ROOT, 'app/plugins/foxhole/legacy/plan-orientation-map.ts');
const KEY_MAP_PATH = path.resolve(PLANNER_ROOT, 'app/plugins/foxhole/legacy/plan-building-key-map.ts');
const BUILDING_KEY_MAP_JSON = path.resolve(__dirname, 'building-key-map.json');
const ORIENTATION_QA_PATH = path.resolve(__dirname, 'orientation-qa.json');
const OUT_DIR = path.resolve(__dirname, 'clipboard-snapshots');
const DEFAULT_GAME_KITCHEN = process.env.GAME_KITCHEN_PATH || 'C:/Code/game-kitchen';

const CELL_SPACING_X = 900;
const CELL_SPACING_Y = 700;
const GRID_COLUMNS = 4;

function gridOrigin(index, columns = GRID_COLUMNS) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    return {
        x: col * CELL_SPACING_X,
        y: row * CELL_SPACING_Y,
    };
}

function parseArgs(argv) {
    const options = {
        mode: 'orientation-uncertain',
        confidence: new Set(['low', 'medium']),
        only: null,
        limit: null,
        outName: null,
        singlePair: false,
        allBunkers: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--mode') {
            options.mode = String(argv[++index] ?? options.mode).trim() || options.mode;
        } else if (arg === '--confidence') {
            const value = String(argv[++index] ?? '');
            options.confidence = new Set(
                value.split(',')
                    .map(part => part.trim().toLowerCase())
                    .filter(Boolean),
            );
        } else if (arg === '--only') {
            options.only = new Set(
                String(argv[++index] ?? '')
                    .split(',')
                    .map(part => part.trim().toLowerCase())
                    .filter(Boolean),
            );
        } else if (arg === '--limit') {
            const limit = Number(argv[++index]);
            options.limit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null;
        } else if (arg === '--out') {
            options.outName = String(argv[++index] ?? '').trim() || null;
        } else if (arg === '--single-pair') {
            options.singlePair = true;
        } else if (arg === '--all-bunkers') {
            options.allBunkers = true;
        }
    }

    if (!options.outName) {
        options.outName = options.mode;
    }

    return options;
}

function loadOrientationEntries() {
    const src = fs.readFileSync(ORIENTATION_MAP_PATH, 'utf8');
    /** @type {Array<{ foxholeKey: string; confidence: string; method: string; rotationOffsetDeg: number; }>} */
    const entries = [];
    for (const match of src.matchAll(/"([^"]+)":\s*\{([\s\S]*?)\n\t\},/g)) {
        const foxholeKey = match[1];
        const body = match[2];
        const confidence = body.match(/confidence:\s*"([^"]+)"/)?.[1] ?? 'low';
        const method = body.match(/method:\s*"([^"]+)"/)?.[1] ?? '';
        const rotationOffsetDeg = Number(body.match(/rotationOffsetDeg:\s*(-?\d+)/)?.[1] ?? 0);
        entries.push({
            foxholeKey,
            confidence,
            method,
            rotationOffsetDeg,
        });
    }
    return entries;
}

function loadLegacyKeyByFoxholeKey() {
    const src = fs.readFileSync(KEY_MAP_PATH, 'utf8');
    /** @type {Map<string, string>} */
    const byFoxholeKey = new Map();
    for (const match of src.matchAll(/(?:['"]([^'"]+)['"]|([A-Za-z_$][\w$]*)):\s*['"]([^'"]+)['"]/g)) {
        const legacyKey = match[1] ?? match[2];
        const foxholeKey = match[3];
        if (!byFoxholeKey.has(foxholeKey)) {
            byFoxholeKey.set(foxholeKey, legacyKey);
        }
    }
    return byFoxholeKey;
}

/**
 * Migration / Nixie composite keys that are NOT pasteable into the legacy editor.
 * Unknown keys fall through createObject → type "point".
 */
const CLIPBOARD_PASTE_KEY_ALIASES = {
    fortt3_fortempt3: 'fortempt3',
    fortt3_lrartillery: 'lrartillery',
    fortt3_intelcenter: 'intelcenter',
    fortt3_weatherstation: 'weatherstation',
    fortt3_fortlargeradar: 'fortlargeradar',
    fortt3_fortgarrisonstation: 'fortgarrisonstation',
};

/** Legacy keys that need a default bezier segment or they load as empty handles. */
const CLIPBOARD_BEZIER_LEGACY_KEYS = new Set([
    'rail_large_gauge',
    'rail_small_gauge',
    'rail_large_crane',
]);

/** Board-pixel length for a short default rail (~minLength 5m at 100px/m). */
const DEFAULT_BEZIER_LENGTH_PX = 500;

function resolveClipboardPasteKey(legacyOrFoxholeKey, legacyKeyByFoxholeKey = loadLegacyKeyByFoxholeKey()) {
    const raw = String(legacyOrFoxholeKey ?? '').trim();
    if (!raw) {
        return raw;
    }
    if (CLIPBOARD_PASTE_KEY_ALIASES[raw]) {
        return CLIPBOARD_PASTE_KEY_ALIASES[raw];
    }
    return legacyKeyByFoxholeKey.get(raw) ?? raw;
}

function buildBuildingEntities(selected) {
    /** @type {Array<Record<string, unknown>>} */
    const entities = [];
    let nextId = 1;

    selected.forEach((entry, index) => {
        const { x: originX, y: originY } = gridOrigin(index);
        const legacyKey = resolveClipboardPasteKey(entry.legacyKey ?? entry.foxholeKey);
        const label = entry.label ?? entry.foxholeKey ?? legacyKey;

        entities.push({
            id: nextId++,
            type: 'text',
            x: originX,
            y: originY - 220,
            rotation: 0,
            label,
            labelStyle: {
                fontSize: 48,
            },
            sortOffset: 0,
        });

        /** @type {Record<string, unknown>} */
        const building = {
            id: nextId++,
            key: legacyKey,
            x: originX,
            y: originY,
            rotation: 0,
            sortOffset: 0,
            name: label,
        };
        if (CLIPBOARD_BEZIER_LEGACY_KEYS.has(legacyKey)) {
            // Legacy rails are isBezier + hasHandle; without bezier points onLoad
            // clears handles and leaves an empty/point-looking entity.
            building.bezier = [
                { x: 0, y: 0, rotation: 0 },
                { x: DEFAULT_BEZIER_LENGTH_PX, y: 0, rotation: 0 },
            ];
        }
        entities.push(building);
    });

    return entities;
}

/**
 * Four deterministic rotations of each structure. With socket/breach overlays
 * enabled, this is the smallest repeatable visual check for legacy socket-id
 * maps: a bad cardinal remap is visible in every quadrant immediately.
 */
function buildSocketCompassEntities(selected) {
    const entities = [];
    let nextId = 1;
    const rotations = [0, 90, 180, -90];

    selected.forEach((entry, assetIndex) => {
        const baseX = (assetIndex % 2) * 4_400;
        const baseY = Math.floor(assetIndex / 2) * 3_400;
        const legacyKey = resolveClipboardPasteKey(entry.legacyKey ?? entry.foxholeKey);
        const label = entry.label ?? entry.foxholeKey ?? legacyKey;

        rotations.forEach((rotation, rotationIndex) => {
            const column = rotationIndex % 2;
            const row = Math.floor(rotationIndex / 2);
            const x = baseX + ((column - 0.5) * 1_300);
            const y = baseY + ((row - 0.5) * 1_300);
            entities.push({
                id: nextId++,
                key: legacyKey,
                x,
                y,
                rotation,
                sortOffset: 0,
                name: `${label} ${rotation}°`,
            });
        });
    });

    return entities;
}

function rotatePoint(point, rotationDeg) {
    const radians = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        x: (point.x * cos) - (point.y * sin),
        y: (point.x * sin) + (point.y * cos),
    };
}

function resolveSocketOffset(socket, sockets) {
    const xs = sockets.map(entry => entry.x);
    const ys = sockets.map(entry => entry.y);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
    // Legacy plan coordinates use 32px per meter.
    return { x: (socket.x - centerX) * 32, y: (socket.y - centerY) * 32 };
}

/**
 * Build reciprocal legacy connections for every socket and cardinal rotation.
 * A target face connects to the opposite face of a compatible anchor: a neutral Tier 1
 * bunker for bunker parts, or the same foundation type for foundations. This gives
 * Breach Indicators a real green/red result instead of isolated red sockets.
 */
function buildSocketPairEntities(selected, options = {}) {
    const legacySocketsByKey = exfilLegacySocketsFromDataJs(
        path.join(DEFAULT_GAME_KITCHEN, 'app/plugins/foxhole/data.js'),
    );

    const entities = [];
    let nextId = 1;
    const rotations = options.singlePair ? [0] : [0, 90, 180, -90];

    selected.forEach((entry, assetIndex) => {
        const targetSockets = legacySocketsByKey[entry.legacyKey];
        if (!targetSockets?.length) {
            throw new Error(`Missing legacy sockets for ${entry.legacyKey}`);
        }
        const baseLegacyKey = entry.legacyKey.startsWith('foundation') ? entry.legacyKey : 'fortt1';
        const baseSockets = legacySocketsByKey[baseLegacyKey];
        if (!baseSockets?.length) {
            throw new Error(`Missing legacy ${baseLegacyKey} sockets required for socket-pair fixtures`);
        }
        const baseX = options.singlePair ? assetIndex * 1_200 : (assetIndex % 2) * 8_000;
        const baseY = options.singlePair ? 0 : Math.floor(assetIndex / 2) * 7_000;
        const socketsToTest = options.singlePair
            ? targetSockets.filter(socket => Number(socket.id) === 0)
            : targetSockets;
        if (!socketsToTest.length) {
            throw new Error(`Missing legacy socket 0 for ${entry.legacyKey}`);
        }

        rotations.forEach((rotation, rotationIndex) => {
            socketsToTest.forEach((targetSocket, socketIndex) => {
                const oppositeId = (Number(targetSocket.id) + 2) % 4;
                const baseSocket = baseLegacyKey === entry.legacyKey
                    ? baseSockets.find(socket => Math.abs(Math.abs(Number(socket.rotation) - Number(targetSocket.rotation)) - 180) < 0.001)
                    : baseSockets.find(socket => Number(socket.id) === oppositeId);
                if (!baseSocket) {
                    throw new Error(`Missing ${baseLegacyKey} opposite socket for ${entry.legacyKey}:${targetSocket.id}`);
                }
                const column = options.singlePair ? socketIndex : (rotationIndex * 4) + socketIndex;
                const x = baseX + ((column % 8) * 850);
                const y = baseY + (Math.floor(column / 8) * 2_200);
                const targetId = nextId++;
                const baseId = nextId++;
                const targetOffset = rotatePoint(resolveSocketOffset(targetSocket, targetSockets), rotation);
                const baseOffset = rotatePoint(resolveSocketOffset(baseSocket, baseSockets), rotation);
                const baseXPosition = x + targetOffset.x - baseOffset.x;
                const baseYPosition = y + targetOffset.y - baseOffset.y;

                entities.push({
                    id: targetId,
                    key: entry.legacyKey,
                    x,
                    y,
                    rotation,
                    sortOffset: 0,
                    connections: { [targetSocket.id]: { [baseId]: baseSocket.id } },
                });
                entities.push({
                    id: baseId,
                    key: baseLegacyKey,
                    x: baseXPosition,
                    y: baseYPosition,
                    rotation,
                    sortOffset: 0,
                    name: `Anchor ${baseLegacyKey} — socket ${baseSocket.id}`,
                    connections: { [baseSocket.id]: { [targetId]: targetSocket.id } },
                });
            });
        });
    });

    return entities;
}

/**
 * A deliberately asset-free diagram of the socket-id mapping used by Nixie's
 * legacy importer. Keeping the diagram as regular planner nodes makes it
 * inspectable in the same scene as a pasted legacy plan without relying on
 * breach-marker rendering or an anchor structure.
 */
function buildShapeSampleEntities() {
    /** @type {Array<Record<string, unknown>>} */
    const entities = [];
    let nextId = 1;
    const samples = [
        {
            label: 'text (defaults)',
            entity: {
                type: 'text',
                label: 'Sample Text',
                // omit labelStyle → legacy applies default text style on load
            },
        },
        {
            label: 'rectangle (defaults)',
            entity: {
                type: 'rectangle',
                width: 320,
                height: 180,
                // omit shapeStyle → legacy DEFAULT_SHAPE_STYLE / type defaults
            },
        },
        {
            label: 'circle (defaults)',
            entity: {
                type: 'circle',
                radius: 120,
            },
        },
        {
            label: 'line (defaults)',
            entity: {
                type: 'line',
                // Line persists {x,y} point objects.
                points: [
                    { x: 0, y: 0 },
                    { x: 280, y: 40 },
                ],
            },
        },
        {
            label: 'binoline (defaults)',
            entity: {
                type: 'line',
                key: 'binoline',
                points: [
                    { x: 0, y: 0 },
                    { x: 280, y: 40 },
                ],
            },
        },
        {
            label: 'polygon (defaults)',
            entity: {
                type: 'polygon',
                // Polygon persists a flat [x,y,x,y,…] number array (not point objects).
                polygon: [0, 0, 220, 20, 160, 160, -20, 120],
            },
        },
        {
            label: 'stroke (defaults)',
            entity: {
                type: 'stroke',
                // Stroke persists a flat [x,y,x,y,…] number array on `stroke` (not `points`).
                stroke: [0, 0, 60, -40, 140, 30, 220, -10],
            },
        },
        {
            label: 'rectangle (explicit style)',
            entity: {
                type: 'rectangle',
                width: 280,
                height: 160,
                shapeStyle: {
                    fill: true,
                    fillColor: '#1F6FEB',
                    border: true,
                    lineWidth: 4,
                    lineColor: '#FFFFFF',
                    alpha: 0.85,
                },
            },
        },
        {
            label: 'line (explicit style)',
            entity: {
                type: 'line',
                points: [
                    { x: 0, y: 0 },
                    { x: 260, y: -60 },
                ],
                shapeStyle: {
                    fillColor: '#FF6B4A',
                    lineWidth: 18,
                    frontArrow: true,
                    backArrow: false,
                    showDist: true,
                },
            },
        },
    ];

    samples.forEach((sample, index) => {
        const { x: originX, y: originY } = gridOrigin(index);
        entities.push({
            id: nextId++,
            type: 'text',
            x: originX,
            y: originY - 220,
            rotation: 0,
            label: sample.label,
            labelStyle: { fontSize: 40 },
            sortOffset: 0,
        });
        entities.push({
            id: nextId++,
            ...sample.entity,
            x: originX,
            y: originY,
            rotation: 0,
            sortOffset: 0,
        });
    });

    return entities;
}

function buildIconSampleEntities() {
    /** @type {Array<Record<string, unknown>>} */
    const entities = [];
    let nextId = 1;
    const samples = [
        {
            label: 'rainuniformc',
            entity: {
                type: 'icon',
                key: 'rainuniformc',
                width: 128,
                height: 128,
            },
        },
        {
            label: 'icon (with frame style)',
            entity: {
                type: 'icon',
                key: 'rainuniformc',
                width: 128,
                height: 128,
                shapeStyle: {
                    fill: true,
                    fillColor: '#0B0B0B',
                    border: true,
                    lineWidth: 3,
                    lineColor: '#00FF00',
                    label: true,
                    labelPosition: 'bottom',
                    labelSize: 24,
                },
                name: 'Rain Uniform',
            },
        },
    ];

    samples.forEach((sample, index) => {
        const { x: originX, y: originY } = gridOrigin(index);
        entities.push({
            id: nextId++,
            type: 'text',
            x: originX,
            y: originY - 220,
            rotation: 0,
            label: sample.label,
            labelStyle: { fontSize: 40 },
            sortOffset: 0,
        });
        entities.push({
            id: nextId++,
            ...sample.entity,
            x: originX,
            y: originY,
            rotation: 0,
            sortOffset: 0,
        });
    });

    return entities;
}

function loadMissingBuildingEntries() {
    const raw = JSON.parse(fs.readFileSync(BUILDING_KEY_MAP_JSON, 'utf8'));
    const unresolved = Array.isArray(raw.unresolved) ? raw.unresolved : [];
    return unresolved
        .filter(entry => entry?.kind === 'building' && entry?.legacyKey)
        .map(entry => ({
            legacyKey: String(entry.legacyKey),
            foxholeKey: String(entry.legacyKey),
            label: String(entry.legacyKey),
            codeName: entry.codeName ?? null,
            reason: entry.reason ?? null,
        }))
        .sort((left, right) => left.legacyKey.localeCompare(right.legacyKey));
}

function loadOrientationQaExclusions() {
    if (!fs.existsSync(ORIENTATION_QA_PATH)) {
        return new Set();
    }
    const raw = JSON.parse(fs.readFileSync(ORIENTATION_QA_PATH, 'utf8'));
    const excluded = new Set();
    for (const key of Array.isArray(raw.confirmed) ? raw.confirmed : []) {
        const normalized = String(key ?? '').trim();
        if (normalized) {
            excluded.add(normalized);
        }
    }
    for (const key of Object.keys(raw.skipClipboard && typeof raw.skipClipboard === 'object' ? raw.skipClipboard : {})) {
        const normalized = String(key ?? '').trim();
        if (normalized) {
            excluded.add(normalized);
        }
    }
    return excluded;
}

function writeSnapshot({ outName, entities, meta }) {
    const save = {
        version: '1.0.5',
        entities,
    };
    const clipboardText = entities.length
        ? `data:plan;plain,${JSON.stringify(save)}`
        : '';

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const txtPath = path.join(OUT_DIR, `${outName}.txt`);
    const jsonPath = path.join(OUT_DIR, `${outName}.json`);
    fs.writeFileSync(txtPath, clipboardText);
    fs.writeFileSync(jsonPath, `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        entityCount: entities.length,
        ...meta,
        save,
    }, null, '\t')}\n`);
    return { txtPath, jsonPath, entityCount: entities.length };
}

function main() {
    const options = parseArgs(process.argv.slice(2));

    if (options.mode === 'missing-buildings') {
        let selected = loadMissingBuildingEntries();
        if (options.only) {
            selected = selected.filter(entry => options.only.has(entry.legacyKey));
        }
        if (options.limit != null) {
            selected = selected.slice(0, options.limit);
        }
        if (!selected.length && options.only) {
            throw new Error('No missing building keys matched the current filters');
        }
        const entities = buildBuildingEntities(selected);
        const written = writeSnapshot({
            outName: options.outName,
            entities,
            meta: {
                mode: options.mode,
                assetCount: selected.length,
                assets: selected,
                note: 'True missing buildings (no manifest mapping). Paste into legacy editor to inspect. Facility upgrade composites are excluded — those resolve as parent+mod.',
            },
        });
        console.log({ mode: options.mode, assets: selected.length, ...written });
        return;
    }

    if (options.mode === 'shapes') {
        const entities = buildShapeSampleEntities();
        const written = writeSnapshot({
            outName: options.outName,
            entities,
            meta: {
                mode: options.mode,
                assetCount: entities.filter(entity => entity.type !== 'text' || entity.label === 'Sample Text').length,
                note: 'Shape/text samples on a 4-column grid. Polygon uses flat [x,y,…] coords; stroke uses flat stroke[]. Default rect/circle omit fill+border — legacy still paints fill when border is false.',
            },
        });
        console.log({ mode: options.mode, entities: entities.length, ...written });
        return;
    }

    if (options.mode === 'icons') {
        const entities = buildIconSampleEntities();
        const written = writeSnapshot({
            outName: options.outName,
            entities,
            meta: {
                mode: options.mode,
                assetCount: entities.filter(entity => entity.type === 'icon').length,
                note: 'Icon samples. rainuniformc is the acceptance case for item-catalog icon import.',
            },
        });
        console.log({ mode: options.mode, entities: entities.length, ...written });
        return;
    }

    if (options.mode === 'socket-compass') {
        const legacyKeyByFoxholeKey = loadLegacyKeyByFoxholeKey();
        const requested = options.only
            ? [...options.only].sort()
            : [
                'fortt3',
                'fortcornert3',
                'fortt3_artilleryait3',
                'fortt3_atgunait3',
                'fortt3_rifleait3',
                'fortt3_engineroomt3',
                'fortt3_observationbunkert3',
                'fortt3_fortrampt3',
            ];
        const selected = requested.map(foxholeKey => ({
            foxholeKey,
            legacyKey: legacyKeyByFoxholeKey.get(foxholeKey) ?? foxholeKey,
            label: foxholeKey,
        }));
        const entities = buildSocketCompassEntities(selected);
        const written = writeSnapshot({
            outName: options.outName,
            entities,
            meta: {
                mode: options.mode,
                assetCount: selected.length,
                assets: selected,
                note: 'Enable Breach Indicators in both planners before comparing. Each asset appears at 0°, 90°, 180°, and -90° so a socket-id/cardinal mismatch is visible without a community blueprint.',
            },
        });
        console.log({ mode: options.mode, assets: selected.length, ...written });
        return;
    }

    if (options.mode === 'socket-pairs') {
        const legacyKeyByFoxholeKey = loadLegacyKeyByFoxholeKey();
        const requested = options.only
            ? [...options.only].sort()
            : options.allBunkers
                ? Object.keys(exfilLegacySocketsFromDataJs(
                    path.join(DEFAULT_GAME_KITCHEN, 'app/plugins/foxhole/data.js'),
                )).filter(key => /^fortt[123](?:_|$)/.test(key)).sort()
                : [
                'fortt3_artilleryait3',
                'fortt3_atgunait3',
                'fortt3_rifleait3',
                'fortt3_engineroomt3',
                'fortt3_observationbunkert3',
                'fortt3_fortrampt3',
            ];
        const selected = requested.map(foxholeKey => ({
            foxholeKey,
            legacyKey: legacyKeyByFoxholeKey.get(foxholeKey) ?? foxholeKey,
            label: foxholeKey,
        }));
        const entities = buildSocketPairEntities(selected, { singlePair: options.singlePair });
        const written = writeSnapshot({
            outName: options.outName,
            entities,
            meta: {
                mode: options.mode,
                assetCount: selected.length,
                assets: selected,
                note: options.singlePair
                    ? 'Enable Breach Indicators in both planners. Each asset has one reciprocal 0° legacy socket-0 connection to a neutral fortt1 anchor; use Nixie’s All Sockets overlay for live socket-id and socket-name labels.'
                    : 'Enable Breach Indicators in both planners. Every cell is one reciprocal legacy connection to the opposite fortt1 face; use Nixie’s All Sockets overlay for live socket-id and socket-name labels.',
            },
        });
        console.log({ mode: options.mode, assets: selected.length, ...written });
        return;
    }

    const orientationEntries = loadOrientationEntries();
    const legacyKeyByFoxholeKey = loadLegacyKeyByFoxholeKey();
    const qaExcluded = loadOrientationQaExclusions();

    let selected = orientationEntries.filter(entry => {
        if (options.only) {
            // Explicit --only is for targeted QA (e.g. unresolved sockets); include
            // skip/spline and orientation-confirmed keys the caller asked for.
            return options.only.has(entry.foxholeKey);
        }
        if (entry.confidence === 'skip' || entry.method === 'spline-connector') {
            return false;
        }
        if (qaExcluded.has(entry.foxholeKey)) {
            return false;
        }
        return options.confidence.has(entry.confidence);
    });

    // Synthesize any --only keys missing from the orientation map entirely.
    if (options.only) {
        const present = new Set(selected.map(entry => entry.foxholeKey));
        for (const foxholeKey of [...options.only].sort()) {
            if (present.has(foxholeKey)) {
                continue;
            }
            selected.push({
                foxholeKey,
                confidence: 'manual',
                method: 'only-request',
                rotationOffsetDeg: 0,
            });
        }
    }

    selected.sort((left, right) => left.foxholeKey.localeCompare(right.foxholeKey));
    if (options.limit != null) {
        selected = selected.slice(0, options.limit);
    }

    if (!selected.length && options.only) {
        throw new Error('No orientation entries matched the current filters');
    }

    const entities = buildBuildingEntities(selected.map(entry => ({
        foxholeKey: entry.foxholeKey,
        legacyKey: resolveClipboardPasteKey(
            legacyKeyByFoxholeKey.get(entry.foxholeKey) ?? entry.foxholeKey,
            legacyKeyByFoxholeKey,
        ),
        label: entry.foxholeKey,
        confidence: entry.confidence,
        method: entry.method,
        rotationOffsetDeg: entry.rotationOffsetDeg,
    })));
    const written = writeSnapshot({
        outName: options.outName,
        entities,
        meta: {
            mode: 'orientation-uncertain',
            assetCount: selected.length,
            confidence: [...options.confidence],
            assets: selected.map(entry => ({
                foxholeKey: entry.foxholeKey,
                legacyKey: resolveClipboardPasteKey(
                    legacyKeyByFoxholeKey.get(entry.foxholeKey) ?? entry.foxholeKey,
                    legacyKeyByFoxholeKey,
                ),
                confidence: entry.confidence,
                method: entry.method,
                rotationOffsetDeg: entry.rotationOffsetDeg,
            })),
        },
    });

    const readmePath = path.join(OUT_DIR, 'README.md');
    fs.writeFileSync(readmePath, `# Legacy Clipboard Snapshots

Paste the same payload into **legacy Foxhole Planner** and **foxhole-planner** for visual A/B.

## How to use

1. Open \`<name>.txt\`
2. Copy the entire file contents (starts with \`data:plan;plain,\`)
3. Paste into both editors (Ctrl+V)

## Regenerate

\`\`\`bash
npm run legacy:generate-clipboard-snapshots
npm run legacy:generate-clipboard-snapshots -- --mode missing-buildings
npm run legacy:generate-clipboard-snapshots -- --mode shapes
npm run legacy:generate-clipboard-snapshots -- --mode icons
npm run legacy:generate-clipboard-snapshots -- --mode socket-compass
npm run legacy:generate-clipboard-snapshots -- --mode socket-compass --only fortt3_atgunait3
npm run legacy:generate-clipboard-snapshots -- --mode socket-pairs --only fortt3_atgunait3
npm run legacy:generate-clipboard-snapshots -- --mode socket-pairs --all-bunkers --single-pair --out connected-all-bunkers-compact
npm run legacy:generate-clipboard-snapshots -- --only facilitypowerdiesel,facilitycrane
npm run legacy:generate-clipboard-snapshots -- --confidence low --limit 20
\`\`\`

Default layout: grid (\`${GRID_COLUMNS}\` columns) — label above each asset at rotation \`0\`
(frame offset is applied on spawn, so extra entity rotations do not help QA).

Confirmed / skipped keys live in \`../orientation-qa.json\` and are omitted from orientation snapshots.
Manual rotation fixes live in \`../orientation-overrides.json\`.
`);

    console.log({ mode: 'orientation-uncertain', assets: selected.length, ...written });
}

main();
