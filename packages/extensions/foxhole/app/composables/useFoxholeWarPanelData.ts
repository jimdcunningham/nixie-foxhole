import { computed, onMounted, onUnmounted, readonly, ref, watch } from 'vue';
import type { ComputedRef } from 'vue';
import { readFoxholeMapSettings } from '#foxhole/plugins/foxhole/nixie/map-settings.ts';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import {
    fetchFoxholePlaybackFrame,

} from '#foxhole/plugins/foxhole/nixie/map/playback-frame-cache.ts';
import type { FoxholePlaybackFramePayload, FoxholePlaybackFrameRecord } from '#foxhole/plugins/foxhole/nixie/map/playback-frame-cache.ts';
import {
    getFoxholeMapPlaybackPreviewRef,

} from '#foxhole/plugins/foxhole/nixie/map/playback-preview.ts';
import type { FoxholeMapPlaybackPreviewState } from '#foxhole/plugins/foxhole/nixie/map/playback-preview.ts';
import {
    cloneFoxholeWarDebugPreset,
    getFoxholeWarDebugPresetRef,
} from '#foxhole/composables/foxholeWarDebugState.ts';

export type FoxholeFactionKey = 'colonial' | 'warden';

export interface FoxholeWarFactionSummary {
    totalCasualties: number;
    totalHourlyCasualties: number | null;
    victoryTowns: number;
    rocketSites: number;
    rockets: number;
}

