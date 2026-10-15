import { resolveFacilityPipeSideSocketsFromPath } from './connector-side-sockets.ts';
import { isWaterWallSpline } from '../../../../../../../extensions/foxhole-planner/src/water-wall-spline.ts';
import { isBarbedWireFence, sampleBarbedWireFencePath } from '../../../../../../../extensions/foxhole-planner/src/barbed-wire-fence.ts';
import {
    buildArcLengthTable,
} from '#nixie/plugins/nixie/board/utils/spline-path.ts';
import type { SplinePathConstraints, SplinePathEndpoint } from '#nixie/plugins/nixie/board/utils/spline-path.ts';
import { usesIntervalMarkerSpan,
    centimetersToFoxholeBoardPixels,
    isUndergroundPipe,
    normalizeSplineRotationRadians,
    resolveHybridPipeBezierEndRotation,
    resolveStraightConnectorFrontTrimRotation,
    resolveTrimDisplayRotation,
    usesFieldConnectorSpan,
    usesMineSplineConnector,
    usesSocketFacingEndRotation,
    usesTrimSpanSplineConnector } from './spline-connector.ts';
import type { ConnectorSplinePathSample, ConnectorTrimSocketRole } from './spline-ribbon-mesh.ts';
import {
    resolveConnectorEndpointRotations,
    resolveSpanTextureRepeatLength,
    resolveSpanTrimSocketInset,
    resolveTrimHalfLength,
    sampleConnectorSplinePath,
    resolveTrimSocketAnchor,

} from './spline-ribbon-mesh.ts';
import type { SpanTextureMapping } from './span-texture-mapping.ts';
import {
    blendConnectorPathSamples,
    sampleExtensionPipePath,
    usesPipeExtensionPath,
} from './pipe-extension-path.ts';
import { normalizePipeCurveT } from './pipe-spline-constraints.ts';
import {
    usesConnectorEndpointOnlyHitTesting,
} from './connector-behavior.ts';
import type { FoxholeManifestConnector, FoxholeManifestConnectorMeshConfig } from './manifest.ts';
import type { FoxholeStructureRenderLayerAsset } from './catalog.ts';

export {
    isConnectorEndpointHit,
    usesConnectorEndpointOnlyHitTesting,
} from './connector-behavior.ts';
export {
    allowsConnectorRotationHandles,
    resolveConnectorRampSpriteAnchor,
    resolveEffectiveConnectorPathStyle,
} from './spline-connector.ts';
export {
    resolveIntervalMarkerDistances,
    usesIntervalMarkerSpan,
} from './spline-connector.ts';
export { resolveIntervalMarkerSamples } from './interval-connector-path.ts';

export type FoxholeConnectorPathStyle
    = | 'endpoints-only'
        | 'straight-telescoping'
        | 'spline'
        | 'interval'
        | (string & {});

export type FoxholeConnectorTrimPlacement = 'handle' | 'socket-edge';

export interface FacilityPipeSideSocketPlacement {
    name: 'LeftSocket' | 'RightSocket';
    x: number;
    y: number;
    rotation: number;
}

export function resolveConnectorSpanCrossHalfWidth(
    spanLayer: FoxholeStructureRenderLayerAsset | undefined,
    spriteScale: number,
): number {
    // Texture height is the pipe cross-section; match ribbon / hit-test half-width.
    return Math.max(2, (spanLayer?.height ?? 16) * spriteScale * 0.5);
}

export function resolveFacilityPipeSideSocketPlacements(
    start: SplinePathEndpoint,
    end: SplinePathEndpoint,
    constraints: SplinePathConstraints,
    pathStyle: string | undefined,
    foxholeKey: string | undefined,
    options?: {
        lateralOffset?: number;
    },
): FacilityPipeSideSocketPlacement[] {
    if (String(foxholeKey ?? '').trim().toLowerCase() !== 'facilitypipe') {
        return [];
    }

    const sampled = sampleConnectorPath(start, end, constraints, pathStyle, { foxholeKey });
    return resolveFacilityPipeSideSocketsFromPath(sampled, options?.lateralOffset);
}

