export const FOXHOLE_BOARD_SPRITE_SCALE = 0.5;

export function resolveFoxholeStructureSpriteOffset(
    sprite: { offsetX?: number | null; offsetY?: number | null; } | null | undefined,
    alternative: { offsetX?: number | null; offsetY?: number | null; } | null | undefined,
    replacement: { offsetX?: number | null; offsetY?: number | null; } | null | undefined,
): { x: number; y: number; } {
    const scale = (value: number) => Number.isFinite(value) ? value * FOXHOLE_BOARD_SPRITE_SCALE : 0;
    if (replacement) {
        return { x: scale(Number(replacement.offsetX ?? 0)), y: scale(Number(replacement.offsetY ?? 0)) };
    }
    const override = (value: number | null | undefined, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return { x: scale(override(alternative?.offsetX, Number(sprite?.offsetX ?? 0))),
        y: scale(override(alternative?.offsetY, Number(sprite?.offsetY ?? 0))) };
}

/** Native primary-sprite dimensions, independent of decorative render layers. */
export function resolveFoxholeStructureDimensions(
    asset: { width?: number | null; height?: number | null; } | null | undefined,
    alternative: { width?: number | null; height?: number | null; } | null | undefined,
    replacement: { textureWidth?: number | null; textureHeight?: number | null; } | null | undefined,
): { width: number | null; height: number | null; } {
    const width = replacement ? replacement.textureWidth : alternative?.width ?? asset?.width;
    const height = replacement ? replacement.textureHeight : alternative?.height ?? asset?.height;
    return {
        width: typeof width === 'number' ? width * FOXHOLE_BOARD_SPRITE_SCALE : null,
        height: typeof height === 'number' ? height * FOXHOLE_BOARD_SPRITE_SCALE : null,
    };
}
