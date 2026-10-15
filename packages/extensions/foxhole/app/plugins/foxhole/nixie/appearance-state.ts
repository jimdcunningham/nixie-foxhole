const DEFAULT_FOXHOLE_TINT = 0xFFFFFF;
const DEFAULT_FOXHOLE_BRIGHTNESS = 1;

/**
 * Snapshot normalization omits default appearance values. When a snapshot diff
 * carries one of those fields as `undefined`, materialize the visual default so
 * the live scene clears the previous tint/filter instead of treating it as a no-op.
 */
export function materializeFoxholeAppearancePatchDefaults<T extends Record<string, unknown>>(patch: T): T {
    const materialized = { ...patch };

    if (Object.prototype.hasOwnProperty.call(materialized, 'tint') && materialized.tint === undefined) {
        materialized.tint = DEFAULT_FOXHOLE_TINT;
    }
    if (Object.prototype.hasOwnProperty.call(materialized, 'brightness') && materialized.brightness === undefined) {
        materialized.brightness = DEFAULT_FOXHOLE_BRIGHTNESS;
    }

    return materialized;
}
