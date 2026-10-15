
import {
    buildArcLengthTable,
    evaluateCubicBezier,
    evaluateCubicBezierTangent,
    resolveSplineControlPoints,
    samplePointAlongSplinePath,
} from '@nixie/extension-sdk/experimental/scene-v2';
import type { SplinePathConstraints, SplinePathEndpoint } from '@nixie/extension-sdk/experimental/scene-v2';
const FOXHOLE_BOARD_SPRITE_SCALE = 0.5;
const centimetersToFoxholeBoardPixels = (value: number) => Math.max(0, value) * 0.32;
import type { SpanTextureMapping } from './span-texture-mapping.ts';
import { mapSpanTextureUAlong } from './span-texture-mapping.ts';
import { buildNativeSplineSurfaceMeshData } from './native-spline-surface.ts';
import type { NativeSplineSurface } from './native-spline-surface.ts';
export interface FoxholeStructureRenderLayerAsset {
    nativeSurface?: NativeSplineSurface;
    width?: number | null;
    height?: number | null;
    anchorX?: number | null;
    anchorY?: number | null;
    offsetY?: number | null;
}

export type { SpanTextureMapping } from './span-texture-mapping.ts';
export { mapSpanTextureUAlong } from './span-texture-mapping.ts';

export interface ConnectorSplinePathSample {
    points: Array<{ x: number; y: number; }>;
    lengths: number[];
    totalLength: number;
}

export interface BuildSplineRibbonMeshOptions {
    textureMaterialScale?: readonly number[] | null;
    spanLayer: FoxholeStructureRenderLayerAsset;
    textureRepeatLength?: number;
    textureMapping?: SpanTextureMapping;
    perpendicularOffset?: number;
    startInset?: number;
    endInset?: number;
    pathSample?: ConnectorSplinePathSample;
    centerTextureRepeats?: boolean;
    textureSlicing?: { repeatStartU: number; repeatEndU: number; tileBody?: boolean; bodyRepeatLength?: number; };
}

export function resolveConnectorSplineTextureSlicing(foxholeKey: string, layer: FoxholeStructureRenderLayerAsset, materialScale?: readonly number[] | null): BuildSplineRibbonMeshOptions['textureSlicing'] {
    if (layer.nativeSurface) return undefined;
    // The native road prototype is three 450cm panels at 64px/m. Gate on the
    // new frame so an older cached manifest cannot slice the former 320px tile.
    if (foxholeKey.toLowerCase() === 'facilityroad' && layer.width === 864) {
        const scaleY = Number(materialScale?.[1]);
        return { repeatStartU: 1 / 3, repeatEndU: 2 / 3, tileBody: true,
            bodyRepeatLength: Number.isFinite(scaleY) && scaleY > 0 ? 0.32 / scaleY : 144 };
    }
    return resolveSandbagSplineTextureSlicing(foxholeKey);
}

/** The published sandbag strips include distinct exposed ends, so only their interior can repeat. */
export function resolveSandbagSplineTextureSlicing(foxholeKey: string): BuildSplineRibbonMeshOptions['textureSlicing'] {
    switch (foxholeKey.toLowerCase()) {
        case 'sandbaghalfspline':
            return { repeatStartU: 45 / 270, repeatEndU: 225 / 270 };
        case 'sandbagfullspline':
            return { repeatStartU: 75 / 273, repeatEndU: 234 / 273 };
        default:
            return undefined;
    }
}

const TRIM_SOCKET_ANCHOR = { x: 0.5, y: 0.5 };
const TRIM_SOCKET_OVERLAP = 3;
const BEZIER_PARAMETER_STEPS = 96;
const MIN_ARC_SAMPLE_STEP = 1;
const MAX_ARC_SAMPLE_STEP = 4;

interface BezierArcLengthSample {
    x: number;
    y: number;
    tangent: number;
    distance: number;
}

