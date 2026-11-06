import type { NixieExtensionRenderNodeV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import { createFoxholeSpotlightBeamGraphics } from './spotlight-beam.ts';
import { FOXHOLE_STRUCTURE_RENDER_LANES, foxholeRenderLane } from './render-lanes.ts';

export const FOXHOLE_DEBUG_SPOTLIGHTS_SETTING_ID = 'foxhole.debug.structure.spotlights';

/** Show the same authored light footprint used by the V1 debug spotlight overlay. */
export function renderFoxholeDebugSpotlightOverlays(asset: FoxholeSceneV2AssetMetadata,
    settings: Readonly<Record<string, boolean>>, appearance: { destroyed: boolean; packaged: boolean; }): NixieExtensionRenderNodeV1[] {
    if (settings[FOXHOLE_DEBUG_SPOTLIGHTS_SETTING_ID] !== true || appearance.destroyed || appearance.packaged) return [];
    const children: NixieExtensionRenderNodeV1[] = (asset.spotlights ?? []).flatMap((light, index) => {
        if (![light.x, light.y, light.rotation, light.attenuationRadius, light.outerConeAngle, light.planarProjectionScale].every(Number.isFinite)
            || light.attenuationRadius <= 0 || light.outerConeAngle <= 0) return [];
        const projection = Math.max(0, Math.min(1, light.planarProjectionScale));
        const length = light.attenuationRadius * 0.32 * projection;
        const outer = Math.max(6, light.outerConeAngle) * Math.PI / 180;
        const inner = Math.min(Math.max(0, light.innerConeAngle), Math.max(6, light.outerConeAngle)) * Math.PI / 180;
        const outerHalfWidth = Math.tan(outer / 2) * length;
        const innerHalfWidth = Math.tan(inner / 2) * length;
        const authoredWidth = Math.max(0, light.sourceRadius ?? 0, light.softSourceRadius ?? 0) * 0.32;
        const halfWidth = projection <= 0.01
            ? Math.min(4, Math.max(authoredWidth, 1.25))
            : Math.min(4, outerHalfWidth * 0.5, authoredWidth > 0 ? authoredWidth : Math.max(innerHalfWidth * 0.06, outerHalfWidth * 0.004, 1.25));
        const tangent = Math.tan(outer / 2);
        const offset = projection <= 0.01 ? 0 : Math.min(length * 0.24,
            Math.max(Math.max(0, light.sourceLength ?? 0) * 0.32, tangent > 0.0001 ? halfWidth / tangent : 0));
        const intensity = light.intensity ?? 0;
        const strength = intensity > 0 ? Math.max(0.35, Math.min(1, Math.log10(intensity + 1) / 1.6)) : 0.55;
        const beam = createFoxholeSpotlightBeamGraphics({ planarProjectionScale: projection, coneLength: length,
            baseOffsetPixels: offset, baseHalfWidthPixels: halfWidth, outerConeAngleRadians: outer, innerConeAngleRadians: inner,
            beamColorHex: light.lightColor ?? 'ffe3ac', beamStrength: strength,
            lightFalloffExponent: light.lightFalloffExponent, useInverseSquaredFalloff: light.useInverseSquaredFalloff });
        return [{ id: `debug-spotlight-${index}`, kind: 'group', x: light.x * 0.32, y: light.y * 0.32,
            rotation: light.rotation * Math.PI / 180, children: beam.map(node => ({ ...node, id: `${node.id}-${index}` })) }];
    });
    return children.length ? [{ id: 'structure-debug-spotlights', kind: 'group',
        ...foxholeRenderLane(FOXHOLE_STRUCTURE_RENDER_LANES.hitboxDebug),
        presentation: { contractVersion: 1, excludeFromBounds: true }, children }] : [];
}
