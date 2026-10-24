import { samplePointAlongSplinePath } from '@nixiejs/extension-sdk/experimental/scene-v2';
import type { SplinePathPoint } from '@nixiejs/extension-sdk/experimental/scene-v2';
import type { FoxholeIntervalMeshConfig as FoxholeManifestConnectorMeshConfig } from './interval-marker-distances.ts';
import {
    resolveCenteredMeshConfigIntervalBoundaryDistances,
    resolveIntervalMarkerDistances,
    resolveMeshConfigIntervalMarkerDistances,
} from './interval-marker-distances.ts';

const centimetersToFoxholeBoardPixels = (value: number) => Math.max(0, value) * 0.32;

const UINT32_RANGE = 0x1_0000_0000;

function resolveMineMarkerRotationUnit(rotationSeed: number, markerIndex: number): number {
    let value = (Math.trunc(rotationSeed) ^ Math.imul(markerIndex + 1, 0x9e37_79b9)) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb_352d);
    value ^= value >>> 15;
    value = Math.imul(value, 0x846c_a68b);
    value ^= value >>> 16;
    return (value >>> 0) / UINT32_RANGE;
}

export const INTERVAL_MARKER_SPRITE_ANCHOR = {
    x: 0.5,
    y: 0.5,
} as const;

interface IntervalMarkerPathSample {
    points: readonly SplinePathPoint[];
    lengths: readonly number[];
    totalLength: number;
}

export function resolveIntervalMarkerSamples(
    pathSample: IntervalMarkerPathSample,
    connector: Parameters<typeof resolveIntervalMarkerDistances>[0],
    pathStyle: string | undefined,
    meshCount: number,
): Array<{ x: number; y: number; rotation: number; meshIndex: number; }> {
    return resolveIntervalMarkerDistances(connector, pathSample.totalLength, pathStyle, meshCount).flatMap(marker => {
        const sample = samplePointAlongSplinePath(pathSample.points, pathSample.lengths, marker.distance);
        if (!sample) {
            return [];
        }

        return [{
            x: sample.x,
            y: sample.y,
            rotation: sample.tangent,
            meshIndex: marker.meshIndex,
        }];
    });
}

export function resolveMeshConfigIntervalMarkerSamples(
    pathSample: IntervalMarkerPathSample,
    config: FoxholeManifestConnectorMeshConfig | undefined,
    meshCount = 1,
): Array<{ x: number; y: number; rotation: number; meshIndex: number; }> {
    return resolveMeshConfigIntervalMarkerDistances(config, pathSample.totalLength, meshCount).flatMap(marker => {
        const sample = samplePointAlongSplinePath(pathSample.points, pathSample.lengths, marker.distance);
        if (!sample) {
            return [];
        }

        return [{
            x: sample.x,
            y: sample.y,
            rotation: sample.tangent,
            meshIndex: marker.meshIndex,
        }];
    });
}

export function resolveCenteredMeshConfigIntervalBoundarySamples(
    pathSample: IntervalMarkerPathSample,
    config: FoxholeManifestConnectorMeshConfig | undefined,
    meshCount = 1,
): Array<{ x: number; y: number; rotation: number; meshIndex: number; }> {
    return resolveCenteredMeshConfigIntervalBoundaryDistances(config, pathSample.totalLength, meshCount).flatMap(marker => {
        const sample = samplePointAlongSplinePath(pathSample.points, pathSample.lengths, marker.distance);
        if (!sample) {
            return [];
        }

        return [{
            x: sample.x,
            y: sample.y,
            rotation: sample.tangent,
            meshIndex: marker.meshIndex,
        }];
    });
}

export function resolveMineSplineMarkerSample(
    sample: { x: number; y: number; rotation: number; meshIndex: number; },
    config: FoxholeManifestConnectorMeshConfig | undefined,
    markerIndex: number,
    rotationSeed = 0,
): { x: number; y: number; rotation: number; meshIndex: number; } {
    const relativeLocation = config?.relativeLocation ?? [];
    const alongOffset = centimetersToFoxholeBoardPixels(Number(relativeLocation[0] ?? 0));
    const authoredSideOffset = centimetersToFoxholeBoardPixels(Number(relativeLocation[1] ?? 100));
    const alternatingSideOffset = authoredSideOffset * (markerIndex % 2 === 0 ? 1 : -1);
    const cos = Math.cos(sample.rotation);
    const sin = Math.sin(sample.rotation);

    return {
        x: sample.x + (cos * alongOffset) - (sin * alternatingSideOffset),
        y: sample.y + (sin * alongOffset) + (cos * alternatingSideOffset),
        rotation: sample.rotation + (resolveMineMarkerRotationUnit(rotationSeed, markerIndex) * Math.PI * 2),
        meshIndex: sample.meshIndex,
    };
}

export function resolveIntervalMarkerSpritePosition(
    sample: { x: number; y: number; rotation: number; meshIndex: number; },
    _layer: unknown,
    _referenceLayer: unknown | undefined,
    _connector: Parameters<typeof resolveIntervalMarkerDistances>[0],
): { x: number; y: number; } {
    return {
        x: sample.x,
        y: sample.y,
    };
}
