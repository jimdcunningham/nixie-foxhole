import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import type { SplinePathConstraints } from '#nixie/plugins/nixie/board/utils/spline-path.ts';
import type { FoxholeStructureAsset } from './catalog.ts';
import type { FoxholeManifestConnector, FoxholeManifestStructure } from './manifest.ts';
import {
    applyPipeEndpointRotationConstraints,
    usesPipeCurveScale,
} from './pipe-spline-constraints.ts';
import {
    allowsConnectorRotationHandles,
    getFoxholeSplineConnectorConstraints,
    isFoxholeSplineConnectorStructure,
    normalizeSplineRotationRadians,
    resolveDefaultEndRotation,
    usesSocketFacingEndRotation,
} from './spline-connector.ts';
import type { FoxholeSplineConnectorEndpoint, FoxholeSplineConnectorState } from './spline-connector.ts';
import { resolveStraightConnectorEndpointRotations } from './pipe-connector-path.ts';
import { createFoxholeSplineConnectorSnapshot } from './spline-connector-snapshot.ts';

function resolveConnectorPathStyle(
    connector?: FoxholeManifestConnector | null,
): string | undefined {
    const pathStyle = String(connector?.pathStyle ?? '').trim();
    return pathStyle || undefined;
}

export const SPLINE_CONNECTOR_GALLERY_VARIATION_COUNT = 8;
export const SPLINE_CONNECTOR_GALLERY_COLUMNS = SPLINE_CONNECTOR_GALLERY_VARIATION_COUNT;
export const SPLINE_CONNECTOR_GALLERY_MIN_CELL_WIDTH = 180;
export const SPLINE_CONNECTOR_GALLERY_MIN_CELL_HEIGHT = 140;
export const SPLINE_CONNECTOR_GALLERY_CELL_PADDING_X = 64;
export const SPLINE_CONNECTOR_GALLERY_CELL_PADDING_Y = 56;
export const SPLINE_CONNECTOR_GALLERY_TRIM_PADDING = 80;

export interface SplineConnectorCatalogEntry {
    asset: FoxholeStructureAsset;
    structure: FoxholeManifestStructure;
}

export interface SplineConnectorFixturePlacement {
    label: string;
    nodeRotation: number;
    curveT?: number;
    start: FoxholeSplineConnectorEndpoint;
    end: FoxholeSplineConnectorEndpoint;
}

interface SplineConnectorFixtureSpec {
    label: string;
    direction: number;
    lengthFactor: number;
    nodeRotation?: number;
    startRotationOffset?: number;
    endRotationOffset?: number;
    curveT?: number;
}

const STRAIGHT_FIXTURE_SPECS: readonly SplineConnectorFixtureSpec[] = [
    { label: 'Min Length', direction: 0, lengthFactor: 0 },
    { label: 'Medium Horizontal', direction: 0, lengthFactor: 0.35 },
    { label: 'Long Horizontal', direction: 0, lengthFactor: 0.72 },
    { label: 'Diagonal', direction: Math.PI / 4, lengthFactor: 0.5 },
    { label: 'Vertical', direction: Math.PI / 2, lengthFactor: 0.5 },
    { label: 'Rotated Node', direction: 0, lengthFactor: 0.45, nodeRotation: Math.PI / 2 },
    { label: 'Steep Angle', direction: -Math.PI / 3, lengthFactor: 0.55 },
    { label: 'Reverse', direction: Math.PI, lengthFactor: 0.4 },
];

const CURVED_FIXTURE_SPECS: readonly SplineConnectorFixtureSpec[] = [
    { label: 'Min Length', direction: 0, lengthFactor: 0 },
    { label: 'Medium Horizontal', direction: 0, lengthFactor: 0.35 },
    { label: 'Long Horizontal', direction: 0, lengthFactor: 0.72 },
    { label: 'Diagonal', direction: Math.PI / 4, lengthFactor: 0.5 },
    { label: 'Vertical', direction: Math.PI / 2, lengthFactor: 0.5 },
    { label: 'Gentle Curve', direction: 0, lengthFactor: 0.58, startRotationOffset: -Math.PI / 6, endRotationOffset: Math.PI / 6 },
    { label: 'S-Curve', direction: 0, lengthFactor: 0.62, startRotationOffset: Math.PI / 5, endRotationOffset: -Math.PI / 5 },
    { label: 'Right Turn', direction: 0, lengthFactor: 0.55, startRotationOffset: 0, endRotationOffset: Math.PI / 2, curveT: 1 },
];

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function resolveDisplayLength(minLength: number, maxLength: number, lengthFactor: number): number {
    const maxDisplay = Math.min(maxLength, Math.max(minLength * 3, 420));
    return minLength + ((maxDisplay - minLength) * clamp(lengthFactor, 0, 1));
}

