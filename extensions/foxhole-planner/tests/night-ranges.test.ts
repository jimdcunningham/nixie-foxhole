import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseNixieExtensionRenderPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import assets from '../src/scene-v2-assets-node.ts';
import { FOXHOLE_NIGHT_RANGE_SETTING_IDS, FOXHOLE_NIGHTTIME_RANGES_SETTING_ID, FOXHOLE_POWERED_SPOTLIGHTS_SETTING_ID,
    createFoxholeNightRangePolygon, resolveFoxholeNightVisionRadius } from '../src/night-ranges.ts';
import { renderFoxholeStructureRangeOverlays } from '../src/scene-v2-structure-range-overlays.ts';

const midnight = { [FOXHOLE_NIGHTTIME_RANGES_SETTING_ID]: true };
const get = (settings: Record<string, boolean>) => (id: string) => settings[id];

test('nighttime toggle uses midnight vision and daytime leaves weapon ranges unchanged', () => {
    const structure = { codeName: 'RifleAIT3' };
    const range = { type: 'killbox', max: 29 };
    assert.equal(resolveFoxholeNightVisionRadius(structure, range, get({})), null);
    assert.equal(resolveFoxholeNightVisionRadius(structure, range, get(midnight)), 15);
    assert.equal(resolveFoxholeNightVisionRadius(structure, range, get({ [FOXHOLE_NIGHTTIME_RANGES_SETTING_ID]: false,
        [FOXHOLE_POWERED_SPOTLIGHTS_SETTING_ID]: true })), null);
});

test('only known AI defenses lose range; spotlights help only T2/T3 bunker garrisons', () => {
    const powered = get({ ...midnight, [FOXHOLE_POWERED_SPOTLIGHTS_SETTING_ID]: true });
    for (const codeName of ['RifleAIT1', 'MGAIT1', 'ATGunAIT1', 'RiflePillbox', 'MGPillbox', 'ATPillbox', 'ISGPillbox']) {
        assert.equal(resolveFoxholeNightVisionRadius({ codeName }, { type: 'killbox', max: 30 }, powered), 15, codeName);
    }
    for (const codeName of ['RifleAIT2', 'MGAIT3', 'ATGunAIT2']) {
        assert.ok(Math.abs(resolveFoxholeNightVisionRadius({ codeName }, { type: 'killbox', max: 30 }, powered)! - 19.95) < 0.000001, codeName);
        assert.equal(resolveFoxholeNightVisionRadius({ codeName }, { type: 'killbox', max: 30 }, get({})), null);
    }
    for (const codeName of ['ArtilleryAIT3', 'CoastalGun', 'AAGunAI', 'IntelCenter', 'WeatherStation', 'ObservationBunkerT3', 'DeployedISG', 'EmplacedATW']) {
        assert.equal(resolveFoxholeNightVisionRadius({ codeName }, { type: 'killbox', max: 30 }, powered), null, codeName);
    }
    assert.equal(resolveFoxholeNightVisionRadius({ codeName: 'RifleAIT2', isVehicle: true }, { type: 'killbox' }, powered), null);
    assert.equal(resolveFoxholeNightVisionRadius({ codeName: 'RifleAIT2' }, { type: 'intel' }, powered), null);
});

test('night geometry intersects offset firing sectors with the structure center and respects weapon reach', () => {
    const range = { type: 'killbox', x: 4, y: 2, max: 30, arc: 45, rotation: 20 };
    const before = structuredClone(range);
    const polygon = createFoxholeNightRangePolygon(range, 15)!;
    assert.ok(polygon.length > 6);
    for (let index = 0; index < polygon.length; index += 2) {
        const x = polygon[index]!, y = polygon[index + 1]!;
        assert.ok(Math.hypot(x, y) <= 15.000001);
        assert.ok(Math.hypot(x - 4, y - 2) <= 30.000001);
        if (Math.hypot(x - 4, y - 2) > 0.000001) {
            const angle = Math.atan2(y - 2, x - 4) * 180 / Math.PI;
            assert.ok(angle >= -25.000001 && angle <= 65.000001);
        }
    }
    assert.deepEqual(range, before);
    assert.equal(createFoxholeNightRangePolygon({ type: 'killbox', max: 10 }, 15), null);
    assert.equal(createFoxholeNightRangePolygon(range, null), null);
    assert.deepEqual(createFoxholeNightRangePolygon({ type: 'killbox', x: 50, max: 5 }, 15), []);
});

test('real published AI overlays shrink in both visibility groups and stay valid standalone render plans', () => {
    const asset = assets.rifleait3!;
    const before = structuredClone(asset);
    for (const enabled of [false, true]) {
        const overlays = renderFoxholeStructureRangeOverlays(asset, { ...midnight, 'foxhole.ranges.rifle': enabled }, { destroyed: false, packaged: false });
        assert.equal(overlays[0]?.id, enabled ? 'structure-ranges' : 'selected-structure-ranges');
        const rangeNode = overlays[0]?.kind === 'group' ? overlays[0].children[0] : undefined;
        const fill = rangeNode?.kind === 'group' ? rangeNode.children[0] : undefined;
        assert.ok(fill?.kind === 'graphics');
        const polygon = fill.commands.find(command => command.op === 'polygon');
        assert.ok(polygon?.op === 'polygon');
        assert.ok(polygon.points.every(point => Math.hypot(point.x, point.y) <= 15 * 32 + 0.000001));
        assert.doesNotThrow(() => parseNixieExtensionRenderPlanV1({ schemaVersion: 1, root: { id: 'root', kind: 'group', children: overlays } }));
    }
    assert.deepEqual(asset, before);
    assert.deepEqual(renderFoxholeStructureRangeOverlays(assets.observationbunkert3!, midnight, { destroyed: false, packaged: false }),
        renderFoxholeStructureRangeOverlays(assets.observationbunkert3!, {}, { destroyed: false, packaged: false }));
});

test('all night preferences are declared to the extension renderer and default to daytime', () => {
    const manifest = JSON.parse(readFileSync(new URL('../nixie.extension.json', import.meta.url), 'utf8'));
    const renderer = manifest.contributes.experimentalRenderers.find((entry: { id: string }) => entry.id === 'foxhole-assets');
    for (const id of FOXHOLE_NIGHT_RANGE_SETTING_IDS) {
        assert.ok(renderer.settingIds.includes(id));
        assert.equal(manifest.contributes.settings.find((entry: { id: string }) => entry.id === id)?.defaultValue, false);
    }
});