export function resolveConnectorTrimSpriteAnchor(
    layer: FoxholeStructureRenderLayerAsset | undefined,
    role: ConnectorTrimSocketRole,
    options?: {
        foxholeKey?: string;
        placement?: FoxholeConnectorTrimPlacement;
    },
): { x: number; y: number; } {
    if (options?.placement === 'handle' && usesTrimSpanSplineConnector(options.foxholeKey ?? '')) {
        return {
            x: 0.5,
            y: 0.5,
        };
    }

    return resolveTrimSocketAnchor(layer, role);
}

export function resolveConnectorPathStyle(
    connector?: FoxholeManifestConnector | null,
): FoxholeConnectorPathStyle | undefined {
    const pathStyle = String(connector?.pathStyle ?? '').trim();
    return pathStyle || undefined;
}

export function shouldRenderConnectorSpan(
    pathStyle?: string,
    connector?: import('./manifest.ts').FoxholeManifestConnector | null,
    foxholeKey?: string,
): boolean {
    // Underground pipes keep spline routing/handles, but only the end-cap trims are selectable visuals.
    if (isUndergroundPipe(String(foxholeKey ?? ''), connector) || pathStyle === 'endpoints-only') {
        return false;
    }

    return /^sandbag(?:half|full)spline$/iu.test(String(foxholeKey ?? ''))
        || !usesIntervalMarkerSpan(pathStyle, connector);
}

export function usesStraightChordPath(pathStyle?: string): boolean {
    return pathStyle === 'straight-telescoping' || pathStyle === 'endpoints-only';
}

export function usesStraightSampledConnectorPath(pathStyle?: string, foxholeKey?: string): boolean {
    return pathStyle === 'trench' || usesStraightChordPath(pathStyle)
        || usesMineSplineConnector(String(foxholeKey ?? ''))
        || String(foxholeKey ?? '').trim().toLowerCase().includes('cranerail');
}

export function resolveChordLength(start: SplinePathEndpoint, end: SplinePathEndpoint): number {
    return Math.hypot(end.x - start.x, end.y - start.y);
}

export function resolveChordRotation(start: SplinePathEndpoint, end: SplinePathEndpoint): number {
    return Math.atan2(end.y - start.y, end.x - start.x);
}

export function resolvePointAlongChord(
    start: SplinePathEndpoint,
    end: SplinePathEndpoint,
    distanceFromStart: number,
): { x: number; y: number; rotation: number; } {
    const length = Math.max(0, resolveChordLength(start, end));
    const rotation = resolveChordRotation(start, end);
    const clamped = Math.max(0, Math.min(length, distanceFromStart));
    const t = length > 0 ? clamped / length : 0;

    return {
        x: start.x + ((end.x - start.x) * t),
        y: start.y + ((end.y - start.y) * t),
        rotation,
    };
}

export function resolveStraightConnectorEndpointRotations(
    start: SplinePathEndpoint,
    end: SplinePathEndpoint,
    foxholeKey?: string,
): { startRotation: number; endRotation: number; } {
    const rotation = resolveChordRotation(start, end);
    return {
        startRotation: rotation,
        endRotation: usesSocketFacingEndRotation(String(foxholeKey ?? ''))
            ? normalizeSplineRotationRadians(rotation + Math.PI)
            : rotation,
    };
}

export function sampleStraightConnectorPath(
    start: SplinePathEndpoint,
    end: SplinePathEndpoint,
): ConnectorSplinePathSample {
    const points = [
        { x: start.x, y: start.y },
        { x: end.x, y: end.y },
    ];
    const lengths = buildArcLengthTable(points);

    return {
        points,
        lengths,
        totalLength: lengths[lengths.length - 1] ?? 0,
    };
}

function resolvePrimaryMeshConfig(
    meshConfigs: FoxholeManifestConnectorMeshConfig[] | undefined,
): FoxholeManifestConnectorMeshConfig | undefined {
    if (!meshConfigs?.length) {
        return undefined;
    }

    return meshConfigs.find(config => String(config.mode ?? '').toLowerCase().includes('spline'))
        ?? meshConfigs[0];
}

export function usesLayeredLandWallConnector(foxholeKey?: string): boolean {
    return /^wallsplinet[123]$/i.test(String(foxholeKey ?? '').trim());
}

export function resolveLandWallLayerMeshConfig(
    connector: FoxholeManifestConnector | undefined,
    layerId: 'barbedwire' | 'middlepillars',
): FoxholeManifestConnectorMeshConfig | undefined {
    return connector?.meshConfigs?.[layerId === 'barbedwire' ? 0 : 2];
}