function resolveFixtureSpec(
    variationIndex: number,
    allowsRotationHandles: boolean,
): SplineConnectorFixtureSpec {
    const specs = allowsRotationHandles ? CURVED_FIXTURE_SPECS : STRAIGHT_FIXTURE_SPECS;
    return specs[variationIndex % specs.length]!;
}

function resolveEndpointRotations(
    start: FoxholeSplineConnectorEndpoint,
    end: FoxholeSplineConnectorEndpoint,
    foxholeKey: string,
    pathStyle: string | undefined,
    constraints: SplinePathConstraints,
    spec: SplineConnectorFixtureSpec,
    allowsRotationHandles: boolean,
): { start: FoxholeSplineConnectorEndpoint; end: FoxholeSplineConnectorEndpoint; } {
    if (!allowsRotationHandles) {
        const rotations = resolveStraightConnectorEndpointRotations(start, end, foxholeKey);
        return {
            start: { ...start, rotation: rotations.startRotation },
            end: { ...end, rotation: rotations.endRotation },
        };
    }

    const chordRotation = Math.atan2(end.y - start.y, end.x - start.x);
    let nextStart: FoxholeSplineConnectorEndpoint = {
        ...start,
        rotation: normalizeSplineRotationRadians(chordRotation + (spec.startRotationOffset ?? 0)),
    };
    let nextEnd: FoxholeSplineConnectorEndpoint = {
        ...end,
        rotation: normalizeSplineRotationRadians(
            resolveDefaultEndRotation(start, end, foxholeKey) + (spec.endRotationOffset ?? 0),
        ),
    };

    if (usesSocketFacingEndRotation(foxholeKey) || constraints.maxTargetAngleDeg != null) {
        const constrained = applyPipeEndpointRotationConstraints(nextStart, nextEnd, {
            curveT: spec.curveT,
            maxTargetAngleDeg: constraints.maxTargetAngleDeg,
        });
        nextStart = constrained.start;
        nextEnd = constrained.end;
    }

    return { start: nextStart, end: nextEnd };
}

export function resolveSplineConnectorFixturePlacement(
    variationIndex: number,
    foxholeKey: string,
    structure: FoxholeManifestStructure,
    constraints: SplinePathConstraints,
): SplineConnectorFixturePlacement {
    const pathStyle = resolveConnectorPathStyle(structure.connector);
    const allowsRotationHandles = allowsConnectorRotationHandles(pathStyle, foxholeKey, {
        maxArcAngleDeg: structure.connector?.maxArcAngleDeg,
    });
    const spec = resolveFixtureSpec(variationIndex, allowsRotationHandles);
    const length = resolveDisplayLength(
        constraints.minLength ?? 48,
        constraints.maxLength ?? 420,
        spec.lengthFactor,
    );
    const start: FoxholeSplineConnectorEndpoint = { x: 0, y: 0, rotation: 0 };
    const end: FoxholeSplineConnectorEndpoint = {
        x: Math.cos(spec.direction) * length,
        y: Math.sin(spec.direction) * length,
        rotation: 0,
    };
    const endpoints = resolveEndpointRotations(
        start,
        end,
        foxholeKey,
        pathStyle,
        constraints,
        spec,
        allowsRotationHandles,
    );

    return {
        label: spec.label,
        nodeRotation: spec.nodeRotation ?? 0,
        ...(usesPipeCurveScale(pathStyle, foxholeKey) && spec.curveT !== undefined
            ? { curveT: spec.curveT }
            : {}),
        start: endpoints.start,
        end: endpoints.end,
    };
}

