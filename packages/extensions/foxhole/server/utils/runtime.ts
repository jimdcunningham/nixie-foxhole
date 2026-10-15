import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
// @ts-ignore Voronoi does not ship types and this service only needs its runtime API.
import Voronoi from 'voronoi';
import {
    buildFoxholePlaybackMapSummary,
    captureFoxholePlaybackSnapshot,

} from './playback.ts';
import type { FoxholePlaybackEventInput } from './playback.ts';
import {
    buildFactionCasualtySummary,
    getHourlyCasualtyRingCapacity,
} from './hourly-casualties.ts';
import {
    shouldResetFoxholeSubscription,
    validateFoxholeClientRequest,

} from './realtime.ts';
import type { FoxholeRawClientRequest, FoxholeValidatedClientRequest, FoxholeShardLike, FoxholeWarData } from './realtime.ts';

interface FoxholePeer {
    send(data: string): void;
}

interface FoxholeWarReport {
    totalEnlistments?: number;
    colonialCasualties?: number;
    wardenCasualties?: number;
    dayOfWar?: number;
    version?: number;
    colonial?: {
        totalHourlyCasualties: number | null;
        totalCasualties: number;
    };
    warden?: {
        totalHourlyCasualties: number | null;
        totalCasualties: number;
    };
    colonialCasualtyValues?: number[];
    wardenCasualtyValues?: number[];
}

interface FoxholeMapCacheLayerEntry {
    version?: number;
    items?: any[];
}

interface FoxholeMapState {
    static?: any;
    dynamic?: any;
    report?: FoxholeWarReport;
    voronoi?: any;
    updateConnections: Set<string>;
}

interface FoxholeStaticMapTextItem {
    x: number;
    y: number;
    text?: string;
    mapMarkerType?: string;
    iconId?: {
        x: number;
        y: number;
    };
    teamId?: string;
    capturedTimestamp?: number;
}

interface FoxholeStaticMapData {
    version?: number;
    mapTextItems: FoxholeStaticMapTextItem[];
}

interface FoxholeDynamicMapItem {
    iconType: number;
    x: number;
    y: number;
    teamId?: string;
    flags?: number;
}

interface FoxholeDynamicMapData {
    version?: number;
    mapItems: FoxholeDynamicMapItem[];
}

interface FoxholeWarReportResponse extends FoxholeWarReport {
    colonialCasualties?: number;
    wardenCasualties?: number;
}

interface FoxholeShardState extends FoxholeShardLike {
    name: string;
    url: string;
    etags: {
        dynamic: Record<string, string>;
        report: Record<string, string>;
    };
    updateConnections: Set<string>;
    mapList: Record<string, FoxholeMapState>;
    mapCache: {
        reports: Record<string, any>;
        labels: Record<string, FoxholeMapCacheLayerEntry>;
        icons: Record<string, FoxholeMapCacheLayerEntry>;
    };
}

interface FoxholeConnectionState {
    id: string;
    peer: FoxholePeer;
    request?: FoxholeValidatedClientRequest;
}

interface SerializedFoxholeMapState {
    static?: any;
    dynamic?: any;
    report?: FoxholeWarReport;
}

interface SerializedFoxholeShardState {
    warData?: FoxholeWarData;
    mapList?: Record<string, SerializedFoxholeMapState>;
}

interface FoxholeRuntimeState {
    started: boolean;
    startingPromise: Promise<void> | null;
    nextConnectionId: number;
    connections: Map<string, FoxholeConnectionState>;
    peerIds: Map<object, string>;
    shards: Record<string, FoxholeShardState>;
    timers: NodeJS.Timeout[];
}

interface FoxholeUpdatePayload {
    shardId?: string;
    warId?: string;
    warNumber?: number;
    warStart?: number | null;
    conquestEndTime?: number | null;
    resistanceStart?: number | null;
    scheduledConquestEndTime?: number | null;
    requiredVictoryTowns?: number;
    shortRequiredVictoryTowns?: number | null;
    winner?: string | null;
    reports?: Record<string, any>;
    labels?: Record<string, FoxholeMapCacheLayerEntry>;
    icons?: Record<string, FoxholeMapCacheLayerEntry>;
}

const shardAccessPoints = [
    {
        id: 'live',
        name: 'Able',
        url: 'https://war-service-live.foxholeservices.com/api',
    },
    {
        id: 'live-2',
        name: 'Baker',
        url: 'https://war-service-live-2.foxholeservices.com/api',
    },
    {
        id: 'live-3',
        name: 'Charlie',
        url: 'https://war-service-live-3.foxholeservices.com/api',
    },
    {
        id: 'dev',
        name: 'Dev Branch',
        url: 'https://war-service-dev.foxholeservices.com/api',
    },
] as const;

const CACHE_DIR = path.resolve('.cache/warAPI');
const CACHE_FILE = path.join(CACHE_DIR, 'shards.json');
const METER_BOARD_PIXEL_SIZE = 32;
const REGION_WIDTH = 2177 * METER_BOARD_PIXEL_SIZE;
const REGION_HEIGHT = 1888 * METER_BOARD_PIXEL_SIZE;
const WAR_UPDATE_FREQUENCY = 300000;
const REPORT_UPDATE_FREQUENCY = 150000;
const DYNAMIC_UPDATE_FREQUENCY = 60000;
const FOXHOLE_TOWN_BASE_ICON_TYPES = new Set<number>([45, 46, 47, 56, 57, 58]);
const FOXHOLE_MAP_FLAG_IS_VICTORY_BASE = 0x01;
const FOXHOLE_MAP_FLAG_IS_SCORCHED = 0x10;
const FOXHOLE_MAP_FLAG_IS_TOWN_CLAIMED = 0x20;
const FOXHOLE_ROCKET_TARGET_ICON_TYPE = 70;
const FOXHOLE_ROCKET_GROUND_ZERO_ICON_TYPE = 71;
const FOXHOLE_ROCKET_READY_ICON_TYPE = 72;
const FOXHOLE_BASE_TIER_BY_ICON_TYPE = new Map<number, { baseType: 'town' | 'relic'; tier: number; }>([
    [45, { baseType: 'relic', tier: 1 }],
    [46, { baseType: 'relic', tier: 2 }],
    [47, { baseType: 'relic', tier: 3 }],
    [56, { baseType: 'town', tier: 1 }],
    [57, { baseType: 'town', tier: 2 }],
    [58, { baseType: 'town', tier: 3 }],
]);

const foxholeRuntimeGlobal = globalThis as typeof globalThis & {
    __foxholeRealtimeRuntime__?: FoxholeRuntimeState;
};
let runtimeStatePersistPromise: Promise<void> = Promise.resolve();

