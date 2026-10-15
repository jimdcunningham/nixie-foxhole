import { foxholePlaybackFrameStorage } from './storage.ts';

export interface FoxholePlaybackPreviewLayerEntry {
    version?: number | null;
    items?: unknown[];
}

export interface FoxholePlaybackPreviewReportEntry {
    totalEnlistments?: number | null;
    factions?: Record<string, Record<string, number>>;
    dayOfWar?: number | null;
    version?: number | null;
}

export interface FoxholePlaybackFramePayload {
    shardId: string;
    warId: string | null;
    warNumber: number | null;
    warStart: number | null;
    warEnd?: number | null;
    resistanceStart: number | null;
    scheduledConquestEndTime?: number | null;
    requiredVictoryTowns: number | null;
    shortRequiredVictoryTowns?: number | null;
    winner?: string | null;
    reports: Record<string, FoxholePlaybackPreviewReportEntry | null | undefined>;
    labels: Record<string, FoxholePlaybackPreviewLayerEntry | null | undefined>;
    icons: Record<string, FoxholePlaybackPreviewLayerEntry | null | undefined>;
}

export interface FoxholePlaybackFrameRecord {
    id: string;
    shardId: string;
    warId: string | null;
    warNumber: number | null;
    source?: string;
    capturedAt: string;
    frameSequence?: number;
    changedMapKeys?: string[];
    summary?: Record<string, unknown>;
    payload: FoxholePlaybackFramePayload;
}

export interface FoxholePlaybackFrameRequestOptions {
    frameId?: string | null;
    shardId?: string | null;
    warId?: string | null;
    at?: string | null;
    signal?: AbortSignal | null;
    priority?: number | null;
    forceRefresh?: boolean | null;
}

interface PersistedPlaybackFrameIndexEntry {
    id: string;
    cachedAt: number;
    capturedAt: string;
}

interface PersistedPlaybackFrameAliasEntry {
    requestKey: string;
    frameId: string;
    cachedAt: number;
    capturedAt: string;
}

interface BackgroundPlaybackFrameRequest {
    requestKey: string;
    options: FoxholePlaybackFrameRequestOptions;
    priority: number;
    sequence: number;
    started: boolean;
    controller: AbortController;
    promise: Promise<FoxholePlaybackFrameRecord | null>;
    resolve: (frame: FoxholePlaybackFrameRecord | null) => void;
    reject: (error: unknown) => void;
}

const PLAYBACK_FRAME_MEMORY_LIMIT = 96;
const PLAYBACK_FRAME_RETENTION_MS = 24 * 60 * 60 * 1000;
const PLAYBACK_FRAME_BACKGROUND_CONCURRENCY = 2;
const PLAYBACK_FRAME_BACKGROUND_DEFAULT_PRIORITY = 10_000;
const PLAYBACK_FRAME_INDEX_KEY = 'playback-frame-index:v1';
const PLAYBACK_FRAME_ALIAS_INDEX_KEY = 'playback-frame-alias-index:v1';
const PLAYBACK_FRAME_KEY_PREFIX = 'playback-frame:';

const frameMemoryCache = new Map<string, FoxholePlaybackFrameRecord>();
const pendingBackgroundFrameRequests = new Map<string, BackgroundPlaybackFrameRequest>();
const requestFrameAliases = new Map<string, string>();

let persistenceQueue: Promise<void> = Promise.resolve();
let activeBackgroundFrameRequestCount = 0;
let backgroundFrameRequestSequence = 0;

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function buildPlaybackFrameStorageKey(frameId: string): string {
    return `${PLAYBACK_FRAME_KEY_PREFIX}${frameId}`;
}

function buildPlaybackFrameRequestKey(options: FoxholePlaybackFrameRequestOptions): string {
    const frameId = normalizeString(options.frameId);
    if (frameId) {
        return `frame:${frameId}`;
    }

    return [
        'lookup',
        normalizeString(options.shardId),
        normalizeString(options.warId),
        normalizeString(options.at),
    ].join(':');
}

function createPlaybackAbortError(): Error {
    const error = new Error('Playback frame request aborted.');
    error.name = 'AbortError';
    return error;
}

function isPlaybackAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function normalizePlaybackRequestPriority(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return PLAYBACK_FRAME_BACKGROUND_DEFAULT_PRIORITY;
    }

    return Math.max(0, Math.floor(value));
}