export interface FoxholeWarSummary {
    warId: string | null;
    warNumber: number | null;
    shardId: string;
    warStart: number | null;
    conquestEndTime: number | null;
    resistanceStart: number | null;
    scheduledConquestEndTime: number | null;
    requiredVictoryTowns: number | null;
    shortRequiredVictoryTowns: number | null;
    winner: string | null;
    lastUpdatedAt: number | null;
    factions: {
        colonial: FoxholeWarFactionSummary;
        warden: FoxholeWarFactionSummary;
    };
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

export interface FoxholePlaybackTimelineItem {
    id: string;
    shardId: string;
    warId: string | null;
    warNumber: number | null;
    capturedAt: string;
    frameSequence?: number;
    summary?: {
        controlledTowns?: Record<string, number>;
        victoryTowns?: Record<string, number>;
        requiredVictoryTowns?: number | null;
    };
}

interface FoxholeWarPanelBindings {
    mapSettings: ComputedRef<ReturnType<typeof readFoxholeMapSettings>>;
    playbackEnabled: ComputedRef<boolean>;
}

interface RefreshWarPanelDataOptions {
    force?: boolean;
    timelineMode?: 'full' | 'incremental';
}

const SUMMARY_REFRESH_MS = 15_000;
const PLAYBACK_EVENT_LIMIT = 250;
const PLAYBACK_TIMELINE_LIMIT = 3000;
const PLAYBACK_TIMELINE_SUMMARY_LIMIT = 240;
const PLAYBACK_INCREMENTAL_LIMIT = 600;
const PLAYBACK_REFRESH_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const FOXHOLE_ROCKET_SITE_ICON_TYPE = 37;
const FOXHOLE_ROCKET_READY_ICON_TYPE = 72;

const sharedWarSummary = ref<FoxholeWarSummary | null>(null);
const sharedWarSummaryLoading = ref(false);
const sharedPlaybackEvents24h = ref<FoxholePlaybackEventRecord[]>([]);
const sharedPlaybackTimeline = ref<FoxholePlaybackTimelineItem[]>([]);
const sharedPlaybackEnabled = ref(true);
const sharedPlaybackEventsLoading = ref(false);
const sharedPlaybackTimelineLoading = ref(false);
const sharedPlaybackEventsError = ref('');
const sharedPlaybackTimelineError = ref('');

const sharedPlaybackSummaryTimeline = computed(() => {
    return sampleTimelineItemsEvenly(sharedPlaybackTimeline.value, PLAYBACK_TIMELINE_SUMMARY_LIMIT);
});

const sharedPlaybackSnapshotLoading = computed(() => {
    return sharedPlaybackEventsLoading.value || sharedPlaybackTimelineLoading.value;
});

const sharedPlaybackSnapshotError = computed(() => {
    return sharedPlaybackEventsError.value || sharedPlaybackTimelineError.value;
});
const foxholeWarDebugPreset = getFoxholeWarDebugPresetRef();
const foxholeMapPlaybackPreview = getFoxholeMapPlaybackPreviewRef();

let bindings: FoxholeWarPanelBindings | null = null;
let subscriberCount = 0;
let summaryInterval: ReturnType<typeof setInterval> | null = null;
let playbackInterval: ReturnType<typeof setInterval> | null = null;

let warSummaryPromise: Promise<void> | null = null;
let warSummaryRequestKey = '';
let warSummaryRequestToken = 0;

let playbackEventsPromise: Promise<void> | null = null;
let playbackEventsRequestKey = '';
let playbackEventsRequestToken = 0;
let lastPlaybackEventsResolvedKey = '';
let lastPlaybackEventsResolvedAt = 0;

let playbackTimelinePromise: Promise<void> | null = null;
let playbackTimelineRequestKey = '';
let playbackTimelineRequestToken = 0;
let lastPlaybackTimelineResolvedKey = '';
let lastPlaybackTimelineResolvedAt = 0;

function bindFoxholeWarPanelContext(context: FoxholeWarPanelBindings): void {
    if (!bindings) {
        bindings = context;
    }

    syncSharedPlaybackEnabled();
}

function syncSharedPlaybackEnabled(): void {
    const activePreset = foxholeWarDebugPreset.value;
    if (activePreset) {
        sharedPlaybackEnabled.value = activePreset.playbackEnabled;
        return;
    }

    sharedPlaybackEnabled.value = bindings?.playbackEnabled.value !== false;
}

function applyFoxholeWarDebugPresetState(): void {
    const activePreset = foxholeWarDebugPreset.value;
    if (!activePreset) {
        return;
    }

    const preset = cloneFoxholeWarDebugPreset(activePreset);
    sharedWarSummary.value = preset.warSummary;
    sharedWarSummaryLoading.value = preset.warSummaryLoading;
    sharedPlaybackEnabled.value = preset.playbackEnabled;
    sharedPlaybackEvents24h.value = preset.playbackEvents24h;
    sharedPlaybackTimeline.value = preset.playbackTimeline;
    sharedPlaybackEventsLoading.value = preset.playbackEventsLoading;
    sharedPlaybackTimelineLoading.value = preset.playbackTimelineLoading;
    sharedPlaybackEventsError.value = preset.playbackEventsError;
    sharedPlaybackTimelineError.value = preset.playbackTimelineError;
}

function getSelectedShardId(): string {
    return bindings ? normalizeString(bindings.mapSettings.value.shardId) : '';
}

function getCurrentWarContext(): { shardId: string; warId: string | null; warNumber: number | null; } {
    return {
        shardId: normalizeString(sharedWarSummary.value?.shardId) || getSelectedShardId(),
        warId: normalizeString(sharedWarSummary.value?.warId) || null,
        warNumber: asFiniteNumber(sharedWarSummary.value?.warNumber),
    };
}

function getWarContextKey(summary: Pick<FoxholeWarSummary, 'shardId' | 'warId'> | null | undefined): string {
    return `${normalizeString(summary?.shardId)}:${normalizeString(summary?.warId)}`;
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function asFiniteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parsePlaybackTimestamp(value: string | null | undefined): number | null {
    const source = normalizeString(value);
    if (!source) {
        return null;
    }

    const timestampMs = Date.parse(source);
    return Number.isFinite(timestampMs) ? timestampMs : null;
}

function normalizeFactionKey(teamId: string | null | undefined): FoxholeFactionKey | null {
    switch (normalizeString(teamId).toLowerCase()) {
        case 'colonials':
        case 'c':
        case 'colonial':
            return 'colonial';
        case 'wardens':
        case 'w':
        case 'warden':
            return 'warden';
        default:
            return null;
    }
}

function createEmptyFactionSummary(): FoxholeWarFactionSummary {
    return {
        totalCasualties: 0,
        totalHourlyCasualties: null,
        victoryTowns: 0,
        rocketSites: 0,
        rockets: 0,
    };
}

function readMapIconType(icon: unknown): number | null {
    const iconType = typeof icon === 'object' && icon && 'iconType' in icon
        ? Number((icon as { iconType?: string | number | null; }).iconType)
        : Number.NaN;
    return Number.isFinite(iconType) ? iconType : null;
}

function incrementStructureCount(summary: FoxholeWarFactionSummary, iconType: number): void {
    switch (iconType) {
        case FOXHOLE_ROCKET_SITE_ICON_TYPE:
            summary.rocketSites += 1;
            break;
        case FOXHOLE_ROCKET_READY_ICON_TYPE:
            summary.rockets += 1;
            break;
        default:
            break;
    }
}

function createEmptyWarSummary(selectedShardId: string): FoxholeWarSummary {
    return {
        warId: null,
        warNumber: null,
        shardId: selectedShardId,
        warStart: null,
        conquestEndTime: null,
        resistanceStart: null,
        scheduledConquestEndTime: null,
        requiredVictoryTowns: null,
        shortRequiredVictoryTowns: null,
        winner: null,
        lastUpdatedAt: null,
        factions: {
            colonial: createEmptyFactionSummary(),
            warden: createEmptyFactionSummary(),
        },
    };
}

function normalizeTimelineItems(
    items: readonly FoxholePlaybackTimelineItem[],
    minimumTimestampMs: number,
): FoxholePlaybackTimelineItem[] {
    const dedupedItems = new Map<string, FoxholePlaybackTimelineItem>();

    for (const item of items) {
        const itemId = normalizeString(item?.id);
        const capturedAt = normalizeString(item?.capturedAt);
        const capturedAtMs = parsePlaybackTimestamp(capturedAt);
        if (!itemId || capturedAtMs === null || capturedAtMs < minimumTimestampMs) {
            continue;
        }

        dedupedItems.set(itemId, {
            ...item,
            id: itemId,
            capturedAt,
        });
    }

    return Array.from(dedupedItems.values()).sort((left, right) => {
        const leftSequence = asFiniteNumber(left.frameSequence);
        const rightSequence = asFiniteNumber(right.frameSequence);
        if (leftSequence !== null && rightSequence !== null && leftSequence !== rightSequence) {
            return leftSequence - rightSequence;
        }

        const leftTimestamp = parsePlaybackTimestamp(left.capturedAt) ?? 0;
        const rightTimestamp = parsePlaybackTimestamp(right.capturedAt) ?? 0;
        if (leftTimestamp !== rightTimestamp) {
            return leftTimestamp - rightTimestamp;
        }

        return left.id.localeCompare(right.id);
    });
}

function sampleTimelineItemsEvenly(
    items: readonly FoxholePlaybackTimelineItem[],
    maxCount: number,
): FoxholePlaybackTimelineItem[] {
    if (items.length <= maxCount) {
        return [...items];
    }

    const sampled: FoxholePlaybackTimelineItem[] = [];
    const lastIndex = items.length - 1;
    let previousIndex = -1;

    for (let sampleIndex = 0; sampleIndex < maxCount; sampleIndex += 1) {
        const index = Math.round((sampleIndex / (maxCount - 1)) * lastIndex);
        if (index === previousIndex) {
            continue;
        }

        const item = items[index];
        if (!item) {
            continue;
        }

        sampled.push(item);
        previousIndex = index;
    }

    const lastItem = items[lastIndex];
    if (lastItem && sampled[sampled.length - 1]?.id !== lastItem.id) {
        sampled.push(lastItem);
    }

    return sampled;
}

function mergeTimelineItems(
    existingItems: readonly FoxholePlaybackTimelineItem[],
    incomingItems: readonly FoxholePlaybackTimelineItem[],
    minimumTimestampMs: number,
): FoxholePlaybackTimelineItem[] {
    return normalizeTimelineItems([
        ...existingItems,
        ...incomingItems,
    ], minimumTimestampMs);
}

function getRequestErrorMessage(caughtError: unknown, fallbackMessage: string): string {
    const statusMessage = typeof caughtError === 'object' && caughtError && 'data' in caughtError
        ? (caughtError as { data?: { statusMessage?: string; }; }).data?.statusMessage
        : undefined;
    const message = typeof caughtError === 'object' && caughtError && 'message' in caughtError
        ? (caughtError as { message?: string; }).message
        : undefined;
    return statusMessage || message || fallbackMessage;
}

function buildWarSummaryFromFramePayload(
    payload: FoxholePlaybackFramePayload,
    frame: Pick<FoxholePlaybackFrameRecord, 'capturedAt'>,
    selectedShardId: string,
): FoxholeWarSummary {
    const nextSummary = createEmptyWarSummary(selectedShardId);
    nextSummary.warId = normalizeString(payload.warId) || null;
    nextSummary.warNumber = asFiniteNumber(payload.warNumber);
    nextSummary.shardId = normalizeString(payload.shardId) || nextSummary.shardId;
    nextSummary.warStart = asFiniteNumber(payload.warStart);
    nextSummary.conquestEndTime = asFiniteNumber(payload.warEnd);
    nextSummary.resistanceStart = asFiniteNumber(payload.resistanceStart);
    nextSummary.scheduledConquestEndTime = asFiniteNumber(payload.scheduledConquestEndTime);
    nextSummary.requiredVictoryTowns = asFiniteNumber(payload.requiredVictoryTowns);
    nextSummary.shortRequiredVictoryTowns = asFiniteNumber(payload.shortRequiredVictoryTowns);
    nextSummary.winner = normalizeString(payload.winner) || null;
    nextSummary.lastUpdatedAt = parsePlaybackTimestamp(frame.capturedAt) ?? Date.now();

    for (const iconLayer of Object.values(payload.icons ?? {})) {
        for (const icon of iconLayer?.items ?? []) {
            const factionKey = normalizeFactionKey((icon as { teamId?: string | null; }).teamId);
            if (!factionKey) {
                continue;
            }

            const iconType = readMapIconType(icon);
            if (iconType !== null) {
                incrementStructureCount(nextSummary.factions[factionKey], iconType);
            }

            const flags = (icon as { flags?: number | null; }).flags;
            if (typeof flags === 'number' && (flags & 0x01) !== 0) {
                nextSummary.factions[factionKey].victoryTowns += 1;
            }
        }
    }

    const incompleteHourlyFactions = new Set<FoxholeFactionKey>();
    for (const report of Object.values(payload.reports ?? {})) {
        for (const [factionKey, factionData] of Object.entries(report?.factions ?? {})) {
            const normalizedFactionKey = normalizeFactionKey(factionKey);
            if (!normalizedFactionKey) {
                continue;
            }

            const factionSummary = nextSummary.factions[normalizedFactionKey];
            factionSummary.totalCasualties += Number(factionData.totalCasualties ?? 0);

            const hourlyCasualties = factionData.totalHourlyCasualties;
            if (hourlyCasualties === null || hourlyCasualties === undefined) {
                incompleteHourlyFactions.add(normalizedFactionKey);
                factionSummary.totalHourlyCasualties = null;
                continue;
            }

            if (incompleteHourlyFactions.has(normalizedFactionKey)) {
                continue;
            }

            factionSummary.totalHourlyCasualties = (factionSummary.totalHourlyCasualties ?? 0) + Number(hourlyCasualties);
        }
    }

    return nextSummary;
}

async function buildWarSummaryFromLatestFrame(selectedShardId: string): Promise<FoxholeWarSummary | null> {
    if (!selectedShardId) {
        return null;
    }

    const frame = await fetchFoxholePlaybackFrame({
        shardId: selectedShardId,
        forceRefresh: true,
    });
    if (!frame?.payload) {
        return null;
    }

    return buildWarSummaryFromFramePayload(frame.payload, frame, selectedShardId);
}

function buildWarSummaryFromPlaybackPreview(preview: FoxholeMapPlaybackPreviewState): FoxholeWarSummary {
    return buildWarSummaryFromFramePayload({
        shardId: preview.shardId,
        warId: preview.warId,
        warNumber: preview.warNumber,
        warStart: preview.warStart ?? null,
        warEnd: preview.conquestEndTime ?? null,
        resistanceStart: preview.resistanceStart ?? null,
        scheduledConquestEndTime: preview.scheduledConquestEndTime ?? null,
        requiredVictoryTowns: preview.requiredVictoryTowns ?? null,
        shortRequiredVictoryTowns: preview.shortRequiredVictoryTowns ?? null,
        winner: preview.winner ?? null,
        reports: preview.reports,
        labels: preview.labels,
        icons: preview.icons,
    }, {
        capturedAt: preview.capturedAt,
    }, normalizeString(preview.shardId) || getSelectedShardId());
}

function getActivePlaybackPreview(): FoxholeMapPlaybackPreviewState | null {
    const preview = foxholeMapPlaybackPreview.value;
    if (!preview) {
        return null;
    }

    const selectedShardId = getSelectedShardId();
    const previewShardId = normalizeString(preview.shardId);
    if (selectedShardId && previewShardId && previewShardId !== selectedShardId) {
        return null;
    }

    const currentWarId = normalizeString(sharedWarSummary.value?.warId);
    const previewWarId = normalizeString(preview.warId);
    if (currentWarId && previewWarId && currentWarId !== previewWarId) {
        return null;
    }

    return preview;
}

function filterPlaybackEventsForPreview(
    items: readonly FoxholePlaybackEventRecord[],
    preview: FoxholeMapPlaybackPreviewState,
): FoxholePlaybackEventRecord[] {
    const previewTimestampMs = parsePlaybackTimestamp(preview.capturedAt);
    if (previewTimestampMs === null) {
        return [];
    }

    const minimumTimestampMs = previewTimestampMs - DAY_MS;
    const previewShardId = normalizeString(preview.shardId);
    const previewWarId = normalizeString(preview.warId);

    return items.filter(item => {
        const observedAtMs = parsePlaybackTimestamp(item.observedAt);
        if (observedAtMs === null || observedAtMs < minimumTimestampMs || observedAtMs > previewTimestampMs) {
            return false;
        }

        const itemShardId = normalizeString(item.shardId);
        if (previewShardId && itemShardId && itemShardId !== previewShardId) {
            return false;
        }

        const itemWarId = normalizeString(item.warId);
        if (previewWarId && itemWarId && itemWarId !== previewWarId) {
            return false;
        }

        return true;
    });
}

function filterPlaybackTimelineForPreview(
    items: readonly FoxholePlaybackTimelineItem[],
    preview: FoxholeMapPlaybackPreviewState,
): FoxholePlaybackTimelineItem[] {
    const previewTimestampMs = parsePlaybackTimestamp(preview.capturedAt);
    if (previewTimestampMs === null) {
        return [];
    }

    const minimumTimestampMs = previewTimestampMs - DAY_MS;
    const previewShardId = normalizeString(preview.shardId);
    const previewWarId = normalizeString(preview.warId);

    return items.filter(item => {
        const capturedAtMs = parsePlaybackTimestamp(item.capturedAt);
        if (capturedAtMs === null || capturedAtMs < minimumTimestampMs || capturedAtMs > previewTimestampMs) {
            return false;
        }

        const itemShardId = normalizeString(item.shardId);
        if (previewShardId && itemShardId && itemShardId !== previewShardId) {
            return false;
        }

        const itemWarId = normalizeString(item.warId);
        if (previewWarId && itemWarId && itemWarId !== previewWarId) {
            return false;
        }

        return true;
    });
}

const activePlaybackPreview = computed(() => getActivePlaybackPreview());

const effectiveWarSummary = computed(() => {
    const preview = activePlaybackPreview.value;
    return preview ? buildWarSummaryFromPlaybackPreview(preview) : sharedWarSummary.value;
});

const effectiveWarSummaryLoading = computed(() => {
    return activePlaybackPreview.value ? false : sharedWarSummaryLoading.value;
});

const effectivePlaybackEvents24h = computed(() => {
    const preview = activePlaybackPreview.value;
    return preview
        ? filterPlaybackEventsForPreview(sharedPlaybackEvents24h.value, preview)
        : sharedPlaybackEvents24h.value;
});

const effectivePlaybackSummaryTimeline = computed(() => {
    const preview = activePlaybackPreview.value;
    const visibleItems = preview
        ? filterPlaybackTimelineForPreview(sharedPlaybackTimeline.value, preview)
        : sharedPlaybackTimeline.value;

    return sampleTimelineItemsEvenly(visibleItems, PLAYBACK_TIMELINE_SUMMARY_LIMIT);
});

const effectivePlaybackSnapshotLoading = computed(() => {
    return activePlaybackPreview.value ? false : sharedPlaybackSnapshotLoading.value;
});

const effectivePlaybackSnapshotError = computed(() => {
    return activePlaybackPreview.value ? '' : sharedPlaybackSnapshotError.value;
});

async function refreshWarSummary(options: { force?: boolean; } = {}): Promise<void> {
    if (foxholeWarDebugPreset.value) {
        applyFoxholeWarDebugPresetState();
        return;
    }

    if (!bindings) {
        return;
    }

    syncSharedPlaybackEnabled();
    if (!sharedPlaybackEnabled.value) {
        sharedWarSummaryLoading.value = false;
        warSummaryPromise = null;
        return;
    }

    const requestKey = getSelectedShardId();
    if (!options.force && warSummaryPromise && requestKey === warSummaryRequestKey) {
        return warSummaryPromise;
    }

    const requestToken = ++warSummaryRequestToken;
    warSummaryRequestKey = requestKey;
    const previousWarContextKey = getWarContextKey(sharedWarSummary.value);
    sharedWarSummaryLoading.value = true;

    warSummaryPromise = (async () => {
        try {
            const nextSummary = await buildWarSummaryFromLatestFrame(requestKey);
            if (requestToken !== warSummaryRequestToken) {
                return;
            }

            sharedWarSummary.value = nextSummary;

            const nextWarContextKey = getWarContextKey(nextSummary);
            if (nextWarContextKey !== previousWarContextKey) {
                lastPlaybackEventsResolvedKey = '';
                lastPlaybackEventsResolvedAt = 0;
                lastPlaybackTimelineResolvedKey = '';
                lastPlaybackTimelineResolvedAt = 0;
                await Promise.all([
                    refreshPlaybackEvents({ force: true }),
                    refreshPlaybackTimeline({ force: true, mode: 'full' }),
                ]);
            }
        } catch (caughtError: unknown) {
            if (requestToken !== warSummaryRequestToken) {
                return;
            }

            console.error(getRequestErrorMessage(caughtError, 'Unable to load latest Foxhole frame.'));
        }
    })().finally(() => {
        if (requestToken === warSummaryRequestToken) {
            sharedWarSummaryLoading.value = false;
            warSummaryPromise = null;
        }
    });

    return warSummaryPromise;
}

async function refreshPlaybackEvents(options: { force?: boolean; } = {}): Promise<void> {
    if (foxholeWarDebugPreset.value) {
        applyFoxholeWarDebugPresetState();
        return;
    }

    if (!bindings) {
        return;
    }

    if (!sharedPlaybackEnabled.value) {
        sharedPlaybackEvents24h.value = [];
        sharedPlaybackEventsError.value = 'Playback capture is disabled on this host.';
        return;
    }

    if (!sharedWarSummary.value) {
        await refreshWarSummary();
    }

    if (!sharedPlaybackEnabled.value) {
        sharedPlaybackEvents24h.value = [];
        sharedPlaybackEventsError.value = 'Playback capture is disabled on this host.';
        return;
    }

    const { shardId, warId } = getCurrentWarContext();
    if (!shardId) {
        sharedPlaybackEvents24h.value = [];
        sharedPlaybackEventsError.value = '';
        lastPlaybackEventsResolvedKey = '';
        lastPlaybackEventsResolvedAt = 0;
        return;
    }

    const requestKey = `${shardId}:${warId ?? ''}`;
    const hasWarmCache = sharedPlaybackEvents24h.value.length > 0
        && requestKey === lastPlaybackEventsResolvedKey
        && (Date.now() - lastPlaybackEventsResolvedAt) < PLAYBACK_REFRESH_MS;
    if (!options.force && hasWarmCache) {
        return;
    }
    if (!options.force && playbackEventsPromise && requestKey === playbackEventsRequestKey) {
        return playbackEventsPromise;
    }

    const requestToken = ++playbackEventsRequestToken;
    playbackEventsRequestKey = requestKey;
    sharedPlaybackEventsLoading.value = true;
    sharedPlaybackEventsError.value = '';

    playbackEventsPromise = (async () => {
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - DAY_MS);

        try {
            const response = await $fetch<{ items?: FoxholePlaybackEventRecord[]; }>('/api/foxhole/playback/events', {
                query: {
                    shardId,
                    warId: warId ?? undefined,
                    startAt: startTime.toISOString(),
                    endAt: endTime.toISOString(),
                    limit: PLAYBACK_EVENT_LIMIT,
                },
            });

            if (requestToken !== playbackEventsRequestToken) {
                return;
            }

            sharedPlaybackEvents24h.value = Array.isArray(response?.items) ? response.items : [];
            lastPlaybackEventsResolvedKey = requestKey;
            lastPlaybackEventsResolvedAt = Date.now();
        } catch (caughtError: unknown) {
            if (requestToken !== playbackEventsRequestToken) {
                return;
            }

            sharedPlaybackEventsError.value = getRequestErrorMessage(caughtError, 'Unable to load 24-hour playback events.');
        } finally {
            if (requestToken === playbackEventsRequestToken) {
                sharedPlaybackEventsLoading.value = false;
                playbackEventsPromise = null;
            }
        }
    })();

    return playbackEventsPromise;
}

async function refreshPlaybackTimeline(options: { force?: boolean; mode?: 'full' | 'incremental'; } = {}): Promise<void> {
    if (foxholeWarDebugPreset.value) {
        applyFoxholeWarDebugPresetState();
        return;
    }

    if (!bindings) {
        return;
    }

    if (!sharedPlaybackEnabled.value) {
        sharedPlaybackTimeline.value = [];
        sharedPlaybackTimelineError.value = 'Playback capture is disabled on this host.';
        return;
    }

    if (!sharedWarSummary.value) {
        await refreshWarSummary();
    }

    if (!sharedPlaybackEnabled.value) {
        sharedPlaybackTimeline.value = [];
        sharedPlaybackTimelineError.value = 'Playback capture is disabled on this host.';
        return;
    }

    const { shardId, warId } = getCurrentWarContext();
    if (!shardId) {
        sharedPlaybackTimeline.value = [];
        sharedPlaybackTimelineError.value = '';
        lastPlaybackTimelineResolvedKey = '';
        lastPlaybackTimelineResolvedAt = 0;
        return;
    }

    const mode = options.mode ?? 'full';
    const requestKey = `${shardId}:${warId ?? ''}`;
    const hasWarmCache = sharedPlaybackTimeline.value.length > 0
        && requestKey === lastPlaybackTimelineResolvedKey
        && (Date.now() - lastPlaybackTimelineResolvedAt) < PLAYBACK_REFRESH_MS;
    if (!options.force && mode === 'full' && hasWarmCache) {
        return;
    }
    if (!options.force && playbackTimelinePromise && `${requestKey}:${mode}` === playbackTimelineRequestKey) {
        return playbackTimelinePromise;
    }

    const minimumTimelineTimestampMs = Date.now() - DAY_MS;
    const shouldIncrementallyRefresh = mode === 'incremental'
        && requestKey === lastPlaybackTimelineResolvedKey
        && sharedPlaybackTimeline.value.length > 0;

    const requestToken = ++playbackTimelineRequestToken;
    playbackTimelineRequestKey = `${requestKey}:${mode}`;
    if (!shouldIncrementallyRefresh) {
        sharedPlaybackTimelineLoading.value = true;
        sharedPlaybackTimelineError.value = '';
    }

    playbackTimelinePromise = (async () => {
        try {
            const endAt = new Date(Date.now()).toISOString();
            const startAt = shouldIncrementallyRefresh
                ? normalizeString(sharedPlaybackTimeline.value[sharedPlaybackTimeline.value.length - 1]?.capturedAt) || new Date(minimumTimelineTimestampMs).toISOString()
                : new Date(minimumTimelineTimestampMs).toISOString();
            const response = await $fetch<{ items?: FoxholePlaybackTimelineItem[]; }>('/api/foxhole/playback/timeline', {
                query: {
                    shardId,
                    warId: warId ?? undefined,
                    startAt,
                    endAt,
                    limit: shouldIncrementallyRefresh ? PLAYBACK_INCREMENTAL_LIMIT : PLAYBACK_TIMELINE_LIMIT,
                },
            });

            if (requestToken !== playbackTimelineRequestToken) {
                return;
            }

            const fetchedItems = normalizeTimelineItems(Array.isArray(response?.items) ? response.items : [], minimumTimelineTimestampMs);
            sharedPlaybackTimeline.value = shouldIncrementallyRefresh
                ? mergeTimelineItems(sharedPlaybackTimeline.value, fetchedItems, minimumTimelineTimestampMs)
                : fetchedItems;
            lastPlaybackTimelineResolvedKey = requestKey;
            lastPlaybackTimelineResolvedAt = Date.now();
        } catch (caughtError: unknown) {
            if (requestToken !== playbackTimelineRequestToken) {
                return;
            }

            if (!shouldIncrementallyRefresh) {
                sharedPlaybackTimelineError.value = getRequestErrorMessage(caughtError, 'Unable to load last 24 hours of playback.');
            }
        } finally {
            if (requestToken === playbackTimelineRequestToken) {
                if (!shouldIncrementallyRefresh) {
                    sharedPlaybackTimelineLoading.value = false;
                }
                playbackTimelinePromise = null;
            }
        }
    })();

    return playbackTimelinePromise;
}

async function refreshWarPanelData(options: RefreshWarPanelDataOptions = {}): Promise<void> {
    await refreshWarSummary({ force: options.force });
    await Promise.all([
        refreshPlaybackEvents({ force: options.force }),
        refreshPlaybackTimeline({
            force: options.force,
            mode: options.timelineMode ?? 'full',
        }),
    ]);
}

watch(foxholeWarDebugPreset, nextPreset => {
    syncSharedPlaybackEnabled();

    if (nextPreset) {
        applyFoxholeWarDebugPresetState();
        return;
    }

    if (subscriberCount > 0) {
        void refreshWarPanelData({
            force: true,
            timelineMode: 'full',
        });
    }
}, {
    immediate: true,
});

function startSharedRefreshLoops(): void {
    if (!summaryInterval) {
        summaryInterval = setInterval(() => {
            if (!sharedPlaybackEnabled.value) {
                return;
            }
            void refreshWarSummary({ force: true });
        }, SUMMARY_REFRESH_MS);
    }

    if (!playbackInterval) {
        playbackInterval = setInterval(() => {
            if (!sharedPlaybackEnabled.value) {
                return;
            }
            void Promise.all([
                refreshPlaybackEvents({ force: true }),
                refreshPlaybackTimeline({ force: true, mode: 'incremental' }),
            ]);
        }, PLAYBACK_REFRESH_MS);
    }
}

function stopSharedRefreshLoops(): void {
    if (summaryInterval) {
        clearInterval(summaryInterval);
        summaryInterval = null;
    }

    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }
}

