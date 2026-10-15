import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LEGACY_PLAN_BUILDING_KEY_MAP } from '../../app/plugins/foxhole/legacy/plan-building-key-map.ts';
import { resolveLegacyPlanFacilityUpgradeCodeName } from '../../app/plugins/foxhole/legacy/plan-facility-upgrade-codenames.ts';
import { LEGACY_PLAN_ORIENTATION_MAP } from '../../app/plugins/foxhole/legacy/plan-orientation-map.ts';
import { resolveLegacyTexturePath, resolveNixieTexturePath } from './generate-orientation-map.mjs';
import { refineAlphaTranslation, registerAlphaTranslation, samplePlacedAlpha } from './position-registration.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLANNER_ROOT = path.resolve(__dirname, '../..');
const GAME_KITCHEN = process.argv.includes('--game-kitchen')
    ? process.argv[process.argv.indexOf('--game-kitchen') + 1]
    : process.env.GAME_KITCHEN_PATH || 'C:/Code/game-kitchen';
const LEGACY_TEXTURE_SCALE = 0.5;
const LEGACY_METER_TEXTURE_PIXEL_SCALE = 52.8 / 32;
const NIXIE_SPRITE_SCALE = 0.5;
const MIN_OVERLAP = 0.9;
const MIN_AREA_RATIO = 0.85;
// These adjacent facility variants expose one-to-four-pixel seams in real plans.
const HIGH_PRECISION_FAMILIES = new Set(['oil_refinery', 'coal_refinery']);
const OUT_TS = path.resolve(PLANNER_ROOT, 'app/plugins/foxhole/legacy/plan-position-map.ts');
const OUT_REPORT = path.resolve(__dirname, 'position-map-report.json');

// These use fixed, square board footprints in the legacy planner. Their
// texture alignment is not the structure-origin drift this map addresses.
function isFixedFootprint(key, building) {
    return ['entrenchments', 'foundations', 'garrisons'].includes(building.category)
        || /(?:^fort|bunker|trench|foundation|garrison|emplacement)/i.test(key);
}

function resolveLegacySource(source) {
    if (typeof source === 'string') {
        return source;
    }
    return source?.c ?? source?.w ?? null;
}

function legacyPlacement(texture) {
    const width = texture.width / LEGACY_METER_TEXTURE_PIXEL_SCALE;
    const height = texture.height / LEGACY_METER_TEXTURE_PIXEL_SCALE;
    return {
        width,
        height,
        x: texture.offset
            ? -Number(texture.offset.x ?? 0) * LEGACY_TEXTURE_SCALE / LEGACY_METER_TEXTURE_PIXEL_SCALE
            : -width / 2,
        y: texture.offset
            ? -Number(texture.offset.y ?? 0) * LEGACY_TEXTURE_SCALE / LEGACY_METER_TEXTURE_PIXEL_SCALE
            : -height / 2,
    };
}

function nixiePlacement(sprite) {
    const width = sprite.width * NIXIE_SPRITE_SCALE;
    const height = sprite.height * NIXIE_SPRITE_SCALE;
    return {
        width,
        height,
        x: Number(sprite.offsetX ?? 0) * NIXIE_SPRITE_SCALE - width / 2,
        y: Number(sprite.offsetY ?? 0) * NIXIE_SPRITE_SCALE - height / 2,
    };
}

