import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreLegacyNixieOrientation } from '../../tools/legacy-plans/orientation-alpha-sample.mjs';
import {
    chooseOrientationEntry,
    expandNixieRanges,
    LEGACY_RANGE_FACING_DEFAULT_DEG,
    resolveLegacyTexturePath,
    resolveNixieTexturePath,
    scoreFromDimensions,
    scoreFromRanges,
} from '../../tools/legacy-plans/generate-orientation-map.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const plannerRoot = path.resolve(__dirname, '../..');
const legacyRoot = process.env.GAME_KITCHEN_PATH
    ? path.join(process.env.GAME_KITCHEN_PATH, 'public/assets/foxhole/game/Textures/Structures')
    : 'C:/Code/game-kitchen/public/assets/foxhole/game/Textures/Structures';
const nixieRoot = path.join(plannerRoot, 'public/foxhole/assets/types/structures');

async function scoreCase(foxholeKey, legacyFile, expectedOffset) {
    const result = await scoreLegacyNixieOrientation({
        legacyTexturePath: path.join(legacyRoot, legacyFile),
        nixieTexturePath: path.join(nixieRoot, foxholeKey, `${foxholeKey}.texture.webp`),
    });
    assert.ok(result, `${foxholeKey} should produce an alpha orientation score`);
    assert.equal(result.rotationOffsetDeg + 0, expectedOffset, `${foxholeKey} import offset`);
    return result;
}

test('alpha orientation sampling matches visual QA for known facilities', async t => {
    const cases = [
        ['facilitypowerdiesel', 'diesel_power_plant.webp', -90],
        ['facilitytransferliquid', 'liquid_transfer_station.webp', -90],
        ['facilityvehiclefactory1', 'light_vehicle_assembly_station.webp', 90],
        ['facilitycrane', 'bms_foreman_stacker.webp', 0],
    ];

    for (const [foxholeKey, legacyFile, expectedOffset] of cases) {
        await t.test(foxholeKey, async () => {
            const result = await scoreCase(foxholeKey, legacyFile, expectedOffset);
            assert.ok(result.alphaScore > 0.4, `${foxholeKey} alpha score`);
        });
    }
});

test('liquidcontainer ignores padded square canvas and stays at 0', async () => {
    const result = await scoreLegacyNixieOrientation({
        legacyTexturePath: path.join(legacyRoot, 'fuel_container.webp'),
        nixieTexturePath: path.join(nixieRoot, 'liquidcontainer', 'liquidcontainer.texture.webp'),
        legacyWidth: 161,
        legacyHeight: 267,
        nixieWidth: 194,
        nixieHeight: 323,
    });
    assert.ok(result);
    assert.equal(result.legacyAspect, 'portrait');
    assert.equal(result.nixieAspect, 'portrait');
    assert.equal(result.rotationOffsetDeg + 0, 0);
    assert.deepEqual(
        result.candidateScores.map(entry => entry.offset).sort((a, b) => a - b),
        [0, 180],
    );
});

test('range facing ignores position and prefers +90 for mgpillbox defaults', () => {
    const legacyRanges = [{
        type: 'killboxMG',
        arc: 35,
        facingDeg: LEGACY_RANGE_FACING_DEFAULT_DEG,
    }];
    const nixieRanges = expandNixieRanges([{ t: 'killboxMG', a: 35, mx: 30 }]);
    assert.equal(nixieRanges[0].facingDeg, 0);

    const rangeEntry = scoreFromRanges(
        legacyRanges,
        nixieRanges,
        'landscape',
        'portrait',
        -0.797,
        1.784,
    );
    assert.ok(rangeEntry);
    assert.equal(rangeEntry.rotationOffsetDeg + 0, 90);
    assert.equal(rangeEntry.meanAngleResidualDeg, 0);
    assert.ok(rangeEntry.confidence !== 'low');
});