export function resolveConnectorSpanTextureMapping(
    spanLayer: FoxholeStructureRenderLayerAsset,
    connector: FoxholeManifestConnector | undefined,
    texturePixelWidth?: number | null,
    pathStyle?: string,
    options?: { foxholeKey?: string; },
): SpanTextureMapping {
    const textureRepeatLength = resolveSpanTextureRepeatLength(spanLayer, texturePixelWidth);
    if (usesLayeredLandWallConnector(options?.foxholeKey)) {
        return {
            repeatLength: textureRepeatLength,
        };
    }

    const meshConfig = resolvePrimaryMeshConfig(connector?.meshConfigs);
    if (usesStraightChordPath(pathStyle)) {
        const intervalCm = Number(meshConfig?.interval ?? 0);
        if (intervalCm > 0) {
            return {
                repeatLength: Math.max(8, centimetersToFoxholeBoardPixels(intervalCm)),
                intervalCm,
            };
        }
    }

    return {
        repeatLength: textureRepeatLength,
    };
}

export function resolveConnectorSpanInsets(
    pathStyle: string | undefined,
    connector: FoxholeManifestConnector | undefined,
    backtrimLayer: FoxholeStructureRenderLayerAsset | undefined,
    fronttrimLayer: FoxholeStructureRenderLayerAsset | undefined,
    options?: {
        foxholeKey?: string;
    },
): { startInset: number; endInset: number; } {
    if (/^sandbag(?:half|full)spline$/iu.test(options?.foxholeKey ?? '')
        || options?.foxholeKey === 'barbedwirespline' || isBarbedWireFence(options?.foxholeKey)
        || isWaterWallSpline(options?.foxholeKey)) {
        // These spans reach the handle centers; posts and buoys cover their ends.
        return { startInset: 0, endInset: 0 };
    }
    if (pathStyle === 'straight-telescoping' && usesFieldConnectorSpan(options?.foxholeKey ?? '')) {
        return {
            startInset: 0,
            endInset: 0,
        };
    }

    if (pathStyle === 'straight-telescoping' && usesLayeredLandWallConnector(options?.foxholeKey)) {
        return {
            startInset: 0,
            endInset: 0,
        };
    }

    if (pathStyle === 'straight-telescoping') {
        const meshConfig = resolvePrimaryMeshConfig(connector?.meshConfigs);
        const startOffset = Math.max(0, centimetersToFoxholeBoardPixels(meshConfig?.startOffset ?? 0));
        const endOffset = Math.max(0, centimetersToFoxholeBoardPixels(meshConfig?.endOffset ?? 0));
        return {
            startInset: startOffset,
            endInset: endOffset,
        };
    }

    if (pathStyle === 'interval') {
        const intervalMeshConfig = connector?.meshConfigs?.find(config =>
            String(config.mode ?? '').toLowerCase().includes('interval'),
        ) ?? resolvePrimaryMeshConfig(connector?.meshConfigs);
        const startOffset = Math.max(0, centimetersToFoxholeBoardPixels(intervalMeshConfig?.startOffset ?? 0));
        const endOffset = Math.max(0, centimetersToFoxholeBoardPixels(intervalMeshConfig?.endOffset ?? 0));
        if (startOffset > 0 || endOffset > 0) {
            return {
                startInset: startOffset,
                endInset: endOffset,
            };
        }
    }

    return resolveSpanTrimSocketInset(backtrimLayer, fronttrimLayer);
}

export function resolveConnectorTrimPositions(
    start: SplinePathEndpoint,
    end: SplinePathEndpoint,
    pathStyle: string | undefined,
    connector: FoxholeManifestConnector | undefined,
    backtrimLayer: FoxholeStructureRenderLayerAsset | undefined,
    fronttrimLayer: FoxholeStructureRenderLayerAsset | undefined,
    options?: {
        foxholeKey?: string;
    },
): { backTrim: { x: number; y: number; rotation: number; }; frontTrim: { x: number; y: number; rotation: number; }; } {
    if (pathStyle === 'straight-telescoping') {
        const rotation = resolveChordRotation(start, end);

        return {
            backTrim: {
                x: start.x,
                y: start.y,
                rotation,
            },
            frontTrim: {
                x: end.x,
                y: end.y,
                rotation: resolveStraightConnectorFrontTrimRotation(rotation, options?.foxholeKey),
            },
        };
    }

    return {
        backTrim: {
            x: start.x,
            y: start.y,
            rotation: resolveTrimDisplayRotation(start.rotation, 'start', options?.foxholeKey),
        },
        frontTrim: {
            x: end.x,
            y: end.y,
            rotation: resolveTrimDisplayRotation(end.rotation, 'end', options?.foxholeKey),
        },
    };
}

