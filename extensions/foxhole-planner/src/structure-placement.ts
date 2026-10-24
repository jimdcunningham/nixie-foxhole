import type {
    NixieExperimentalComponentEntitySnapshotV1,
    NixieExperimentalEntityRendererContextV1,
    NixieExperimentalSpatialPlanV1,
    NixieExtensionRenderNodeV1,
} from '@nixiejs/extension-sdk/experimental/scene-v2';
import { resolveFoxholeSceneV2WorldMatrices } from './scene-v2-attachments.ts';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import {
    foxholeFootprintPolygons,
    foxholePointInPolygon,
    foxholePolygonArea,
    foxholePolygonsOverlap,
} from './scene-v2-footprints.ts';
import type { FoxholeSceneV2Point } from './scene-v2-footprints.ts';
import { FOXHOLE_STRUCTURE_RENDER_LANES, foxholeRenderLane } from './render-lanes.ts';

export const FOXHOLE_PLACEMENT_WARNING_SETTING_ID = 'nixie.foxhole-planner.debug.placementWarnings';

export const FOXHOLE_PLACEMENT_OVERLAP_COLOR = 0xEF4444;
export const FOXHOLE_PLACEMENT_FOUNDATION_COLOR = 0xF59E0B;
const FOUNDATION_SAMPLE_INTERVAL = 32;

export interface FoxholeStructurePlacementState {
    overlapEntityIds: string[];
    requiresFoundation: boolean;
    foundationSupported: boolean;
}

function componentData(entity: NixieExperimentalComponentEntitySnapshotV1, ownerId: string, componentId: string) {
    return entity.components.find(component => component.ownerId === ownerId && component.componentId === componentId
        && component.definitionAvailable)?.data;
}

function entityAsset(
    entity: NixieExperimentalComponentEntitySnapshotV1,
    metadata: Record<string, FoxholeSceneV2AssetMetadata>,
): FoxholeSceneV2AssetMetadata | undefined {
    const assetId = componentData(entity, 'nixie.foxhole-planner', 'asset')?.assetId;
    return typeof assetId === 'string' ? metadata[assetId] : undefined;
}

function isSpline(entity: NixieExperimentalComponentEntitySnapshotV1): boolean {
    return Boolean(componentData(entity, 'nixie.foxhole-planner', 'spline-connector'));
}