export function sampleConnectorSplinePath(
    start: SplinePathEndpoint,
    end: SplinePathEndpoint,
    constraints: SplinePathConstraints,
): ConnectorSplinePathSample {
    const controlPoints = resolveSplineControlPoints(start, end, constraints);
    const parameterSteps = Math.max(
        32,
        Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 4),
        BEZIER_PARAMETER_STEPS,
    );
    const points: Array<{ x: number; y: number; }> = [];

    for (let index = 0; index <= parameterSteps; index += 1) {
        points.push(evaluateCubicBezier(controlPoints, index / parameterSteps));
    }

    const lengths = buildArcLengthTable(points);
    return {
        points,
        lengths,
        totalLength: lengths[lengths.length - 1] ?? 0,
    };
}

export function resolveConnectorEndpointRotations(
    start: SplinePathEndpoint,
    end: SplinePathEndpoint,
    constraints: SplinePathConstraints,
): { startRotation: number; endRotation: number; } {
    const sampled = sampleConnectorSplinePath(start, end, constraints);
    const startSample = samplePolylineArcLengthPoint(sampled, 0);
    const endSample = samplePolylineArcLengthPoint(sampled, sampled.totalLength);

    return {
        startRotation: startSample?.tangent ?? start.rotation,
        endRotation: endSample?.tangent ?? end.rotation,
    };
}

export function resolveSpanTextureRepeatLength(
    spanLayer: FoxholeStructureRenderLayerAsset,
    texturePixelWidth?: number | null,
): number {
    const pixels = Number(texturePixelWidth ?? spanLayer.width ?? NaN);
    if (!Number.isFinite(pixels) || pixels <= 0) {
        return 96;
    }

    return Math.max(8, pixels * FOXHOLE_BOARD_SPRITE_SCALE);
}

export function resolveSpanTrimSocketInset(
    backtrimLayer: FoxholeStructureRenderLayerAsset | undefined,
    fronttrimLayer: FoxholeStructureRenderLayerAsset | undefined,
): { startInset: number; endInset: number; } {
    return {
        startInset: resolveTrimInsetTowardSpan(backtrimLayer, 'back'),
        endInset: resolveTrimInsetTowardSpan(fronttrimLayer, 'front'),
    };
}

function sampleBezierArcLengthPoint(
    controlPoints: ReturnType<typeof resolveSplineControlPoints>,
    sampled: ConnectorSplinePathSample,
    distance: number,
): BezierArcLengthSample | null {
    const polylineSample = samplePointAlongSplinePath(sampled.points, sampled.lengths, distance);
    if (!polylineSample || sampled.points.length < 2) {
        return null;
    }

    let segmentIndex = 1;
    for (; segmentIndex < sampled.lengths.length; segmentIndex += 1) {
        if (distance <= sampled.lengths[segmentIndex]!) {
            break;
        }
    }

    const startDistance = sampled.lengths[segmentIndex - 1] ?? 0;
    const endDistance = sampled.lengths[segmentIndex] ?? startDistance;
    const from = sampled.points[segmentIndex - 1]!;
    const to = sampled.points[segmentIndex] ?? from;
    const segmentLength = Math.max(Number.EPSILON, endDistance - startDistance);
    const segmentT = (polylineSample.distance - startDistance) / segmentLength;
    const coarseSteps = sampled.points.length - 1;
    const bezierT = Math.min(1, Math.max(0, ((segmentIndex - 1) + segmentT) / coarseSteps));
    const point = evaluateCubicBezier(controlPoints, bezierT);

    return {
        x: point.x,
        y: point.y,
        tangent: evaluateCubicBezierTangent(controlPoints, bezierT),
        distance: polylineSample.distance,
    };
}

function resolveSpanHalfWidth(spanLayer: FoxholeStructureRenderLayerAsset): number {
    const height = Number(spanLayer.height ?? NaN);
    if (Number.isFinite(height) && height > 0) {
        return Math.max(2, height * FOXHOLE_BOARD_SPRITE_SCALE * 0.5);
    }

    return 9.5;
}

function resolveSpanPerpendicularOffset(spanLayer: FoxholeStructureRenderLayerAsset): number {
    const offsetY = Number(spanLayer.offsetY ?? 0);
    return Number.isFinite(offsetY) ? offsetY * FOXHOLE_BOARD_SPRITE_SCALE : 0;
}

