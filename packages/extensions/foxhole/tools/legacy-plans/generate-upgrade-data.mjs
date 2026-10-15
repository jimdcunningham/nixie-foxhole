import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GAME_KITCHEN = process.env.GAME_KITCHEN_PATH || 'C:/Code/game-kitchen';

function extractBalancedObject(text, openBraceIndex) {
    let depth = 0;
    for (let i = openBraceIndex; i < text.length; i++) {
        const ch = text[i];
        if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return text.slice(openBraceIndex, i + 1);
            }
        }
    }
    return null;
}

function extractFromGameKitchen(gameKitchenPath) {
    const dataPath = path.join(gameKitchenPath, 'app/plugins/foxhole/data.js');
    if (!fs.existsSync(dataPath)) {
        throw new Error(`game-kitchen data.js not found at ${dataPath}`);
    }
    const src = fs.readFileSync(dataPath, 'utf8');

    const presetMap = {};
    const pm = src.match(/"presetMap"\s*:\s*\{([\s\S]*?)\n\t\},/);
    if (pm) {
        for (const m of pm[1].matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)) {
            presetMap[m[1]] = m[2];
        }
    }

    const maps = {};
    const mapsMatch = src.match(/"maps"\s*:\s*\{/);
    if (mapsMatch?.index !== undefined) {
        const mapsOpen = src.indexOf('{', mapsMatch.index + '"maps"'.length);
        const mapsBody = extractBalancedObject(src, mapsOpen);
        if (mapsBody) {
            for (const m of mapsBody.matchAll(/"([A-Za-z0-9]+Hex)"\s*:\s*\{/g)) {
                const objStart = mapsBody.indexOf('{', m.index + m[0].length - 1);
                const body = extractBalancedObject(mapsBody, objStart);
                if (!body) {
                    continue;
                }
                const gridMatch = body.match(/"gridCoord"\s*:\s*\{\s*"x"\s*:\s*(-?\d+)\s*,\s*"y"\s*:\s*(-?\d+)/);
                if (!gridMatch) {
                    continue;
                }
                maps[m[1]] = {
                    key: m[1],
                    gridCoord: { x: Number(gridMatch[1]), y: Number(gridMatch[2]) },
                };
            }
        }
    }

    const buildings = {};
    const buildingsMatch = src.match(/"buildings"\s*:\s*\{/);
    if (buildingsMatch?.index !== undefined) {
        const buildingsOpen = src.indexOf('{', buildingsMatch.index + '"buildings"'.length);
        const buildingsBody = extractBalancedObject(src, buildingsOpen);
        if (buildingsBody) {
            for (const m of buildingsBody.matchAll(/\n\t\t"([^"]+)"\s*:\s*\{/g)) {
                const objStart = buildingsBody.indexOf('{', m.index + m[0].length - 1);
                const body = extractBalancedObject(buildingsBody, objStart);
                if (!body) {
                    continue;
                }
                const head = body.slice(0, Math.min(body.length, 2500));
                const isBezier = /"isBezier"\s*:\s*true/.test(head);
                const hasHandle = /"hasHandle"\s*:\s*true/.test(head);
                if (isBezier || hasHandle) {
                    buildings[m[1]] = {
                        ...(isBezier ? { isBezier: true } : {}),
                        ...(hasHandle ? { hasHandle: true } : {}),
                    };
                }
            }
        }
    }

    return { presetMap, maps, buildings };
}

const gameKitchen = process.argv.includes('--game-kitchen')
    ? process.argv[process.argv.indexOf('--game-kitchen') + 1]
    : DEFAULT_GAME_KITCHEN;

const data = extractFromGameKitchen(gameKitchen);

fs.writeFileSync(
    path.join(__dirname, 'preset-map.json'),
    `${JSON.stringify(data.presetMap, null, '\t')}\n`,
);

const mapsEntries = Object.entries(data.maps)
    .map(([k, v]) => `\t\t${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join('\n');
const buildingEntries = Object.entries(data.buildings)
    .map(([k, v]) => `\t\t${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join('\n');

const content = `/** Auto-derived upgrade constants from game-kitchen foxhole data. */
export const LEGACY_PLAN_SAVE_VERSION = '1.0.5' as const;

/** Board meter scale constants from legacy game.js */
export const LEGACY_METER_BOARD_PIXEL_SIZE = 32;
export const LEGACY_METER_TEXTURE_PIXEL_SIZE = 52.8;
export const LEGACY_METER_TEXTURE_PIXEL_SCALE = LEGACY_METER_TEXTURE_PIXEL_SIZE / LEGACY_METER_BOARD_PIXEL_SIZE;
export const LEGACY_REGION_WIDTH = 2183.9999 * LEGACY_METER_BOARD_PIXEL_SIZE;
export const LEGACY_REGION_HEIGHT = 1889.9999 * LEGACY_METER_BOARD_PIXEL_SIZE;

/** Crane reposition distance used by 1.0.1 → 1.0.2 upgrade (board pixels). */
export const LEGACY_CRANE_UPGRADE_OFFSET = 215 / LEGACY_METER_TEXTURE_PIXEL_SCALE;

export type LegacyPlanMapData = {
\tkey: string;
\tgridCoord: { x: number; y: number; };
};

export type LegacyPlanBuildingUpgradeFlags = {
\tisBezier?: boolean;
\thasHandle?: boolean;
};

export const LEGACY_PLAN_MAPS: Readonly<Record<string, LegacyPlanMapData>> = {
${mapsEntries}
};

export const LEGACY_PLAN_BUILDING_FLAGS: Readonly<Record<string, LegacyPlanBuildingUpgradeFlags>> = {
${buildingEntries}
};
`;

const outPath = path.resolve(__dirname, '../../app/plugins/foxhole/legacy/plan-upgrade-data.ts');
fs.writeFileSync(outPath, content);

console.log({
    presets: Object.keys(data.presetMap).length,
    maps: Object.keys(data.maps).length,
    buildings: Object.keys(data.buildings).length,
    wrote: outPath,
});
