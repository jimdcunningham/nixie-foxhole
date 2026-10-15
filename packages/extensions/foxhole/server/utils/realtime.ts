export interface FoxholeWarData {
    warId?: string;
    warNumber?: number;
    conquestStartTime?: number | null;
    conquestEndTime?: number | null;
    resistanceStartTime?: number | null;
    scheduledConquestEndTime?: number | null;
    requiredVictoryTowns?: number;
    shortRequiredVictoryTowns?: number;
    winner?: string | null;
}

export interface FoxholeShardLike {
    id: string;
    live: boolean;
    warData?: FoxholeWarData;
    mapList: Record<string, unknown>;
}

export interface FoxholeRawClientRequest {
    shardId?: string;
    warId?: string;
    maps?: Record<string, unknown>;
    layers?: {
        reports?: boolean | number;
        labels?: boolean | number;
        icons?: boolean | number;
    };
    realtime?: boolean;
}

export interface FoxholeValidatedClientRequest {
    shardId?: string;
    warId?: string;
    maps: string[];
    layers: {
        reports: boolean | number;
        labels: boolean | number;
        icons: boolean | number;
    };
    updates: boolean;
    lastRequest: number;
}

export function isRealtimeLayerEnabled(value: boolean | number | null | undefined): boolean | number {
    return (typeof value === 'number' && value) || value === true;
}

export function getDefaultShardId<TShard extends FoxholeShardLike>(shards: Record<string, TShard>): string | undefined {
    return Object.values(shards).find(shard => shard.live)?.id;
}

export function validateFoxholeClientRequest<TShard extends FoxholeShardLike>(
    req: FoxholeRawClientRequest | null | undefined,
    shards: Record<string, TShard>,
    now = Date.now(),
): FoxholeValidatedClientRequest {
    const reports = isRealtimeLayerEnabled(req?.layers?.reports);
    const labels = isRealtimeLayerEnabled(req?.layers?.labels);
    const icons = isRealtimeLayerEnabled(req?.layers?.icons);

    const requestedShardId = req?.shardId;
    const shardId = requestedShardId && shards[requestedShardId]
        ? requestedShardId
        : getDefaultShardId(shards);
    const shard = shardId ? shards[shardId] : undefined;
    const maps: string[] = [];

    if (shard && req?.maps) {
        for (const mapKey of Object.keys(req.maps)) {
            if (shard.mapList[mapKey]) {
                maps.push(mapKey);
            }
        }
    }

    const requestWarId = req?.warId;

    return {
        shardId,
        warId: requestWarId === shard?.warData?.warId ? requestWarId : undefined,
        maps,
        layers: {
            reports,
            labels,
            icons,
        },
        updates: req?.realtime === true,
        lastRequest: now,
    };
}

export function shouldResetFoxholeSubscription(
    previousRequest: FoxholeValidatedClientRequest | null | undefined,
    nextRequest: FoxholeValidatedClientRequest,
): boolean {
    if (!previousRequest) {
        return false;
    }

    if (previousRequest.shardId !== nextRequest.shardId) {
        return true;
    }

    if (previousRequest.updates && !nextRequest.updates) {
        return true;
    }

    if (previousRequest.maps.length !== nextRequest.maps.length) {
        return true;
    }

    for (const mapKey of previousRequest.maps) {
        if (!nextRequest.maps.includes(mapKey)) {
            return true;
        }
    }

    return false;
}