export function resolveTrimHalfLength(layer: FoxholeStructureRenderLayerAsset | undefined): number {
    if (!layer) {
        return 0;
    }

    const width = Number(layer.width ?? NaN);
    if (!Number.isFinite(width) || width <= 0) {
        return 0;
    }

    return width * FOXHOLE_BOARD_SPRITE_SCALE * 0.5;
}

export function resolveTrimLayerAnchor(
    layer: FoxholeStructureRenderLayerAsset | undefined,
): { x: number; y: number; } {
    const anchorX = Number(layer?.anchorX ?? TRIM_SOCKET_ANCHOR.x);
    const anchorY = Number(layer?.anchorY ?? TRIM_SOCKET_ANCHOR.y);

    return {
        x: Number.isFinite(anchorX) ? anchorX : TRIM_SOCKET_ANCHOR.x,
        y: Number.isFinite(anchorY) ? anchorY : TRIM_SOCKET_ANCHOR.y,
    };
}

export type ConnectorTrimSocketRole = 'back' | 'front';

export function resolveTrimSocketAnchor(
    layer: FoxholeStructureRenderLayerAsset | undefined,
    role: ConnectorTrimSocketRole,
): { x: number; y: number; } {
    const anchor = resolveTrimLayerAnchor(layer);

    if (role === 'back') {
        // Centered manifest anchors (facilitypipe backtrim ax=0.5) encode composite layout,
        // not the runtime socket. Pin the socket-facing edge to the start endpoint.
        if (anchor.x > 0.1 && anchor.x < 0.9) {
            return {
                x: 0,
                y: anchor.y,
            };
        }

        return {
            x: Math.max(0, Math.min(1, anchor.x)),
            y: anchor.y,
        };
    }

    // Front-trim component renders already include mirror/rotation. Manifest anchorX
    // encodes composite layout (often centered or negative) rather than a runtime
    // socket anchor. Pin centered / out-of-range values to the end-edge socket.
    if (anchor.x > 0.1 && anchor.x < 0.9) {
        return {
            x: 1,
            y: anchor.y,
        };
    }

    if (anchor.x < 0 || anchor.x > 1) {
        return {
            x: 1,
            y: anchor.y,
        };
    }

    return {
        x: 1 - anchor.x,
        y: anchor.y,
    };
}

export function resolveTrimInsetTowardSpan(
    layer: FoxholeStructureRenderLayerAsset | undefined,
    role: ConnectorTrimSocketRole,
): number {
    return Math.max(0, resolveTrimExtentAlongPipe(layer, role) - TRIM_SOCKET_OVERLAP);
}

export function resolveTrimExtentAlongPipe(
    layer: FoxholeStructureRenderLayerAsset | undefined,
    role: ConnectorTrimSocketRole,
): number {
    if (!layer) {
        return 0;
    }

    const width = Number(layer.width ?? NaN);
    if (!Number.isFinite(width) || width <= 0) {
        return 0;
    }

    const anchor = resolveTrimSocketAnchor(layer, role);
    const scaledWidth = width * FOXHOLE_BOARD_SPRITE_SCALE;
    const extent = role === 'back'
        ? scaledWidth * (1 - anchor.x)
        : scaledWidth * anchor.x;

    return Math.max(extent, resolveTrimHalfLength(layer));
}

export interface PolylineArcLengthSample {
    x: number;
    y: number;
    tangent: number;
    distance: number;
}

export function samplePolylineArcLengthPoint(
    sampled: ConnectorSplinePathSample,
    distance: number,
): PolylineArcLengthSample | null {
    const polylineSample = samplePointAlongSplinePath(sampled.points, sampled.lengths, distance);
    if (!polylineSample || sampled.points.length < 2) {
        return null;
    }

    let segmentIndex = 1;
    for (; segmentIndex < sampled.lengths.length; segmentIndex += 1) {
        if (distance <= sampled.lengths[segmentIndex]!) {
            break;
        }
    }

    const from = sampled.points[segmentIndex - 1]!;
    const to = sampled.points[segmentIndex] ?? from;
    const tangent = Math.atan2(to.y - from.y, to.x - from.x);

    return {
        x: polylineSample.x,
        y: polylineSample.y,
        tangent,
        distance: polylineSample.distance,
    };
}

