import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GAME_KITCHEN = process.env.GAME_KITCHEN_PATH || 'C:/Code/game-kitchen';
const MANIFEST_PATH = path.resolve(__dirname, '../../public/foxhole/assets/manifest.v1.json');
const OUT_TS = path.resolve(__dirname, '../../app/plugins/foxhole/legacy/plan-building-key-map.ts');
const OUT_UPGRADE_CODENAMES_TS = path.resolve(__dirname, '../../app/plugins/foxhole/legacy/plan-facility-upgrade-codenames.ts');
const OUT_JSON = path.join(__dirname, 'building-key-map.json');
const OVERRIDES_PATH = path.join(__dirname, 'building-key-overrides.json');

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

/**
 * Collect top-level buildings plus flattened upgrade keys (`parent_upgrade`),
 * matching game-kitchen loader.js (`${buildingKey}_${upgradeKey}`).
 */
function extractBuildingEntries(dataPath) {
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

    /** @type {Array<{ legacyKey: string; codeName: string | null; kind: 'building' | 'upgrade' }>} */
    const entries = [];

    for (const m of body.matchAll(/\n\t\t"([^"]+)"\s*:\s*\{/g)) {
        const buildingKey = m[1];
        const objStart = body.indexOf('{', m.index + m[0].length - 1);
        const obj = extractBalanced(body, objStart);
        if (!obj) {
            continue;
        }

        const buildingCodeName = obj.match(/"codeName"\s*:\s*"([^"]+)"/)?.[1] ?? null;
        entries.push({ legacyKey: buildingKey, codeName: buildingCodeName, kind: 'building' });

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
            const upgradeKey = upgradeMatch[1];
            if (upgradeKey === 'upgrades') {
                continue;
            }
            const upgradeStart = upgradesBody.indexOf('{', upgradeMatch.index + upgradeMatch[0].length - 1);
            const upgradeObj = extractBalanced(upgradesBody, upgradeStart);
            if (!upgradeObj || upgradeObj.length < 2) {
                continue;
            }
            // Only direct children of the upgrades object (skip nested production/etc objects).
            // Direct children are registered one brace-depth under the upgrades root.
            const before = upgradesBody.slice(0, upgradeMatch.index);
            const depth = (before.match(/\{/g)?.length ?? 0) - (before.match(/\}/g)?.length ?? 0);
            if (depth !== 1) {
                continue;
            }
            const upgradeCodeName = upgradeObj.match(/"codeName"\s*:\s*"([^"]+)"/)?.[1] ?? null;
            if (!upgradeCodeName) {
                // Tier/reference pointer entries without codeName are not save entity keys.
                continue;
            }
            entries.push({
                legacyKey: `${buildingKey}_${upgradeKey}`,
                codeName: upgradeCodeName,
                kind: 'upgrade',
            });
        }
    }

    return entries;
}