function parsePlaybackTimestamp(value: unknown): number | null {
    const normalizedValue = normalizeString(value);
    if (!normalizedValue) {
        return null;
    }

    const parsed = Date.parse(normalizedValue);
    return Number.isFinite(parsed) ? parsed : null;
}

function resolvePersistedPlaybackEntryTimestampMs(capturedAt: unknown, cachedAt: unknown): number | null {
    const capturedAtMs = parsePlaybackTimestamp(capturedAt);
    if (capturedAtMs !== null) {
        return capturedAtMs;
    }

    return typeof cachedAt === 'number' && Number.isFinite(cachedAt)
        ? cachedAt
        : null;
}

function isPersistedPlaybackEntryFresh(capturedAt: unknown, cachedAt: unknown, currentTimeMs = Date.now()): boolean {
    const referenceTimestampMs = resolvePersistedPlaybackEntryTimestampMs(capturedAt, cachedAt);
    if (referenceTimestampMs === null) {
        return false;
    }

    return referenceTimestampMs >= (currentTimeMs - PLAYBACK_FRAME_RETENTION_MS);
}

function shouldPersistPlaybackRequestAlias(options: FoxholePlaybackFrameRequestOptions): boolean {
    return !normalizeString(options.frameId) && Boolean(normalizeString(options.at));
}

function filterRetainedPlaybackFrameIndexEntries(
    entries: PersistedPlaybackFrameIndexEntry[],
    currentTimeMs = Date.now(),
): PersistedPlaybackFrameIndexEntry[] {
    return entries.filter(entry => {
        return Boolean(normalizeString(entry?.id))
            && isPersistedPlaybackEntryFresh(entry.capturedAt, entry.cachedAt, currentTimeMs);
    });
}

function filterRetainedPlaybackAliasIndexEntries(
    entries: PersistedPlaybackFrameAliasEntry[],
    retainedFrameIds: Set<string>,
    currentTimeMs = Date.now(),
): PersistedPlaybackFrameAliasEntry[] {
    return entries.filter(entry => {
        return Boolean(normalizeString(entry?.requestKey))
            && Boolean(normalizeString(entry?.frameId))
            && retainedFrameIds.has(entry.frameId)
            && isPersistedPlaybackEntryFresh(entry.capturedAt, entry.cachedAt, currentTimeMs);
    });
}

function touchFrameMemoryCache(frame: FoxholePlaybackFrameRecord): void {
    const frameId = normalizeString(frame.id);
    if (!frameId) {
        return;
    }

    frameMemoryCache.delete(frameId);
    frameMemoryCache.set(frameId, frame);
    while (frameMemoryCache.size > PLAYBACK_FRAME_MEMORY_LIMIT) {
        const oldestFrameId = frameMemoryCache.keys().next().value;
        if (!oldestFrameId) {
            break;
        }

        frameMemoryCache.delete(oldestFrameId);
    }
}

async function readPersistedPlaybackFrameIndex(): Promise<PersistedPlaybackFrameIndexEntry[]> {
    const index = await foxholePlaybackFrameStorage.getItem<PersistedPlaybackFrameIndexEntry[]>(PLAYBACK_FRAME_INDEX_KEY);
    if (!Array.isArray(index)) {
        return [];
    }

    return index.filter(entry => Boolean(normalizeString(entry?.id)));
}

async function readPersistedPlaybackAliasIndex(): Promise<PersistedPlaybackFrameAliasEntry[]> {
    const index = await foxholePlaybackFrameStorage.getItem<PersistedPlaybackFrameAliasEntry[]>(PLAYBACK_FRAME_ALIAS_INDEX_KEY);
    if (!Array.isArray(index)) {
        return [];
    }

    return index.filter(entry => {
        return Boolean(normalizeString(entry?.requestKey))
            && Boolean(normalizeString(entry?.frameId));
    });
}

function queuePlaybackFramePersistence(task: () => Promise<void>): void {
    persistenceQueue = persistenceQueue
        .catch(() => undefined)
        .then(task)
        .catch(() => undefined);
}