function estimateCurvatureLimitedStep(
    sampled: ConnectorSplinePathSample,
): number {
    const maxTurnPerStep = (5 * Math.PI) / 180;
    let minStep = MAX_ARC_SAMPLE_STEP;

    for (let index = 1; index < sampled.points.length - 1; index += 1) {
        const previous = sampled.points[index - 1]!;
        const current = sampled.points[index]!;
        const next = sampled.points[index + 1]!;
        const incomingLength = Math.hypot(current.x - previous.x, current.y - previous.y);
        const outgoingLength = Math.hypot(next.x - current.x, next.y - current.y);
        const segmentLength = Math.max(incomingLength, outgoingLength);
        if (segmentLength <= 0.001) {
            continue;
        }

        const incomingAngle = Math.atan2(current.y - previous.y, current.x - previous.x);
        const outgoingAngle = Math.atan2(next.y - current.y, next.x - current.x);
        let turn = Math.abs(outgoingAngle - incomingAngle);
        if (turn > Math.PI) {
            turn = (Math.PI * 2) - turn;
        }

        if (turn > maxTurnPerStep) {
            minStep = Math.min(minStep, segmentLength * (maxTurnPerStep / turn));
        }
    }

    return Math.max(MIN_ARC_SAMPLE_STEP, minStep);
}

function resolveArcSampleStep(
    usableArcLength: number,
    repeatLength: number,
    pipeDiameter: number,
    sampled: ConnectorSplinePathSample,
    textureMapping?: SpanTextureMapping,
): number {
    const targetSections = Math.max(
        12,
        Math.ceil(usableArcLength / Math.max(repeatLength * 0.25, 1)) * 3,
    );
    const step = usableArcLength / targetSections;
    const maxStepForDiameter = Math.max(MIN_ARC_SAMPLE_STEP, pipeDiameter * 0.35);
    const curvatureStep = estimateCurvatureLimitedStep(sampled);
    const intervalCm = Number(textureMapping?.intervalCm ?? 0);
    const tieStep = intervalCm > 0
        ? Math.max(MIN_ARC_SAMPLE_STEP, centimetersToFoxholeBoardPixels(intervalCm) / 5)
        : MAX_ARC_SAMPLE_STEP;

    return Math.max(
        MIN_ARC_SAMPLE_STEP,
        Math.min(MAX_ARC_SAMPLE_STEP, maxStepForDiameter, step, curvatureStep, tieStep),
    );
}

function pushCrossSection(
    crossSections: Array<{
        leftX: number;
        leftY: number;
        rightX: number;
        rightY: number;
        uAlong: number;
    }>,
    sample: BezierArcLengthSample,
    halfWidth: number,
    perpendicularOffset: number,
    arcDistance: number,
    textureMapping: SpanTextureMapping,
    textureDistanceOffset = 0,
): void {
    const cos = Math.cos(sample.tangent);
    const sin = Math.sin(sample.tangent);
    const normalX = -sin;
    const normalY = cos;
    const centerX = sample.x + (normalX * perpendicularOffset);
    const centerY = sample.y + (normalY * perpendicularOffset);

    crossSections.push({
        leftX: centerX + (normalX * halfWidth),
        leftY: centerY + (normalY * halfWidth),
        rightX: centerX - (normalX * halfWidth),
        rightY: centerY - (normalY * halfWidth),
        uAlong: mapSpanTextureUAlong(arcDistance + textureDistanceOffset, textureMapping),
    });
}

export function resolveCenteredTextureRepeatDistanceOffset(
    usableLength: number,
    repeatLength: number,
): number {
    const normalizedRepeatLength = Math.max(8, repeatLength);
    const completeRepeatCount = Math.floor((usableLength + 0.001) / normalizedRepeatLength);
    if (completeRepeatCount <= 0) {
        return (normalizedRepeatLength - usableLength) / 2;
    }

    const remainder = Math.max(0, usableLength - (completeRepeatCount * normalizedRepeatLength));
    return -(remainder / 2);
}

