import type { NixieSceneV2CanvasCoordinator } from '#nixie/utils/nixie-scene-v2-canvas-coordinator.ts';
import { getFoxholeMapSearchCameraTarget, type FoxholeMapSearchEntry } from './map/search.ts';

/** Route the existing War panel's navigation to the active ECS canvas. */
export function focusFoxholeSceneV2MapEntry(
    canvas: Pick<NixieSceneV2CanvasCoordinator, 'captureFrame' | 'getZoomScale' | 'restoreFrame'> & Partial<Pick<NixieSceneV2CanvasCoordinator, 'focusWorldPoint'>>,
    entry: FoxholeMapSearchEntry,
): boolean {
    const frame = canvas.captureFrame();
    const zoom = canvas.getZoomScale();
    if (!frame || !zoom) return false;
    const screenWidth = frame.worldWidth * zoom;
    const screenHeight = frame.worldHeight * zoom;
    const target = getFoxholeMapSearchCameraTarget(entry, { screenWidth, screenHeight });
    if (canvas.focusWorldPoint) return canvas.focusWorldPoint(target.position, target.scale);
    return canvas.restoreFrame({
        x: target.position.x,
        y: target.position.y,
        worldWidth: screenWidth / target.scale,
        worldHeight: screenHeight / target.scale,
        ...(frame.sceneV2 ? { sceneV2: frame.sceneV2 } : {}),
    });
}