function persistPlaybackFrame(frame: FoxholePlaybackFrameRecord, options: FoxholePlaybackFrameRequestOptions | null = null): void {
    const frameId = normalizeString(frame.id);
    if (!frameId) {
        return;
    }

    queuePlaybackFramePersistence(async () => {
        const currentTimeMs = Date.now();
        const previousIndex = await readPersistedPlaybackFrameIndex();
        const previousAliasIndex = await readPersistedPlaybackAliasIndex();
        const nextEntry: PersistedPlaybackFrameIndexEntry = {
            id: frameId,
            cachedAt: currentTimeMs,
            capturedAt: normalizeString(frame.capturedAt),
        };
        const nextIndex = filterRetainedPlaybackFrameIndexEntries([
            nextEntry,
            ...previousIndex.filter(entry => entry.id !== frameId),
        ], currentTimeMs);
        const retainedFrameIds = new Set(nextIndex.map(entry => entry.id));
        const nextAliasRequestKey = options && shouldPersistPlaybackRequestAlias(options)
            ? buildPlaybackFrameRequestKey(options)
            : '';
        const nextAliasEntry: PersistedPlaybackFrameAliasEntry | null = nextAliasRequestKey
            ? {
                requestKey: nextAliasRequestKey,
                frameId,
                cachedAt: currentTimeMs,
                capturedAt: nextEntry.capturedAt,
            }
            : null;
        const nextAliasIndex = filterRetainedPlaybackAliasIndexEntries([
            ...(nextAliasEntry ? [nextAliasEntry] : []),
            ...previousAliasIndex.filter(entry => entry.requestKey !== nextAliasRequestKey),
        ], retainedFrameIds, currentTimeMs);

        await foxholePlaybackFrameStorage.setItem(buildPlaybackFrameStorageKey(frameId), frame);
        await foxholePlaybackFrameStorage.setItem(PLAYBACK_FRAME_INDEX_KEY, nextIndex);
        await foxholePlaybackFrameStorage.setItem(PLAYBACK_FRAME_ALIAS_INDEX_KEY, nextAliasIndex);

        for (const entry of previousIndex) {
            if (retainedFrameIds.has(entry.id)) {
                continue;
            }

            await foxholePlaybackFrameStorage.removeItem(buildPlaybackFrameStorageKey(entry.id));
        }
    });
}

function discardPersistedPlaybackFrame(frameId: string): void {
    const normalizedFrameId = normalizeString(frameId);
    if (!normalizedFrameId) {
        return;
    }

    queuePlaybackFramePersistence(async () => {
        const currentTimeMs = Date.now();
        const previousIndex = await readPersistedPlaybackFrameIndex();
        const previousAliasIndex = await readPersistedPlaybackAliasIndex();
        const nextIndex = filterRetainedPlaybackFrameIndexEntries(
            previousIndex.filter(entry => entry.id !== normalizedFrameId),
            currentTimeMs,
        );
        const retainedFrameIds = new Set(nextIndex.map(entry => entry.id));
        const nextAliasIndex = filterRetainedPlaybackAliasIndexEntries(previousAliasIndex, retainedFrameIds, currentTimeMs);

        await foxholePlaybackFrameStorage.removeItem(buildPlaybackFrameStorageKey(normalizedFrameId));
        await foxholePlaybackFrameStorage.setItem(PLAYBACK_FRAME_INDEX_KEY, nextIndex);
        await foxholePlaybackFrameStorage.setItem(PLAYBACK_FRAME_ALIAS_INDEX_KEY, nextAliasIndex);
    });
}

async function readPersistedPlaybackFrameAlias(requestKey: string): Promise<string | null> {
    const normalizedRequestKey = normalizeString(requestKey);
    if (!normalizedRequestKey) {
        return null;
    }

    try {
        const aliasIndex = await readPersistedPlaybackAliasIndex();
        const aliasEntry = aliasIndex.find(entry => entry.requestKey === normalizedRequestKey);
        if (!aliasEntry || !isPersistedPlaybackEntryFresh(aliasEntry.capturedAt, aliasEntry.cachedAt)) {
            return null;
        }

        return normalizeString(aliasEntry.frameId) || null;
    } catch {
        return null;
    }
}

async function readPersistedPlaybackFrame(frameId: string): Promise<FoxholePlaybackFrameRecord | null> {
    const normalizedFrameId = normalizeString(frameId);
    if (!normalizedFrameId) {
        return null;
    }

    try {
        const frame = await foxholePlaybackFrameStorage.getItem<FoxholePlaybackFrameRecord>(buildPlaybackFrameStorageKey(normalizedFrameId));
        if (!frame || normalizeString(frame.id) !== normalizedFrameId) {
            return null;
        }
        if (!isPersistedPlaybackEntryFresh(frame.capturedAt, null)) {
            discardPersistedPlaybackFrame(normalizedFrameId);
            return null;
        }

        touchFrameMemoryCache(frame);
        return frame;
    } catch {
        return null;
    }
}

