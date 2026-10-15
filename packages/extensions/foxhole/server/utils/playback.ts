import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createError } from 'h3';
import { useRuntimeConfig } from '#imports';
import { isFoxholePlaybackDbLoggingEnabled } from './service-config.ts';

type JsonObject = Record<string, any>;

interface FoxholePlaybackServiceRuntimeState {
    serviceClient: SupabaseClient | null;
    warnedMissingConfig: boolean;
    snapshotWriteQueues: Map<string, Promise<void>>;
    hydratedFrameCache: Map<string, FoxholePlaybackFrameRecord>;
}

interface FoxholePlaybackCheckpointRow {
    id?: string;
    shard_id?: string | null;
    war_id?: string | null;
    war_number?: number | null;
    last_frame_sequence?: number | null;
    last_frame_hash?: string | null;
    latest_frame_id?: string | null;
    latest_captured_at?: string | null;
    latest_source?: string | null;
    last_changed_map_keys?: string[] | null;
}

interface FoxholePlaybackFrameRow {
    id?: string | null;
    shard_id?: string | null;
    war_id?: string | null;
    war_number?: number | null;
    source?: string | null;
    captured_at?: string | null;
    frame_sequence?: number | null;
    changed_map_keys?: string[] | null;
    payload_hash?: string | null;
    summary?: JsonObject | null;
    payload?: FoxholePlaybackFramePayload | null;
    is_keyframe?: boolean | null;
}

interface FoxholePlaybackEventRow {
    id?: string | null;
    shard_id?: string | null;
    war_id?: string | null;
    war_number?: number | null;
    map_key?: string | null;
    event_type?: string | null;
    source?: string | null;
    observed_at?: string | null;
    data?: unknown;
}

export interface FoxholePlaybackWarData {
    warId?: string;
    warNumber?: number;
    conquestStartTime?: number | null;
    conquestEndTime?: number | null;
    resistanceStartTime?: number | null;
    scheduledConquestEndTime?: number | null;
    requiredVictoryTowns?: number;
    shortRequiredVictoryTowns?: number | null;
    winner?: string | null;
}

export interface FoxholePlaybackMapLayerEntry {
    version?: number;
    items?: any[];
}

export interface FoxholePlaybackMapSummary {
    mapKey: string;
    labelVersion: number | null;
    iconVersion: number | null;
    reportVersion: number | null;
    ownership: Array<{
        name: string;
        teamId: string;
        capturedTimestamp: number | null;
        x: number | null;
        y: number | null;
    }>;
    structureCounts: Record<string, number>;
    totalLabels: number;
    totalIcons: number;
    report: {
        dayOfWar: number | null;
        totalEnlistments: number | null;
        colonialTotalCasualties: number | null;
        colonialHourlyCasualties: number | null;
        wardenTotalCasualties: number | null;
        wardenHourlyCasualties: number | null;
    } | null;
}

export interface FoxholePlaybackEventInput {
    shardId: string;
    warId?: string;
    warNumber?: number;
    mapKey?: string;
    eventType: string;
    source: string;
    observedAt?: number;
    data: unknown;
}

export interface FoxholePlaybackSnapshotInput {
    shardId: string;
    source: string;
    capturedAt?: number;
    warData?: FoxholePlaybackWarData;
    reports?: Record<string, any>;
    labels?: Record<string, FoxholePlaybackMapLayerEntry>;
    icons?: Record<string, FoxholePlaybackMapLayerEntry>;
    changedMaps?: string[];
    events?: FoxholePlaybackEventInput[];
}

export interface FoxholePlaybackShardSummary {
    shardId: string;
    latestWarId: string | null;
    latestWarNumber: number | null;
    latestCapturedAt: string | null;
    latestSource: string | null;
    latestFrameSequence: number;
    availableWars: Array<{
        warId: string | null;
        warNumber: number | null;
        latestCapturedAt: string | null;
        latestFrameSequence: number;
    }>;
}

export interface FoxholePlaybackTimelineItem {
    id: string;
    shardId: string;
    warId: string | null;
    warNumber: number | null;
    source: string;
    capturedAt: string;
    frameSequence: number;
    changedMapKeys: string[];
    summary: JsonObject;
}

export interface FoxholePlaybackFramePayload {
    shardId: string;
    warId: string | null;
    warNumber: number | null;
    warStart: number | null;
    warEnd: number | null;
    resistanceStart: number | null;
    scheduledConquestEndTime: number | null;
    requiredVictoryTowns: number | null;
    shortRequiredVictoryTowns: number | null;
    winner: string | null;
    reports: Record<string, any>;
    labels: Record<string, FoxholePlaybackMapLayerEntry>;
    icons: Record<string, FoxholePlaybackMapLayerEntry>;
    summaries: Record<string, FoxholePlaybackMapSummary>;
}

export interface FoxholePlaybackFrameRecord {
    id: string;
    shardId: string;
    warId: string | null;
    warNumber: number | null;
    source: string;
    capturedAt: string;
    frameSequence: number;
    changedMapKeys: string[];
    summary: JsonObject;
    payload: FoxholePlaybackFramePayload;
}

export interface FoxholePlaybackEventRecord {
    id: string;
    shardId: string;
    warId: string | null;
    warNumber: number | null;
    mapKey: string | null;
    eventType: string;
    source: string;
    observedAt: string;
    data: unknown;
}

declare global {
    var __foxholePlaybackRuntimeState: FoxholePlaybackServiceRuntimeState | undefined;
}

