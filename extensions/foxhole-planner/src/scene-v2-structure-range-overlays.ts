import type { NixieExtensionGraphicsCommandV1, NixieExtensionRenderNodeV1, NixieExperimentalSpatialVolumeV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import type { FoxholeSceneV2AssetMetadata, FoxholeSceneV2StructureRange } from './scene-v2-asset-metadata.ts';
import { isFoxholeStructureRangeVisible, foxholeStructureRangeColor } from './structure-range-settings.ts';
import { FOXHOLE_RANGE_RENDER_LANE, foxholeRenderLane } from './render-lanes.ts';
import { createFoxholeNightRangePolygon, resolveFoxholeNightVisionRadius } from './night-ranges.ts';

function position(value: number | null | undefined): number {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? number * 32 : 0;
}
function distance(value: number | null | undefined): number | null {
    const number = Number(value ?? NaN);
    return Number.isFinite(number) ? number * 32 : null;
}

export function foxholeStructureRangeCommands(range: FoxholeSceneV2StructureRange, nightVisionRadius: number | null = null): { fill: NixieExtensionGraphicsCommandV1[]; stroke: NixieExtensionGraphicsCommandV1[]; overlapOnly: boolean; } | null {
    const color = foxholeStructureRangeColor(range.type);
    const x = position(range.x), y = position(range.y);
    const min = distance(range.min), sourceMax = distance(range.max), overlap = distance(range.overlap), reach = distance(range.reach);
    const max = min && min > 0 && x === 0 && y === 0 && nightVisionRadius !== null
        ? Math.min(sourceMax ?? 0,nightVisionRadius * 32) : sourceMax;
    if (min && max && min >= max) return null;
    const fill: NixieExtensionGraphicsCommandV1[] = [];
    const stroke: NixieExtensionGraphicsCommandV1[] = [];
    const circle = (target: NixieExtensionGraphicsCommandV1[], radius: number) => target.push({ op: 'circle', x, y, radius });
    const outline = (width = 3, alpha = 0.72) => stroke.push({ op: 'stroke', color, alpha, width, alignment: 0.5 });
    const hasCircle = Boolean(max && max > 0);
    const nightPolygon = createFoxholeNightRangePolygon(range, nightVisionRadius);
    if (nightPolygon?.length === 0) return null;
    if (nightPolygon) {
        const points = Array.from({ length: nightPolygon.length / 2 }, (_, index) => ({ x: nightPolygon[index * 2]! * 32, y: nightPolygon[index * 2 + 1]! * 32 }));
        fill.push({ op: 'polygon', points, close: true }, { op: 'fill', color, alpha: 0.15 });
        stroke.push({ op: 'polygon', points, close: true });
        outline();
    } else if (hasCircle) {
        const arc = Number(range.arc ?? NaN) * Math.PI / 180;
        const angle = Number(range.rotation ?? 0) * Math.PI / 180;
        if (Number.isFinite(arc) && arc > 0 && arc * 2 < Math.PI * 2 - 0.0001) {
            const path = (target: NixieExtensionGraphicsCommandV1[]) => {
                if (min && min > 0) {
                    target.push({ op: 'arc', x, y, radius: min, startAngle: angle + arc, endAngle: angle - arc, anticlockwise: true });
                } else {
                    target.push({ op: 'move-to', x, y });
                }
                target.push({ op: 'arc', x, y, radius: max!, startAngle: angle - arc, endAngle: angle + arc });
                target.push(min && min > 0 ? { op: 'close-path' } : { op: 'line-to', x, y });
            };
            path(fill);
            fill.push({ op: 'fill', color, alpha: 0.15 });
            path(stroke);
            outline();
        } else if (min && min > 0) {
            circle(fill, max!);
            fill.push({ op: 'fill', color, alpha: 0.15 });
            circle(fill, min);
            fill.push({ op: 'cut' });
            circle(stroke, max!);
            outline();
            circle(stroke, min);
            outline();
        } else {
            circle(fill, max!);
            fill.push({ op: 'fill', color, alpha: 0.15 });
            circle(stroke, max!);
            outline();
        }
    }
    if (overlap && overlap > 0) {
        circle(stroke, overlap);
        outline();
    }
    if (!hasCircle && overlap && overlap > 0) {
        return { fill, stroke, overlapOnly: true };
    }
    if (reach && max && reach > max) {
        circle(stroke, (max + reach) / 2);
        outline(Math.max(1, reach - max), 0.15);
    }
    return fill.length || stroke.length ? { fill, stroke, overlapOnly: false } : null;
}

function debugLabel(value: string): string {
    const trimmed = value.trim();
    const name = trimmed.slice(trimmed.lastIndexOf(':') + 1).replace(/_C$/i, '').replace(/Component$/i, '').replace(/_GEN_VARIABLE$/i, '');
    return name.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim() || name;
}

export function renderFoxholeStructureRange(range: FoxholeSceneV2StructureRange, prefix: string, nightVisionRadius: number | null = null): NixieExtensionRenderNodeV1 | null {
    const commands = foxholeStructureRangeCommands(range, nightVisionRadius);
    if (!commands) {
        return null;
    }
    const children: NixieExtensionRenderNodeV1[] = commands.overlapOnly
        ? [{ id: `${prefix}-stroke`, kind: 'graphics', commands: commands.stroke }]
        : [{ id: `${prefix}-fill`, kind: 'graphics', commands: commands.fill }, { id: `${prefix}-stroke`, kind: 'graphics', commands: commands.stroke }];
    if (!commands.overlapOnly) {
        const x = position(range.x), y = position(range.y);
        const min = distance(range.min), max = distance(range.max), overlap = distance(range.overlap), reach = distance(range.reach);
        const angle = Number(range.rotation ?? 0) * Math.PI / 180;
        const arc = Number(range.arc ?? NaN);
        const directed = Number.isFinite(arc) && arc > 0;
        const radius = directed ? Math.max(18, max ?? min ?? overlap ?? reach ?? 0) : Math.max(max ?? 0, overlap ?? 0, reach ?? 0, 18);
        const codeName = debugLabel(String(range.codeName ?? '')), type = debugLabel(range.type);
        children.push({ id: `${prefix}-label`, kind: 'text', text: codeName && type ? `${codeName} (${type})` : codeName || type || 'Range',
            visible: false, x: directed ? x + Math.cos(angle) * (radius + 10) : x, y: directed ? y + Math.sin(angle) * (radius + 10) : y - radius - 10,
            anchorX: directed ? Math.cos(angle) >= 0 ? 0 : 1 : 0.5, anchorY: directed ? 0.5 : 1,
            experimentalPresentation: { contractVersion: 1, worldUpright: true },
            style: { fontFamily: 'monospace', fontWeight: '700', fontSize: 11, fill: foxholeStructureRangeColor(range.type) } });
    }
    return { id: prefix, kind: 'group', children };
}

export function renderFoxholeStructureRangeOverlays(asset: FoxholeSceneV2AssetMetadata, settings: Readonly<Record<string, boolean>>,
    appearance: { destroyed: boolean; packaged: boolean; }): NixieExtensionRenderNodeV1[] {
    if (appearance.destroyed || appearance.packaged) {
        return [];
    }
    const always: NixieExtensionRenderNodeV1[] = [], selected: NixieExtensionRenderNodeV1[] = [];
    const projected = new Set(renderFoxholeStructureFiringVolumes(asset, settings, appearance).map(volume => Number(volume.id.match(/^firing-volume-(\d+)/)?.[1])));
    for (const [index, range] of (asset.ranges ?? []).entries()) {
        if (!isFoxholeStructureRangeVisible(range, settings, true, asset.isVehicle === true)) {
            continue;
        }
        const node = renderFoxholeStructureRange(range, `structure-range-${index}`, resolveFoxholeNightVisionRadius(asset, range, id => settings[id]));
        if (node) {
            // Keep ordinary 2D artwork, but never draw its unoccluded fill over the spatial cross-section.
            node.experimentalPresentation = { contractVersion: 1, groundOverlay: !projected.has(index) };
            (isFoxholeStructureRangeVisible(range, settings, false, asset.isVehicle === true) ? always : selected).push(node);
        }
    }
    return [[always, false], [selected, true]].flatMap(([children, selectionOnly], index) => (children as NixieExtensionRenderNodeV1[]).length
        ? [{
            id: index === 0 ? 'structure-ranges' : 'selected-structure-ranges', kind: 'group' as const, ...foxholeRenderLane(FOXHOLE_RANGE_RENDER_LANE),
            experimentalPresentation: { contractVersion: 1 as const, excludeFromBounds: true, selectionOnly: selectionOnly as boolean }, children: children as NixieExtensionRenderNodeV1[],
        }]
        : []);
}


/** Source envelopes remain available independently of their spatial presentation. */
export function createFoxholeStructureFiringEnvelopes(asset: FoxholeSceneV2AssetMetadata, settings: Readonly<Record<string, boolean>>,
    appearance: { destroyed: boolean; packaged: boolean; }): NixieExperimentalSpatialVolumeV1[] {
    if (appearance.destroyed || appearance.packaged || !asset.model) return [];
    return (asset.ranges ?? []).flatMap((range, index) => {
        const source = range.firingVolume;
        if (!source || (source.originSource === 'firing-component' && !source.coverage) || !range.type.startsWith('killbox')
            || !isFoxholeStructureRangeVisible(range, settings, true, asset.isVehicle === true)) return [];
        const max = distance(range.max), min = Math.max(0,distance(range.min) ?? 0);
        if (!max || min >= max || !source.origin.every(Number.isFinite) || source.origin.length !== 3
            || source.orientation.length !== 4 || !source.orientation.every(Number.isFinite)
            || Math.abs(Math.hypot(...source.orientation) - 1) > 0.001) return [];
        const shape = source.source !== 'mount-dynamic-data'
            ? Number.isFinite(source.coneHalfAngle) && source.coneHalfAngle > 0 && source.coneHalfAngle <= 180
                ? { kind: 'cone' as const, halfAngle: source.coneHalfAngle } : null
            : source.source === 'mount-dynamic-data' && [source.minYaw,source.maxYaw,source.minPitch,source.maxPitch].every(Number.isFinite)
                && source.maxYaw > source.minYaw && source.maxYaw - source.minYaw <= 360
                && source.minPitch >= -90 && source.maxPitch <= 90 && source.minPitch < source.maxPitch
                ? { kind: 'angular-envelope' as const, yaw: [source.minYaw,source.maxYaw] as [number,number], pitch: [source.minPitch,source.maxPitch] as [number,number] } : null;
        if (!shape) return [];
        const night = resolveFoxholeNightVisionRadius(asset,range,id => settings[id]);
        const coverage = source.source === 'ai-turret' ? source.coverage : undefined;
        const orientation = coverage?.orientation ?? source.orientation;
        if (orientation.length !== 4 || !orientation.every(Number.isFinite) || Math.abs(Math.hypot(...orientation)-1)>0.001) return [];
        const origins = coverage ? [coverage.origin] : source.muzzleOrigins ?? [source.origin];
        if (!origins.length || origins.length > 32 || origins.some(origin => origin.length !== 3 || !origin.every(Number.isFinite))) return [];
        // Keep the combined opacity of an overlapping salvo equal to one weapon envelope.
        const alpha = origins.length === 1 ? 0.10 : 1 - Math.pow(1 - 0.10, 1 / origins.length);
        return origins.map((origin, muzzleIndex) => ({ id: source.muzzleOrigins ? `firing-volume-${index}-muzzle-${muzzleIndex}` : `firing-volume-${index}`, ...shape,
            origin: origin.map((v,i) => v * 32 + (asset.model?.blueprintOrigin?.[(["x","y","z"] as const)[i]!] ?? 0)) as [number,number,number], orientation: [...orientation] as [number,number,number,number],
            minRadius: min, maxRadius: max, color: foxholeStructureRangeColor(range.type), alpha,
            selectionOnly: !isFoxholeStructureRangeVisible(range,settings,false,asset.isVehicle === true),
            ...(night === null ? {} : { clipCylinder: { center: [0,0] as [number,number], radius: night * 32 } }),
        }));
    });
}

/** Direct-fire coverage is a ground intersection, with model occlusion measured from the physical weapon.
 * Indirect fire and anti-air retain authored ground bands: straight aiming rays are not landing trajectories.
 */
export function renderFoxholeStructureFiringVolumes(asset: FoxholeSceneV2AssetMetadata, settings: Readonly<Record<string, boolean>>,
    appearance: { destroyed: boolean; packaged: boolean; }): NixieExperimentalSpatialVolumeV1[] {
    return createFoxholeStructureFiringEnvelopes(asset, settings, appearance).flatMap(volume => {
        const index = Number(volume.id.match(/^firing-volume-(\d+)/)?.[1]), range = asset.ranges?.[index];
        if (!range || ['killboxArty','killboxRocket','killboxAA'].includes(range.type)) return [];
        const source = range.firingVolume!;
        const eye = source.coverage ? source.origin.map((v,i) => v * 32 + (asset.model?.blueprintOrigin?.[(['x','y','z'] as const)[i]!] ?? 0))
            : volume.origin;
        return [{ ...volume, alpha: 0.15, groundProjection: settings['foxhole.structure.lineOfSight'] === true ? { lineOfSightOrigin: [...eye] as [number,number,number] } : {} }];
    });
}