async function readCachedPlaybackFrameForRequest(
    options: FoxholePlaybackFrameRequestOptions,
): Promise<FoxholePlaybackFrameRecord | null> {
    const requestKey = buildPlaybackFrameRequestKey(options);
    const requestedFrameId = normalizeString(options.frameId);
    if (requestedFrameId) {
        const cachedFrame = frameMemoryCache.get(requestedFrameId);
        if (cachedFrame) {
            touchFrameMemoryCache(cachedFrame);
            requestFrameAliases.set(requestKey, requestedFrameId);
            return cachedFrame;
        }

        const persistedFrame = await readPersistedPlaybackFrame(requestedFrameId);
        if (persistedFrame) {
            requestFrameAliases.set(requestKey, requestedFrameId);
            return persistedFrame;
        }
    }

    let aliasedFrameId: string | null = requestFrameAliases.get(requestKey) ?? null;
    if (!aliasedFrameId && shouldPersistPlaybackRequestAlias(options)) {
        aliasedFrameId = await readPersistedPlaybackFrameAlias(requestKey);
        if (aliasedFrameId) {
            requestFrameAliases.set(requestKey, aliasedFrameId);
        }
    }
    if (!aliasedFrameId) {
        return null;
    }

    const cachedAliasedFrame = frameMemoryCache.get(aliasedFrameId);
    if (cachedAliasedFrame) {
        touchFrameMemoryCache(cachedAliasedFrame);
        return cachedAliasedFrame;
    }

    return await readPersistedPlaybackFrame(aliasedFrameId);
}

async function requestPlaybackFrameFromApi(
    options: FoxholePlaybackFrameRequestOptions,
    signal: AbortSignal | null,
): Promise<FoxholePlaybackFrameRecord | null> {
    if (signal?.aborted) {
        throw createPlaybackAbortError();
    }

    const requestKey = buildPlaybackFrameRequestKey(options);
    const requestedFrameId = normalizeString(options.frameId);
    const frame = await $fetch<FoxholePlaybackFrameRecord | null>('/api/foxhole/playback/frame', {
        query: {
            frameId: requestedFrameId || undefined,
            shardId: normalizeString(options.shardId) || undefined,
            warId: normalizeString(options.warId) || undefined,
            at: normalizeString(options.at) || undefined,
        },
        signal: signal ?? undefined,
    });

    if (!frame?.id) {
        return null;
    }

    touchFrameMemoryCache(frame);
    requestFrameAliases.set(requestKey, normalizeString(frame.id));
    persistPlaybackFrame(frame, options);
    return frame;
}

function settleBackgroundPlaybackFrameRequest(
    state: BackgroundPlaybackFrameRequest,
    result: { frame?: FoxholePlaybackFrameRecord | null; error?: unknown; },
): void {
    pendingBackgroundFrameRequests.delete(state.requestKey);
    if (state.started) {
        activeBackgroundFrameRequestCount = Math.max(0, activeBackgroundFrameRequestCount - 1);
    }

    if ('error' in result) {
        state.reject(result.error);
    } else {
        state.resolve(result.frame ?? null);
    }

    pumpBackgroundPlaybackFrameRequests();
}

function cancelBackgroundPlaybackFrameRequest(state: BackgroundPlaybackFrameRequest): void {
    if (state.controller.signal.aborted) {
        return;
    }

    state.controller.abort();
    if (!state.started) {
        settleBackgroundPlaybackFrameRequest(state, { error: createPlaybackAbortError() });
    }
}

function pumpBackgroundPlaybackFrameRequests(): void {
    while (activeBackgroundFrameRequestCount < PLAYBACK_FRAME_BACKGROUND_CONCURRENCY) {
        const nextState = Array.from(pendingBackgroundFrameRequests.values())
            .filter(state => !state.started)
            .sort((left, right) => {
                if (left.priority !== right.priority) {
                    return left.priority - right.priority;
                }

                return left.sequence - right.sequence;
            })[0];

        if (!nextState) {
            return;
        }

        nextState.started = true;
        activeBackgroundFrameRequestCount += 1;

        void requestPlaybackFrameFromApi(nextState.options, nextState.controller.signal)
            .then(frame => {
                settleBackgroundPlaybackFrameRequest(nextState, { frame });
            })
            .catch((error: unknown) => {
                settleBackgroundPlaybackFrameRequest(nextState, {
                    error: isPlaybackAbortError(error) ? createPlaybackAbortError() : error,
                });
            });
    }
}

