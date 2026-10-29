import type { NixieExtensionRenderNodeV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import { FOXHOLE_STRUCTURE_RENDER_LANES, foxholeRenderLane } from './render-lanes.ts';

export const FOXHOLE_MODIFICATION_SLOTS_SETTING_ID = 'foxhole.debug.structure.modificationSlots';

/** Render the catalog's modification anchors using the V1 debug marker. */
export function renderFoxholeModificationSlotOverlays(asset: FoxholeSceneV2AssetMetadata,
    settings: Readonly<Record<string, boolean>>, appearance: { destroyed: boolean; packaged: boolean; }): NixieExtensionRenderNodeV1[] {
    if (settings[FOXHOLE_MODIFICATION_SLOTS_SETTING_ID] !== true || appearance.destroyed || appearance.packaged) return [];
    const children: NixieExtensionRenderNodeV1[] = Object.entries(asset.modifications).flatMap(([id, slot], index) => {
        if (![slot.x, slot.y, slot.rotation].every(Number.isFinite)) return [];
        return [{ id: `modification-slot-${index}`, kind: 'group', x: slot.x, y: slot.y, rotation: slot.rotation,
            children: [{ id: `modification-slot-${index}-marker`, kind: 'graphics', commands: [
                { op: 'rect', x: -8, y: -8, width: 16, height: 16 },
                { op: 'fill', color: 0xff3b3b, alpha: 0.18 },
                { op: 'stroke', color: 0xff3b3b, alpha: 1, width: 2.5 },
                { op: 'rect', x: -3, y: -3, width: 6, height: 6 },
                { op: 'fill', color: 0xfff0f0, alpha: 1 },
                { op: 'move-to', x: 0, y: 0 }, { op: 'line-to', x: 28, y: 0 },
                { op: 'stroke', color: 0xff3b3b, alpha: 0.95, width: 2.5 },
                { op: 'circle', x: 28, y: 0, radius: 3 }, { op: 'fill', color: 0xff3b3b, alpha: 0.95 },
            ] }, { id: `modification-slot-${index}-label`, kind: 'text', text: (slot.name || id).slice(0, 128),
                x: 0, y: -12, anchorX: 0.5, anchorY: 1,
                style: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700', fill: 0xff3b3b } }] }];
    });
    return children.length ? [{ id: 'structure-modification-slots', kind: 'group',
        ...foxholeRenderLane(FOXHOLE_STRUCTURE_RENDER_LANES.hitboxDebug),
        experimentalPresentation: { contractVersion: 1, excludeFromBounds: true }, children }] : [];
}
