import type { NixieExtensionRenderNodeV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import { FOXHOLE_STRUCTURE_RENDER_LANES, foxholeRenderLane } from './render-lanes.ts';
import { resolveFoxholeContactShadowCenter } from './contact-shadow.ts';

export function renderFoxholeContactShadows(nodes: NixieExtensionRenderNodeV1[], shadows: FoxholeSceneV2AssetMetadata['contactShadows']): NixieExtensionRenderNodeV1[] {
    if (!shadows) {
        return nodes;
    }
    return nodes.flatMap<NixieExtensionRenderNodeV1>((node): NixieExtensionRenderNodeV1[] => {
        if (node.kind === 'group') {
            return [{ ...node, children: renderFoxholeContactShadows(node.children, shadows) }];
        }
        const shadow = (node.kind === 'sprite' || node.kind === 'mesh') ? shadows[node.resourceId] : undefined;
        if (!shadow || node.visible === false) {
            return [node];
        }
        const common = { id: `${node.id}-contact-shadow`, ...foxholeRenderLane(FOXHOLE_STRUCTURE_RENDER_LANES.contactShadow),
            resourceId: shadow.resourceId, alpha: node.alpha, visible: node.visible,
            presentation: { contractVersion: 1 as const, excludeFromBounds: true } };
        if (node.kind === 'mesh') {
            const uvs = node.uvs.map((value, index) => index % 2 === 0
                ? (value * shadow.surfaceWidth + shadow.width / 2 - shadow.surfaceWidth / 2 + shadow.surfaceOffsetX - shadow.offsetX) / shadow.width
                : (value * shadow.surfaceHeight + shadow.height / 2 - shadow.surfaceHeight / 2 + shadow.surfaceOffsetY - shadow.offsetY) / shadow.height);
            return [{ ...node, ...common, uvs }, node];
        }
        if (node.kind !== 'sprite') {
            return [node];
        }
        const sx = (node.width ?? shadow.surfaceWidth) / shadow.surfaceWidth, sy = (node.height ?? shadow.surfaceHeight) / shadow.surfaceHeight;
        const center = resolveFoxholeContactShadowCenter({ ...shadow, textureUrl: '' }, node.anchorX ?? 0, node.anchorY ?? 0);
        if (node.scaleX !== undefined || node.scaleY !== undefined) {
            return [{ id: common.id, kind: 'group', ...foxholeRenderLane(FOXHOLE_STRUCTURE_RENDER_LANES.contactShadow),
                alpha: node.alpha, visible: node.visible, presentation: common.presentation,
                x: node.x, y: node.y, rotation: node.rotation, scaleX: node.scaleX, scaleY: node.scaleY,
                children: [{ id: `${common.id}-image`, kind: 'sprite', resourceId: shadow.resourceId,
                    anchorX: 0.5, anchorY: 0.5, x: center.x * sx, y: center.y * sy,
                    width: shadow.width * sx, height: shadow.height * sy }] }, node];
        }
        const x = center.x * sx, y = center.y * sy, angle = node.rotation ?? 0;
        return [{ ...common, kind: 'sprite' as const, anchorX: 0.5, anchorY: 0.5,
            width: shadow.width * sx, height: shadow.height * sy, rotation: node.rotation,
            x: (node.x ?? 0) + x * Math.cos(angle) - y * Math.sin(angle), y: (node.y ?? 0) + x * Math.sin(angle) + y * Math.cos(angle) }, node];
    });
}
