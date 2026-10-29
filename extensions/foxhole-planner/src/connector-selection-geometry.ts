import type { NixieExperimentalSelectionGeometryV1, NixieExtensionRenderNodeV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import { resolveConnectorBehavior, resolveConnectorVisualPathStyle } from './connector-behavior.ts';
import { FOXHOLE_POWERLINE_CORE_WIDTH } from './powerline-stroke.ts';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';

/** Bounds for the rendered spline leaves only; guides and socket overlays are excluded by the caller. */
function renderedPoints(nodes: readonly NixieExtensionRenderNodeV1[], asset?: FoxholeSceneV2AssetMetadata) {
    const visuals = new Map(Object.values(asset?.renderLayers ?? {}).map(visual => [visual.resourceId, visual]));
    return nodes.flatMap(node => {
        if (node.visible === false || node.alpha === 0) return [];
        const points: { x: number; y: number; }[] = [];
        if (node.kind === 'mesh') {
            for (let index = 0; index < node.positions.length; index += 2) {
                points.push({ x: node.positions[index]!, y: node.positions[index + 1]! });
            }
        } else if (node.kind === 'sprite') {
            const visual = visuals.get(node.resourceId);
            if (!visual) return [];
            // Catalog dimensions are board-scaled; sprite scale applies to the raw texture.
            const width = visual.width * 2, height = visual.height * 2;
            for (const x of [0, width]) for (const y of [0, height]) {
                points.push({ x: x - (node.anchorX ?? 0) * width, y: y - (node.anchorY ?? 0) * height });
            }
        }
        const cos = Math.cos(node.rotation ?? 0), sin = Math.sin(node.rotation ?? 0);
        return points.map(point => {
            const x = point.x * (node.scaleX ?? 1), y = point.y * (node.scaleY ?? 1);
            return { x: x * cos - y * sin + (node.x ?? 0), y: x * sin + y * cos + (node.y ?? 0) };
        });
    });
}

export function resolveFoxholeConnectorSelectionGeometry(data: FoxholeSceneV2SplineConnectorData,
    asset?: FoxholeSceneV2AssetMetadata, content: readonly NixieExtensionRenderNodeV1[] = []): NixieExperimentalSelectionGeometryV1 {
    const geometry: NixieExperimentalSelectionGeometryV1 = { contractVersion: 1,
        transformOrigin: { x: (data.startX + data.endX) / 2, y: (data.startY + data.endY) / 2 } };
    const behavior = resolveConnectorBehavior(data.foxholeKey, asset?.connector);
    const style = resolveConnectorVisualPathStyle(asset?.connector?.pathStyle, data.foxholeKey);
    const straight = !behavior.undergroundPipe && (behavior.mineSpline || data.foxholeKey.toLowerCase().includes('cranerail')
        || style === 'straight-telescoping' || style === 'endpoints-only');
    if (!behavior.powerline && !straight) return geometry;
    const dx = data.endX - data.startX, dy = data.endY - data.startY;
    const length = Math.hypot(dx, dy);
    const ux = length > 1e-6 ? dx / length : 1, uy = length > 1e-6 ? dy / length : 0;
    let points = renderedPoints(content, asset);
    if (behavior.powerline) {
        const radius = FOXHOLE_POWERLINE_CORE_WIDTH / 2;
        points = [data.startX * ux + data.startY * uy - radius, data.endX * ux + data.endY * uy + radius]
            .flatMap(x => [-radius, radius].map(offset => {
                const y = -data.startX * uy + data.startY * ux + offset;
                return { x: x * ux - y * uy, y: x * uy + y * ux };
            }));
    }
    if (!points.length) return geometry;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of points) {
        const x = point.x * ux + point.y * uy, y = -point.x * uy + point.y * ux;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    // The SDK requires a nondegenerate rectangular quad, even during a collapsed endpoint preview.
    if (maxX - minX < 1e-6) { minX -= 0.5; maxX += 0.5; }
    if (maxY - minY < 1e-6) { minY -= 0.5; maxY += 0.5; }
    geometry.localQuad = [[minX, maxY], [maxX, maxY], [maxX, minY], [minX, minY]]
        .map(([x, y]) => ({ x: x! * ux - y! * uy, y: x! * uy + y! * ux }));
    geometry.frameAngle = Math.atan2(dy, dx);
    return geometry;
}