const PLAYBACK_KEYFRAME_INTERVAL = 8;
const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** 24h UI window + 2h buffer so delta hydration at the window edge can still find a keyframe. */
const FRAME_RETENTION_MS = 26 * 60 * 60 * 1000;
const PLAYBACK_PURGE_BATCH_SIZE = 250;
const SEMANTIC_EVENT_DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
const HYDRATED_PLAYBACK_FRAME_CACHE_LIMIT = 160;
const WAR_EVENTS_TABLE = 'foxhole_war_events';
const PLAYBACK_FRAMES_TABLE = 'foxhole_playback_frames';
const PLAYBACK_CHECKPOINTS_TABLE = 'foxhole_playback_checkpoints';
const SEMANTIC_PLAYBACK_EVENT_TYPES = Object.freeze([
    'town-captured',
    'town-neutralized',
    'town-claimed',
    'town-base-upgraded',
    'town-base-downgraded',
    'rocket-targeted',
    'rocket-impact',
    'rocket-ready',
    'victory-town-scorched',
    'short-conquest-scheduled',
    'war-started',
    'resistance-started',
    'war-ended',
    'war-winner-declared',
]);
const LEGACY_PLAYBACK_EVENT_TYPES = Object.freeze([
    'snapshot-derived',
    'war-updated',
    'map-static-refreshed',
    'map-report-updated',
    'map-dynamic-updated',
]);

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeMapKeyList(values: readonly string[] | null | undefined): string[] {
    return Array.from(new Set((values ?? []).map(value => normalizeString(value)).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function asNumberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(item => stableValue(item));
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort((left, right) => left.localeCompare(right)).map(key => [key, stableValue(record[key])]));
}

function hashValue(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function parseIsoTimestamp(value: unknown): number | null {
    const normalizedValue = normalizeString(value);
    if (!normalizedValue) {
        return null;
    }

    const parsed = Date.parse(normalizedValue);
    return Number.isFinite(parsed) ? parsed : null;
}

function asEventDataRecord(data: unknown): JsonObject {
    return data && typeof data === 'object' ? data as JsonObject : {};
}

function formatEventCoordinate(value: unknown): string {
    const coordinate = asNumberOrNull(value);
    return coordinate === null ? 'na' : coordinate.toFixed(4);
}

function buildPlaybackEventDedupKey(event: Pick<FoxholePlaybackEventRecord, 'shardId' | 'warId' | 'mapKey' | 'eventType' | 'data'>): string | null {
    const eventType = normalizeString(event.eventType);
    const eventData = asEventDataRecord(event.data);

    switch (eventType) {
        case 'town-captured':
        case 'town-neutralized': {
            const townName = normalizeString(eventData.townName).toLowerCase();
            const previousTeamId = normalizeString(eventData.previousTeamId);
            const nextTeamId = normalizeString(eventData.nextTeamId);
            const mapKey = normalizeString(event.mapKey || eventData.mapKey);
            if (!townName || !previousTeamId || !nextTeamId || !mapKey) {
                return null;
            }

            return [
                eventType,
                normalizeString(event.shardId),
                normalizeString(event.warId ?? ''),
                mapKey,
                townName,
                previousTeamId,
                nextTeamId,
                formatEventCoordinate(eventData.x),
                formatEventCoordinate(eventData.y),
            ].join(':');
        }
        case 'town-claimed': {
            const townName = normalizeString(eventData.townName).toLowerCase();
            const mapKey = normalizeString(event.mapKey || eventData.mapKey);
            if (!mapKey) {
                return null;
            }

            return [
                eventType,
                normalizeString(event.shardId),
                normalizeString(event.warId ?? ''),
                mapKey,
                townName,
                normalizeString(eventData.teamId),
                formatEventCoordinate(eventData.x),
                formatEventCoordinate(eventData.y),
            ].join(':');
        }
        case 'town-base-upgraded':
        case 'town-base-downgraded': {
            const townName = normalizeString(eventData.townName).toLowerCase();
            const mapKey = normalizeString(event.mapKey || eventData.mapKey);
            if (!mapKey) {
                return null;
            }

            return [
                eventType,
                normalizeString(event.shardId),
                normalizeString(event.warId ?? ''),
                mapKey,
                townName,
                normalizeString(eventData.teamId),
                normalizeString(eventData.baseType),
                String(asNumberOrNull(eventData.previousTier) ?? ''),
                String(asNumberOrNull(eventData.nextTier) ?? ''),
                formatEventCoordinate(eventData.x),
                formatEventCoordinate(eventData.y),
            ].join(':');
        }
        case 'rocket-impact':
        case 'rocket-targeted':
        case 'rocket-ready': {
            const mapKey = normalizeString(event.mapKey || eventData.mapKey);
            if (!mapKey) {
                return null;
            }

            return [
                eventType,
                normalizeString(event.shardId),
                normalizeString(event.warId ?? ''),
                mapKey,
                normalizeString(eventData.teamId),
                formatEventCoordinate(eventData.x),
                formatEventCoordinate(eventData.y),
            ].join(':');
        }
        case 'victory-town-scorched': {
            const mapKey = normalizeString(event.mapKey || eventData.mapKey);
            const townName = normalizeString(eventData.townName).toLowerCase();
            if (!mapKey) {
                return null;
            }

            return [
                eventType,
                normalizeString(event.shardId),
                normalizeString(event.warId ?? ''),
                mapKey,
                townName,
                normalizeString(eventData.teamId),
                formatEventCoordinate(eventData.x),
                formatEventCoordinate(eventData.y),
            ].join(':');
        }
        case 'war-started':
        case 'short-conquest-scheduled':
        case 'resistance-started':
        case 'war-ended':
        case 'war-winner-declared':
            if (eventType === 'short-conquest-scheduled') {
                return [
                    eventType,
                    normalizeString(event.shardId),
                    normalizeString(event.warId ?? ''),
                    String(asNumberOrNull(eventData.scheduledConquestEndTime) ?? ''),
                    String(asNumberOrNull(eventData.shortRequiredVictoryTowns) ?? ''),
                ].join(':');
            }

            return [
                eventType,
                normalizeString(event.shardId),
                normalizeString(event.warId ?? ''),
                normalizeString(eventData.winner ?? ''),
            ].join(':');
        default:
            return null;
    }
}

function getPlaybackEventTimestampMs(event: Pick<FoxholePlaybackEventRecord, 'observedAt' | 'data'>): number | null {
    const eventData = asEventDataRecord(event.data);
    return asNumberOrNull(eventData.capturedTimestamp) ?? parseIsoTimestamp(event.observedAt);
}

function isNearDuplicatePlaybackEvent(
    previousEvent: Pick<FoxholePlaybackEventRecord, 'shardId' | 'warId' | 'mapKey' | 'eventType' | 'observedAt' | 'data'>,
    nextEvent: Pick<FoxholePlaybackEventRecord, 'shardId' | 'warId' | 'mapKey' | 'eventType' | 'observedAt' | 'data'>,
): boolean {
    const previousKey = buildPlaybackEventDedupKey(previousEvent);
    const nextKey = buildPlaybackEventDedupKey(nextEvent);
    if (!previousKey || !nextKey || previousKey !== nextKey) {
        return false;
    }

    if (![
        'town-captured',
        'town-neutralized',
        'town-claimed',
        'town-base-upgraded',
        'town-base-downgraded',
        'rocket-targeted',
        'rocket-impact',
        'rocket-ready',
        'victory-town-scorched',
    ].includes(normalizeString(previousEvent.eventType))) {
        return true;
    }

    const previousTimestamp = getPlaybackEventTimestampMs(previousEvent);
    const nextTimestamp = getPlaybackEventTimestampMs(nextEvent);
    if (previousTimestamp === null || nextTimestamp === null) {
        return true;
    }

    return Math.abs(nextTimestamp - previousTimestamp) <= SEMANTIC_EVENT_DUPLICATE_WINDOW_MS;
}

function mapPlaybackEventRowToRecord(row: FoxholePlaybackEventRow): FoxholePlaybackEventRecord {
    return {
        id: normalizeString(row.id),
        shardId: normalizeString(row.shard_id),
        warId: normalizeString(row.war_id) || null,
        warNumber: asNumberOrNull(row.war_number),
        mapKey: normalizeString(row.map_key) || null,
        eventType: normalizeString(row.event_type),
        source: normalizeString(row.source),
        observedAt: normalizeString(row.observed_at),
        data: row.data ?? null,
    };
}

function sortPlaybackEventsAscending(events: readonly FoxholePlaybackEventRecord[]): FoxholePlaybackEventRecord[] {
    return [...events].sort((left, right) => {
        const leftTimestamp = getPlaybackEventTimestampMs(left) ?? parseIsoTimestamp(left.observedAt) ?? 0;
        const rightTimestamp = getPlaybackEventTimestampMs(right) ?? parseIsoTimestamp(right.observedAt) ?? 0;
        if (leftTimestamp !== rightTimestamp) {
            return leftTimestamp - rightTimestamp;
        }

        return left.id.localeCompare(right.id);
    });
}

function sortPlaybackEventsDescending(events: readonly FoxholePlaybackEventRecord[]): FoxholePlaybackEventRecord[] {
    return [...events].sort((left, right) => {
        const leftTimestamp = parseIsoTimestamp(left.observedAt) ?? getPlaybackEventTimestampMs(left) ?? 0;
        const rightTimestamp = parseIsoTimestamp(right.observedAt) ?? getPlaybackEventTimestampMs(right) ?? 0;
        if (leftTimestamp !== rightTimestamp) {
            return rightTimestamp - leftTimestamp;
        }

        return left.id.localeCompare(right.id);
    });
}

function dedupePlaybackEvents(events: readonly FoxholePlaybackEventRecord[]): FoxholePlaybackEventRecord[] {
    const dedupedEvents: FoxholePlaybackEventRecord[] = [];
    const lastEventByKey = new Map<string, FoxholePlaybackEventRecord>();

    for (const event of sortPlaybackEventsAscending(events)) {
        const eventKey = buildPlaybackEventDedupKey(event);
        if (!eventKey) {
            dedupedEvents.push(event);
            continue;
        }

        const previousEvent = lastEventByKey.get(eventKey);
        if (previousEvent && isNearDuplicatePlaybackEvent(previousEvent, event)) {
            continue;
        }

        lastEventByKey.set(eventKey, event);
        dedupedEvents.push(event);
    }

    return sortPlaybackEventsDescending(dedupedEvents);
}

function createRuntimeState(): FoxholePlaybackServiceRuntimeState {
    return {
        serviceClient: null,
        warnedMissingConfig: false,
        snapshotWriteQueues: new Map<string, Promise<void>>(),
        hydratedFrameCache: new Map<string, FoxholePlaybackFrameRecord>(),
    };
}

function readCachedHydratedPlaybackFrame(frameId: string): FoxholePlaybackFrameRecord | null {
    const normalizedFrameId = normalizeString(frameId);
    if (!normalizedFrameId) {
        return null;
    }

    const cache = getRuntimeState().hydratedFrameCache;
    const cachedFrame = cache.get(normalizedFrameId);
    if (!cachedFrame) {
        return null;
    }

    cache.delete(normalizedFrameId);
    cache.set(normalizedFrameId, cachedFrame);
    return cachedFrame;
}

function storeCachedHydratedPlaybackFrame(frame: FoxholePlaybackFrameRecord): void {
    const normalizedFrameId = normalizeString(frame.id);
    if (!normalizedFrameId) {
        return;
    }

    const cache = getRuntimeState().hydratedFrameCache;
    cache.delete(normalizedFrameId);
    cache.set(normalizedFrameId, frame);

    while (cache.size > HYDRATED_PLAYBACK_FRAME_CACHE_LIMIT) {
        const oldestFrameId = cache.keys().next().value;
        if (!oldestFrameId) {
            break;
        }

        cache.delete(oldestFrameId);
    }
}

function getRuntimeState(): FoxholePlaybackServiceRuntimeState {
    if (!globalThis.__foxholePlaybackRuntimeState) {
        globalThis.__foxholePlaybackRuntimeState = createRuntimeState();
    }

    return globalThis.__foxholePlaybackRuntimeState;
}

function createPlaybackServiceClient(required: boolean): SupabaseClient | null {
    const config = useRuntimeConfig() as {
        supabase?: {
            serviceKey?: string;
            secretKey?: string;
        };
        public?: {
            supabase?: {
                url?: string;
            };
        };
    };
    const supabaseUrl = normalizeString(config.public?.supabase?.url);
    const serviceKey = normalizeString(config.supabase?.serviceKey || config.supabase?.secretKey);

    if (!supabaseUrl || !serviceKey) {
        if (required) {
            throw createError({
                statusCode: 503,
                statusMessage: 'Foxhole playback storage is not configured.',
            });
        }

        const runtime = getRuntimeState();
        if (!runtime.warnedMissingConfig) {
            runtime.warnedMissingConfig = true;
            console.warn('[foxhole:playback] Supabase service-role credentials are not configured; playback persistence is disabled.');
        }

        return null;
    }

    return createClient(supabaseUrl, serviceKey, {
        auth: {
            autoRefreshToken: false,
            detectSessionInUrl: false,
            persistSession: false,
        },
    });
}

function getPlaybackServiceClient(required = false): SupabaseClient | null {
    const runtime = getRuntimeState();
    if (!runtime.serviceClient) {
        runtime.serviceClient = createPlaybackServiceClient(required);
    }

    if (!runtime.serviceClient && required) {
        runtime.serviceClient = createPlaybackServiceClient(true);
    }

    return runtime.serviceClient;
}

function buildSnapshotQueueKey(shardId: string, warId: string | null): string {
    return `${normalizeString(shardId)}:${normalizeString(warId ?? '')}`;
}

async function withSnapshotWriteLock<T>(
    shardId: string,
    warId: string | null,
    work: () => Promise<T>,
): Promise<T> {
    const runtime = getRuntimeState();
    const queueKey = buildSnapshotQueueKey(shardId, warId);
    const previous = runtime.snapshotWriteQueues.get(queueKey) ?? Promise.resolve();

    let releaseQueue!: () => void;
    const current = new Promise<void>(resolve => {
        releaseQueue = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => current);
    runtime.snapshotWriteQueues.set(queueKey, queued);

    await previous.catch(() => undefined);

    try {
        return await work();
    } finally {
        releaseQueue();
        if (runtime.snapshotWriteQueues.get(queueKey) === queued) {
            runtime.snapshotWriteQueues.delete(queueKey);
        }
    }
}

function buildMapOwnership(labelsEntry: FoxholePlaybackMapLayerEntry | null | undefined): FoxholePlaybackMapSummary['ownership'] {
    const labels = Array.isArray(labelsEntry?.items) ? labelsEntry.items : [];
    return labels
        .filter(label => label && typeof label === 'object' && normalizeString(label.teamId) && normalizeString(label.mapMarkerType) === 'Major')
        .map(label => ({
            name: normalizeString(label.text || label.name || label.mapText || 'Unknown Town') || 'Unknown Town',
            teamId: normalizeString(label.teamId),
            capturedTimestamp: asNumberOrNull(label.capturedTimestamp),
            x: asNumberOrNull(label.x),
            y: asNumberOrNull(label.y),
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
}

function buildStructureCounts(iconsEntry: FoxholePlaybackMapLayerEntry | null | undefined): Record<string, number> {
    const icons = Array.isArray(iconsEntry?.items) ? iconsEntry.items : [];
    const counts: Record<string, number> = {};
    for (const icon of icons) {
        const teamId = normalizeString(icon?.teamId) || 'NONE';
        const iconType = asNumberOrNull(icon?.iconType);
        const key = iconType === null ? `${teamId}:unknown` : `${teamId}:${iconType}`;
        counts[key] = (counts[key] ?? 0) + 1;
    }

    return counts;
}

function buildReportSummary(reportEntry: any): FoxholePlaybackMapSummary['report'] {
    if (!reportEntry || typeof reportEntry !== 'object') {
        return null;
    }

    return {
        dayOfWar: asNumberOrNull(reportEntry.dayOfWar),
        totalEnlistments: asNumberOrNull(reportEntry.totalEnlistments),
        colonialTotalCasualties: asNumberOrNull(reportEntry.factions?.colonial?.totalCasualties),
        colonialHourlyCasualties: asNumberOrNull(reportEntry.factions?.colonial?.totalHourlyCasualties),
        wardenTotalCasualties: asNumberOrNull(reportEntry.factions?.warden?.totalCasualties),
        wardenHourlyCasualties: asNumberOrNull(reportEntry.factions?.warden?.totalHourlyCasualties),
    };
}

function createEmptyPlaybackMapLayerEntry(): FoxholePlaybackMapLayerEntry {
    return {
        items: [],
    };
}

export function buildFoxholePlaybackMapSummary(
    mapKey: string,
    layers: {
        report?: any;
        labels?: FoxholePlaybackMapLayerEntry | null;
        icons?: FoxholePlaybackMapLayerEntry | null;
    },
): FoxholePlaybackMapSummary {
    const normalizedMapKey = normalizeString(mapKey);
    return {
        mapKey: normalizedMapKey,
        labelVersion: asNumberOrNull(layers.labels?.version),
        iconVersion: asNumberOrNull(layers.icons?.version),
        reportVersion: asNumberOrNull(layers.report?.version),
        ownership: buildMapOwnership(layers.labels),
        structureCounts: buildStructureCounts(layers.icons),
        totalLabels: Array.isArray(layers.labels?.items) ? layers.labels.items.length : 0,
        totalIcons: Array.isArray(layers.icons?.items) ? layers.icons.items.length : 0,
        report: buildReportSummary(layers.report),
    };
}

function buildFramePayload(input: FoxholePlaybackSnapshotInput): FoxholePlaybackFramePayload {
    const reportMap = input.reports ?? {};
    const labelMap = input.labels ?? {};
    const iconMap = input.icons ?? {};
    const allMapKeys = normalizeMapKeyList([
        ...Object.keys(reportMap),
        ...Object.keys(labelMap),
        ...Object.keys(iconMap),
    ]);

    return {
        shardId: input.shardId,
        warId: normalizeString(input.warData?.warId) || null,
        warNumber: asNumberOrNull(input.warData?.warNumber),
        warStart: asNumberOrNull(input.warData?.conquestStartTime),
        warEnd: asNumberOrNull(input.warData?.conquestEndTime),
        resistanceStart: asNumberOrNull(input.warData?.resistanceStartTime),
        scheduledConquestEndTime: asNumberOrNull(input.warData?.scheduledConquestEndTime),
        requiredVictoryTowns: asNumberOrNull(input.warData?.requiredVictoryTowns),
        shortRequiredVictoryTowns: asNumberOrNull(input.warData?.shortRequiredVictoryTowns),
        winner: normalizeString(input.warData?.winner) || null,
        reports: Object.fromEntries(allMapKeys.map(mapKey => [mapKey, reportMap[mapKey] ?? null])),
        labels: Object.fromEntries(allMapKeys.map(mapKey => [mapKey, labelMap[mapKey] ?? createEmptyPlaybackMapLayerEntry()])),
        icons: Object.fromEntries(allMapKeys.map(mapKey => [mapKey, iconMap[mapKey] ?? createEmptyPlaybackMapLayerEntry()])),
        summaries: Object.fromEntries(allMapKeys.map(mapKey => [mapKey, buildFoxholePlaybackMapSummary(mapKey, {
            report: reportMap[mapKey],
            labels: labelMap[mapKey],
            icons: iconMap[mapKey],
        })])),
    };
}

function countVictoryTownsByTeam(payload: FoxholePlaybackFramePayload): Record<string, number> {
    const totals: Record<string, number> = {};

    for (const iconLayer of Object.values(payload.icons ?? {})) {
        for (const icon of iconLayer?.items ?? []) {
            if (!icon || typeof icon !== 'object') {
                continue;
            }

            const flags = asNumberOrNull((icon as { flags?: number | null; }).flags);
            if (flags === null || (flags & 0x01) === 0) {
                continue;
            }

            const teamId = normalizeString((icon as { teamId?: string | null; }).teamId);
            if (!teamId) {
                continue;
            }

            totals[teamId] = (totals[teamId] ?? 0) + 1;
        }
    }

    return totals;
}

function buildFrameSummary(payload: FoxholePlaybackFramePayload, changedMapKeys: string[]): JsonObject {
    const maps = Object.values(payload.summaries);
    const ownership = maps.flatMap(map => map.ownership);

    return {
        mapCount: maps.length,
        changedMapCount: changedMapKeys.length,
        totalIcons: maps.reduce((total, map) => total + map.totalIcons, 0),
        totalLabels: maps.reduce((total, map) => total + map.totalLabels, 0),
        controlledTowns: ownership.reduce<Record<string, number>>((totals, town) => {
            totals[town.teamId] = (totals[town.teamId] ?? 0) + 1;
            return totals;
        }, {}),
        victoryTowns: countVictoryTownsByTeam(payload),
        requiredVictoryTowns: payload.requiredVictoryTowns,
        casualtyTotals: maps.reduce((totals, map) => {
            totals.colonial = (totals.colonial ?? 0) + (map.report?.colonialTotalCasualties ?? 0);
            totals.warden = (totals.warden ?? 0) + (map.report?.wardenTotalCasualties ?? 0);
            return totals;
        }, {} as Record<string, number>),
    };
}

function clonePlaybackFramePayload(payload: FoxholePlaybackFramePayload): FoxholePlaybackFramePayload {
    return JSON.parse(JSON.stringify(payload)) as FoxholePlaybackFramePayload;
}

function pickPlaybackMapSubset<TValue>(
    values: Record<string, TValue>,
    keys: readonly string[],
): Record<string, TValue> {
    const subset: Record<string, TValue> = {};
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(values, key)) {
            subset[key] = values[key] as TValue;
        }
    }

    return subset;
}

function buildStoredFramePayload(
    payload: FoxholePlaybackFramePayload,
    changedMapKeys: readonly string[],
    isKeyframe: boolean,
): FoxholePlaybackFramePayload {
    if (isKeyframe) {
        return payload;
    }

    return {
        shardId: payload.shardId,
        warId: payload.warId,
        warNumber: payload.warNumber,
        warStart: payload.warStart,
        warEnd: payload.warEnd,
        resistanceStart: payload.resistanceStart,
        scheduledConquestEndTime: payload.scheduledConquestEndTime,
        requiredVictoryTowns: payload.requiredVictoryTowns,
        shortRequiredVictoryTowns: payload.shortRequiredVictoryTowns,
        winner: payload.winner,
        reports: pickPlaybackMapSubset(payload.reports, changedMapKeys),
        labels: pickPlaybackMapSubset(payload.labels, changedMapKeys),
        icons: pickPlaybackMapSubset(payload.icons, changedMapKeys),
        summaries: pickPlaybackMapSubset(payload.summaries, changedMapKeys),
    };
}

function applyPlaybackFrameDelta(
    basePayload: FoxholePlaybackFramePayload,
    deltaPayload: FoxholePlaybackFramePayload,
): FoxholePlaybackFramePayload {
    const nextPayload = clonePlaybackFramePayload(basePayload);

    nextPayload.shardId = normalizeString(deltaPayload.shardId) || nextPayload.shardId;
    nextPayload.warId = deltaPayload.warId;
    nextPayload.warNumber = deltaPayload.warNumber;
    nextPayload.warStart = deltaPayload.warStart;
    nextPayload.warEnd = deltaPayload.warEnd;
    nextPayload.resistanceStart = deltaPayload.resistanceStart;
    nextPayload.scheduledConquestEndTime = deltaPayload.scheduledConquestEndTime;
    nextPayload.requiredVictoryTowns = deltaPayload.requiredVictoryTowns;
    nextPayload.shortRequiredVictoryTowns = deltaPayload.shortRequiredVictoryTowns;
    nextPayload.winner = deltaPayload.winner;

    for (const [mapKey, value] of Object.entries(deltaPayload.reports ?? {})) {
        nextPayload.reports[mapKey] = value;
    }
    for (const [mapKey, value] of Object.entries(deltaPayload.labels ?? {})) {
        nextPayload.labels[mapKey] = value as FoxholePlaybackMapLayerEntry;
    }
    for (const [mapKey, value] of Object.entries(deltaPayload.icons ?? {})) {
        nextPayload.icons[mapKey] = value as FoxholePlaybackMapLayerEntry;
    }
    for (const [mapKey, value] of Object.entries(deltaPayload.summaries ?? {})) {
        nextPayload.summaries[mapKey] = value as FoxholePlaybackMapSummary;
    }

    return nextPayload;
}

function shouldStoreKeyframe(input: FoxholePlaybackSnapshotInput, nextSequence: number): boolean {
    return nextSequence === 1
        || input.source === 'war-state'
        || (nextSequence % PLAYBACK_KEYFRAME_INTERVAL) === 0;
}

function buildEventRows(input: FoxholePlaybackSnapshotInput): Array<Record<string, unknown>> {
    return (input.events ?? []).map(event => ({
        shard_id: normalizeString(event.shardId),
        war_id: normalizeString(event.warId || input.warData?.warId) || null,
        war_number: asNumberOrNull(event.warNumber ?? input.warData?.warNumber),
        map_key: normalizeString(event.mapKey) || null,
        event_type: normalizeString(event.eventType),
        source: normalizeString(event.source) || input.source,
        observed_at: new Date(event.observedAt ?? input.capturedAt ?? Date.now()).toISOString(),
        payload_hash: hashValue(event.data),
        data: stableValue(event.data),
    })).filter(row => normalizeString(row.event_type));
}

function isUniqueViolationError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const code = normalizeString((error as { code?: unknown; }).code);
    return code === '23505';
}

async function insertPlaybackEventRows(
    client: SupabaseClient,
    eventRows: Array<Record<string, unknown>>,
): Promise<void> {
    for (const eventRow of eventRows) {
        const insert = await client
            .from(WAR_EVENTS_TABLE)
            .insert(eventRow);

        if (!insert.error) {
            continue;
        }

        if (
            normalizeString(eventRow.event_type) === 'town-captured'
            && isUniqueViolationError(insert.error)
        ) {
            continue;
        }

        throw createError({
            statusCode: 500,
            statusMessage: insert.error.message || 'Unable to store Foxhole playback events.',
        });
    }
}

function buildPendingPlaybackEventRecords(input: FoxholePlaybackSnapshotInput): FoxholePlaybackEventRecord[] {
    return (input.events ?? []).map((event, index) => ({
        id: `pending:${index}`,
        shardId: normalizeString(event.shardId),
        warId: normalizeString(event.warId || input.warData?.warId) || null,
        warNumber: asNumberOrNull(event.warNumber ?? input.warData?.warNumber),
        mapKey: normalizeString(event.mapKey) || null,
        eventType: normalizeString(event.eventType),
        source: normalizeString(event.source) || input.source,
        observedAt: new Date(event.observedAt ?? input.capturedAt ?? Date.now()).toISOString(),
        data: stableValue(event.data),
    })).filter(event => Boolean(event.eventType));
}

async function loadRecentPlaybackEventsForDedupe(
    client: SupabaseClient,
    shardId: string,
    pendingEvents: readonly FoxholePlaybackEventRecord[],
): Promise<FoxholePlaybackEventRecord[]> {
    const dedupableEvents = pendingEvents.filter(event => Boolean(buildPlaybackEventDedupKey(event)));
    if (!dedupableEvents.length) {
        return [];
    }

    const earliestTimestamp = dedupableEvents
        .map(event => parseIsoTimestamp(event.observedAt))
        .filter((value): value is number => value !== null)
        .reduce<number | null>((earliest, value) => earliest === null ? value : Math.min(earliest, value), null);

    const eventTypes = Array.from(new Set(dedupableEvents.map(event => event.eventType)));
    let query = client
        .from(WAR_EVENTS_TABLE)
        .select('id,shard_id,war_id,war_number,map_key,event_type,source,observed_at,data')
        .eq('shard_id', shardId)
        .in('event_type', eventTypes);

    if (earliestTimestamp !== null) {
        query = query.gte('observed_at', new Date(earliestTimestamp - SEMANTIC_EVENT_DUPLICATE_WINDOW_MS).toISOString());
    }

    const { data, error } = await query;
    if (error) {
        throw createError({
            statusCode: 500,
            statusMessage: error.message || 'Unable to load recent Foxhole playback events for dedupe.',
        });
    }

    return (data ?? []).map(row => mapPlaybackEventRowToRecord(row as FoxholePlaybackEventRow));
}

async function loadCheckpoint(
    client: SupabaseClient,
    shardId: string,
    warId: string | null,
): Promise<FoxholePlaybackCheckpointRow | null> {
    let query = client
        .from('foxhole_playback_checkpoints')
        .select('id,shard_id,war_id,war_number,last_frame_sequence,last_frame_hash,latest_frame_id,latest_captured_at,latest_source,last_changed_map_keys')
        .eq('shard_id', shardId);

    query = warId ? query.eq('war_id', warId) : query.is('war_id', null);

    const { data, error } = await query.maybeSingle<FoxholePlaybackCheckpointRow>();
    if (error) {
        throw createError({
            statusCode: 500,
            statusMessage: error.message || 'Unable to load Foxhole playback checkpoint.',
        });
    }

    return data ?? null;
}

async function loadLatestFrameHead(
    client: SupabaseClient,
    shardId: string,
    warId: string | null,
): Promise<FoxholePlaybackFrameRow | null> {
    let query = client
        .from('foxhole_playback_frames')
        .select('id,shard_id,war_id,war_number,source,captured_at,frame_sequence,changed_map_keys,payload_hash')
        .eq('shard_id', shardId)
        .order('frame_sequence', { ascending: false })
        .limit(1);

    query = warId ? query.eq('war_id', warId) : query.is('war_id', null);

    const { data, error } = await query.maybeSingle<FoxholePlaybackFrameRow>();
    if (error) {
        throw createError({
            statusCode: 500,
            statusMessage: error.message || 'Unable to load latest Foxhole playback frame.',
        });
    }

    return data ?? null;
}

async function saveCheckpoint(
    client: SupabaseClient,
    checkpointId: string | null,
    checkpoint: Record<string, unknown>,
): Promise<string | null> {
    if (checkpointId) {
        const update = await client
            .from('foxhole_playback_checkpoints')
            .update(checkpoint)
            .eq('id', checkpointId);

        if (update.error) {
            throw createError({
                statusCode: 500,
                statusMessage: update.error.message || 'Unable to update Foxhole playback checkpoint.',
            });
        }

        return checkpointId;
    }

    const insert = await client
        .from('foxhole_playback_checkpoints')
        .insert(checkpoint)
        .select('id')
        .single<{ id: string; }>();

    if (insert.error) {
        throw createError({
            statusCode: 500,
            statusMessage: insert.error.message || 'Unable to create Foxhole playback checkpoint.',
        });
    }

    return normalizeString(insert.data?.id) || null;
}

export async function captureFoxholePlaybackSnapshot(input: FoxholePlaybackSnapshotInput): Promise<void> {
    const shardId = normalizeString(input.shardId);
    if (!shardId) {
        return;
    }

    if (!isFoxholePlaybackDbLoggingEnabled()) {
        return;
    }

    const client = getPlaybackServiceClient(false);
    if (!client) {
        return;
    }

    const payload = buildFramePayload({
        ...input,
        shardId,
    });
    const warId = normalizeString(payload.warId) || null;

    await withSnapshotWriteLock(shardId, warId, async () => {
        const changedMapKeys = normalizeMapKeyList(input.changedMaps?.length ? input.changedMaps : Object.keys(payload.summaries));
        const summary = buildFrameSummary(payload, changedMapKeys);
        const frameHash = hashValue(payload);
        const capturedAtIso = new Date(input.capturedAt ?? Date.now()).toISOString();
        const checkpoint = await loadCheckpoint(client, shardId, warId);
        const latestFrame = await loadLatestFrameHead(client, shardId, warId);
        const checkpointSequence = Math.max(0, asNumberOrNull(checkpoint?.last_frame_sequence) ?? 0);
        const latestFrameSequence = Math.max(0, asNumberOrNull(latestFrame?.frame_sequence) ?? 0);
        const lastSequence = Math.max(checkpointSequence, latestFrameSequence);
        const lastFrameHash = latestFrameSequence >= checkpointSequence
            ? normalizeString(latestFrame?.payload_hash)
            : normalizeString(checkpoint?.last_frame_hash);

        let checkpointId = normalizeString(checkpoint?.id) || null;
        const latestFrameId = normalizeString(latestFrame?.id) || null;
        const latestFrameCapturedAt = normalizeString(latestFrame?.captured_at) || null;
        const latestFrameSource = normalizeString(latestFrame?.source) || null;
        const latestFrameChangedMapKeys = normalizeMapKeyList(latestFrame?.changed_map_keys);

        if (
            latestFrame
            && (
                !checkpointId
                || checkpointSequence !== latestFrameSequence
                || normalizeString(checkpoint?.last_frame_hash) !== normalizeString(latestFrame?.payload_hash)
                || normalizeString(checkpoint?.latest_frame_id) !== latestFrameId
            )
        ) {
            checkpointId = await saveCheckpoint(client, checkpointId, {
                shard_id: shardId,
                war_id: warId,
                war_number: asNumberOrNull(latestFrame?.war_number) ?? payload.warNumber,
                last_frame_sequence: latestFrameSequence,
                last_frame_hash: normalizeString(latestFrame?.payload_hash) || null,
                latest_frame_id: latestFrameId,
                latest_captured_at: latestFrameCapturedAt,
                latest_source: latestFrameSource,
                last_changed_map_keys: latestFrameChangedMapKeys,
            });
        }

        if (lastFrameHash === frameHash) {
            return;
        }

        let eventRows = buildEventRows(input);
        if (eventRows.length) {
            const pendingEvents = buildPendingPlaybackEventRecords(input);
            const recentEvents = await loadRecentPlaybackEventsForDedupe(client, shardId, pendingEvents);
            const dedupedPendingEventIds = new Set(
                dedupePlaybackEvents([...recentEvents, ...pendingEvents])
                    .filter(event => event.id.startsWith('pending:'))
                    .map(event => event.id),
            );
            eventRows = eventRows.filter((_, index) => dedupedPendingEventIds.has(`pending:${index}`));
        }

        if (eventRows.length) {
            await insertPlaybackEventRows(client, eventRows);
        }

        const nextSequence = lastSequence + 1;
        const isKeyframe = shouldStoreKeyframe(input, nextSequence);
        const storedPayload = buildStoredFramePayload(payload, changedMapKeys, isKeyframe);
        const frameInsert = {
            shard_id: shardId,
            war_id: warId,
            war_number: payload.warNumber,
            source: input.source,
            captured_at: capturedAtIso,
            frame_sequence: nextSequence,
            changed_map_keys: changedMapKeys,
            payload_hash: frameHash,
            summary,
            payload: storedPayload,
            is_keyframe: isKeyframe,
        };

        const { data: frameRow, error: frameError } = await client
            .from('foxhole_playback_frames')
            .insert(frameInsert)
            .select('id')
            .single<{ id: string; }>();

        if (frameError) {
            throw createError({
                statusCode: 500,
                statusMessage: frameError.message || 'Unable to store Foxhole playback frame.',
            });
        }

        const checkpointInsert = {
            shard_id: shardId,
            war_id: warId,
            war_number: payload.warNumber,
            last_frame_sequence: nextSequence,
            last_frame_hash: frameHash,
            latest_frame_id: frameRow.id,
            latest_captured_at: capturedAtIso,
            latest_source: input.source,
            last_changed_map_keys: changedMapKeys,
        };

        checkpointId = await saveCheckpoint(client, checkpointId, checkpointInsert);
    });
}

export async function listFoxholePlaybackShards(): Promise<FoxholePlaybackShardSummary[]> {
    const client = getPlaybackServiceClient(true)!;
    const { data, error } = await client
        .from('foxhole_playback_checkpoints')
        .select('shard_id,war_id,war_number,last_frame_sequence,latest_captured_at,latest_source')
        .order('shard_id', { ascending: true })
        .order('latest_captured_at', { ascending: false });

    if (error) {
        throw createError({
            statusCode: 500,
            statusMessage: error.message || 'Unable to load Foxhole playback shard summaries.',
        });
    }

    const summaries = new Map<string, FoxholePlaybackShardSummary>();
    for (const row of data ?? []) {
        const shardId = normalizeString(row.shard_id);
        if (!shardId) {
            continue;
        }

        const warEntry = {
            warId: normalizeString(row.war_id) || null,
            warNumber: asNumberOrNull(row.war_number),
            latestCapturedAt: normalizeString(row.latest_captured_at) || null,
            latestFrameSequence: Math.max(0, asNumberOrNull(row.last_frame_sequence) ?? 0),
        };

        if (!summaries.has(shardId)) {
            summaries.set(shardId, {
                shardId,
                latestWarId: warEntry.warId,
                latestWarNumber: warEntry.warNumber,
                latestCapturedAt: warEntry.latestCapturedAt,
                latestSource: normalizeString(row.latest_source) || null,
                latestFrameSequence: warEntry.latestFrameSequence,
                availableWars: [warEntry],
            });
            continue;
        }

        summaries.get(shardId)!.availableWars.push(warEntry);
    }

    return Array.from(summaries.values()).map(summary => ({
        ...summary,
        availableWars: summary.availableWars.sort((left, right) => {
            const leftTime = left.latestCapturedAt ? Date.parse(left.latestCapturedAt) : 0;
            const rightTime = right.latestCapturedAt ? Date.parse(right.latestCapturedAt) : 0;
            return rightTime - leftTime;
        }),
    }));
}

function clampTimelineLimit(value: unknown): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 240;
    }

    return Math.min(parsed, 3000);
}

function clampEventLimit(value: unknown): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 100;
    }

    return Math.min(parsed, 250);
}