export function buildSplineRibbonMeshData(
    options: BuildSplineRibbonMeshOptions,
    start: SplinePathEndpoint,
    end: SplinePathEndpoint,
    constraints: SplinePathConstraints,
): { positions: Float32Array; uvs: Float32Array; indices: Uint32Array; } | null {
    const { spanLayer } = options;
    const sampled = options.pathSample ?? sampleConnectorSplinePath(start, end, constraints);
    const totalLength = sampled.totalLength;

    if (totalLength <= 0.001) {
        return null;
    }

    if (spanLayer.nativeSurface) {
        return buildNativeSplineSurfaceMeshData(spanLayer.nativeSurface, sampled, options.textureMaterialScale);
    }

    const slicing = options.textureSlicing;
    if (slicing) {
        const usableStart = Math.min(totalLength, Math.max(0, options.startInset ?? 0));
        const usableEnd = Math.max(usableStart, totalLength - Math.max(0, options.endInset ?? 0));
        const usableLength = usableEnd - usableStart;
        const repeatLength = options.textureMapping?.repeatLength
            ?? options.textureRepeatLength ?? resolveSpanTextureRepeatLength(spanLayer);
        const startCapLength = slicing.repeatStartU * repeatLength;
        const endCapLength = (1 - slicing.repeatEndU) * repeatLength;
        const nativeBodyLength = slicing.bodyRepeatLength ?? (slicing.repeatEndU - slicing.repeatStartU) * repeatLength;
        const bodyLength = usableLength - startCapLength - endCapLength;
        if (bodyLength > (slicing.tileBody ? 0.001 : 1) && nativeBodyLength > 1) {
            const bodyCount = Math.max(1, slicing.tileBody
                ? Math.ceil(bodyLength / nativeBodyLength) : Math.round(bodyLength / nativeBodyLength));
            const bodySectionLength = bodyLength / bodyCount;
            const segments = [
                { from: 0, to: startCapLength, uStart: 0, uEnd: slicing.repeatStartU },
                ...Array.from({ length: bodyCount }, (_, index) => ({
                    from: startCapLength + (index * (slicing.tileBody ? nativeBodyLength : bodySectionLength)),
                    to: startCapLength + Math.min(bodyLength, (index + 1) * (slicing.tileBody ? nativeBodyLength : bodySectionLength)),
                    uStart: slicing.repeatStartU,
                    uEnd: slicing.tileBody
                        ? slicing.repeatStartU + Math.min(1, (bodyLength - index * nativeBodyLength) / nativeBodyLength) * (slicing.repeatEndU - slicing.repeatStartU)
                        : slicing.repeatEndU,
                })),
                { from: usableLength - endCapLength, to: usableLength, uStart: slicing.repeatEndU, uEnd: 1 },
            ];
            const parts = segments.map(segment => {
                const geometry = buildSplineRibbonMeshData({
                    ...options, pathSample: sampled, textureSlicing: undefined,
                    centerTextureRepeats: false,
                    startInset: usableStart + segment.from,
                    endInset: totalLength - usableStart - segment.to,
                    textureMapping: { repeatLength: segment.to - segment.from },
                }, start, end, constraints);
                if (geometry) {
                    for (let index = 0; index < geometry.uvs.length; index += 2) {
                        geometry.uvs[index] = segment.uStart
                            + (geometry.uvs[index]! * (slicing.tileBody ? Math.max(8, segment.to - segment.from) / (segment.to - segment.from) : 1) * (segment.uEnd - segment.uStart));
                    }
                }
                return geometry;
            });
            if (parts.every(part => part !== null)) {
                const positions = new Float32Array(parts.reduce((sum, part) => sum + part!.positions.length, 0));
                const uvs = new Float32Array(parts.reduce((sum, part) => sum + part!.uvs.length, 0));
                const indices = new Uint32Array(parts.reduce((sum, part) => sum + part!.indices.length, 0));
                let vertexOffset = 0;
                let positionOffset = 0;
                let indexOffset = 0;
                for (const part of parts) {
                    positions.set(part!.positions, positionOffset);
                    uvs.set(part!.uvs, positionOffset);
                    for (const index of part!.indices) {
                        indices[indexOffset++] = index + vertexOffset;
                    }
                    positionOffset += part!.positions.length;
                    vertexOffset += part!.positions.length / 2;
                }
                return { positions, uvs, indices };
            }
        }
    }

    const halfWidth = resolveSpanHalfWidth(spanLayer);
    const pipeDiameter = halfWidth * 2;
    const perpendicularOffset = options.perpendicularOffset ?? resolveSpanPerpendicularOffset(spanLayer);
    const textureMapping = options.textureMapping ?? {
        repeatLength: Math.max(8, options.textureRepeatLength ?? resolveSpanTextureRepeatLength(spanLayer)),
    };
    const startInset = Math.max(0, options.startInset ?? 0);
    const endInset = Math.max(0, options.endInset ?? 0);
    const usableStart = Math.min(totalLength, startInset);
    const usableEnd = Math.max(usableStart, totalLength - endInset);
    const usableArcLength = usableEnd - usableStart;

    if (usableArcLength <= 0.001) {
        return null;
    }

    const textureDistanceOffset = options.centerTextureRepeats
        ? resolveCenteredTextureRepeatDistanceOffset(usableArcLength, textureMapping.repeatLength)
        : 0;

    const step = resolveArcSampleStep(
        usableArcLength,
        textureMapping.repeatLength,
        pipeDiameter,
        sampled,
        textureMapping,
    );
    const crossSections: Array<{
        leftX: number;
        leftY: number;
        rightX: number;
        rightY: number;
        uAlong: number;
    }> = [];

    for (let distance = usableStart; distance <= usableEnd + 0.001; distance += step) {
        const clampedDistance = Math.min(distance, usableEnd);
        const sample = samplePolylineArcLengthPoint(sampled, clampedDistance);
        if (!sample) {
            continue;
        }

        const arcDistance = clampedDistance - usableStart;
        pushCrossSection(
            crossSections,
            sample,
            halfWidth,
            perpendicularOffset,
            arcDistance,
            textureMapping,
            textureDistanceOffset,
        );

        if (clampedDistance >= usableEnd - 0.001) {
            break;
        }
    }

    const endSample = samplePolylineArcLengthPoint(sampled, usableEnd);
    if (endSample) {
        const endArcDistance = usableEnd - usableStart;
        const endUAlong = mapSpanTextureUAlong(endArcDistance, textureMapping);
        const last = crossSections[crossSections.length - 1];
        if (!last || Math.hypot(last.leftX - endSample.x, last.leftY - endSample.y) > 0.5) {
            pushCrossSection(
                crossSections,
                endSample,
                halfWidth,
                perpendicularOffset,
                endArcDistance,
                textureMapping,
            );
        } else {
            last.uAlong = endUAlong;
        }
    }

    if (crossSections.length < 2) {
        return null;
    }

    const vertexCount = crossSections.length * 2;
    const positions = new Float32Array(vertexCount * 2);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint32Array((crossSections.length - 1) * 6);

    for (let index = 0; index < crossSections.length; index += 1) {
        const section = crossSections[index]!;
        const leftIndex = index * 2;
        const rightIndex = leftIndex + 1;

        positions[leftIndex * 2] = section.leftX;
        positions[leftIndex * 2 + 1] = section.leftY;
        positions[rightIndex * 2] = section.rightX;
        positions[rightIndex * 2 + 1] = section.rightY;

        uvs[leftIndex * 2] = section.uAlong;
        uvs[leftIndex * 2 + 1] = 0;
        uvs[rightIndex * 2] = section.uAlong;
        uvs[rightIndex * 2 + 1] = 1;
    }

    let indexOffset = 0;
    for (let index = 0; index < crossSections.length - 1; index += 1) {
        const left = index * 2;
        const right = left + 1;
        const nextLeft = left + 2;
        const nextRight = left + 3;

        indices[indexOffset++] = left;
        indices[indexOffset++] = right;
        indices[indexOffset++] = nextLeft;
        indices[indexOffset++] = right;
        indices[indexOffset++] = nextRight;
        indices[indexOffset++] = nextLeft;
    }

    return { positions, uvs, indices };
}