function loadManifestIds(manifestPath) {
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Manifest not found at ${manifestPath}`);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const structures = Array.isArray(manifest.structures)
        ? manifest.structures
        : (Array.isArray(manifest.assets) ? manifest.assets : []);
    const byId = new Set();
    const byCodeNameLower = new Map();
    for (const structure of structures) {
        const id = String(structure?.id ?? '').trim();
        if (!id) {
            continue;
        }
        byId.add(id);
        const codeName = String(structure?.codeName ?? '').trim();
        if (codeName) {
            byCodeNameLower.set(codeName.toLowerCase(), id);
        }
    }
    return { byId, byCodeNameLower, count: structures.length };
}

function resolveAgainstManifest(codeName, manifest) {
    if (!codeName) {
        return null;
    }
    const normalized = codeName.toLowerCase();
    return manifest.byCodeNameLower.get(normalized)
        ?? (manifest.byId.has(normalized) ? normalized : null);
}

function main() {
    const gameKitchen = process.argv.includes('--game-kitchen')
        ? process.argv[process.argv.indexOf('--game-kitchen') + 1]
        : DEFAULT_GAME_KITCHEN;
    const dataPath = path.join(gameKitchen, 'app/plugins/foxhole/data.js');
    const entries = extractBuildingEntries(dataPath);
    const manifest = loadManifestIds(MANIFEST_PATH);

    /** @type {Record<string, string>} */
    const mapping = {};
    /** @type {Record<string, string>} */
    const upgradeCodeNames = {};
    /** @type {Array<{ legacyKey: string; codeName: string | null; kind: string; reason: string }>} */
    const unresolved = [];
    let renamed = 0;
    let upgradeMapped = 0;

    for (const entry of entries) {
        if (entry.kind === 'upgrade' && entry.codeName) {
            upgradeCodeNames[entry.legacyKey] = entry.codeName;
        }
        const resolvedId = resolveAgainstManifest(entry.codeName, manifest);
        if (!resolvedId) {
            unresolved.push({
                legacyKey: entry.legacyKey,
                codeName: entry.codeName,
                kind: entry.kind,
                reason: entry.codeName ? 'not_in_manifest' : 'missing_code_name',
            });
            continue;
        }
        mapping[entry.legacyKey] = resolvedId;
        if (entry.legacyKey !== resolvedId) {
            renamed += 1;
        }
        if (entry.kind === 'upgrade') {
            upgradeMapped += 1;
        }
    }

    if (fs.existsSync(OVERRIDES_PATH)) {
        const overridesRaw = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
        for (const [legacyKey, foxholeKey] of Object.entries(overridesRaw)) {
            if (legacyKey.startsWith('_') || typeof foxholeKey !== 'string') {
                continue;
            }
            const normalizedTarget = String(foxholeKey).trim();
            if (!normalizedTarget) {
                continue;
            }
            if (!manifest.byId.has(normalizedTarget)) {
                console.warn(`[building-key-map] override target missing from manifest: ${legacyKey} → ${normalizedTarget}`);
                continue;
            }
            const previous = mapping[legacyKey];
            mapping[legacyKey] = normalizedTarget;
            // Overrides replace auto-unresolved entries and force separate-asset mapping.
            const unresolvedIndex = unresolved.findIndex(entry => entry.legacyKey === legacyKey);
            if (unresolvedIndex >= 0) {
                unresolved.splice(unresolvedIndex, 1);
            }
            if (previous && previous !== normalizedTarget) {
                console.log(`[building-key-map] override ${legacyKey}: ${previous} → ${normalizedTarget}`);
            } else if (!previous) {
                console.log(`[building-key-map] override ${legacyKey}: → ${normalizedTarget}`);
                if (legacyKey !== normalizedTarget) {
                    renamed += 1;
                }
            }
        }
    }

    const sortedEntries = Object.entries(mapping).sort(([a], [b]) => a.localeCompare(b));
    const mapLiteral = sortedEntries
        .map(([legacyKey, id]) => `\t${JSON.stringify(legacyKey)}: ${JSON.stringify(id)},`)
        .join('\n');

    const sortedUpgradeCodeNames = Object.entries(upgradeCodeNames).sort(([a], [b]) => a.localeCompare(b));
    const upgradeCodeNameLiteral = sortedUpgradeCodeNames
        .map(([legacyKey, codeName]) => `\t${JSON.stringify(legacyKey)}: ${JSON.stringify(codeName)},`)
        .join('\n');

    const ts = `/**
 * Legacy Foxhole Planner building key → Nixie manifest structure id.
 *
 * Built from game-kitchen data.js \`codeName\` (lowercased), including flattened
 * upgrade keys (\`parent_upgrade\`) the way loader.js registers them.
 * Verified against public/foxhole/assets/manifest.v1.json.
 * Manual overrides: tools/legacy-plans/building-key-overrides.json
 *
 * Regenerate:
 *   npm run legacy:generate-building-key-map
 */
export const LEGACY_PLAN_BUILDING_KEY_MAP: Readonly<Record<string, string>> = {
${mapLiteral}
};

export function resolveLegacyPlanBuildingKey(legacyKey: string): string | null {
\tconst normalized = String(legacyKey ?? '').trim();
\tif (!normalized) {
\t\treturn null;
\t}
\treturn LEGACY_PLAN_BUILDING_KEY_MAP[normalized] ?? null;
}
`;

    const upgradeCodeNamesTs = `/**
 * Legacy flattened upgrade keys (\`parent_upgrade\`) → data.js upgrade codeName.
 * Used when the upgrade is a modification variant on the parent, not its own asset.
 *
 * Regenerate:
 *   npm run legacy:generate-building-key-map
 */
export const LEGACY_PLAN_FACILITY_UPGRADE_CODENAMES: Readonly<Record<string, string>> = {
${upgradeCodeNameLiteral}
};

export function resolveLegacyPlanFacilityUpgradeCodeName(legacyKey: string): string | null {
\tconst normalized = String(legacyKey ?? '').trim();
\tif (!normalized) {
\t\treturn null;
\t}
\treturn LEGACY_PLAN_FACILITY_UPGRADE_CODENAMES[normalized] ?? null;
}
`;

    fs.writeFileSync(OUT_TS, ts);
    fs.writeFileSync(OUT_UPGRADE_CODENAMES_TS, upgradeCodeNamesTs);
    fs.writeFileSync(OUT_JSON, `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        source: dataPath,
        manifest: MANIFEST_PATH,
        mapped: sortedEntries.length,
        renamed,
        upgradeMapped,
        upgradeCodeNames: sortedUpgradeCodeNames.length,
        unresolved,
        mapping: Object.fromEntries(sortedEntries),
    }, null, '\t')}\n`);

    console.log({
        legacyEntries: entries.length,
        manifestStructures: manifest.count,
        mapped: sortedEntries.length,
        renamed,
        upgradeMapped,
        upgradeCodeNames: sortedUpgradeCodeNames.length,
        unresolved: unresolved.length,
        unresolvedUpgrades: unresolved.filter(entry => entry.kind === 'upgrade').length,
        unresolvedSample: unresolved.slice(0, 25),
        wrote: OUT_TS,
        wroteUpgradeCodeNames: OUT_UPGRADE_CODENAMES_TS,
    });
}

main();