const PLAYBACK_TIMELINE_PAGE_SIZE = 500;

export async function listFoxholePlaybackTimeline(options: {
    shardId: string;
    warId?: string | null;
    startAt?: string | null;
    endAt?: string | null;
    limit?: number;
}): Promise<FoxholePlaybackTimelineItem[]> {
    const shardId = normalizeString(options.shardId);
    if (!shardId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'A playback shardId is required.',
        });
    }

    const client = getPlaybackServiceClient(true)!;
    const requestedLimit = clampTimelineLimit(options.limit);
    const warId = normalizeString(options.warId);
    const startAt = normalizeString(options.startAt);
    const endAt = normalizeString(options.endAt);
    const rows: FoxholePlaybackFrameRow[] = [];

    for (let offset = 0; offset < requestedLimit; offset += PLAYBACK_TIMELINE_PAGE_SIZE) {
        const batchSize = Math.min(PLAYBACK_TIMELINE_PAGE_SIZE, requestedLimit - offset);
        let query = client
            .from('foxhole_playback_frames')
            .select('id,shard_id,war_id,war_number,source,captured_at,frame_sequence,changed_map_keys,summary')
            .eq('shard_id', shardId)
            .order('frame_sequence', { ascending: true })
            .range(offset, offset + batchSize - 1);

        query = warId ? query.eq('war_id', warId) : query;

        if (startAt) {
            query = query.gte('captured_at', startAt);
        }

        if (endAt) {
            query = query.lte('captured_at', endAt);
        }

        const { data, error } = await query;
        if (error) {
            throw createError({
                statusCode: 500,
                statusMessage: error.message || 'Unable to load Foxhole playback timeline.',
            });
        }

        const batch = data ?? [];
        rows.push(...batch);
        if (batch.length < batchSize) {
            break;
        }
    }

    return rows.map(row => ({
        id: normalizeString(row.id),
        shardId: normalizeString(row.shard_id),
        warId: normalizeString(row.war_id) || null,
        warNumber: asNumberOrNull(row.war_number),
        source: normalizeString(row.source),
        capturedAt: normalizeString(row.captured_at),
        frameSequence: Math.max(0, asNumberOrNull(row.frame_sequence) ?? 0),
        changedMapKeys: normalizeMapKeyList(row.changed_map_keys),
        summary: (row.summary && typeof row.summary === 'object') ? row.summary as JsonObject : {},
    }));
}