async function queueBackgroundPlaybackFrameRequest(
    options: FoxholePlaybackFrameRequestOptions,
): Promise<FoxholePlaybackFrameRecord | null> {
    const requestKey = buildPlaybackFrameRequestKey(options);
    const cachedFrame = await readCachedPlaybackFrameForRequest(options);
    if (cachedFrame) {
        return cachedFrame;
    }

    const existingRequest = pendingBackgroundFrameRequests.get(requestKey);
    if (existingRequest) {
        if (!existingRequest.started) {
            existingRequest.priority = Math.min(existingRequest.priority, normalizePlaybackRequestPriority(options.priority));
            pumpBackgroundPlaybackFrameRequests();
        }

        return await existingRequest.promise;
    }

    let resolvePromise!: (frame: FoxholePlaybackFrameRecord | null) => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<FoxholePlaybackFrameRecord | null>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });

    const nextState: BackgroundPlaybackFrameRequest = {
        requestKey,
        options: {
            frameId: options.frameId,
            shardId: options.shardId,
            warId: options.warId,
            at: options.at,
        },
        priority: normalizePlaybackRequestPriority(options.priority),
        sequence: ++backgroundFrameRequestSequence,
        started: false,
        controller: new AbortController(),
        promise,
        resolve: resolvePromise,
        reject: rejectPromise,
    };

    pendingBackgroundFrameRequests.set(requestKey, nextState);
    pumpBackgroundPlaybackFrameRequests();

    return await promise;
}

async function loadForegroundPlaybackFrame(
    options: FoxholePlaybackFrameRequestOptions,
    persistResult: boolean,
): Promise<FoxholePlaybackFrameRecord | null> {
    const requestKey = buildPlaybackFrameRequestKey(options);
    const requestedFrameId = normalizeString(options.frameId);
    const shouldBypassCache = options.forceRefresh === true
        && !requestedFrameId
        && !normalizeString(options.at);
    if (!shouldBypassCache) {
        const cachedFrame = await readCachedPlaybackFrameForRequest(options);
        if (cachedFrame) {
            return cachedFrame;
        }
    }

    const pendingBackgroundRequest = pendingBackgroundFrameRequests.get(requestKey);
    if (pendingBackgroundRequest) {
        cancelBackgroundPlaybackFrameRequest(pendingBackgroundRequest);
    }

    if (!persistResult) {
        return null;
    }

    return await requestPlaybackFrameFromApi(options, options.signal ?? null);
}

async function loadPlaybackFrame(
    options: FoxholePlaybackFrameRequestOptions,
    persistResult: boolean,
): Promise<FoxholePlaybackFrameRecord | null> {
    if (persistResult) {
        return await loadForegroundPlaybackFrame(options, true);
    }

    return await queueBackgroundPlaybackFrameRequest(options);
}

export async function fetchFoxholePlaybackFrame(
    options: FoxholePlaybackFrameRequestOptions,
): Promise<FoxholePlaybackFrameRecord | null> {
    return await loadPlaybackFrame(options, true);
}

export async function peekCachedFoxholePlaybackFrame(
    options: FoxholePlaybackFrameRequestOptions,
): Promise<FoxholePlaybackFrameRecord | null> {
    const requestedFrameId = normalizeString(options.frameId);
    const shouldBypassCache = options.forceRefresh === true
        && !requestedFrameId
        && !normalizeString(options.at);
    if (shouldBypassCache) {
        return null;
    }

    return await readCachedPlaybackFrameForRequest(options);
}

export async function prefetchFoxholePlaybackFrame(
    options: FoxholePlaybackFrameRequestOptions,
): Promise<void> {
    await loadPlaybackFrame(options, false);
}

export function cancelFoxholePlaybackFramePrefetches(): void {
    for (const state of Array.from(pendingBackgroundFrameRequests.values())) {
        cancelBackgroundPlaybackFrameRequest(state);
    }
}
