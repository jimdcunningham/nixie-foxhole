import type { NixieExtensionRenderNodeV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import { FOXHOLE_STRUCTURE_RENDER_LANES, foxholeRenderLane } from './render-lanes.ts';

const VOLUME_COLORS: Record<string, { fill: number; stroke: number; }> = {
    footprint: { fill: 0x00e5a8, stroke: 0x6effe2 }, useArea: { fill: 0x1dd3b0, stroke: 0x6effe2 },
    seatTrigger: { fill: 0xe9c46a, stroke: 0xffe6a7 },
    killVolume: { fill: 0xd7263d, stroke: 0xff90a1 }, garageFootprint: { fill: 0xff9f1c, stroke: 0xffd08a },
    parkingSpot: { fill: 0x3a86ff, stroke: 0xa7c8ff }, loadingArea: { fill: 0x8338ec, stroke: 0xd1b3ff },
    interiorArea: { fill: 0x2a9d8f, stroke: 0x9be7de }, noBuild: { fill: 0x6c757d, stroke: 0xcdd3d8 },
    docking: { fill: 0x118ab2, stroke: 0x9de7ff }, temperature: { fill: 0xfb5607, stroke: 0xffc19a },
    passenger: { fill: 0x8ac926, stroke: 0xd5f39f }, iceBlocker: { fill: 0x70d6ff, stroke: 0xd5f5ff },
    other: { fill: 0xb8b8ff, stroke: 0xececff },
};
export const FOXHOLE_STRUCTURE_VOLUME_SETTING_IDS = Object.keys(VOLUME_COLORS).map(category => `foxhole.debug.structure.volume.${category}`);

/** Render authored component half-extents in the same 2D units and colors as V1. */
export function renderFoxholeStructureVolumeOverlays(asset: FoxholeSceneV2AssetMetadata,
    settings: Readonly<Record<string, boolean>>, appearance: { destroyed: boolean; packaged: boolean; }): NixieExtensionRenderNodeV1[] {
    if (appearance.destroyed || appearance.packaged) return [];
    const children: NixieExtensionRenderNodeV1[] = (asset.structureVolumes ?? []).flatMap((volume, index) => {
        const color = VOLUME_COLORS[volume.category] ?? VOLUME_COLORS.other!;
        if (settings[`foxhole.debug.structure.volume.${volume.category}`] !== true) return [];
        const width = volume.width * 0.32, height = volume.length * 0.32;
        if (![volume.x, volume.y, width, height, volume.rotation].every(Number.isFinite) || width <= 0 || height <= 0) return [];
        return [{ id: `structure-volume-${index}`, kind: 'group', x: volume.x * 0.32, y: volume.y * 0.32,
            rotation: volume.rotation * Math.PI / 180, children: [
                { id: `structure-volume-${index}-shape`, kind: 'graphics', commands: [
                    { op: 'rect', x: -width, y: -height, width: width * 2, height: height * 2 },
                    { op: 'fill', color: color.fill, alpha: 0.16 }, { op: 'stroke', color: color.stroke, alpha: 0.95, width: 3 },
                ] },
                { id: `structure-volume-${index}-label`, kind: 'text', text: volume.label.slice(0, 128), x: -width + 6, y: -height + 6,
                    style: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700', fill: color.stroke } },
            ] }];
    });
    return children.length ? [{ id: 'structure-volume-overlays', kind: 'group',
        ...foxholeRenderLane(FOXHOLE_STRUCTURE_RENDER_LANES.hitboxDebug),
        presentation: { contractVersion: 1, excludeFromBounds: true }, children }] : [];
}
