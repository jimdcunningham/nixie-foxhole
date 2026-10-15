export interface FoxholeSelectionBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** Native trench crops omit end dirt/berms but retain transparent vertical padding.
 * Inputs are already in scene units; sprite anchors affect X, not the layer crop Y.
 */
export function resolveFoxholeTrenchSelectionBounds(sprite: FoxholeSelectionBounds,
    layers: readonly { width: number; height: number; offsetX: number; offsetY: number; }[]): FoxholeSelectionBounds | null {
    const valid = layers.filter(layer => Number.isFinite(layer.width) && layer.width > 0
        && Number.isFinite(layer.height) && layer.height > 0 && Number.isFinite(layer.offsetX) && Number.isFinite(layer.offsetY));
    if (!valid.length) return null;
    return {
        ...sprite,
        maxX: sprite.maxX + 6,
        minY: Math.min(...valid.map(layer => layer.offsetY - layer.height / 2)) + 8,
        maxY: Math.max(...valid.map(layer => layer.offsetY + layer.height / 2)) - 8,
    };
}
