import { parseLegacyColor } from './plan-legacy-styles.ts';

export type LegacyTintBrightness = {
    tint?: number;
    brightness?: number;
};

/**
 * Resolve legacy entity tint/brightness the way DraggableContainer.setTintBrightness
 * stores them: white tint is cleared, brightness === 1 is cleared.
 */
export function resolveLegacyTintBrightness(entity: {
    tint?: unknown;
    brightness?: unknown;
}): LegacyTintBrightness {
    const result: LegacyTintBrightness = {};

    if (entity.tint !== undefined && entity.tint !== null && entity.tint !== '') {
        const parsed = parseLegacyColor(entity.tint, 0xFFFFFF) >>> 0;
        if (parsed !== 0xFFFFFF) {
            result.tint = parsed;
        }
    }

    if (entity.brightness !== undefined && entity.brightness !== null && entity.brightness !== '') {
        const brightness = Number(entity.brightness);
        if (Number.isFinite(brightness) && brightness !== 1) {
            result.brightness = brightness;
        }
    }

    return result;
}

export function applyLegacyTintBrightness(
    state: { tint?: number; brightness?: number; },
    entity: { tint?: unknown; brightness?: unknown; },
): void {
    const resolved = resolveLegacyTintBrightness(entity);
    if (resolved.tint != null) {
        state.tint = resolved.tint;
    }
    if (resolved.brightness != null) {
        state.brightness = resolved.brightness;
    }
}