export function useFoxholeWarPanelData() {
    const runtime = useNixieRuntime();
    const runtimeConfig = useRuntimeConfig();
    const settingsStore = useNixieSettingsStore();
    const mapSettings = computed(() => readFoxholeMapSettings(
        runtime.projectStore.settings,
        settingId => settingsStore.getValueOr(settingId, undefined),
    ));
    const playbackEnabled = computed(() => runtimeConfig.public?.foxholePlaybackApiEnabled !== false);

    bindFoxholeWarPanelContext({
        mapSettings,
        playbackEnabled,
    });

    onMounted(() => {
        subscriberCount += 1;
        startSharedRefreshLoops();
        void refreshWarPanelData({
            force: subscriberCount === 1,
            timelineMode: sharedPlaybackTimeline.value.length ? 'incremental' : 'full',
        });
    });

    onUnmounted(() => {
        subscriberCount = Math.max(0, subscriberCount - 1);
        if (subscriberCount === 0) {
            stopSharedRefreshLoops();
        }
    });

    watch(() => mapSettings.value.shardId, (nextShardId, previousShardId) => {
        if (nextShardId === previousShardId) {
            return;
        }

        void refreshWarPanelData({
            force: true,
            timelineMode: 'full',
        });
    });

    return {
        warSummary: effectiveWarSummary,
        warSummaryLoading: effectiveWarSummaryLoading,
        playbackEnabled: readonly(sharedPlaybackEnabled),
        playbackEvents24h: effectivePlaybackEvents24h,
        playbackEventsLoading: readonly(sharedPlaybackEventsLoading),
        playbackEventsError: readonly(sharedPlaybackEventsError),
        playbackTimeline: readonly(sharedPlaybackTimeline),
        playbackSummaryTimeline: effectivePlaybackSummaryTimeline,
        playbackTimelineLoading: readonly(sharedPlaybackTimelineLoading),
        playbackTimelineError: readonly(sharedPlaybackTimelineError),
        playbackSnapshotLoading: effectivePlaybackSnapshotLoading,
        playbackSnapshotError: effectivePlaybackSnapshotError,
        refreshWarSummary,
        refreshPlaybackEvents,
        refreshPlaybackTimeline,
        refreshWarPanelData,
    };
}