function normalizeUpgradeId(value) {
    return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveUpgradeSprite(asset, legacyKey, upgradeKey) {
    const fullKey = `${legacyKey}_${upgradeKey}`;
    const candidates = new Set([upgradeKey, fullKey, resolveLegacyPlanFacilityUpgradeCodeName(fullKey)]
        .map(normalizeUpgradeId).filter(Boolean));
    for (const slot of asset.modifications ?? []) {
        for (const [variantId, variant] of Object.entries(slot.variants ?? {})) {
            if ([variantId, variant.appliedModificationId].some(value => candidates.has(normalizeUpgradeId(value)))) {
                return variant.sprite ?? null;
            }
        }
    }
    return null;
}

async function main() {
    const dataModule = await import(pathToFileURL(path.resolve(GAME_KITCHEN, 'app/plugins/foxhole/data.js')).href);
    const buildings = dataModule.default.buildings;
    const manifest = JSON.parse(fs.readFileSync(path.resolve(PLANNER_ROOT, 'public/foxhole/assets/manifest.v1.json'), 'utf8'));
    const assetsById = new Map(manifest.assets.map(asset => [asset.id, asset]));
    const report = {};
    const accepted = {};

    async function registerPosition(legacyKey, foxholeKey, oldTexture, newSprite, guardSprite, orientation, nixieTexturePath) {
        if (!Number.isFinite(oldTexture?.width) || !Number.isFinite(oldTexture?.height)
            || !Number.isFinite(newSprite?.width) || !Number.isFinite(newSprite?.height)
            || oldTexture.width <= 0 || oldTexture.height <= 0
            || newSprite.width <= 0 || newSprite.height <= 0) {
            return;
        }
        const legacyTexturePath = resolveLegacyTexturePath(GAME_KITCHEN, resolveLegacySource(oldTexture.src));
        if (!legacyTexturePath || !nixieTexturePath) {
            report[legacyKey] = { foxholeKey, reason: 'missing-texture' };
            return;
        }
        const oldPlacement = legacyPlacement(oldTexture);
        const newPlacement = nixiePlacement(newSprite);
        const oldAlpha = await samplePlacedAlpha(legacyTexturePath, oldPlacement.width, oldPlacement.height,
            oldPlacement.x, oldPlacement.y);
        const newAlpha = await samplePlacedAlpha(nixieTexturePath, newPlacement.width, newPlacement.height,
            newPlacement.x, newPlacement.y, orientation.rotationOffsetDeg);
        if (!oldAlpha || !newAlpha) {
            report[legacyKey] = { foxholeKey, reason: 'empty-alpha' };
            return;
        }
        let match = registerAlphaTranslation(oldAlpha, newAlpha);
        if ([...HIGH_PRECISION_FAMILIES].some(key => legacyKey === key || legacyKey.startsWith(`${key}_`))) {
            const oldFine = await samplePlacedAlpha(legacyTexturePath, oldPlacement.width, oldPlacement.height,
                oldPlacement.x, oldPlacement.y, 0, 1);
            const newFine = await samplePlacedAlpha(nixieTexturePath, newPlacement.width, newPlacement.height,
                newPlacement.x, newPlacement.y, orientation.rotationOffsetDeg, 1);
            if (oldFine && newFine) {
                match = refineAlphaTranslation(oldFine, newFine, match.x, match.y);
            }
        }
        const acceptedMatch = orientation.confidence !== 'low' && orientation.confidence !== 'skip'
            && match.score >= MIN_OVERLAP && match.areaRatio >= MIN_AREA_RATIO
            && ((match.x === 0 && match.y === 0) || match.score - match.originScore >= 0.01);
        report[legacyKey] = { foxholeKey, ...match, rotationOffsetDeg: orientation.rotationOffsetDeg,
            accepted: acceptedMatch };
        if (acceptedMatch && (match.x !== 0 || match.y !== 0)) {
            accepted[legacyKey] = { x: match.x, y: match.y, score: match.score, foxholeKey,
                sprite: [guardSprite.width, guardSprite.height,
                    Number(guardSprite.offsetX ?? 0), Number(guardSprite.offsetY ?? 0)],
                ...(newSprite === guardSprite ? {} : { variantSprite: [newSprite.width, newSprite.height,
                    Number(newSprite.offsetX ?? 0), Number(newSprite.offsetY ?? 0)] }) };
        }
    }

    for (const [legacyKey, building] of Object.entries(buildings).sort(([a], [b]) => a.localeCompare(b))) {
        const foxholeKey = LEGACY_PLAN_BUILDING_KEY_MAP[legacyKey];
        const asset = assetsById.get(foxholeKey);
        const orientation = LEGACY_PLAN_ORIENTATION_MAP[foxholeKey];
        if (!asset || !orientation || !building.texture || building.hasHandle
            || asset.connector?.splineComponentName === 'SplineConnector'
            || isFixedFootprint(legacyKey, building)) {
            continue;
        }
        const nixieTexturePath = resolveNixieTexturePath(foxholeKey);
        await registerPosition(legacyKey, foxholeKey, building.texture, asset.sprite, asset.sprite,
            orientation, nixieTexturePath);

        for (const [upgradeKey, upgrade] of Object.entries(building.upgrades ?? {})) {
            const upgradeSprite = resolveUpgradeSprite(asset, legacyKey, upgradeKey);
            if (!upgradeSprite?.source || !upgrade.texture) {
                continue;
            }
            const upgradeTexturePath = path.resolve(PLANNER_ROOT, 'public', String(upgradeSprite.source).replace(/^\//, ''));
            await registerPosition(`${legacyKey}_${upgradeKey}`, foxholeKey, upgrade.texture,
                upgradeSprite, asset.sprite, orientation, upgradeTexturePath);
        }
    }

    const rows = Object.entries(accepted).map(([key, entry]) =>
        `    ${JSON.stringify(key)}: { x: ${entry.x}, y: ${entry.y}, score: ${entry.score}, foxholeKey: ${JSON.stringify(entry.foxholeKey)}, sprite: ${JSON.stringify(entry.sprite)}${entry.variantSprite ? `, variantSprite: ${JSON.stringify(entry.variantSprite)}` : ''} },`).join('\n');
    fs.writeFileSync(OUT_TS, `/**
 * Legacy Foxhole Planner image-origin corrections in board pixels.
 * Generated offline from game-kitchen sprites and the published Nixie manifest.
 * Values are offsets at legacy rotation 0; the importer rotates them with the
 * legacy entity. Fixed-footprint structures and uncertain matches are omitted.
 * Regenerate: npm run legacy:generate-position-map
 */
export const LEGACY_PLAN_POSITION_MAP: Readonly<Record<string, { x: number; y: number; score: number; foxholeKey: string; sprite: readonly [number, number, number, number]; variantSprite?: readonly [number, number, number, number] }>> = {
${rows}
};
`);
    fs.writeFileSync(OUT_REPORT, `${JSON.stringify({ thresholds: { overlap: MIN_OVERLAP, areaRatio: MIN_AREA_RATIO },
        examined: Object.keys(report).length, accepted: Object.keys(accepted).length, results: report }, null, 2)}\n`);
    console.log({ examined: Object.keys(report).length, accepted: Object.keys(accepted).length, wrote: OUT_TS });
}

await main();
