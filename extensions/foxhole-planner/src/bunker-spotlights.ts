import { FOXHOLE_NIGHTTIME_RANGES_SETTING_ID, FOXHOLE_POWERED_SPOTLIGHTS_SETTING_ID, hasFoxholeBunkerSpotlight } from './night-ranges.ts';
import { readFoxholeAuthoredSpotlight } from './spotlight-beam.ts';
import type { FoxholeSpotlightBeam } from './spotlight-beam.ts';

export function isFoxholeBunkerSpotlightLayer(layer: { id: string; }, codeName?: string | null): boolean {
    return hasFoxholeBunkerSpotlight(codeName) && /^(?:base|top)mesh$/i.test(layer.id);
}

export function showFoxholeBunkerSpotlightGlow(codeName: string | null | undefined, getValue: (id: string) => unknown,
    appearance: { destroyed?: boolean; packaged?: boolean; blueprint?: boolean; } = {}): boolean {
    return hasFoxholeBunkerSpotlight(codeName) && !appearance.destroyed && !appearance.packaged && !appearance.blueprint
        && getValue(FOXHOLE_NIGHTTIME_RANGES_SETTING_ID) === true
        && getValue(FOXHOLE_POWERED_SPOTLIGHTS_SETTING_ID) === true
        && getValue('foxhole.structure.hideRoofs') !== true;
}

// A compact vehicle-style headlight across the roof, independent of AI range.
export const FOXHOLE_BUNKER_SPOTLIGHT_BEAM: FoxholeSpotlightBeam = {
    planarProjectionScale: 1, coneLength: 88, baseOffsetPixels: 4.5, baseHalfWidthPixels: 1.5,
    outerConeAngleRadians: 40 * Math.PI / 180, beamColorHex: 'ffe3ac', beamStrength: 0.85,
};

export function foxholeBunkerSpotlightLensPosition(layer: { offsetX?: number | null; offsetY?: number | null; width: number; }) {
    return { x: (layer.offsetX ?? 0) + layer.width * 0.35, y: layer.offsetY ?? 0 };
}

export function resolveFoxholeBunkerSpotlightLights(spotlights: readonly unknown[] | undefined,
    fallbackLamp?: { offsetX?: number | null; offsetY?: number | null; width: number; }) {
    const lights = (spotlights ?? []).flatMap(value => {
        const light = readFoxholeAuthoredSpotlight(value);
        if (!light) return [];
        const strength = light.intensity && light.intensity > 0 ? Math.max(0.35, Math.min(1, Math.log10(light.intensity + 1) / 1.6)) : 0.55;
        return [{ authored: true, x: light.x / 100 * 32, y: light.y / 100 * 32, rotation: light.rotation * Math.PI / 180,
            beam: { planarProjectionScale: light.planarProjectionScale,
                coneLength: light.attenuationRadius / 100 * 32 * Math.max(0, Math.min(1, light.planarProjectionScale)),
                baseHalfWidthPixels: Math.max(light.sourceRadius ?? 0, light.softSourceRadius ?? 0) / 100 * 32,
                baseOffsetPixels: (light.sourceLength ?? 0) / 100 * 32,
                // Unreal cone properties are half angles; the shared headlight renderer accepts full cone width.
                outerConeAngleRadians: Math.min(89.9, light.outerConeAngle) * Math.PI / 180 * 2,
                innerConeAngleRadians: Math.max(0, Math.min(light.outerConeAngle, light.innerConeAngle)) * Math.PI / 180 * 2,
                beamColorHex: light.lightColor ?? 'ffe3ac', beamStrength: strength,
                lightFalloffExponent: light.lightFalloffExponent, useInverseSquaredFalloff: light.useInverseSquaredFalloff,
            } satisfies FoxholeSpotlightBeam }];
    });
    return lights.length || !fallbackLamp ? lights : [{ authored: false, ...foxholeBunkerSpotlightLensPosition(fallbackLamp), rotation: 0,
        beam: FOXHOLE_BUNKER_SPOTLIGHT_BEAM }];
}
