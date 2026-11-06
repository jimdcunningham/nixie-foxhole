import type { NixieExtensionRenderNodeV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import { FOXHOLE_STRUCTURE_RENDER_LANES, foxholeRenderLane } from './render-lanes.ts';

export const FOXHOLE_VEHICLE_SEATS_SETTING_ID = 'foxhole.debug.structure.vehicleSeats';
const SEAT_COLOR = 0xffd166;

function formatLabel(value: string): string {
    const trimmed = value.trim();
    const name = trimmed.slice(trimmed.lastIndexOf(':') + 1).replace(/_C$/i, '').replace(/Component$/i, '').replace(/_GEN_VARIABLE$/i, '');
    return name.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
}

/** Render authored vehicle seats as diagnostic markers without changing selection bounds. */
export function renderFoxholeVehicleSeatOverlays(asset: FoxholeSceneV2AssetMetadata,
    settings: Readonly<Record<string, boolean>>, appearance: { destroyed: boolean; packaged: boolean; }): NixieExtensionRenderNodeV1[] {
    if (settings[FOXHOLE_VEHICLE_SEATS_SETTING_ID] !== true || appearance.destroyed || appearance.packaged) return [];
    const children: NixieExtensionRenderNodeV1[] = (asset.vehicleSeats ?? []).flatMap((seat, index) => {
        if (![seat.x, seat.y, seat.rotation].every(Number.isFinite)) return [];
        const label = formatLabel(seat.seatType ?? '') || formatLabel(seat.name ?? '') || `Seat ${index + 1}`;
        const direction = formatLabel(seat.seatDirection ?? '');
        return [{ id: `vehicle-seat-${index}`, kind: 'group', x: seat.x, y: seat.y, rotation: seat.rotation,
            children: [{ id: `vehicle-seat-${index}-marker`, kind: 'graphics', commands: [
                { op: 'round-rect', x: -8, y: -6, width: 16, height: 12, radius: 3 },
                { op: 'fill', color: SEAT_COLOR, alpha: 0.18 }, { op: 'stroke', color: SEAT_COLOR, alpha: 0.98, width: 2.5 },
                { op: 'rect', x: -4, y: -3, width: 8, height: 6 }, { op: 'fill', color: 0xfff4cc, alpha: 1 },
                { op: 'move-to', x: 0, y: 0 }, { op: 'line-to', x: 26, y: 0 },
                { op: 'stroke', color: SEAT_COLOR, alpha: 0.95, width: 2.5 },
                { op: 'polygon', points: [{ x: 32, y: 0 }, { x: 22, y: -5 }, { x: 22, y: 5 }], close: true },
                { op: 'fill', color: SEAT_COLOR, alpha: 0.95 },
            ] }, { id: `vehicle-seat-${index}-label`, kind: 'text',
                text: (direction ? `${label} (${direction})` : label).slice(0, 128), x: 0, y: -12, anchorX: 0.5, anchorY: 1,
                presentation: { contractVersion: 1, worldUpright: true },
                style: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700', fill: SEAT_COLOR } }] }];
    });
    return children.length ? [{ id: 'structure-vehicle-seats', kind: 'group',
        ...foxholeRenderLane(FOXHOLE_STRUCTURE_RENDER_LANES.hitboxDebug),
        presentation: { contractVersion: 1, excludeFromBounds: true }, children }] : [];
}