test('range facing resolves ambiguous alpha ±90 for mgpillbox', async () => {
    const alphaEntry = await scoreLegacyNixieOrientation({
        legacyTexturePath: path.join(legacyRoot, 'mgpillbox.webp'),
        nixieTexturePath: path.join(nixieRoot, 'mgpillbox', 'mgpillbox.texture.webp'),
        legacyWidth: 296,
        legacyHeight: 262,
        nixieWidth: 307,
        nixieHeight: 355,
    });
    assert.ok(alphaEntry);
    assert.equal(Math.abs(alphaEntry.rotationOffsetDeg), 90);
    assert.ok((alphaEntry.alphaMargin ?? 1) < 0.03, 'mgpillbox alpha should be sign-ambiguous');

    const rangeEntry = scoreFromRanges(
        [{ type: 'killboxMG', arc: 35, facingDeg: LEGACY_RANGE_FACING_DEFAULT_DEG }],
        expandNixieRanges([{ t: 'killboxMG', a: 35, mx: 30 }]),
        'landscape',
        'portrait',
        -0.797,
        1.784,
    );
    const chosen = chooseOrientationEntry(alphaEntry, null, rangeEntry, {
        rotationOffsetDeg: 90,
        confidence: 'low',
        method: 'aspect-flip',
        legacyAspect: 'landscape',
        nixieAspect: 'portrait',
    });
    assert.equal(chosen.rotationOffsetDeg + 0, 90);
    assert.match(chosen.method, /range-facing/);
});

test('numeric width/height fit prefers flip when axes swap to match', () => {
    // shippingcontainer: legacy 322×163 landscape → nixie 197×390 portrait
    const entry = scoreFromDimensions(322, 163, 197, 390, 'landscape', 'portrait', 0, 0);
    assert.ok(entry);
    assert.equal(Math.abs(entry.rotationOffsetDeg), 90);
    assert.match(entry.method, /dimension-fit-flip/);
    assert.ok((entry.dimensionFitMargin ?? 0) > 0.15);
});

test('strong same-aspect dimension fit is high confidence at offset 0', () => {
    // Typical vehicle: portrait→portrait with near-identical ratio.
    const entry = scoreFromDimensions(400, 900, 410, 920, 'portrait', 'portrait', 0, 0);
    assert.ok(entry);
    assert.equal(entry.rotationOffsetDeg + 0, 0);
    assert.equal(entry.confidence, 'high');
    assert.equal(entry.method, 'dimension-fit-same');
});

test('legacy and nixie vehicle textures resolve outside Structures/', () => {
    const gameKitchen = process.env.GAME_KITCHEN_PATH || 'C:/Code/game-kitchen';
    const legacyPath = resolveLegacyTexturePath(gameKitchen, '../Vehicles/aircraftbomberc.webp');
    assert.ok(legacyPath, 'legacy Vehicles texture should resolve');
    assert.match(legacyPath.replace(/\\/g, '/'), /Textures\/Vehicles\/aircraftbomberc\.webp$/);

    const nixiePath = resolveNixieTexturePath('aircraftbomberc');
    assert.ok(nixiePath, 'nixie Vehicles texture should resolve');
    assert.match(nixiePath.replace(/\\/g, '/'), /types\/vehicles\/aircraftbomberc\/aircraftbomberc\.texture\.webp$/);
});

test('orientation map applies manual overrides for ambiguous assets', async () => {
    const { resolveLegacyPlanOrientationOffsetDeg } = await import(
        '../../app/plugins/foxhole/legacy/plan-orientation-map.ts'
    );
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('rocketpartcenter'), 0);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('rocketparttop'), 0);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('shippingcontainer'), -90);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('resourcecontainer'), -90);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('barbedwirespline'), 0);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('constructionequipment'), -90);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('facilityvehiclefactory3'), 180);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('seaport'), 0);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('powerpole'), 180);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('salvagefield'), 0);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('waterminespline'), 0);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('fieldpier'), 0);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('foundation011x2t3'), 90);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('foundation02t3'), 180);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('structurecrate'), 90);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('artilleryait1'), 90);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('artilleryait2'), 90);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('artilleryait3'), 90);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('atgunait1'), 90);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('atgunait2'), 90);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('atgunait3'), 90);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('fortrampt1'), 90);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('fortrampt2'), 90);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('fortrampt3'), 90);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('mgait1'), 90);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('mgait2'), 90);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('mgait3'), 90);
});