function createShardState(
    accessPoint: typeof shardAccessPoints[number],
    previous?: FoxholeShardState,
): FoxholeShardState {
    return {
        id: accessPoint.id,
        name: accessPoint.name,
        url: accessPoint.url,
        live: previous?.live ?? false,
        etags: {
            dynamic: { ...(previous?.etags.dynamic ?? {}) },
            report: { ...(previous?.etags.report ?? {}) },
        },
        updateConnections: previous?.updateConnections ?? new Set<string>(),
        warData: previous?.warData,
        mapList: previous?.mapList ?? {},
        mapCache: previous?.mapCache ?? {
            reports: {},
            labels: {},
            icons: {},
        },
    };
}

function createRuntimeState(): FoxholeRuntimeState {
    const shards = Object.fromEntries(
        shardAccessPoints.map(accessPoint => [accessPoint.id, createShardState(accessPoint)]),
    ) as Record<string, FoxholeShardState>;

    return {
        started: false,
        startingPromise: null,
        nextConnectionId: 1,
        connections: new Map<string, FoxholeConnectionState>(),
        peerIds: new Map<object, string>(),
        shards,
        timers: [],
    };
}

function getRuntimeState(): FoxholeRuntimeState {
    if (!foxholeRuntimeGlobal.__foxholeRealtimeRuntime__) {
        foxholeRuntimeGlobal.__foxholeRealtimeRuntime__ = createRuntimeState();
    }
    return foxholeRuntimeGlobal.__foxholeRealtimeRuntime__;
}

function pointInVoronoiCell(x: number, y: number, cell: any): boolean {
    const vertices: Array<{ x: number; y: number; }> = [];
    for (let index = 0; index < cell.halfedges.length; index += 1) {
        const edge = cell.halfedges[index];
        const vertex = edge.getStartpoint();
        vertices.push({ x: vertex.x, y: vertex.y });
    }

    let inside = false;
    for (let index = 0, previousIndex = vertices.length - 1; index < vertices.length; previousIndex = index, index += 1) {
        const current = vertices[index];
        const previous = vertices[previousIndex];
        if (!current || !previous) {
            continue;
        }

        const intersects = ((current.y > y) !== (previous.y > y))
            && (x < ((previous.x - current.x) * (y - current.y) / (previous.y - current.y)) + current.x);
        if (intersects) {
            inside = !inside;
        }
    }

    return inside;
}

