import type { NixieComponentJsonObjectV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { FoxholeSceneV2ConnectorMetadata } from './scene-v2-asset-metadata.ts';
import { isTrenchConnector } from './trench-connector.ts';

const PIXELS_PER_CENTIMETER = 32 / 100;
export const FOXHOLE_POWERLINE_PREVIEW_LENGTH = 96;
function pixels(value: number | undefined, fallback: number): number {
    return (typeof value === 'number' && Number.isFinite(value) ? value : fallback) * PIXELS_PER_CENTIMETER;
}

/** Same catalog-unit normalization as Native snapshot creation; templates contain only authored spline state. */
export function createFoxholeSceneV2SplineProductData(assetId: string, connector: FoxholeSceneV2ConnectorMetadata): NixieComponentJsonObjectV1 {
    const trench = isTrenchConnector(assetId);
    const minLength = Math.max(1, pixels(connector.minLengthCm, trench ? 250 : 300));
    const maxLength = Math.max(minLength, pixels(connector.maxLengthCm, trench ? 800 : 2000));
    const backSocketName = connector.backSocketName ?? (trench ? 'BackSocket' : undefined);
    const frontSocketName = connector.frontSocketName ?? (trench ? 'FrontSocket' : undefined);
    const minRadius = Math.max(1, pixels(connector.minRadiusCm, 50));
    const maxRadius = typeof connector.maxRadiusCm === 'number' && connector.maxRadiusCm > 0
        ? Math.max(minRadius, pixels(connector.maxRadiusCm, 50))
        : Math.max(minRadius, maxLength);
    return {
        foxholeKey: assetId, startX: 0, startY: 0, startRotation: 0,
        // Surface pipe routing uses socket-facing ends; underground data stores tangent-aligned ends.
        endX: assetId === 'powerline' ? Math.min(FOXHOLE_POWERLINE_PREVIEW_LENGTH, maxLength) : minLength, endY: 0, endRotation: assetId === 'facilitypipe' ? Math.PI : 0,
        minLength, maxLength, minRadius, maxRadius,
        maxBuffer: Math.max(0, pixels(connector.maxBufferCm, connector.minLengthCm ?? 300)), curveT: 0, blueprint: false,
        ...(backSocketName ? { startSocketName: backSocketName } : {}),
        ...(frontSocketName ? { endSocketName: frontSocketName } : {}),
        ...(connector.maxTargetAngleDeg === undefined || connector.maxTargetAngleDeg < 0 ? {} : { maxTargetAngleDeg: Math.min(360, connector.maxTargetAngleDeg) }),
        ...(connector.maxArcAngleDeg === undefined || connector.maxArcAngleDeg < 0 ? {} : { maxArcAngleDeg: Math.min(360, connector.maxArcAngleDeg) }),
    };
}
