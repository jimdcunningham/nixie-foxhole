import { LEGACY_PLAN_POSITION_MAP } from './plan-position-map.ts';

type SpriteGeometry = { width?: number | null; height?: number | null; offsetX?: number | null; offsetY?: number | null };

function matchesSpriteGeometry(expected: readonly [number, number, number, number], sprite: SpriteGeometry | null | undefined): boolean {
    return Boolean(sprite && expected[0] === Number(sprite.width ?? 0)
        && expected[1] === Number(sprite.height ?? 0)
        && expected[2] === Number(sprite.offsetX ?? 0)
        && expected[3] === Number(sprite.offsetY ?? 0));
}

/** Apply the image-origin correction only while creating an imported snapshot. */
export function resolveLegacyPlanPosition(
    legacyKey: string,
    foxholeKey: string,
    sprite: SpriteGeometry,
    x: number,
    y: number,
    legacyRotationDeg: number,
    variantSprite?: SpriteGeometry | null,
): { x: number; y: number } {
    const offset = LEGACY_PLAN_POSITION_MAP[String(legacyKey ?? '').trim().toLowerCase()];
    if (!offset || !Number.isFinite(legacyRotationDeg)
        || offset.foxholeKey !== foxholeKey
        || !matchesSpriteGeometry(offset.sprite, sprite)
        || (offset.variantSprite && !matchesSpriteGeometry(offset.variantSprite, variantSprite))) {
        return { x, y };
    }
    const radians = legacyRotationDeg * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        x: x + offset.x * cos - offset.y * sin,
        y: y + offset.x * sin + offset.y * cos,
    };
}
