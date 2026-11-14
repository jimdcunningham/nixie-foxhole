// Pixi 3D 0.1 names this operation after the render-pass mask it sets.
export function setBatchPasses(batch, index, mask) {
    if (batch.setPassesAt) {
        batch.setPassesAt(index, mask);
    } else {
        batch.setItemActive(index, mask);
    }
}
