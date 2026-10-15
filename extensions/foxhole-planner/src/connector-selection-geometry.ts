import type { NixieExperimentalSelectionGeometryV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { FOXHOLE_POWERLINE_CORE_WIDTH } from './powerline-stroke.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';

export function resolveFoxholeConnectorSelectionGeometry(data: FoxholeSceneV2SplineConnectorData): NixieExperimentalSelectionGeometryV1 {
    const geometry: NixieExperimentalSelectionGeometryV1 = { contractVersion: 1,
        transformOrigin: { x: (data.startX + data.endX) / 2, y: (data.startY + data.endY) / 2 } };
    if (!data.foxholeKey.toLowerCase().includes('powerline')) {
        return geometry;
    }
    const dx = data.endX - data.startX;
    const dy = data.endY - data.startY;
    const length = Math.hypot(dx, dy);
    const halfStroke = FOXHOLE_POWERLINE_CORE_WIDTH / 2;
    const ux = length > 1e-6 ? dx / length : 1;
    const uy = length > 1e-6 ? dy / length : 0;
    const startX = data.startX - ux * halfStroke;
    const startY = data.startY - uy * halfStroke;
    const endX = data.endX + ux * halfStroke;
    const endY = data.endY + uy * halfStroke;
    geometry.localQuad = [{ x: startX - uy * halfStroke, y: startY + ux * halfStroke },
        { x: endX - uy * halfStroke, y: endY + ux * halfStroke }, { x: endX + uy * halfStroke, y: endY - ux * halfStroke },
        { x: startX + uy * halfStroke, y: startY - ux * halfStroke }];
    geometry.frameAngle = Math.atan2(dy, dx);
    return geometry;
}