export async function listFoxholePlaybackEvents(options: {
    shardId?: string | null;
    warId?: string | null;
    mapKey?: string | null;
    eventType?: string | null;
    includeLegacy?: boolean;
    startAt?: string | null;
    endAt?: string | null;
    limit?: number;
}): Promise<FoxholePlaybackEventRecord[]> {
    const requestedLimit = clampEventLimit(options.limit);
    const fetchLimit = Math.min(requestedLimit * 3, 500);
    const client = getPlaybackServiceClient(true)!;
    let query = client
        .from(WAR_EVENTS_TABLE)
        .select('id,shard_id,war_id,war_number,map_key,event_type,source,observed_at,data')
        .order('observed_at', { ascending: false })
        .limit(fetchLimit);

    const shardId = normalizeString(options.shardId);
    if (shardId) {
        query = query.eq('shard_id', shardId);
    }

    const warId = normalizeString(options.warId);
    if (warId) {
        query = query.eq('war_id', warId);
    }

    const mapKey = normalizeString(options.mapKey);
    if (mapKey) {
        query = query.eq('map_key', mapKey);
    }

    const eventType = normalizeString(options.eventType);
    if (eventType) {
        query = query.eq('event_type', eventType);
    } else if (options.includeLegacy !== true) {
        query = query.in('event_type', [...SEMANTIC_PLAYBACK_EVENT_TYPES]);
    }

    const startAt = normalizeString(options.startAt);
    if (startAt) {
        query = query.gte('observed_at', startAt);
    }

    const endAt = normalizeString(options.endAt);
    if (endAt) {
        query = query.lte('observed_at', endAt);
    }

    const { data, error } = await query;
    if (error) {
        throw createError({
            statusCode: 500,
            statusMessage: error.message || 'Unable to load Foxhole playback events.',
        });
    }

    return dedupePlaybackEvents((data ?? []).map(row => mapPlaybackEventRowToRecord(row as FoxholePlaybackEventRow)))
        .slice(0, requestedLimit);
}

