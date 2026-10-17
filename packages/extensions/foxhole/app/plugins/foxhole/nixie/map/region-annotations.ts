import type { Container } from 'pixi.js';

/** Native region labels remain the authority for each summary card's attachment. */
export const foxholeMapRegionAnnotationLabels = new WeakMap<Container, Container>();

export function getFoxholeMapRegionBillboardGroups(layer: Container) {
    return layer.children.flatMap(content => {
        const label = foxholeMapRegionAnnotationLabels.get(content);
        if (!label || label.destroyed) {
            return [];
        }
        return [{ content, anchor: { x: label.x, y: label.y }, offset: content.y - label.y,
            anchorHalfHeight: label.getLocalBounds().height * Math.abs(label.scale.y) / (2 * Math.max(1e-6, Math.abs(content.scale.y))) }];
    });
}
