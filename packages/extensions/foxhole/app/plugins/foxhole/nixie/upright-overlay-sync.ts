import * as PIXI from 'pixi.js';

/** Pixi label marking containers that stay world-upright during live node rotation. */
export const FOXHOLE_UPRIGHT_OVERLAY_LABEL = 'foxhole-upright';

/**
 * Keep text and marked upright child containers world-upright while a board
 * node's live Pixi rotation diverges from committed board state during drag.
 *
 * Directional placement containers (pipe sockets, power frames, stems) keep
 * their authored local rotation and ride with the structure.
 */
export function syncUprightBoardOverlayChildren(
    nodeRotation: number,
    container: PIXI.Container,
    rotationToRoot = 0,
): void {
    // Absolute rotation of `container` relative to the board node.
    const rotationToContainer = rotationToRoot + container.rotation;

    for (const child of container.children) {
        if (child instanceof PIXI.Text) {
            child.rotation = -nodeRotation - rotationToContainer;
            continue;
        }

        if (!(child instanceof PIXI.Container)) {
            continue;
        }

        if (child.label === FOXHOLE_UPRIGHT_OVERLAY_LABEL) {
            child.rotation = -nodeRotation - rotationToContainer;
            continue;
        }

        // Pass this container's absolute rotation as the child's rotationToRoot.
        // Do not add child.rotation here — the recursive call adds container.rotation
        // (the child) once via rotationToRoot + container.rotation.
        syncUprightBoardOverlayChildren(
            nodeRotation,
            child,
            rotationToContainer,
        );
    }
}