function sendPeerMessage(peer: FoxholePeer, payload: unknown): void {
    peer.send(JSON.stringify(payload));
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function serializeRuntimeState(runtime: FoxholeRuntimeState): Record<string, SerializedFoxholeShardState> {
    return Object.fromEntries(Object.values(runtime.shards).map(shard => [
        shard.id,
        {
            warData: shard.warData,
            mapList: Object.fromEntries(Object.entries(shard.mapList).map(([mapKey, mapState]) => [
                mapKey,
                {
                    static: mapState.static,
                    dynamic: mapState.dynamic,
                    report: mapState.report,
                },
            ])),
        },
    ]));
}

export function parseFoxholeRuntimeCache(text: string): Record<string, SerializedFoxholeShardState> | null {
    const sanitizedText = text.replace(/\u0000/g, '').trim();
    if (!sanitizedText) {
        return null;
    }

    try {
        const parsed = JSON.parse(sanitizedText) as Record<string, SerializedFoxholeShardState>;
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

async function writeRuntimeStateCache(cacheText: string): Promise<void> {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const tempCacheFile = `${CACHE_FILE}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

    try {
        await fs.writeFile(tempCacheFile, cacheText);
        await fs.rename(tempCacheFile, CACHE_FILE);
    } catch (error) {
        await fs.rm(tempCacheFile, { force: true }).catch(() => undefined);
        throw error;
    }
}

async function persistRuntimeState(runtime: FoxholeRuntimeState): Promise<void> {
    const cacheText = JSON.stringify(serializeRuntimeState(runtime), null, '\t');
    const persistTask = runtimeStatePersistPromise
        .catch(() => undefined)
        .then(() => writeRuntimeStateCache(cacheText));

    runtimeStatePersistPromise = persistTask;
    await persistTask;
}

function hydrateMapCache(shard: FoxholeShardState, mapKey: string): void {
    const mapState = shard.mapList[mapKey];
    if (!mapState) {
        return;
    }

    if (mapState.static) {
        shard.mapCache.labels[mapKey] = {
            version: mapState.static.version,
            items: mapState.static.mapTextItems,
        };
    }

    if (mapState.dynamic) {
        shard.mapCache.icons[mapKey] = {
            version: mapState.dynamic.version,
            items: mapState.dynamic.mapItems,
        };
    }

    if (mapState.report) {
        const report = mapState.report;
        shard.mapCache.reports[mapKey] = {
            totalEnlistments: report.totalEnlistments,
            factions: {
                colonial: buildFactionCasualtySummary(
                    report.colonial?.totalCasualties ?? report.colonialCasualties ?? 0,
                    report.colonialCasualtyValues,
                ),
                warden: buildFactionCasualtySummary(
                    report.warden?.totalCasualties ?? report.wardenCasualties ?? 0,
                    report.wardenCasualtyValues,
                ),
            },
            dayOfWar: report.dayOfWar,
            version: report.version,
        };
    }
}

async function hydrateRuntimeFromCache(runtime: FoxholeRuntimeState): Promise<void> {
    if (!existsSync(CACHE_FILE)) {
        return;
    }

    const shardsText = await fs.readFile(CACHE_FILE, 'utf8');
    const serialized = parseFoxholeRuntimeCache(shardsText);
    if (!serialized) {
        console.warn('Foxhole realtime cache file is empty or invalid. Ignoring cached state.');
        return;
    }

    for (const [shardId, shardData] of Object.entries(serialized)) {
        const shard = runtime.shards[shardId];
        if (!shard) {
            continue;
        }

        shard.warData = shardData.warData;
        for (const [mapKey, mapData] of Object.entries(shardData.mapList ?? {})) {
            shard.mapList[mapKey] = {
                static: mapData.static,
                dynamic: mapData.dynamic,
                report: mapData.report,
                updateConnections: new Set<string>(),
            };
            hydrateMapCache(shard, mapKey);
        }
    }
}

function removeConnectionSubscriptions(runtime: FoxholeRuntimeState, request: FoxholeValidatedClientRequest | undefined, connectionId: string): void {
    if (!request?.shardId) {
        return;
    }

    const shard = runtime.shards[request.shardId];
    if (!shard) {
        return;
    }

    if (!request.maps.length) {
        shard.updateConnections.delete(connectionId);
        return;
    }

    for (const mapKey of request.maps) {
        shard.mapList[mapKey]?.updateConnections.delete(connectionId);
    }
}

function addConnectionSubscriptions(runtime: FoxholeRuntimeState, request: FoxholeValidatedClientRequest, connectionId: string): void {
    if (!request.updates || !request.shardId) {
        return;
    }

    const shard = runtime.shards[request.shardId];
    if (!shard) {
        return;
    }

    if (!request.maps.length) {
        shard.updateConnections.add(connectionId);
        return;
    }

    for (const mapKey of request.maps) {
        const mapState = shard.mapList[mapKey];
        if (mapState) {
            mapState.updateConnections.add(connectionId);
        }
    }
}

function buildSnapshotPayload(
    shard: FoxholeShardState,
    request: FoxholeValidatedClientRequest,
): FoxholeUpdatePayload {
    let reports: Record<string, any> | undefined;
    let labels: Record<string, FoxholeMapCacheLayerEntry> | undefined;
    let icons: Record<string, FoxholeMapCacheLayerEntry> | undefined;

    if (request.maps.length) {
        if (request.layers.reports !== false) {
            reports = {};
        }
        if (request.layers.labels !== false) {
            labels = {};
        }
        if (request.layers.icons !== false) {
            icons = {};
        }

        for (const mapKey of request.maps) {
            if (reports && shard.mapCache.reports[mapKey]) {
                reports[mapKey] = shard.mapCache.reports[mapKey];
            }
            if (labels && shard.mapCache.labels[mapKey]) {
                labels[mapKey] = shard.mapCache.labels[mapKey];
            }
            if (icons && shard.mapCache.icons[mapKey]) {
                icons[mapKey] = shard.mapCache.icons[mapKey];
            }
        }
    }

    return {
        shardId: shard.id,
        warId: shard.warData?.warId,
        warNumber: shard.warData?.warNumber,
        warStart: shard.warData?.conquestStartTime,
        conquestEndTime: shard.warData?.conquestEndTime,
        resistanceStart: shard.warData?.resistanceStartTime,
        scheduledConquestEndTime: shard.warData?.scheduledConquestEndTime,
        requiredVictoryTowns: shard.warData?.requiredVictoryTowns,
        shortRequiredVictoryTowns: shard.warData?.shortRequiredVictoryTowns ?? null,
        winner: normalizeString(shard.warData?.winner) || null,
        reports: reports ?? shard.mapCache.reports,
        labels: labels ?? shard.mapCache.labels,
        icons: icons ?? shard.mapCache.icons,
    };
}

function sendSnapshot(runtime: FoxholeRuntimeState, connectionId: string, request: FoxholeValidatedClientRequest): void {
    const connection = runtime.connections.get(connectionId);
    if (!connection?.request?.shardId) {
        return;
    }

    const shard = runtime.shards[connection.request.shardId];
    if (!shard) {
        return;
    }

    sendPeerMessage(connection.peer, {
        type: 'update-maps',
        payload: buildSnapshotPayload(shard, request),
    });
}

function broadcastUpdate(runtime: FoxholeRuntimeState, connectionIds: Iterable<string>, payload: FoxholeUpdatePayload): void {
    for (const connectionId of connectionIds) {
        const connection = runtime.connections.get(connectionId);
        if (!connection) {
            continue;
        }

        sendPeerMessage(connection.peer, {
            type: 'update-maps',
            payload,
        });
    }
}

type FoxholePlaybackTownOwnership = ReturnType<typeof buildFoxholePlaybackMapSummary>['ownership'][number];

function getPlaybackMapSummaryFromShardCache(
    shard: FoxholeShardState,
    mapKey: string,
): ReturnType<typeof buildFoxholePlaybackMapSummary> {
    return buildFoxholePlaybackMapSummary(mapKey, {
        report: shard.mapCache.reports[mapKey],
        labels: shard.mapCache.labels[mapKey],
        icons: shard.mapCache.icons[mapKey],
    });
}

function normalizeTownOwnershipTeamId(teamId: string | null | undefined): string {
    const normalizedTeamId = String(teamId ?? '').trim();
    return normalizedTeamId || 'NONE';
}

function buildTownOwnershipEventKey(town: FoxholePlaybackTownOwnership): string {
    const name = normalizeString(town.name).toLowerCase();
    const x = typeof town.x === 'number' ? town.x.toFixed(4) : 'na';
    const y = typeof town.y === 'number' ? town.y.toFixed(4) : 'na';
    return `${name}:${x}:${y}`;
}

function buildTownOwnershipIndex(summary: ReturnType<typeof buildFoxholePlaybackMapSummary>): Map<string, FoxholePlaybackTownOwnership> {
    const ownership = new Map<string, FoxholePlaybackTownOwnership>();
    for (const town of summary.ownership) {
        ownership.set(buildTownOwnershipEventKey(town), town);
    }
    return ownership;
}

function findNearestTownOwnership(
    summary: ReturnType<typeof buildFoxholePlaybackMapSummary>,
    x: number,
    y: number,
): FoxholePlaybackTownOwnership | null {
    let nearestTown: FoxholePlaybackTownOwnership | null = null;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;

    for (const town of summary.ownership) {
        if (typeof town.x !== 'number' || typeof town.y !== 'number') {
            continue;
        }

        const deltaX = town.x - x;
        const deltaY = town.y - y;
        const distanceSquared = (deltaX * deltaX) + (deltaY * deltaY);
        if (distanceSquared < nearestDistanceSquared) {
            nearestDistanceSquared = distanceSquared;
            nearestTown = town;
        }
    }

    return nearestTown;
}

function buildDynamicIconEventKey(icon: FoxholeDynamicMapItem): string {
    return [
        icon.iconType,
        normalizeTownOwnershipTeamId(icon.teamId),
        icon.x.toFixed(4),
        icon.y.toFixed(4),
    ].join(':');
}

function buildDynamicIconLocationKey(icon: Pick<FoxholeDynamicMapItem, 'x' | 'y'>): string {
    return [
        icon.x.toFixed(4),
        icon.y.toFixed(4),
    ].join(':');
}

function hasFoxholeMapFlag(icon: FoxholeDynamicMapItem, flag: number): boolean {
    return typeof icon.flags === 'number' && (icon.flags & flag) !== 0;
}

function isScorchedVictoryTownIcon(icon: FoxholeDynamicMapItem): boolean {
    return FOXHOLE_TOWN_BASE_ICON_TYPES.has(icon.iconType)
        && hasFoxholeMapFlag(icon, FOXHOLE_MAP_FLAG_IS_VICTORY_BASE)
        && hasFoxholeMapFlag(icon, FOXHOLE_MAP_FLAG_IS_SCORCHED);
}

function isClaimedTownIcon(icon: FoxholeDynamicMapItem): boolean {
    return FOXHOLE_TOWN_BASE_ICON_TYPES.has(icon.iconType)
        && hasFoxholeMapFlag(icon, FOXHOLE_MAP_FLAG_IS_TOWN_CLAIMED);
}

function getBaseTierInfo(icon: FoxholeDynamicMapItem): { baseType: 'town' | 'relic'; tier: number; } | null {
    return FOXHOLE_BASE_TIER_BY_ICON_TYPE.get(icon.iconType) ?? null;
}

function buildTownOwnershipEvents(
    shard: FoxholeShardState,
    mapKey: string,
    source: string,
    observedAt: number,
    previousSummary: ReturnType<typeof buildFoxholePlaybackMapSummary>,
    nextSummary: ReturnType<typeof buildFoxholePlaybackMapSummary>,
): FoxholePlaybackEventInput[] {
    const previousOwnership = buildTownOwnershipIndex(previousSummary);
    const nextOwnership = buildTownOwnershipIndex(nextSummary);
    const playbackEvents: FoxholePlaybackEventInput[] = [];

    for (const [townKey, nextTown] of nextOwnership.entries()) {
        const previousTown = previousOwnership.get(townKey);
        // The first observation establishes ownership; an unseen town is not neutral.
        if (!previousTown) {
            continue;
        }
        const previousTeamId = normalizeTownOwnershipTeamId(previousTown?.teamId);
        const nextTeamId = normalizeTownOwnershipTeamId(nextTown.teamId);
        if (previousTeamId === nextTeamId) {
            continue;
        }

        const eventType = nextTeamId === 'NONE'
            ? previousTeamId === 'NONE'
                ? null
                : 'town-neutralized'
            : 'town-captured';
        if (!eventType) {
            continue;
        }

        playbackEvents.push({
            shardId: shard.id,
            warId: shard.warData?.warId,
            warNumber: shard.warData?.warNumber,
            mapKey,
            eventType,
            source,
            observedAt,
            data: {
                mapKey,
                townName: nextTown.name,
                previousTeamId,
                nextTeamId,
                capturedTimestamp: nextTown.capturedTimestamp ?? observedAt,
                x: nextTown.x,
                y: nextTown.y,
            },
        });
    }

    return playbackEvents;
}

function buildRocketActivityEvents(
    shard: FoxholeShardState,
    mapKey: string,
    source: string,
    observedAt: number,
    previousDynamic: FoxholeDynamicMapData | undefined,
    nextDynamic: FoxholeDynamicMapData,
    nextSummary: ReturnType<typeof buildFoxholePlaybackMapSummary>,
): FoxholePlaybackEventInput[] {
    const previousMapItems = Array.isArray(previousDynamic?.mapItems) ? previousDynamic.mapItems : [];
    if (!previousMapItems.length) {
        return [];
    }

    const rocketEventTypes = new Map<number, string>([
        [FOXHOLE_ROCKET_TARGET_ICON_TYPE, 'rocket-targeted'],
        [FOXHOLE_ROCKET_GROUND_ZERO_ICON_TYPE, 'rocket-impact'],
        [FOXHOLE_ROCKET_READY_ICON_TYPE, 'rocket-ready'],
    ]);
    const previousRocketKeysByIconType = new Map<number, Set<string>>();
    for (const icon of previousMapItems) {
        if (!rocketEventTypes.has(icon.iconType)) {
            continue;
        }

        const previousKeys = previousRocketKeysByIconType.get(icon.iconType) ?? new Set<string>();
        previousKeys.add(buildDynamicIconEventKey(icon));
        previousRocketKeysByIconType.set(icon.iconType, previousKeys);
    }
    const playbackEvents: FoxholePlaybackEventInput[] = [];

    for (const icon of nextDynamic.mapItems) {
        const eventType = rocketEventTypes.get(icon.iconType);
        if (!eventType) {
            continue;
        }

        const impactKey = buildDynamicIconEventKey(icon);
        const previousKeys = previousRocketKeysByIconType.get(icon.iconType);
        if (previousKeys?.has(impactKey)) {
            continue;
        }

        const nearestTown = findNearestTownOwnership(nextSummary, icon.x, icon.y);
        playbackEvents.push({
            shardId: shard.id,
            warId: shard.warData?.warId,
            warNumber: shard.warData?.warNumber,
            mapKey,
            eventType,
            source,
            observedAt,
            data: {
                mapKey,
                iconType: icon.iconType,
                teamId: normalizeTownOwnershipTeamId(icon.teamId),
                nearestTownName: nearestTown?.name ?? null,
                x: icon.x,
                y: icon.y,
            },
        });
    }

    return playbackEvents;
}

function buildVictoryTownScorchedEvents(
    shard: FoxholeShardState,
    mapKey: string,
    source: string,
    observedAt: number,
    previousDynamic: FoxholeDynamicMapData | undefined,
    nextDynamic: FoxholeDynamicMapData,
    nextSummary: ReturnType<typeof buildFoxholePlaybackMapSummary>,
): FoxholePlaybackEventInput[] {
    const previousMapItems = Array.isArray(previousDynamic?.mapItems) ? previousDynamic.mapItems : [];
    if (!previousMapItems.length) {
        return [];
    }

    const previousScorchedTownKeys = new Set(
        previousMapItems
            .filter(icon => isScorchedVictoryTownIcon(icon))
            .map(icon => buildDynamicIconLocationKey(icon)),
    );
    const playbackEvents: FoxholePlaybackEventInput[] = [];

    for (const icon of nextDynamic.mapItems) {
        if (!isScorchedVictoryTownIcon(icon)) {
            continue;
        }

        const townKey = buildDynamicIconLocationKey(icon);
        if (previousScorchedTownKeys.has(townKey)) {
            continue;
        }

        const nearestTown = findNearestTownOwnership(nextSummary, icon.x, icon.y);
        playbackEvents.push({
            shardId: shard.id,
            warId: shard.warData?.warId,
            warNumber: shard.warData?.warNumber,
            mapKey,
            eventType: 'victory-town-scorched',
            source,
            observedAt,
            data: {
                mapKey,
                townName: nearestTown?.name ?? null,
                teamId: normalizeTownOwnershipTeamId(icon.teamId),
                x: icon.x,
                y: icon.y,
            },
        });
    }

    return playbackEvents;
}

function buildTownClaimedEvents(
    shard: FoxholeShardState,
    mapKey: string,
    source: string,
    observedAt: number,
    previousDynamic: FoxholeDynamicMapData | undefined,
    nextDynamic: FoxholeDynamicMapData,
    nextSummary: ReturnType<typeof buildFoxholePlaybackMapSummary>,
): FoxholePlaybackEventInput[] {
    const previousMapItems = Array.isArray(previousDynamic?.mapItems) ? previousDynamic.mapItems : [];
    if (!previousMapItems.length) {
        return [];
    }

    const previousClaimedTownKeys = new Set(
        previousMapItems
            .filter(icon => isClaimedTownIcon(icon))
            .map(icon => buildDynamicIconLocationKey(icon)),
    );
    const playbackEvents: FoxholePlaybackEventInput[] = [];

    for (const icon of nextDynamic.mapItems) {
        if (!isClaimedTownIcon(icon)) {
            continue;
        }

        const townKey = buildDynamicIconLocationKey(icon);
        if (previousClaimedTownKeys.has(townKey)) {
            continue;
        }

        const nearestTown = findNearestTownOwnership(nextSummary, icon.x, icon.y);
        playbackEvents.push({
            shardId: shard.id,
            warId: shard.warData?.warId,
            warNumber: shard.warData?.warNumber,
            mapKey,
            eventType: 'town-claimed',
            source,
            observedAt,
            data: {
                mapKey,
                townName: nearestTown?.name ?? null,
                teamId: normalizeTownOwnershipTeamId(icon.teamId),
                x: icon.x,
                y: icon.y,
            },
        });
    }

    return playbackEvents;
}

function buildTownBaseTierEvents(
    shard: FoxholeShardState,
    mapKey: string,
    source: string,
    observedAt: number,
    previousDynamic: FoxholeDynamicMapData | undefined,
    nextDynamic: FoxholeDynamicMapData,
    nextSummary: ReturnType<typeof buildFoxholePlaybackMapSummary>,
): FoxholePlaybackEventInput[] {
    const previousMapItems = Array.isArray(previousDynamic?.mapItems) ? previousDynamic.mapItems : [];
    if (!previousMapItems.length) {
        return [];
    }

    const previousTieredBases = new Map<string, FoxholeDynamicMapItem>();
    for (const icon of previousMapItems) {
        if (!getBaseTierInfo(icon)) {
            continue;
        }

        previousTieredBases.set(buildDynamicIconLocationKey(icon), icon);
    }

    const playbackEvents: FoxholePlaybackEventInput[] = [];
    for (const icon of nextDynamic.mapItems) {
        const nextTierInfo = getBaseTierInfo(icon);
        if (!nextTierInfo) {
            continue;
        }

        const previousIcon = previousTieredBases.get(buildDynamicIconLocationKey(icon));
        if (!previousIcon) {
            continue;
        }

        const previousTierInfo = getBaseTierInfo(previousIcon);
        if (!previousTierInfo || previousTierInfo.baseType !== nextTierInfo.baseType) {
            continue;
        }

        const previousTeamId = normalizeTownOwnershipTeamId(previousIcon.teamId);
        const nextTeamId = normalizeTownOwnershipTeamId(icon.teamId);
        if (previousTeamId !== nextTeamId || previousTierInfo.tier === nextTierInfo.tier) {
            continue;
        }

        const eventType = nextTierInfo.tier > previousTierInfo.tier
            ? 'town-base-upgraded'
            : 'town-base-downgraded';
        const nearestTown = findNearestTownOwnership(nextSummary, icon.x, icon.y);
        playbackEvents.push({
            shardId: shard.id,
            warId: shard.warData?.warId,
            warNumber: shard.warData?.warNumber,
            mapKey,
            eventType,
            source,
            observedAt,
            data: {
                mapKey,
                townName: nearestTown?.name ?? null,
                teamId: nextTeamId,
                baseType: nextTierInfo.baseType,
                previousTier: previousTierInfo.tier,
                nextTier: nextTierInfo.tier,
                previousIconType: previousIcon.iconType,
                nextIconType: icon.iconType,
                x: icon.x,
                y: icon.y,
            },
        });
    }

    return playbackEvents;
}

function buildWarLifecycleEvents(
    shard: FoxholeShardState,
    nextWarData: FoxholeWarData & { winner?: string | null; },
    observedAt: number,
): FoxholePlaybackEventInput[] {
    if (!shard.warData) {
        return [];
    }

    const previousWarData = shard.warData as FoxholeWarData & { winner?: string | null; };
    const previousWinner = String(previousWarData.winner ?? '').trim();
    const nextWinner = String(nextWarData.winner ?? '').trim();
    const events: FoxholePlaybackEventInput[] = [];

    if (
        previousWarData.warId
        && nextWarData.warId
        && previousWarData.warId !== nextWarData.warId
        && typeof nextWarData.conquestStartTime === 'number'
    ) {
        events.push({
            shardId: shard.id,
            warId: nextWarData.warId,
            warNumber: nextWarData.warNumber,
            eventType: 'war-started',
            source: 'war-state',
            observedAt,
            data: {
                previousWarId: previousWarData.warId,
                nextWarId: nextWarData.warId,
                warNumber: nextWarData.warNumber ?? null,
                conquestStartTime: nextWarData.conquestStartTime,
                requiredVictoryTowns: nextWarData.requiredVictoryTowns ?? null,
            },
        });
    }

    if (
        typeof nextWarData.resistanceStartTime === 'number'
        && previousWarData.resistanceStartTime !== nextWarData.resistanceStartTime
    ) {
        events.push({
            shardId: shard.id,
            warId: nextWarData.warId,
            warNumber: nextWarData.warNumber,
            eventType: 'resistance-started',
            source: 'war-state',
            observedAt,
            data: {
                warId: nextWarData.warId,
                warNumber: nextWarData.warNumber ?? null,
                resistanceStartTime: nextWarData.resistanceStartTime,
            },
        });
    }

    if (
        typeof nextWarData.scheduledConquestEndTime === 'number'
        && previousWarData.scheduledConquestEndTime !== nextWarData.scheduledConquestEndTime
    ) {
        events.push({
            shardId: shard.id,
            warId: nextWarData.warId,
            warNumber: nextWarData.warNumber,
            eventType: 'short-conquest-scheduled',
            source: 'war-state',
            observedAt,
            data: {
                warId: nextWarData.warId,
                warNumber: nextWarData.warNumber ?? null,
                scheduledConquestEndTime: nextWarData.scheduledConquestEndTime,
                shortRequiredVictoryTowns: nextWarData.shortRequiredVictoryTowns ?? null,
                requiredVictoryTowns: nextWarData.requiredVictoryTowns ?? null,
            },
        });
    }

    if (
        typeof nextWarData.conquestEndTime === 'number'
        && previousWarData.conquestEndTime !== nextWarData.conquestEndTime
    ) {
        events.push({
            shardId: shard.id,
            warId: nextWarData.warId,
            warNumber: nextWarData.warNumber,
            eventType: 'war-ended',
            source: 'war-state',
            observedAt,
            data: {
                warId: nextWarData.warId,
                warNumber: nextWarData.warNumber ?? null,
                conquestEndTime: nextWarData.conquestEndTime,
                winner: nextWinner || null,
            },
        });
    }

    if (nextWinner && nextWinner !== 'NONE' && nextWinner !== previousWinner) {
        events.push({
            shardId: shard.id,
            warId: nextWarData.warId,
            warNumber: nextWarData.warNumber,
            eventType: 'war-winner-declared',
            source: 'war-state',
            observedAt,
            data: {
                warId: nextWarData.warId,
                warNumber: nextWarData.warNumber ?? null,
                winner: nextWinner,
            },
        });
    }

    return events;
}

async function capturePlaybackSnapshotForShard(
    shard: FoxholeShardState,
    source: string,
    observedAt: number,
    changedMaps: string[],
    events: FoxholePlaybackEventInput[],
): Promise<void> {
    if (!changedMaps.length && !events.length) {
        return;
    }

    try {
        await captureFoxholePlaybackSnapshot({
            shardId: shard.id,
            source,
            capturedAt: observedAt,
            warData: shard.warData,
            reports: shard.mapCache.reports,
            labels: shard.mapCache.labels,
            icons: shard.mapCache.icons,
            changedMaps,
            events,
        });
    } catch (error) {
        console.error('[foxhole:playback] failed to capture playback snapshot', {
            shardId: shard.id,
            source,
            error,
        });
    }
}

async function fetchShardMaps(shard: FoxholeShardState): Promise<void> {
    const mapKeys = await $fetch<string[]>(`${shard.url}/worldconquest/maps`);
    const results = await Promise.all(mapKeys.map(async mapKey => ({
        id: mapKey,
        static: await $fetch<FoxholeStaticMapData>(`${shard.url}/worldconquest/maps/${mapKey}/static`),
    })));

    const voronoi = new Voronoi();
    const nextMapList: Record<string, FoxholeMapState> = {};
    for (const result of results) {
        const majorRegions = [];
        for (const mapLabel of result.static.mapTextItems) {
            if (mapLabel.mapMarkerType === 'Major') {
                majorRegions.push({
                    x: mapLabel.x * REGION_WIDTH,
                    y: mapLabel.y * REGION_HEIGHT,
                    mapLabel,
                });
            }
        }

        nextMapList[result.id] = {
            static: result.static,
            dynamic: shard.mapList[result.id]?.dynamic,
            report: shard.mapList[result.id]?.report,
            voronoi: voronoi.compute(majorRegions, { xl: 0, xr: REGION_WIDTH, yt: 0, yb: REGION_HEIGHT }),
            updateConnections: shard.mapList[result.id]?.updateConnections ?? new Set<string>(),
        };
        hydrateMapCache({ ...shard, mapList: nextMapList } as FoxholeShardState, result.id);
    }

    shard.mapList = nextMapList;
    for (const mapKey of Object.keys(shard.mapList)) {
        hydrateMapCache(shard, mapKey);
    }
    console.info(`Retrieved data for ${Object.keys(nextMapList).length} maps from WarAPI for shard ${shard.id}`);
}

async function updateWarData(runtime: FoxholeRuntimeState): Promise<void> {
    for (const [shardId, shard] of Object.entries(runtime.shards)) {
        try {
            const response = await $fetch<FoxholeWarData & { winner?: string; }>(`${shard.url}/worldconquest/war`);
            if (!response) {
                throw new Error('No response from WarAPI.');
            }

            shard.live = true;
            if (
                shard.warData?.warId === 'f6429c79-1293-45c3-88d2-796d033a1e0b'
                && shard.warData.conquestStartTime !== response.conquestStartTime
            ) {
                shard.warData.conquestStartTime = response.conquestStartTime;
            }

            const previousWarData = shard.warData;
            const needsRefresh = !previousWarData
                || !Object.keys(shard.mapList).length
                || (previousWarData.warId !== response.warId && response.conquestStartTime !== null)
                || previousWarData.conquestStartTime !== response.conquestStartTime
                || previousWarData.conquestEndTime !== response.conquestEndTime
                || previousWarData.resistanceStartTime !== response.resistanceStartTime
                || previousWarData.scheduledConquestEndTime !== response.scheduledConquestEndTime
                || previousWarData.requiredVictoryTowns !== response.requiredVictoryTowns
                || previousWarData.shortRequiredVictoryTowns !== response.shortRequiredVictoryTowns
                || normalizeString(previousWarData.winner) !== normalizeString(response.winner);

            if (!needsRefresh) {
                continue;
            }

            runtime.shards[shardId] = createShardState(
                shardAccessPoints.find(accessPoint => accessPoint.id === shardId)!,
                shard,
            );
            runtime.shards[shardId].live = true;
            runtime.shards[shardId].warData = response;
            const observedAt = Date.now();
            const refreshedShard = runtime.shards[shardId];
            await fetchShardMaps(refreshedShard);
            for (const connectionId of refreshedShard.updateConnections) {
                const connection = runtime.connections.get(connectionId);
                if (!connection?.request || connection.request.shardId !== refreshedShard.id) {
                    continue;
                }

                sendSnapshot(runtime, connectionId, connection.request);
            }
            const changedMaps = Object.keys(refreshedShard.mapList);
            const playbackEvents = buildWarLifecycleEvents(shard, response, observedAt);
            await capturePlaybackSnapshotForShard(
                refreshedShard,
                'war-state',
                observedAt,
                changedMaps,
                playbackEvents,
            );
        } catch (error) {
            shard.live = false;
            console.error(`Failed to retrieve war info from WarAPI: ${shard.id}, ${(error as Error).message}`);
        }
    }

    await persistRuntimeState(runtime);
}

async function updateWarReport(runtime: FoxholeRuntimeState, force: boolean): Promise<void> {
    for (const shard of Object.values(runtime.shards)) {
        if (!(force || shard.live) || !Object.keys(shard.mapList).length) {
            continue;
        }

        try {
            const mapKeys = Object.keys(shard.mapList);
            const observedAt = Date.now();
            const changedMaps: string[] = [];
            const playbackEvents: FoxholePlaybackEventInput[] = [];
            const requests = mapKeys.map(mapKey => $fetch.raw(`${shard.url}/worldconquest/warReport/${mapKey}`, {
                headers: {
                    'If-None-Match': shard.etags.report[mapKey] ?? '',
                },
            }));
            const maxCasualtyValues = getHourlyCasualtyRingCapacity(REPORT_UPDATE_FREQUENCY);
            const addCasualtyDifference = (values: number[], difference: number) => {
                values.unshift(difference);
                if (values.length > maxCasualtyValues) {
                    values.pop();
                }
            };

            const responses = await Promise.all(requests);
            for (const [index, response] of responses.entries()) {
                const mapKey = mapKeys[index];
                const mapState = mapKey ? shard.mapList[mapKey] : undefined;
                if (!mapKey || !mapState || (response.status !== 200 && response.status !== 304)) {
                    continue;
                }

                shard.etags.report[mapKey] = response.headers.get('etag') ?? '';
                const previousReport = mapState.report ?? {};
                const report = response.status === 200 ? response._data as FoxholeWarReportResponse : previousReport;
                for (const faction of ['colonial', 'warden'] as const) {
                    const previousCasualties = previousReport[faction]?.totalCasualties ?? 0;
                    const casualtyValues = (previousReport[`${faction}CasualtyValues` as const] ?? [])
                        .filter((value): value is number => Number.isFinite(value) && value >= 0);
                    let totalCasualties = previousCasualties;
                    let difference = 0;
                    if (response.status === 200) {
                        const nextCasualties = report[`${faction}Casualties`];
                        if (typeof nextCasualties === 'number') {
                            totalCasualties = nextCasualties;
                            if (totalCasualties < previousCasualties) {
                                casualtyValues.length = 0;
                                difference = Math.max(0, totalCasualties);
                            } else {
                                difference = Math.max(0, totalCasualties - previousCasualties);
                            }
                        }
                    }

                    addCasualtyDifference(casualtyValues, difference);
                    report[`${faction}CasualtyValues` as const] = casualtyValues;
                    report[faction] = buildFactionCasualtySummary(totalCasualties, casualtyValues);
                }

                mapState.report = report;
                hydrateMapCache(shard, mapKey);
                if (response.status === 200) {
                    changedMaps.push(mapKey);
                }
                const connectionIds = new Set<string>([
                    ...mapState.updateConnections,
                    ...shard.updateConnections,
                ]);
                if (connectionIds.size) {
                    broadcastUpdate(runtime, connectionIds, {
                        shardId: shard.id,
                        warId: shard.warData?.warId,
                        warNumber: shard.warData?.warNumber,
                        warStart: shard.warData?.conquestStartTime,
                        conquestEndTime: shard.warData?.conquestEndTime,
                        resistanceStart: shard.warData?.resistanceStartTime,
                        scheduledConquestEndTime: shard.warData?.scheduledConquestEndTime,
                        requiredVictoryTowns: shard.warData?.requiredVictoryTowns,
                        shortRequiredVictoryTowns: shard.warData?.shortRequiredVictoryTowns ?? null,
                        winner: normalizeString(shard.warData?.winner) || null,
                        reports: {
                            [mapKey]: shard.mapCache.reports[mapKey],
                        },
                    });
                }
            }

            await capturePlaybackSnapshotForShard(shard, 'war-report', observedAt, changedMaps, playbackEvents);
        } catch (error) {
            console.error(`Failed to retrieve war reports from WarAPI: ${shard.id}, ${(error as Error).message}`);
        }
    }

    await persistRuntimeState(runtime);
}

async function updateDynamicMapData(runtime: FoxholeRuntimeState, force: boolean): Promise<void> {
    for (const shard of Object.values(runtime.shards)) {
        if (!(force || shard.live) || !Object.keys(shard.mapList).length) {
            continue;
        }

        try {
            const mapKeys = Object.keys(shard.mapList);
            const observedAt = Date.now();
            const changedMaps: string[] = [];
            const playbackEvents: FoxholePlaybackEventInput[] = [];
            const responses = await Promise.all(mapKeys.map(mapKey => $fetch.raw(`${shard.url}/worldconquest/maps/${mapKey}/dynamic/public`, {
                headers: {
                    'If-None-Match': shard.etags.dynamic[mapKey] ?? '',
                },
            })));

            for (const [index, response] of responses.entries()) {
                const mapKey = mapKeys[index];
                const mapState = mapKey ? shard.mapList[mapKey] : undefined;
                if (!mapKey || !mapState || response.status !== 200) {
                    continue;
                }

                const previousSummary = getPlaybackMapSummaryFromShardCache(shard, mapKey);
                const previousDynamic = mapState.dynamic;
                shard.etags.dynamic[mapKey] = response.headers.get('etag') ?? '';
                mapState.dynamic = response._data as FoxholeDynamicMapData;
                changedMaps.push(mapKey);

                const baseIcons = [];
                for (const icon of mapState.dynamic.mapItems) {
                    if (FOXHOLE_TOWN_BASE_ICON_TYPES.has(icon.iconType)) {
                        baseIcons.push({
                            x: icon.x * REGION_WIDTH,
                            y: icon.y * REGION_HEIGHT,
                            icon,
                        });
                    }
                }

                if (baseIcons.length) {
                    if (mapState.voronoi) {
                        try {
                            for (const cell of mapState.voronoi.cells) {
                                let remaining = baseIcons.length;
                                for (let baseIndex = 0; baseIndex < remaining; baseIndex += 1) {
                                    const baseIcon = baseIcons[baseIndex];
                                    if (!baseIcon || !pointInVoronoiCell(baseIcon.x, baseIcon.y, cell)) {
                                        continue;
                                    }

                                    const labelData = cell.site;
                                    if (labelData.mapLabel) {
                                        if (!labelData.mapLabel.iconId) {
                                            labelData.mapLabel.iconId = {
                                                x: Math.floor(baseIcon.x),
                                                y: Math.floor(baseIcon.y),
                                            };
                                        }
                                        if (labelData.mapLabel.teamId === undefined || labelData.mapLabel.teamId !== baseIcon.icon.teamId) {
                                            labelData.mapLabel.teamId = baseIcon.icon.teamId;
                                            labelData.mapLabel.capturedTimestamp = (
                                                labelData.mapLabel.capturedTimestamp === undefined
                                                && shard.warData?.conquestStartTime
                                            ) || Date.now();
                                        }
                                    }

                                    baseIcons.splice(baseIndex, 1);
                                    remaining -= 1;
                                    break;
                                }
                            }
                        } catch {
                            console.error(`Failed to update dynamic data for map ${mapKey} from WarAPI. Voronoi data is invalid.`);
                        }
                        mapState.voronoi = undefined;
                    } else if (mapState.static) {
                        for (const label of mapState.static.mapTextItems) {
                            if (!label.iconId) {
                                continue;
                            }

                            let remaining = baseIcons.length;
                            for (let baseIndex = 0; baseIndex < remaining; baseIndex += 1) {
                                const baseIcon = baseIcons[baseIndex];
                                if (!baseIcon) {
                                    continue;
                                }

                                if (label.iconId.x === Math.floor(baseIcon.x) && label.iconId.y === Math.floor(baseIcon.y)) {
                                    if (label.teamId === undefined || label.teamId !== baseIcon.icon.teamId) {
                                        label.teamId = baseIcon.icon.teamId;
                                        label.capturedTimestamp = (label.capturedTimestamp === undefined && shard.warData?.conquestStartTime) || Date.now();
                                    }
                                    baseIcons.splice(baseIndex, 1);
                                    remaining -= 1;
                                    break;
                                }
                            }
                        }
                    } else {
                        console.error(`Failed to update dynamic data for map ${mapKey} from WarAPI. Static map data is missing.`);
                    }
                }

                hydrateMapCache(shard, mapKey);
                const nextSummary = getPlaybackMapSummaryFromShardCache(shard, mapKey);
                playbackEvents.push(...buildTownOwnershipEvents(shard, mapKey, 'dynamic-map', observedAt, previousSummary, nextSummary));
                playbackEvents.push(...buildTownClaimedEvents(shard, mapKey, 'dynamic-map', observedAt, previousDynamic, mapState.dynamic, nextSummary));
                playbackEvents.push(...buildTownBaseTierEvents(shard, mapKey, 'dynamic-map', observedAt, previousDynamic, mapState.dynamic, nextSummary));
                playbackEvents.push(...buildRocketActivityEvents(shard, mapKey, 'dynamic-map', observedAt, previousDynamic, mapState.dynamic, nextSummary));
                playbackEvents.push(...buildVictoryTownScorchedEvents(shard, mapKey, 'dynamic-map', observedAt, previousDynamic, mapState.dynamic, nextSummary));
                const connectionIds = new Set<string>([
                    ...mapState.updateConnections,
                    ...shard.updateConnections,
                ]);
                if (connectionIds.size) {
                    const labelEntry = shard.mapCache.labels[mapKey];
                    const iconEntry = shard.mapCache.icons[mapKey];
                    broadcastUpdate(runtime, connectionIds, {
                        shardId: shard.id,
                        warId: shard.warData?.warId,
                        warNumber: shard.warData?.warNumber,
                        warStart: shard.warData?.conquestStartTime,
                        conquestEndTime: shard.warData?.conquestEndTime,
                        resistanceStart: shard.warData?.resistanceStartTime,
                        scheduledConquestEndTime: shard.warData?.scheduledConquestEndTime,
                        requiredVictoryTowns: shard.warData?.requiredVictoryTowns,
                        shortRequiredVictoryTowns: shard.warData?.shortRequiredVictoryTowns ?? null,
                        winner: normalizeString(shard.warData?.winner) || null,
                        labels: labelEntry
                            ? {
                                [mapKey]: labelEntry,
                            }
                            : undefined,
                        icons: iconEntry
                            ? {
                                [mapKey]: iconEntry,
                            }
                            : undefined,
                    });
                }
            }

            await capturePlaybackSnapshotForShard(shard, 'dynamic-map', observedAt, changedMaps, playbackEvents);
        } catch (error) {
            console.error(`Failed to retrieve dynamic war data from WarAPI: ${shard.id}, ${(error as Error).message}`);
        }
    }

    await persistRuntimeState(runtime);
}

function runBackgroundUpdate(label: string, update: () => Promise<void>): void {
    void update().catch(error => {
        console.error(`Foxhole realtime ${label} update failed.`, error);
    });
}

export async function startFoxholeRealtimeService(): Promise<void> {
    const runtime = getRuntimeState();
    if (runtime.started) {
        return;
    }

    if (runtime.startingPromise) {
        await runtime.startingPromise;
        return;
    }

    runtime.startingPromise = (async () => {
        await hydrateRuntimeFromCache(runtime);
        await updateWarData(runtime);
        await updateWarReport(runtime, true);
        await updateDynamicMapData(runtime, true);

        runtime.timers.push(setInterval(() => {
            runBackgroundUpdate('war data', () => updateWarData(runtime));
        }, WAR_UPDATE_FREQUENCY));
        runtime.timers.push(setInterval(() => {
            runBackgroundUpdate('war reports', () => updateWarReport(runtime, false));
        }, REPORT_UPDATE_FREQUENCY));
        runtime.timers.push(setInterval(() => {
            runBackgroundUpdate('dynamic map data', () => updateDynamicMapData(runtime, false));
        }, DYNAMIC_UPDATE_FREQUENCY));
        runtime.started = true;
        console.info('Foxhole realtime service started.');
    })();

    try {
        await runtime.startingPromise;
    } finally {
        runtime.startingPromise = null;
    }
}

export function getFoxholeRealtimeShards(): Array<{ id: string; name: string; default: boolean; }> {
    const runtime = getRuntimeState();
    const defaultShardId = Object.values(runtime.shards).find(shard => shard.live)?.id;
    return Object.values(runtime.shards)
        .filter(shard => shard.live)
        .map(shard => ({
            id: shard.id,
            name: shard.name,
            default: shard.id === defaultShardId,
        }));
}

export function getFoxholeRealtimeStats(): {
    shards: Record<string, {
        id: string;
        live: boolean;
        warData: FoxholeWarData | undefined;
        warTimesLocale: {
            conquestStart: string | undefined;
            conquestEnd: string | undefined;
            resistanceStart: string | undefined;
        };
    }>;
    totalConnections: number;
    uptime: number;
} {
    const runtime = getRuntimeState();
    return {
        shards: Object.fromEntries(Object.values(runtime.shards).map(shard => [
            shard.id,
            {
                id: shard.id,
                live: shard.live,
                warData: shard.warData,
                warTimesLocale: {
                    conquestStart: shard.warData?.conquestStartTime ? new Date(shard.warData.conquestStartTime).toLocaleString() : undefined,
                    conquestEnd: shard.warData?.conquestEndTime ? new Date(shard.warData.conquestEndTime).toLocaleString() : undefined,
                    resistanceStart: shard.warData?.resistanceStartTime ? new Date(shard.warData.resistanceStartTime).toLocaleString() : undefined,
                },
            },
        ])),
        totalConnections: runtime.connections.size,
        uptime: process.uptime(),
    };
}

export function registerFoxholeConnection(peer: FoxholePeer): string {
    const runtime = getRuntimeState();
    const connectionId = `foxhole-${runtime.nextConnectionId}`;
    runtime.nextConnectionId += 1;
    runtime.connections.set(connectionId, { id: connectionId, peer });
    runtime.peerIds.set(peer as object, connectionId);
    return connectionId;
}

export function unregisterFoxholeConnection(peer: FoxholePeer): void {
    const runtime = getRuntimeState();
    const connectionId = runtime.peerIds.get(peer as object);
    if (!connectionId) {
        return;
    }

    const connection = runtime.connections.get(connectionId);
    removeConnectionSubscriptions(runtime, connection?.request, connectionId);
    runtime.connections.delete(connectionId);
    runtime.peerIds.delete(peer as object);
}

export function handleFoxholeRealtimeMessage(peer: FoxholePeer, text: string): void {
    const runtime = getRuntimeState();
    const connectionId = runtime.peerIds.get(peer as object);
    if (!connectionId) {
        return;
    }

    const connection = runtime.connections.get(connectionId);
    if (!connection) {
        return;
    }

    let parsed: { type?: string; payload?: FoxholeRawClientRequest; } | FoxholeRawClientRequest;
    try {
        parsed = JSON.parse(text) as { type?: string; payload?: FoxholeRawClientRequest; } | FoxholeRawClientRequest;
    } catch {
        sendPeerMessage(peer, {
            type: 'error',
            payload: { message: 'Invalid JSON message.' },
        });
        return;
    }

    let request: FoxholeRawClientRequest | undefined;
    if ('type' in parsed) {
        request = parsed.type === 'request-maps' ? parsed.payload : undefined;
    } else {
        request = parsed as FoxholeRawClientRequest;
    }
    if (!request) {
        sendPeerMessage(peer, {
            type: 'error',
            payload: { message: 'Unsupported realtime message.' },
        });
        return;
    }

    const nextRequest = validateFoxholeClientRequest(request, runtime.shards);
    const previousRequest = connection.request;
    if (previousRequest && shouldResetFoxholeSubscription(previousRequest, nextRequest)) {
        removeConnectionSubscriptions(runtime, previousRequest, connectionId);
    }

    connection.request = nextRequest;
    if (!previousRequest || shouldResetFoxholeSubscription(previousRequest, nextRequest) || !previousRequest.updates) {
        addConnectionSubscriptions(runtime, nextRequest, connectionId);
    }

    sendSnapshot(runtime, connectionId, nextRequest);
}