export async function getFoxholePlaybackFrame(options: {
    frameId?: string | null;
    shardId?: string | null;
    warId?: string | null;
    at?: string | null;
}): Promise<FoxholePlaybackFrameRecord | null> {
    const client = getPlaybackServiceClient(true)!;
    const frameId = normalizeString(options.frameId);
    const at = normalizeString(options.at);

    if (frameId) {
        const cachedFrame = readCachedHydratedPlaybackFrame(frameId);
        if (cachedFrame) {
            return cachedFrame;
        }
    }

    let query = client
        .from('foxhole_playback_frames')
        .select('id,shard_id,war_id,war_number,source,captured_at,frame_sequence,changed_map_keys,summary,payload,is_keyframe')
        .limit(1);

    if (frameId) {
        query = query.eq('id', frameId);
    } else {
        const shardId = normalizeString(options.shardId);
        if (!shardId) {
            throw createError({
                statusCode: 400,
                statusMessage: 'frameId or shardId is required to load a playback frame.',
            });
        }

        query = query.eq('shard_id', shardId);

        const warId = normalizeString(options.warId);
        if (warId) {
            query = query.eq('war_id', warId);
        }

        if (at) {
            query = query.lte('captured_at', at).order('captured_at', { ascending: false });
        } else {
            query = query.order('captured_at', { ascending: false });
        }
    }

    const initialResult = await query.maybeSingle();
    let data = initialResult.data;
    const { error } = initialResult;
    if (error) {
        throw createError({
            statusCode: 500,
            statusMessage: error.message || 'Unable to load Foxhole playback frame.',
        });
    }

    if (!data && !frameId && at) {
        let fallbackQuery = client
            .from('foxhole_playback_frames')
            .select('id,shard_id,war_id,war_number,source,captured_at,frame_sequence,changed_map_keys,summary,payload,is_keyframe')
            .limit(1);

        const shardId = normalizeString(options.shardId);
        if (shardId) {
            fallbackQuery = fallbackQuery.eq('shard_id', shardId);
        }

        const warId = normalizeString(options.warId);
        if (warId) {
            fallbackQuery = fallbackQuery.eq('war_id', warId);
        }

        const fallbackResult = await fallbackQuery
            .gte('captured_at', at)
            .order('captured_at', { ascending: true })
            .maybeSingle();

        if (fallbackResult.error) {
            throw createError({
                statusCode: 500,
                statusMessage: fallbackResult.error.message || 'Unable to load Foxhole playback frame.',
            });
        }

        data = fallbackResult.data;
    }

    if (!data) {
        return null;
    }

    const frameRow = data as FoxholePlaybackFrameRow;
    const cachedFrame = readCachedHydratedPlaybackFrame(normalizeString(frameRow.id));
    if (cachedFrame) {
        return cachedFrame;
    }

    const payload = frameRow.is_keyframe === false
        ? await hydratePlaybackFramePayload(client, frameRow)
        : ((frameRow.payload && typeof frameRow.payload === 'object') ? frameRow.payload : {}) as FoxholePlaybackFramePayload;

    const frameRecord = {
        id: normalizeString(frameRow.id),
        shardId: normalizeString(frameRow.shard_id),
        warId: normalizeString(frameRow.war_id) || null,
        warNumber: asNumberOrNull(frameRow.war_number),
        source: normalizeString(frameRow.source),
        capturedAt: normalizeString(frameRow.captured_at),
        frameSequence: Math.max(0, asNumberOrNull(frameRow.frame_sequence) ?? 0),
        changedMapKeys: normalizeMapKeyList(frameRow.changed_map_keys),
        summary: (frameRow.summary && typeof frameRow.summary === 'object') ? frameRow.summary as JsonObject : {},
        payload,
    };

    storeCachedHydratedPlaybackFrame(frameRecord);
    return frameRecord;
}