export function buildSplineConnectorFixtureSnapshot(
    entry: SplineConnectorCatalogEntry,
    variationIndex: number,
    position: { x: number; y: number; },
): BoardNodeSnapshot<FoxholeSplineConnectorState> {
    const pathStyle = resolveConnectorPathStyle(entry.structure.connector);
    const previewSnapshot = createFoxholeSplineConnectorSnapshot({
        foxholeKey: entry.asset.foxholeKey,
        structure: entry.structure,
    });
    const constraints = getFoxholeSplineConnectorConstraints(previewSnapshot.state, pathStyle);
    const placement = resolveSplineConnectorFixturePlacement(
        variationIndex,
        entry.asset.foxholeKey,
        entry.structure,
        constraints,
    );

    return createFoxholeSplineConnectorSnapshot({
        foxholeKey: entry.asset.foxholeKey,
        structure: entry.structure,
        label: `${entry.asset.name} · ${placement.label}`,
        x: position.x,
        y: position.y,
        rotation: placement.nodeRotation,
        start: placement.start,
        end: placement.end,
        curveT: placement.curveT,
    });
}

export function resolveSplineConnectorFixtureCellSize(
    entry: SplineConnectorCatalogEntry,
    variationIndex: number,
): { width: number; height: number; } {
    const pathStyle = resolveConnectorPathStyle(entry.structure.connector);
    const previewSnapshot = createFoxholeSplineConnectorSnapshot({
        foxholeKey: entry.asset.foxholeKey,
        structure: entry.structure,
    });
    const constraints = getFoxholeSplineConnectorConstraints(previewSnapshot.state, pathStyle);
    const placement = resolveSplineConnectorFixturePlacement(
        variationIndex,
        entry.asset.foxholeKey,
        entry.structure,
        constraints,
    );
    const rotation = placement.nodeRotation;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const transform = (localX: number, localY: number) => ({
        x: (localX * cos) - (localY * sin),
        y: (localX * sin) + (localY * cos),
    });

    const localPoints = [
        transform(placement.start.x, placement.start.y),
        transform(placement.end.x, placement.end.y),
    ];
    const chordLength = Math.hypot(
        placement.end.x - placement.start.x,
        placement.end.y - placement.start.y,
    );
    const allowsRotationHandles = allowsConnectorRotationHandles(pathStyle, entry.asset.foxholeKey, {
        maxArcAngleDeg: entry.structure?.connector?.maxArcAngleDeg,
    });
    const curveBulge = allowsRotationHandles
        ? Math.max(constraints.minRadius ?? 24, chordLength * 0.42)
        : Math.max(24, chordLength * 0.08);

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const point of localPoints) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    }

    const spanPadding = SPLINE_CONNECTOR_GALLERY_TRIM_PADDING + curveBulge;

    return {
        width: Math.max(
            SPLINE_CONNECTOR_GALLERY_MIN_CELL_WIDTH,
            (maxX - minX) + (spanPadding * 2),
        ),
        height: Math.max(
            SPLINE_CONNECTOR_GALLERY_MIN_CELL_HEIGHT,
            (maxY - minY) + (spanPadding * 2),
        ),
    };
}

export function getSplineConnectorCatalogEntries(
    catalog: {
        assets: readonly FoxholeStructureAsset[];
        structureByKey: Record<string, FoxholeManifestStructure | undefined>;
    },
): SplineConnectorCatalogEntry[] {
    return catalog.assets
        .map(asset => {
            const structure = catalog.structureByKey[asset.foxholeKey];
            if (!structure || !isFoxholeSplineConnectorStructure(structure)) {
                return null;
            }

            return { asset, structure };
        })
        .filter((entry): entry is SplineConnectorCatalogEntry => entry != null)
        .sort((left, right) => left.asset.name.localeCompare(right.asset.name));
}

export function getSplineConnectorSnapshotBounds(
    snapshot: BoardNodeSnapshot<FoxholeSplineConnectorState>,
): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
} {
    const state = snapshot.state;
    const rotation = Number(state.rotation ?? 0);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const transform = (localX: number, localY: number) => ({
        x: state.x + ((localX * cos) - (localY * sin)),
        y: state.y + ((localX * sin) + (localY * cos)),
    });

    const points = [
        transform(state.start.x, state.start.y),
        transform(state.end.x, state.end.y),
    ];
    const chordLength = Math.hypot(state.end.x - state.start.x, state.end.y - state.start.y);
    const padding = Math.max(56, chordLength * 0.35, state.minRadius * 2);

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const point of points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    }

    return {
        minX: minX - padding,
        minY: minY - padding,
        maxX: maxX + padding,
        maxY: maxY + padding,
    };
}