function polygonSamples(polygon: readonly FoxholeSceneV2Point[]): FoxholeSceneV2Point[] {
    const samples = [...polygon];
    for (let index = 0; index < polygon.length; index++) {
        const start = polygon[index]!;
        const end = polygon[(index + 1) % polygon.length]!;
        const count = Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / FOUNDATION_SAMPLE_INTERVAL);
        for (let step = 1; step < count; step++) {
            const t = step / count;
            samples.push({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
        }
    }
    const minX = Math.min(...polygon.map(point => point.x));
    const maxX = Math.max(...polygon.map(point => point.x));
    const minY = Math.min(...polygon.map(point => point.y));
    const maxY = Math.max(...polygon.map(point => point.y));
    for (let x = minX + FOUNDATION_SAMPLE_INTERVAL / 2; x < maxX; x += FOUNDATION_SAMPLE_INTERVAL) {
        for (let y = minY + FOUNDATION_SAMPLE_INTERVAL / 2; y < maxY; y += FOUNDATION_SAMPLE_INTERVAL) {
            const point = { x, y };
            if (foxholePointInPolygon(point, polygon)) {
                samples.push(point);
            }
        }
    }
    samples.push({
        x: polygon.reduce((total, point) => total + point.x, 0) / polygon.length,
        y: polygon.reduce((total, point) => total + point.y, 0) / polygon.length,
    });
    return samples;
}

function largestPolygon(polygons: FoxholeSceneV2Point[][]): FoxholeSceneV2Point[] | undefined {
    return polygons.reduce<FoxholeSceneV2Point[] | undefined>((largest, polygon) => (
        !largest || foxholePolygonArea(polygon) > foxholePolygonArea(largest) ? polygon : largest
    ), undefined);
}

interface FoxholePlacementSceneEntry {
    entity: NixieExperimentalComponentEntitySnapshotV1;
    asset?: FoxholeSceneV2AssetMetadata;
    footprints: FoxholeSceneV2Point[][];
    foundationSurface?: FoxholeSceneV2Point[];
    spline: boolean;
}

interface FoxholePlacementBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

const placementSceneCache = new WeakMap<Record<string, FoxholeSceneV2AssetMetadata>, {
    key: string;
    states: Map<string, FoxholeStructurePlacementState>;
}>();

function placementBounds(polygons: readonly FoxholeSceneV2Point[][]): FoxholePlacementBounds | undefined {
    const points = polygons.flat();
    return points.length
        ? {
            minX: Math.min(...points.map(point => point.x)),
            minY: Math.min(...points.map(point => point.y)),
            maxX: Math.max(...points.map(point => point.x)),
            maxY: Math.max(...points.map(point => point.y)),
        }
        : undefined;
}

function boundsOverlap(left: FoxholePlacementBounds | undefined, right: FoxholePlacementBounds | undefined): boolean {
    return Boolean(left && right && left.minX < right.maxX && left.maxX > right.minX
        && left.minY < right.maxY && left.maxY > right.minY);
}

function placementSceneKey(context: NixieExperimentalEntityRendererContextV1): string {
    return context.entities.map(entity => `${entity.entityId.length}:${entity.entityId}:${entity.revision}`).join('|');
}

function resolvePlacementScene(
    context: NixieExperimentalEntityRendererContextV1,
    metadata: Record<string, FoxholeSceneV2AssetMetadata>,
): Map<string, FoxholeStructurePlacementState> {
    const key = placementSceneKey(context);
    const cached = placementSceneCache.get(metadata);
    if (cached?.key === key) {
        return cached.states;
    }
    const matrices = resolveFoxholeSceneV2WorldMatrices(context);
    const entries: FoxholePlacementSceneEntry[] = context.entities.map(entity => {
        const asset = entityAsset(entity, metadata);
        const world = matrices.get(entity.entityId);
        const spline = isSpline(entity);
        const footprints = asset && world && !asset.isVehicle && !asset.isItem && !spline
            ? foxholeFootprintPolygons(asset, world)
            : [];
        return {
            entity,
            asset,
            footprints,
            spline,
            foundationSurface: asset?.category === 'foundation' ? largestPolygon(footprints) : undefined,
        };
    });
    const foundations = entries.flatMap(entry => entry.foundationSurface ? [entry.foundationSurface] : []);
    const bounds = new Map(entries.map(entry => [entry.entity.entityId, placementBounds(entry.footprints)]));
    const states = new Map(entries.map((entry): [string, FoxholeStructurePlacementState] => {
        const requiresFoundation = entry.asset?.requiresFoundation === true;
        if (!entry.asset || entry.asset.isVehicle || entry.asset.isItem || entry.spline) {
            return [entry.entity.entityId,
                { overlapEntityIds: [], requiresFoundation, foundationSupported: !requiresFoundation }];
        }
        if (!entry.footprints.length) {
            return [entry.entity.entityId,
                { overlapEntityIds: [], requiresFoundation, foundationSupported: true }];
        }
        const entryIsFoundation = entry.asset.category === 'foundation';
        const overlapEntityIds = entries.flatMap(candidate => {
            if (candidate.entity.entityId === entry.entity.entityId || !candidate.asset
                || entryIsFoundation !== (candidate.asset.category === 'foundation')
                || !boundsOverlap(bounds.get(entry.entity.entityId), bounds.get(candidate.entity.entityId))) {
                return [];
            }
            const overlaps = entry.footprints.some(subject => candidate.footprints.some(candidatePolygon => (
                foxholePolygonsOverlap(subject, candidatePolygon)
            )));
            return overlaps ? [candidate.entity.entityId] : [];
        });
        const foundationSupported = !requiresFoundation || entry.footprints.every(polygon => (
            polygonSamples(polygon).every(point => foundations.some(foundation => foxholePointInPolygon(point, foundation)))
        ));
        return [entry.entity.entityId, { overlapEntityIds, requiresFoundation, foundationSupported }];
    }));
    placementSceneCache.set(metadata, { key, states });
    return states;
}

/** Derive placement validity from authored build footprints without persisting planner-only state. */
export function resolveFoxholeStructurePlacement(
    entity: NixieExperimentalComponentEntitySnapshotV1,
    context: NixieExperimentalEntityRendererContextV1,
    metadata: Record<string, FoxholeSceneV2AssetMetadata>,
): FoxholeStructurePlacementState {
    const asset = entityAsset(entity, metadata);
    const requiresFoundation = asset?.requiresFoundation === true;
    return resolvePlacementScene(context, metadata).get(entity.entityId)
        ?? { overlapEntityIds: [], requiresFoundation, foundationSupported: !requiresFoundation };
}

export function renderFoxholeStructurePlacementOverlay(
    asset: FoxholeSceneV2AssetMetadata,
    state: FoxholeStructurePlacementState,
): NixieExtensionRenderNodeV1[] {
    const invalid = state.overlapEntityIds.length > 0 || !state.foundationSupported;
    if (!invalid) {
        return [];
    }
    const color = state.overlapEntityIds.length ? FOXHOLE_PLACEMENT_OVERLAP_COLOR : FOXHOLE_PLACEMENT_FOUNDATION_COLOR;
    return foxholeFootprintPolygons(asset).map((polygon, index) => ({
        id: `placement-invalid-${index}`,
        kind: 'graphics',
        ...foxholeRenderLane(FOXHOLE_STRUCTURE_RENDER_LANES.hitboxDebug),
        experimentalPresentation: { contractVersion: 1, excludeFromBounds: true },
        commands: [{ op: 'polygon', close: true, points: polygon },
            { op: 'fill', color, alpha: 0.18 }, { op: 'stroke', color, alpha: 1, width: 4, join: 'round' }],
    }));
}

export function renderFoxholeStructurePlacementSpatialOverlay(
    entity: NixieExperimentalComponentEntitySnapshotV1,
    asset: FoxholeSceneV2AssetMetadata,
    state: FoxholeStructurePlacementState,
): NixieExperimentalSpatialPlanV1 | undefined {
    const hasModel = entity.components.some(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'model' && component.definitionAvailable);
    const invalid = state.overlapEntityIds.length > 0 || !state.foundationSupported;
    if (!hasModel || !invalid) {
        return undefined;
    }
    const color = state.overlapEntityIds.length ? FOXHOLE_PLACEMENT_OVERLAP_COLOR : FOXHOLE_PLACEMENT_FOUNDATION_COLOR;
    const nodes = foxholeFootprintPolygons(asset).slice(0, 16).map((polygon, index) => ({
        id: `placement-${index}`,
        kind: 'line' as const,
        points: polygon.flatMap(point => [point.x, point.y, 2]),
        color,
        closed: true as const,
    }));
    return nodes.length
        ? { contractVersion: 1, supplementModel: true, nodes }
        : undefined;
}