async function hydratePlaybackFramePayload(
    client: SupabaseClient,
    frameRow: FoxholePlaybackFrameRow,
): Promise<FoxholePlaybackFramePayload> {
    const shardId = normalizeString(frameRow.shard_id);
    const frameSequence = Math.max(0, asNumberOrNull(frameRow.frame_sequence) ?? 0);
    const warId = normalizeString(frameRow.war_id) || null;
    if (!shardId || !frameSequence) {
        throw createError({
            statusCode: 500,
            statusMessage: 'Playback frame is missing reconstruction metadata.',
        });
    }

    let keyframeQuery = client
        .from('foxhole_playback_frames')
        .select('id,shard_id,war_id,war_number,source,captured_at,frame_sequence,changed_map_keys,summary,payload,is_keyframe')
        .eq('shard_id', shardId)
        .eq('is_keyframe', true)
        .lte('frame_sequence', frameSequence)
        .order('frame_sequence', { ascending: false })
        .limit(1);

    keyframeQuery = warId ? keyframeQuery.eq('war_id', warId) : keyframeQuery.is('war_id', null);
    const { data: keyframeData, error: keyframeError } = await keyframeQuery.maybeSingle<FoxholePlaybackFrameRow>();
    if (keyframeError) {
        throw createError({
            statusCode: 500,
            statusMessage: keyframeError.message || 'Unable to load playback keyframe.',
        });
    }

    if (!keyframeData?.payload || typeof keyframeData.payload !== 'object') {
        throw createError({
            statusCode: 500,
            statusMessage: 'Playback keyframe payload is missing.',
        });
    }

    const keyframeSequence = Math.max(0, asNumberOrNull(keyframeData.frame_sequence) ?? 0);
    let payload = clonePlaybackFramePayload(keyframeData.payload);
    if (keyframeSequence === frameSequence) {
        return payload;
    }

    let deltaQuery = client
        .from('foxhole_playback_frames')
        .select('id,shard_id,war_id,war_number,source,captured_at,frame_sequence,changed_map_keys,summary,payload,is_keyframe')
        .eq('shard_id', shardId)
        .gt('frame_sequence', keyframeSequence)
        .lte('frame_sequence', frameSequence)
        .order('frame_sequence', { ascending: true });

    deltaQuery = warId ? deltaQuery.eq('war_id', warId) : deltaQuery.is('war_id', null);
    const { data: deltaRows, error: deltaError } = await deltaQuery;
    if (deltaError) {
        throw createError({
            statusCode: 500,
            statusMessage: deltaError.message || 'Unable to load playback frame deltas.',
        });
    }

    for (const deltaRow of deltaRows ?? []) {
        if (!deltaRow?.payload || typeof deltaRow.payload !== 'object') {
            continue;
        }

        payload = deltaRow.is_keyframe === true
            ? clonePlaybackFramePayload(deltaRow.payload as FoxholePlaybackFramePayload)
            : applyPlaybackFrameDelta(payload, deltaRow.payload as FoxholePlaybackFramePayload);
    }

    return payload;
}