function resolveHybridPipeBezierEndpoint(
    endpoint: SplinePathEndpoint,
    role: 'start' | 'end',
    foxholeKey?: string,
): SplinePathEndpoint {
    if (role !== 'end') {
        return endpoint;
    }

    return {
        ...endpoint,
        rotation: resolveHybridPipeBezierEndRotation(endpoint.rotation, foxholeKey),
    };
}

export function sampleHybridPipePath(
    start: SplinePathEndpoint,
    end: SplinePathEndpoint,
    constraints: SplinePathConstraints,
    options?: {
        foxholeKey?: string;
    },
): ConnectorSplinePathSample {
    // Underground stores tangent-aligned rotations; extension routing uses socket-facing angles.
    const routingEnd = isUndergroundPipe(String(options?.foxholeKey ?? ''))
        ? {
            ...end,
            rotation: normalizeSplineRotationRadians(end.rotation + Math.PI),
        }
        : end;
    const curveT = normalizePipeCurveT(constraints.curveT);
    const rigid = sampleExtensionPipePath(start, routingEnd, constraints);
    if (curveT <= 0) {
        return rigid;
    }

    const bezierEnd = resolveHybridPipeBezierEndpoint(routingEnd, 'end', options?.foxholeKey);
    const curved = sampleConnectorSplinePath(start, bezierEnd, {
        ...constraints,
        curveT: 1,
    });
    if (curveT >= 1) {
        return curved;
    }

    return blendConnectorPathSamples(rigid, curved, curveT);
}

export function sampleConnectorPath(
    start: SplinePathEndpoint,
    end: SplinePathEndpoint,
    constraints: SplinePathConstraints,
    pathStyle?: string,
    options?: {
        foxholeKey?: string;
    },
): ConnectorSplinePathSample {
    if (isBarbedWireFence(options?.foxholeKey)) {
        return sampleBarbedWireFencePath(start, end, constraints);
    }
    if (usesStraightSampledConnectorPath(pathStyle, options?.foxholeKey)) {
        return sampleStraightConnectorPath(start, end);
    }

    if (usesPipeExtensionPath(pathStyle, options?.foxholeKey)) {
        return sampleHybridPipePath(start, end, constraints, options);
    }

    return sampleConnectorSplinePath(start, end, constraints);
}

export function resolveConnectorEndpointRotationsForPathStyle(
    start: SplinePathEndpoint,
    end: SplinePathEndpoint,
    constraints: SplinePathConstraints,
    pathStyle?: string,
): { startRotation: number; endRotation: number; } {
    if (usesStraightChordPath(pathStyle)) {
        return resolveStraightConnectorEndpointRotations(start, end);
    }

    return resolveConnectorEndpointRotations(start, end, constraints);
}

export function resolveConnectorPathConstraints(
    constraints: SplinePathConstraints,
    pathStyle?: string,
): SplinePathConstraints {
    if (!usesStraightChordPath(pathStyle)) {
        return constraints;
    }

    return {
        ...constraints,
        minRadius: undefined,
        maxRadius: undefined,
        maxBuffer: undefined,
    };
}

export function resolveConnectorHitRadius(
    pathStyle: string | undefined,
    backtrimLayer: FoxholeStructureRenderLayerAsset | undefined,
    fronttrimLayer: FoxholeStructureRenderLayerAsset | undefined,
    spanLayer: FoxholeStructureRenderLayerAsset | undefined,
    spriteScale: number,
    options?: {
        foxholeKey?: string;
        connector?: import('./manifest.ts').FoxholeManifestConnector | null;
    },
): number {
    if (
        usesConnectorEndpointOnlyHitTesting(options?.foxholeKey, options?.connector)
        || pathStyle === 'endpoints-only'
    ) {
        return Math.max(
            resolveTrimHalfLength(backtrimLayer),
            resolveTrimHalfLength(fronttrimLayer),
            12,
        );
    }

    return Math.max(8, resolveConnectorSpanCrossHalfWidth(spanLayer, spriteScale));
}
