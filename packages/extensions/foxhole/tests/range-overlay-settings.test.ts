import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FOXHOLE_RANGE_DEBUG_SETTING_KEYS,
    FOXHOLE_RANGE_SETTING_KEYS,
    foxholeRangeDebugUserSettings,
    foxholeRangeUserSettings,
    isFoxholeRangeVisible,
    readFoxholeRangeSettings,
} from '../app/plugins/foxhole/nixie/range-settings.ts';
import { FOXHOLE_NIGHT_RANGE_SETTING_IDS } from '../app/plugins/foxhole/nixie/night-ranges.ts';
import { createFoxholeStructureRangeVisual } from '../app/plugins/foxhole/nixie/structure-range-visual.ts';

test('Foxhole range overlays can be enabled independently', () => {
    const settings = readFoxholeRangeSettings({
        [FOXHOLE_RANGE_SETTING_KEYS.rifle]: true,
        [FOXHOLE_RANGE_SETTING_KEYS.machineGun]: false,
    });

    assert.equal(isFoxholeRangeVisible({ type: 'killbox' }, settings, false), true);
    assert.equal(isFoxholeRangeVisible({ type: 'killboxMG' }, settings, false), false);
    assert.equal(isFoxholeRangeVisible({ type: 'killboxAT' }, settings, false), false);
});

test('Foxhole range overlays preserve legacy grouped settings as fallbacks', () => {
    const settings = readFoxholeRangeSettings({
        [FOXHOLE_RANGE_SETTING_KEYS.defenseArtillery]: true,
    });

    assert.equal(isFoxholeRangeVisible({ type: 'killboxArty' }, settings, false), true);
    assert.equal(isFoxholeRangeVisible({ type: 'killboxRocket' }, settings, false), true);
    assert.equal(isFoxholeRangeVisible({ type: 'killboxAA' }, settings, false), true);
});

test('Foxhole vehicle weapon ranges stay gated until their debug flag is enabled', () => {
    const settings = readFoxholeRangeSettings({
        [FOXHOLE_RANGE_SETTING_KEYS.rifle]: true,
    });

    assert.equal(isFoxholeRangeVisible({ type: 'killbox' }, settings, false), true);
    assert.equal(isFoxholeRangeVisible({ type: 'killbox' }, settings, false, { isVehicle: true }), false);
    assert.equal(isFoxholeRangeVisible({ type: 'killbox' }, settings, true, { isVehicle: true }), false);
    assert.equal(isFoxholeRangeVisible({ type: 'crane' }, settings, true, { isVehicle: true }), true);

    const debugSettings = readFoxholeRangeSettings({
        [FOXHOLE_RANGE_SETTING_KEYS.rifle]: true,
        [FOXHOLE_RANGE_DEBUG_SETTING_KEYS.vehicleWeapons]: true,
    });

    assert.equal(isFoxholeRangeVisible({ type: 'killbox' }, debugSettings, false, { isVehicle: true }), true);
});

test('Foxhole vehicle weapon range debug setting is registered off by default', () => {
    const setting = foxholeRangeDebugUserSettings.find(definition => definition.id === FOXHOLE_RANGE_DEBUG_SETTING_KEYS.vehicleWeapons);

    assert.ok(setting);
    assert.equal(setting.defaultValue, false);
    assert.equal(setting.settingsPageSectionId, 'foxhole-debug');
});

test('night preferences are registered for the overlays menu without separate settings controls', () => {
    for (const id of FOXHOLE_NIGHT_RANGE_SETTING_IDS) {
        const setting = foxholeRangeUserSettings.find(definition => definition.id === id);
        assert.ok(setting);
        assert.equal(setting.defaultValue, false);
        assert.equal(setting.visible, false);
    }
});

test('native night overlays draw the reduced boundary and keep the firing arc', () => {
    const range = { type: 'killboxMG', max: 30, arc: 45 };
    const day = createFoxholeStructureRangeVisual(range)!;
    const night = createFoxholeStructureRangeVisual(range, false, 15)!;
    assert.ok(Math.abs(day.strokeVisual!.context.bounds.maxX - 30 * 32) <= 3);
    assert.ok(night.strokeVisual!.context.bounds.maxX <= 15 * 32 + 3);
    assert.ok(night.strokeVisual!.context.bounds.minX >= -3);
    assert.ok(night.strokeVisual!.context.bounds.maxY <= 15 * 32 * Math.sin(Math.PI / 4) + 3);
    day.visual.destroy({ children: true });
    night.visual.destroy({ children: true });
});