async function deletePlaybackRowsByIds(
    client: SupabaseClient,
    table: string,
    ids: string[],
    failureMessage: string,
): Promise<void> {
    if (!ids.length) {
        return;
    }

    const { error } = await client
        .from(table)
        .delete()
        .in('id', ids);

    if (error) {
        throw createError({
            statusCode: 500,
            statusMessage: error.message || failureMessage,
        });
    }
}

async function purgePlaybackRowsInBatches(
    client: SupabaseClient,
    table: string,
    buildQuery: (query: any) => any,
    failureMessages: {
        select: string;
        delete: string;
    },
): Promise<number> {
    let purgedCount = 0;

    while (true) {
        let query = client
            .from(table)
            .select('id')
            .limit(PLAYBACK_PURGE_BATCH_SIZE);

        query = buildQuery(query);

        const { data: rows, error: selectError } = await query;
        if (selectError) {
            throw createError({
                statusCode: 500,
                statusMessage: selectError.message || failureMessages.select,
            });
        }

        const ids = (rows ?? [])
            .map((row: { id?: string | null; }) => normalizeString(row?.id))
            .filter(Boolean);

        if (!ids.length) {
            break;
        }

        await deletePlaybackRowsByIds(client, table, ids, failureMessages.delete);
        purgedCount += ids.length;
    }

    return purgedCount;
}

