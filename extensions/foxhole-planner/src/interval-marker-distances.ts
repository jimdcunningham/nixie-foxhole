export interface FoxholeIntervalMeshConfig {
    mode?: string;
    interval?: number;
    startOffset?: number;
    endOffset?: number;
    relativeLocation?: number[];
}

export interface FoxholeIntervalConnector {
    meshConfigs?: FoxholeIntervalMeshConfig[];
}

const centimetersToFoxholeBoardPixels = (value: number) => Math.max(0, value) * 0.32;

export function usesIntervalMarkerSpan(
    pathStyle?: string,
    connector?: FoxholeIntervalConnector | null,
): boolean {
    if (pathStyle !== 'interval') {
        return false;
    }

    const meshConfigs = connector?.meshConfigs ?? [];
    if (!meshConfigs.length) {
        return false;
    }

    return !meshConfigs.some(config => String(config.mode ?? '').toLowerCase().includes('spline'));
}

export function resolveIntervalMeshConfig(
    connector?: FoxholeIntervalConnector | null,
): FoxholeIntervalMeshConfig | undefined {
    return connector?.meshConfigs?.find(config => String(config.mode ?? '').toLowerCase().includes('interval'))
        ?? connector?.meshConfigs?.[0];
}

export function resolveIntervalMarkerDistances(
    connector: FoxholeIntervalConnector | undefined,
    totalPathLength: number,
    pathStyle?: string,
    meshCount = 1,
): Array<{ distance: number; meshIndex: number; }> {
    if (!usesIntervalMarkerSpan(pathStyle, connector)) {
        return [];
    }

    const config = resolveIntervalMeshConfig(connector);
    return resolveMeshConfigIntervalMarkerDistances(config, totalPathLength, meshCount);
}

export function resolveMeshConfigIntervalMarkerDistances(
    config: FoxholeIntervalMeshConfig | undefined,
    totalPathLength: number,
    meshCount = 1,
): Array<{ distance: number; meshIndex: number; }> {
    const intervalCm = Number(config?.interval ?? 0);
    const interval = intervalCm > 0
        ? Math.max(1, centimetersToFoxholeBoardPixels(intervalCm))
        : Math.max(1, totalPathLength);
    const startInset = Math.max(0, centimetersToFoxholeBoardPixels(config?.startOffset ?? 0));
    const endInset = Math.max(0, centimetersToFoxholeBoardPixels(config?.endOffset ?? 0));
    const endDistance = Math.max(startInset, totalPathLength - endInset);
    const normalizedMeshCount = Math.max(1, meshCount);
    const markers: Array<{ distance: number; meshIndex: number; }> = [];
    let meshIndex = 0;

    for (let distance = startInset; distance <= endDistance + 0.001; distance += interval) {
        markers.push({
            distance,
            meshIndex: meshIndex % normalizedMeshCount,
        });
        meshIndex += 1;
    }

    return markers;
}

export function resolveCenteredMeshConfigIntervalBoundaryDistances(
    config: FoxholeIntervalMeshConfig | undefined,
    totalPathLength: number,
    meshCount = 1,
): Array<{ distance: number; meshIndex: number; }> {
    const intervalCm = Number(config?.interval ?? 0);
    const interval = intervalCm > 0
        ? Math.max(1, centimetersToFoxholeBoardPixels(intervalCm))
        : Math.max(1, totalPathLength);
    const completeIntervalCount = Math.floor((totalPathLength + 0.001) / interval);
    if (completeIntervalCount <= 0) {
        return [];
    }

    const remainder = Math.max(0, totalPathLength - (completeIntervalCount * interval));
    const firstBoundary = remainder / 2;
    const normalizedMeshCount = Math.max(1, meshCount);
    const markers: Array<{ distance: number; meshIndex: number; }> = [];

    for (
        let distance = firstBoundary <= 0.001 ? interval : firstBoundary;
        distance < totalPathLength - 0.001;
        distance += interval
    ) {
        markers.push({
            distance,
            meshIndex: markers.length % normalizedMeshCount,
        });
    }

    return markers;
}
