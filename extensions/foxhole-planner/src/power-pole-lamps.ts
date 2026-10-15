import { FOXHOLE_NIGHTTIME_RANGES_SETTING_ID, FOXHOLE_POWERED_SPOTLIGHTS_SETTING_ID } from './night-ranges.ts';

// BPPowerPoleLight's downward spotlight: 1200 cm attenuation, Z=538.7588 cm,
// outer half-angle=35 degrees, LightColor=FFE1B5, falloff exponent=4.
export const FOXHOLE_POWER_POLE_LAMP = {
    x: -41.941277 / 100 * 32,
    y: -0.11272239 / 100 * 32,
    radius: Math.min(538.7588 * Math.tan(35 * Math.PI / 180), Math.sqrt(1200 ** 2 - 538.7588 ** 2)) / 100 * 32,
    color: 0xffe1b5,
};

export function showFoxholePowerPoleLamp(codeName: string | null | undefined, variantIds: readonly string[],
    getValue: (id: string) => unknown, appearance: { destroyed?: boolean; packaged?: boolean; blueprint?: boolean; } = {}): boolean {
    return /^PowerPole$/i.test(codeName ?? '') && variantIds.includes('light')
        && !appearance.destroyed && !appearance.packaged && !appearance.blueprint
        && getValue(FOXHOLE_NIGHTTIME_RANGES_SETTING_ID) === true
        && getValue(FOXHOLE_POWERED_SPOTLIGHTS_SETTING_ID) === true;
}

export function powerPoleLampFootprint() {
    const gap = 12 * Math.PI / 180;
    return [{ x: 0, y: 0 }, ...Array.from({ length: 65 }, (_, index) => {
        const angle = gap + (Math.PI * 2 - gap * 2) * index / 64;
        return { x: Math.cos(angle) * FOXHOLE_POWER_POLE_LAMP.radius, y: Math.sin(angle) * FOXHOLE_POWER_POLE_LAMP.radius };
    })];
}

export const POWER_POLE_LAMP_STOPS = Array.from({ length: 17 }, (_, index) => ({
    offset: index / 16, color: FOXHOLE_POWER_POLE_LAMP.color,
    alpha: Math.round(0.24 * Math.pow(1 - (index / 16) ** 2, 4) * 1e6) / 1e6,
}));