export async function purgeExpiredFoxholePlaybackData(): Promise<{
    frameRetentionHours: number;
    eventRetentionDays: number;
    frameCutoff: string;
    eventCutoff: string;
    purgedFrameCount: number;
    purgedCheckpointCount: number;
    purgedLegacyEventCount: number;
    purgedExpiredEventCount: number;
}> {
    const client = getPlaybackServiceClient(true)!;
    const now = Date.now();
    const frameRetentionHours = FRAME_RETENTION_MS / (60 * 60 * 1000);
    const eventRetentionDays = EVENT_RETENTION_MS / (24 * 60 * 60 * 1000);
    const frameCutoff = new Date(now - FRAME_RETENTION_MS).toISOString();
    const eventCutoff = new Date(now - EVENT_RETENTION_MS).toISOString();

    const purgedFrameCount = await purgePlaybackRowsInBatches(
        client,
        PLAYBACK_FRAMES_TABLE,
        query => query.lt('captured_at', frameCutoff).order('captured_at', { ascending: true }),
        {
            select: 'Unable to load expired playback frames for purge.',
            delete: 'Unable to purge expired playback frames.',
        },
    );

    const purgedCheckpointCount = await purgePlaybackRowsInBatches(
        client,
        PLAYBACK_CHECKPOINTS_TABLE,
        query => query.lt('latest_captured_at', frameCutoff).order('latest_captured_at', { ascending: true }),
        {
            select: 'Unable to load expired playback checkpoints for purge.',
            delete: 'Unable to purge expired playback checkpoints.',
        },
    );

    let purgedLegacyEventCount = 0;
    for (const legacyEventType of LEGACY_PLAYBACK_EVENT_TYPES) {
        purgedLegacyEventCount += await purgePlaybackRowsInBatches(
            client,
            WAR_EVENTS_TABLE,
            query => query.eq('event_type', legacyEventType),
            {
                select: 'Unable to load legacy playback events for purge.',
                delete: 'Unable to purge legacy playback events.',
            },
        );
    }

    const purgedExpiredEventCount = await purgePlaybackRowsInBatches(
        client,
        WAR_EVENTS_TABLE,
        query => query.lt('observed_at', eventCutoff).order('observed_at', { ascending: true }),
        {
            select: 'Unable to load expired playback events for purge.',
            delete: 'Unable to purge expired playback events.',
        },
    );

    return {
        frameRetentionHours,
        eventRetentionDays,
        frameCutoff,
        eventCutoff,
        purgedFrameCount,
        purgedCheckpointCount,
        purgedLegacyEventCount,
        purgedExpiredEventCount,
    };
}
