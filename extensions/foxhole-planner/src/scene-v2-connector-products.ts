import type { NixieExperimentalComponentJsonObjectV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import type { FoxholeSceneV2ConnectorMetadata } from './scene-v2-asset-metadata.ts';

const PIXELS_PER_CENTIMETER = 32 / 100;
function pixels(value: number | undefined, fallback: number): number {
    return (typeof value === 'number' && Number.isFinite(value) ? value : fallback) * PIXELS_PER_CENTIMETER;
}

/** Same catalog-unit normalization as Native snapshot creation; templates contain only authored spline state. */
export function createFoxholeSceneV2SplineProductData(assetId: string, connector: FoxholeSceneV2ConnectorMetadata): NixieExperimentalComponentJsonObjectV1 {
    const minLength = Math.max(1, pixels(connector.minLengthCm, 300));
    const maxLength = Math.max(minLength, pixels(connector.maxLengthCm, 2000));
    const minRadius = Math.max(1, pixels(connector.minRadiusCm, 50));
    const maxRadius = typeof connector.maxRadiusCm === 'number' && connector.maxRadiusCm > 0
        ? Math.max(minRadius, pixels(connector.maxRadiusCm, 50))
        : Math.max(minRadius, maxLength);
    return {
        foxholeKey: assetId, startX: 0, startY: 0, startRotation: 0,
        // Surface pipe routing uses socket-facing ends; underground data stores tangent-aligned ends.
        endX: minLength, endY: 0, endRotation: assetId === 'facilitypipe' ? Math.PI : 0,
        minLength, maxLength, minRadius, maxRadius,
        maxBuffer: Math.max(0, pixels(connector.maxBufferCm, connector.minLengthCm ?? 300)), curveT: 0, blueprint: false,
        ...(connector.backSocketName ? { startSocketName: connector.backSocketName } : {}),
        ...(connector.frontSocketName ? { endSocketName: connector.frontSocketName } : {}),
        ...(connector.maxTargetAngleDeg === undefined || connector.maxTargetAngleDeg < 0 ? {} : { maxTargetAngleDeg: Math.min(360, connector.maxTargetAngleDeg) }),
        ...(connector.maxArcAngleDeg === undefined || connector.maxArcAngleDeg < 0 ? {} : { maxArcAngleDeg: Math.min(360, connector.maxArcAngleDeg) }),
    };
}
