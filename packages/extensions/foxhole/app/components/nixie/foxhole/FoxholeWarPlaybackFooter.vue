<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useFoxholeWarPanelData } from '#foxhole/composables/useFoxholeWarPanelData.ts';
import type { FoxholePlaybackTimelineItem } from '#foxhole/composables/useFoxholeWarPanelData.ts';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { readBrowserStorageJson, writeBrowserStorageJson } from '#nixie/plugins/nixie/browser-storage.ts';
import {
    clearFoxholeMapPlaybackPreview,
    getFoxholeMapPlaybackPreviewRef,
    setFoxholeMapPlaybackPreview,
} from '#foxhole/plugins/foxhole/nixie/map/playback-preview.ts';
import {
    cancelFoxholePlaybackFramePrefetches,
    fetchFoxholePlaybackFrame,
    peekCachedFoxholePlaybackFrame,
    prefetchFoxholePlaybackFrame,
} from '#foxhole/plugins/foxhole/nixie/map/playback-frame-cache.ts';
import { readFoxholeMapSettings } from '#foxhole/plugins/foxhole/nixie/map-settings.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';

interface FoxholePlaybackPreviewLayerEntry {
    version?: number | null;
    items?: unknown[];
}

interface FoxholePlaybackPreviewReportEntry {
    totalEnlistments?: number | null;
    factions?: Record<string, Record<string, number>>;
    dayOfWar?: number | null;
    version?: number | null;
}

interface FoxholePlaybackFramePayload {
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

interface FoxholePlaybackFrameRecord {
    id: string;
    shardId: string;
    warId: string | null;
    warNumber: number | null;
    capturedAt: string;
    payload: FoxholePlaybackFramePayload;
}

interface PersistedFoxholeWarPlaybackSettings {
    loop?: boolean;
    speedMultiplier?: number;
}

interface PlaybackSliderScaleTick {
    minuteOffset: number;
    percent: number;
    label: string;
    align: 'start' | 'center' | 'end';
}

type PlaybackAdvanceTarget = { mode: 'timestamp'; timestampMs: number; } | { mode: 'live'; };

const MINUTE_MS = 60 * 1000;
const PLAYBACK_WINDOW_MINUTES = 24 * 60;
const PLAYBACK_WINDOW_MS = PLAYBACK_WINDOW_MINUTES * MINUTE_MS;
const PLAYBACK_MINOR_TICK_MINUTES = 60;
const PLAYBACK_MAJOR_TICK_MINUTES = 6 * 60;
const PLAYBACK_STEP_MS = 1000;
const PLAYBACK_MIN_STEP_MS = 16;
const SCRUB_DEBOUNCE_MS = 120;
const PLAYBACK_BUFFER_SAMPLE_COUNT = 12;
const PLAYBACK_PREFETCH_SAMPLE_COUNT = 24;
const PLAYBACK_LIVE_EDGE_WARMUP = 48;
const PLAYBACK_SPEED_OPTIONS = Object.freeze([
    { label: '1x', multiplier: 1 },
    { label: '2x', multiplier: 2 },
    { label: '4x', multiplier: 4 },
    { label: '8x', multiplier: 8 },
    { label: '16x', multiplier: 16 },
    { label: '30x', multiplier: 30 },
    { label: '60x', multiplier: 60 },
]);
const DEFAULT_PLAYBACK_SPEED = PLAYBACK_SPEED_OPTIONS[2]!;
const FOXHOLE_WAR_PLAYBACK_SETTINGS_STORAGE_KEY = 'foxhole:war-playback-footer-settings:v1';
const CLOCK_FORMATTER = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
});
const CLOCK_MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, {
    month: 'short',
});

const runtime = useNixieRuntime();
const settingsStore = useNixieSettingsStore();
const playbackPreviewRef = getFoxholeMapPlaybackPreviewRef();
const mapSettings = computed(() => readFoxholeMapSettings(
    runtime.projectStore.settings,
    settingId => settingsStore.getValueOr(settingId, ''),
));
const activePreview = computed(() => playbackPreviewRef.value);
const {
    warSummary,
    playbackEnabled,
    playbackTimeline: timelineItems,
    playbackTimelineLoading: loading,
    playbackTimelineError: error,
    refreshPlaybackTimeline,
} = useFoxholeWarPanelData();
const previewLoading = ref(false);
const previewError = ref('');
const debouncePending = ref(false);
const playbackBuffering = ref(false);
const playbackBufferTargetTimestampMs = ref<number | null>(null);
const playheadTimestampMs = ref<number | null>(null);
const selectedIndex = ref(0);
const isLive = ref(true);
const isPlaying = ref(false);
const isLoopingPlayback = ref(false);
const selectedPlaybackSpeedIndex = ref(2);
const readyFrameIds = ref<Set<string>>(new Set());
const pendingFrameIds = ref<Set<string>>(new Set());
const warContext = computed(() => ({
    shardId: normalizeString(warSummary.value?.shardId) || normalizeString(mapSettings.value.shardId),
    warId: normalizeString(warSummary.value?.warId) || null,
    warNumber: warSummary.value?.warNumber ?? null,
}));

let playbackAdvanceTimeout: ReturnType<typeof setTimeout> | null = null;
let scrubTimeout: ReturnType<typeof setTimeout> | null = null;
let previewRequestToken = 0;
let playbackSessionToken = 0;
let scheduledPlaybackTarget: PlaybackAdvanceTarget | null = null;
let previewAbortController: AbortController | null = null;
let suppressPreviewLoad = false;

function getTimelineItemAt(index: number): FoxholePlaybackTimelineItem | null {
    if (!timelineItems.value.length) {
        return null;
    }

    const nextIndex = clampIndex(index, maxIndex.value);
    return timelineItems.value[nextIndex] ?? null;
}

function getTimelineItemIfInRange(index: number): FoxholePlaybackTimelineItem | null {
    if (index < 0 || index >= timelineItems.value.length) {
        return null;
    }

    return timelineItems.value[index] ?? null;
}

function restorePlaybackSettings(): void {
    const persisted = readBrowserStorageJson<PersistedFoxholeWarPlaybackSettings>(FOXHOLE_WAR_PLAYBACK_SETTINGS_STORAGE_KEY);
    if (!persisted) {
        return;
    }

    if (typeof persisted.loop === 'boolean') {
        isLoopingPlayback.value = persisted.loop;
    }

    if (!Number.isFinite(persisted.speedMultiplier)) {
        return;
    }

    const nextSpeedIndex = PLAYBACK_SPEED_OPTIONS.findIndex(option => option.multiplier === persisted.speedMultiplier);
    if (nextSpeedIndex >= 0) {
        selectedPlaybackSpeedIndex.value = nextSpeedIndex;
    }
}

function persistPlaybackSettings(): void {
    writeBrowserStorageJson(FOXHOLE_WAR_PLAYBACK_SETTINGS_STORAGE_KEY, {
        loop: isLoopingPlayback.value,
        speedMultiplier: selectedPlaybackSpeed.value.multiplier,
    });
}

const selectedShardId = computed(() => {
    const currentShardId = normalizeString(warContext.value.shardId);
    if (currentShardId) {
        return currentShardId;
    }

    return normalizeString(mapSettings.value.shardId);
});
const hasTimeline = computed(() => timelineItems.value.length > 0);
const maxIndex = computed(() => Math.max(0, timelineItems.value.length - 1));
const liveEdgeTimestampMs = computed(() => parsePlaybackTimestamp(timelineItems.value.at(-1)?.capturedAt));
const windowStartTimestampMs = computed(() => {
    const liveEdge = liveEdgeTimestampMs.value;
    return liveEdge === null ? null : liveEdge - PLAYBACK_WINDOW_MS;
});
const selectedTimelineItem = computed(() => {
    if (!timelineItems.value.length) {
        return null;
    }
    const nextIndex = clampIndex(selectedIndex.value, timelineItems.value.length - 1);
    return timelineItems.value[nextIndex] ?? null;
});
const selectedPlaybackSpeed = computed(() => {
    return PLAYBACK_SPEED_OPTIONS[selectedPlaybackSpeedIndex.value] ?? DEFAULT_PLAYBACK_SPEED;
});
const playbackStepMs = computed(() => {
    return Math.max(PLAYBACK_MIN_STEP_MS, Math.round(PLAYBACK_STEP_MS / Math.max(1, selectedPlaybackSpeed.value.multiplier)));
});
const fullReplayDurationMs = computed(() => {
    return Math.max(0, timelineItems.value.length - 1) * playbackStepMs.value;
});
const currentPlayheadTimestampMs = computed(() => {
    const liveEdge = liveEdgeTimestampMs.value;
    if (liveEdge === null) {
        return null;
    }

    if (isLive.value) {
        return liveEdge;
    }

    return clampTimestampToWindow(playheadTimestampMs.value ?? liveEdge);
});
const playheadMinuteOffset = computed(() => {
    const currentTimestamp = currentPlayheadTimestampMs.value;
    const windowStart = windowStartTimestampMs.value;
    if (currentTimestamp === null || windowStart === null) {
        return 0;
    }

    return clampMinuteOffset(Math.round((currentTimestamp - windowStart) / MINUTE_MS));
});
const playbackRateSummaryLabel = computed(() => {
    return `${selectedPlaybackSpeed.value.label} · target cadence ${formatPlaybackCadence(playbackStepMs.value)} per snapshot · full replay ${formatDurationCompact(fullReplayDurationMs.value)}`;
});

async function getOrFetchFrame(frameId: string, signal?: AbortSignal | null): Promise<FoxholePlaybackFrameRecord> {
    const normalizedFrameId = normalizeString(frameId);
    if (!normalizedFrameId) {
        throw new Error('Playback frame id is required.');
    }

    const frame = await fetchFoxholePlaybackFrame({
        frameId: normalizedFrameId,
        signal,
    });
    if (!frame) {
        throw new Error('Unable to load playback frame.');
    }

    return frame;
}

function markFrameReady(frameId: string): void {
    const normalizedFrameId = normalizeString(frameId);
    if (!normalizedFrameId) {
        return;
    }

    const nextReadyFrameIds = new Set(readyFrameIds.value);
    nextReadyFrameIds.add(normalizedFrameId);
    readyFrameIds.value = nextReadyFrameIds;

    if (pendingFrameIds.value.has(normalizedFrameId)) {
        const nextPendingFrameIds = new Set(pendingFrameIds.value);
        nextPendingFrameIds.delete(normalizedFrameId);
        pendingFrameIds.value = nextPendingFrameIds;
    }
}

function markFramePending(frameId: string, pending: boolean): void {
    const normalizedFrameId = normalizeString(frameId);
    if (!normalizedFrameId || readyFrameIds.value.has(normalizedFrameId)) {
        return;
    }

    if (pending) {
        if (pendingFrameIds.value.has(normalizedFrameId)) {
            return;
        }

        const nextPendingFrameIds = new Set(pendingFrameIds.value);
        nextPendingFrameIds.add(normalizedFrameId);
        pendingFrameIds.value = nextPendingFrameIds;
        return;
    }

    if (!pendingFrameIds.value.has(normalizedFrameId)) {
        return;
    }

    const nextPendingFrameIds = new Set(pendingFrameIds.value);
    nextPendingFrameIds.delete(normalizedFrameId);
    pendingFrameIds.value = nextPendingFrameIds;
}

function clearFrameTrackingState(): void {
    readyFrameIds.value = new Set();
    pendingFrameIds.value = new Set();
}

function clearPendingFrameTrackingState(): void {
    pendingFrameIds.value = new Set();
}

function isFrameReady(frameId: string | null | undefined): boolean {
    const normalizedFrameId = normalizeString(frameId);
    return Boolean(normalizedFrameId) && readyFrameIds.value.has(normalizedFrameId);
}

function isAbortError(caughtError: unknown): boolean {
    return caughtError instanceof Error && caughtError.name === 'AbortError';
}

async function prefetchTimelineFrame(
    frameId: string,
    options: {
        immediate?: boolean;
        priority?: number;
    } = {},
): Promise<boolean> {
    const normalizedFrameId = normalizeString(frameId);
    if (!normalizedFrameId) {
        return false;
    }
    if (readyFrameIds.value.has(normalizedFrameId)) {
        return true;
    }

    markFramePending(normalizedFrameId, true);
    try {
        if (options.immediate) {
            await getOrFetchFrame(normalizedFrameId);
        } else {
            await prefetchFoxholePlaybackFrame({
                frameId: normalizedFrameId,
                priority: options.priority,
            });
        }
        markFrameReady(normalizedFrameId);
        return true;
    } catch (caughtError: unknown) {
        markFramePending(normalizedFrameId, false);
        if (isAbortError(caughtError)) {
            return false;
        }

        return false;
    }
}

async function warmPlaybackWindow(centerIndex: number): Promise<boolean> {
    const currentFrameId = getTimelineItemAt(centerIndex)?.id;
    if (!currentFrameId) {
        return false;
    }

    const requiredAheadFrameIds = collectSequentialFrameIds(centerIndex, getDesiredReadyAheadCount(centerIndex), false)
        .filter(frameId => frameId !== currentFrameId);
    const surroundingFrameIds = collectSequentialFrameIds(centerIndex, PLAYBACK_PREFETCH_SAMPLE_COUNT, false)
        .filter(frameId => frameId !== currentFrameId && !requiredAheadFrameIds.includes(frameId));

    const requiredAheadPromises = requiredAheadFrameIds.map((frameId, index) => prefetchTimelineFrame(frameId, {
        priority: index + 1,
    }).catch(() => false));

    for (const [priority, frameId] of surroundingFrameIds.entries()) {
        void prefetchTimelineFrame(frameId, {
            priority: requiredAheadFrameIds.length + priority + 1,
        }).catch(() => undefined);
    }

    const [currentFrameReady, aheadResults] = await Promise.all([
        prefetchTimelineFrame(currentFrameId, {
            immediate: true,
            priority: 0,
        }),
        Promise.all(requiredAheadPromises),
    ]);

    if (!currentFrameReady) {
        return false;
    }

    const requiredAheadReadyCount = aheadResults.filter(Boolean).length;
    return requiredAheadReadyCount >= requiredAheadFrameIds.length;
}

function isPlaybackWindowReadyAt(index: number, requiredAheadCount = getDesiredReadyAheadCount(index)): boolean {
    const currentFrameId = getTimelineItemAt(index)?.id;
    if (!isFrameReady(currentFrameId)) {
        return false;
    }

    return countReadyAheadFrames(index, requiredAheadCount) >= requiredAheadCount;
}

function prefetchLiveEdgeFrames(): void {
    if (!timelineItems.value.length) {
        return;
    }

    const startIndex = Math.max(0, timelineItems.value.length - PLAYBACK_LIVE_EDGE_WARMUP);
    for (let index = startIndex; index < timelineItems.value.length; index += 1) {
        const frameId = timelineItems.value[index]?.id;
        if (!frameId) {
            continue;
        }

        void prefetchTimelineFrame(frameId, {
            priority: index - startIndex,
        }).catch(() => undefined);
    }
}

function prefetchTimelineBuffer(centerIndex: number): void {
    for (const [priority, frameId] of collectSequentialFrameIds(centerIndex, PLAYBACK_PREFETCH_SAMPLE_COUNT).entries()) {
        void prefetchTimelineFrame(frameId, {
            priority,
        }).catch(() => undefined);
    }
}

const sliderProgressPercent = computed(() => {
    if (!timelineItems.value.length) {
        return 0;
    }

    return (playheadMinuteOffset.value / PLAYBACK_WINDOW_MINUTES) * 100;
});

const sliderStyle = computed(() => ({
    '--foxhole-playback-progress': `${sliderProgressPercent.value}%`,
}));
const sliderMinorTicks = computed(() => {
    const ticks: Array<{ minuteOffset: number; percent: number; }> = [];

    for (let minuteOffset = 0; minuteOffset <= PLAYBACK_WINDOW_MINUTES; minuteOffset += PLAYBACK_MINOR_TICK_MINUTES) {
        if (
            minuteOffset === 0
            || minuteOffset === PLAYBACK_WINDOW_MINUTES
            || minuteOffset % PLAYBACK_MAJOR_TICK_MINUTES === 0
        ) {
            continue;
        }

        ticks.push({
            minuteOffset,
            percent: (minuteOffset / PLAYBACK_WINDOW_MINUTES) * 100,
        });
    }

    return ticks;
});
const sliderMajorTicks = computed<PlaybackSliderScaleTick[]>(() => {
    const ticks: PlaybackSliderScaleTick[] = [];

    for (let minuteOffset = 0; minuteOffset <= PLAYBACK_WINDOW_MINUTES; minuteOffset += PLAYBACK_MAJOR_TICK_MINUTES) {
        const hoursBehindLive = Math.max(0, Math.round((PLAYBACK_WINDOW_MINUTES - minuteOffset) / 60));
        ticks.push({
            minuteOffset,
            percent: (minuteOffset / PLAYBACK_WINDOW_MINUTES) * 100,
            label: hoursBehindLive === 0 ? 'Live' : `${hoursBehindLive}h`,
            align: minuteOffset === 0 ? 'start' : minuteOffset === PLAYBACK_WINDOW_MINUTES ? 'end' : 'center',
        });
    }

    return ticks;
});

const playbackMetricTimestampMs = computed(() => {
    return playbackBufferTargetTimestampMs.value ?? currentPlayheadTimestampMs.value;
});
const playbackMetricIndex = computed(() => {
    if (playbackMetricTimestampMs.value === null) {
        return null;
    }

    return findClosestTimelineIndex(playbackMetricTimestampMs.value);
});

const requiredReadyAheadCount = computed(() => {
    if (!timelineItems.value.length || isLive.value || playbackMetricIndex.value === null) {
        return 0;
    }

    return getDesiredReadyAheadCount(playbackMetricIndex.value);
});

const readyAheadCount = computed(() => {
    if (!requiredReadyAheadCount.value || playbackMetricIndex.value === null) {
        return 0;
    }

    return countReadyAheadFrames(playbackMetricIndex.value, requiredReadyAheadCount.value);
});

const currentFrameReady = computed(() => {
    if (isLive.value || !timelineItems.value.length || playbackMetricIndex.value === null) {
        return false;
    }

    return isFrameReady(getTimelineItemAt(playbackMetricIndex.value)?.id);
});

const playbackWindowReady = computed(() => {
    if (isLive.value || !timelineItems.value.length || playbackMetricIndex.value === null) {
        return false;
    }

    return isPlaybackWindowReadyAt(playbackMetricIndex.value, requiredReadyAheadCount.value);
});

const interactionStateBadge = computed(() => {
    if (isPlaying.value) {
        if (playbackBuffering.value) {
            return {
                label: requiredReadyAheadCount.value > 0
                    ? `Buffer ${readyAheadCount.value}/${requiredReadyAheadCount.value}`
                    : 'Buffering',
                toneClass: 'is-loading',
            };
        }

        return null;
    }

    if (previewLoading.value) {
        return {
            label: 'Seeking',
            toneClass: 'is-loading',
        };
    }
    if (debouncePending.value) {
        return {
            label: 'Scrubbing',
            toneClass: 'is-debouncing',
        };
    }
    return null;
});

const centerStatusLabel = computed(() => {
    if (!playbackEnabled.value) {
        return 'Playback unavailable';
    }
    if (loading.value) {
        return 'Loading last 24h';
    }
    if (error.value) {
        return 'Timeline unavailable';
    }
    if (!timelineItems.value.length) {
        return 'Waiting for frames';
    }
    if (isPlaying.value && playbackBuffering.value) {
        return 'Buffering playback';
    }
    if (previewLoading.value && !isPlaying.value) {
        return 'Loading frame';
    }
    if (isLive.value) {
        return 'Live edge';
    }

    return formatClockLabel(currentPlayheadTimestampMs.value);
});

const timelinePrimaryLabel = computed(() => {
    if (!playbackEnabled.value) {
        return 'Playback unavailable';
    }
    if (loading.value) {
        return 'Loading 24h timeline';
    }
    if (error.value) {
        return 'Timeline unavailable';
    }
    if (!timelineItems.value.length) {
        return 'Awaiting frames';
    }
    if (isLive.value) {
        return 'Live Edge';
    }

    return formatClockLabel(currentPlayheadTimestampMs.value);
});

const timelinePrimaryParts = computed(() => {
    if (!playbackEnabled.value || loading.value || error.value || !timelineItems.value.length || isLive.value) {
        return null;
    }
    if (currentPlayheadTimestampMs.value === null) {
        return null;
    }

    return {
        timeLabel: CLOCK_FORMATTER.format(currentPlayheadTimestampMs.value),
        dateLabel: formatClockDateLabel(currentPlayheadTimestampMs.value),
    };
});

const subtitleLabel = computed(() => {
    if (!playbackEnabled.value) {
        return 'Playback APIs are disabled on this host.';
    }
    if (error.value) {
        return error.value;
    }
    if (!timelineItems.value.length) {
        return 'Drag the scrubber once frames land.';
    }
    if (isPlaying.value) {
        if (playbackBuffering.value) {
            return `Buffering playback · ${playbackRateSummaryLabel.value}`;
        }

        return `Playing ${playbackRateSummaryLabel.value}`;
    }
    if (debouncePending.value) {
        return `Pause on a moment and we'll load it · ${playbackRateSummaryLabel.value}`;
    }
    if (previewLoading.value) {
        return `Loading that moment into the map · ${playbackRateSummaryLabel.value}`;
    }
    if (isLive.value) {
        return `Scrub the last 24 hours · ${playbackRateSummaryLabel.value}`;
    }

    return `Previewing this moment across the map, header, and war summary · ${playbackRateSummaryLabel.value}`;
});

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function parsePlaybackTimestamp(value: string | null | undefined): number | null {
    if (!value) {
        return null;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function formatOrdinalDay(day: number): string {
    const lastTwoDigits = day % 100;
    if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
        return `${day}th`;
    }

    const lastDigit = day % 10;
    if (lastDigit === 1) {
        return `${day}st`;
    }
    if (lastDigit === 2) {
        return `${day}nd`;
    }
    if (lastDigit === 3) {
        return `${day}rd`;
    }

    return `${day}th`;
}

function formatClockDateLabel(timestampMs: number): string {
    const date = new Date(timestampMs);
    return `${CLOCK_MONTH_FORMATTER.format(date)} ${formatOrdinalDay(date.getDate())}, ${date.getFullYear()}`;
}

function formatClockLabel(timestampMs: number | null): string {
    if (timestampMs === null) {
        return '--';
    }

    return `${CLOCK_FORMATTER.format(timestampMs)} · ${formatClockDateLabel(timestampMs)}`;
}

function formatDurationCompact(durationMs: number): string {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
        return '0s';
    }

    let remainingSeconds = Math.max(0, Math.round(durationMs / 1000));
    const days = Math.floor(remainingSeconds / 86400);
    remainingSeconds -= days * 86400;
    const hours = Math.floor(remainingSeconds / 3600);
    remainingSeconds -= hours * 3600;
    const minutes = Math.floor(remainingSeconds / 60);
    remainingSeconds -= minutes * 60;

    const parts: string[] = [];
    if (days > 0) {
        parts.push(`${days}d`);
    }
    if (hours > 0) {
        parts.push(`${hours}h`);
    }
    if (minutes > 0) {
        parts.push(`${minutes}m`);
    }
    if (!parts.length || (parts.length < 2 && remainingSeconds > 0 && days === 0)) {
        parts.push(`${remainingSeconds}s`);
    }

    return parts.slice(0, 2).join(' ');
}

function formatPlaybackCadence(durationMs: number): string {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
        return '0ms';
    }

    if (durationMs < 1000) {
        return `${Math.round(durationMs)}ms`;
    }

    if (durationMs % 1000 === 0) {
        return `${Math.round(durationMs / 1000)}s`;
    }

    return `${(durationMs / 1000).toFixed(1)}s`;
}

function clampIndex(value: number, maximum: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.min(Math.max(Math.floor(value), 0), Math.max(0, maximum));
}

function clampMinuteOffset(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.min(Math.max(Math.round(value), 0), PLAYBACK_WINDOW_MINUTES);
}

function clampTimestampToWindow(timestampMs: number | null | undefined): number | null {
    const liveEdge = liveEdgeTimestampMs.value;
    const windowStart = windowStartTimestampMs.value;
    const nextTimestamp = typeof timestampMs === 'number' ? timestampMs : Number.NaN;
    if (liveEdge === null || windowStart === null || !Number.isFinite(nextTimestamp)) {
        return null;
    }

    return Math.min(Math.max(nextTimestamp, windowStart), liveEdge);
}

function resolveTimestampFromMinuteOffset(minuteOffset: number): number | null {
    const windowStart = windowStartTimestampMs.value;
    if (windowStart === null) {
        return null;
    }

    return clampTimestampToWindow(windowStart + (clampMinuteOffset(minuteOffset) * MINUTE_MS));
}

function collectSequentialFrameIds(centerIndex: number, count: number, includeCurrent = true): string[] {
    const frameIds = new Set<string>();
    const startOffset = includeCurrent ? 0 : 1;

    for (let offset = startOffset; offset <= count; offset += 1) {
        const frameId = normalizeString(getTimelineItemAt(centerIndex + offset)?.id);
        if (frameId) {
            frameIds.add(frameId);
        }
    }

    return Array.from(frameIds);
}

function getDesiredReadyAheadCount(index: number): number {
    const clampedIndex = clampIndex(index, maxIndex.value);
    const remainingFrames = Math.max(0, maxIndex.value - clampedIndex);
    if (remainingFrames === 0) {
        return 0;
    }

    const speedMultiplier = Math.max(1, selectedPlaybackSpeed.value.multiplier);
    const scaledReadyAhead = PLAYBACK_BUFFER_SAMPLE_COUNT + (Math.ceil(Math.log2(speedMultiplier)) * 4);

    return Math.min(
        remainingFrames,
        Math.min(PLAYBACK_PREFETCH_SAMPLE_COUNT, Math.max(PLAYBACK_BUFFER_SAMPLE_COUNT, scaledReadyAhead)),
    );
}

function countReadyAheadFrames(centerIndex: number, limit: number): number {
    if (limit <= 0) {
        return 0;
    }

    let count = 0;

    for (let offset = 1; offset <= limit; offset += 1) {
        const frameId = normalizeString(getTimelineItemAt(centerIndex + offset)?.id);
        if (!frameId || !isFrameReady(frameId)) {
            break;
        }

        count += 1;
    }

    return count;
}

function clearScheduledPreviewLoad(): void {
    if (!scrubTimeout) {
        return;
    }

    clearTimeout(scrubTimeout);
    scrubTimeout = null;
}
function clearScheduledPlaybackAdvance(): void {
    if (!playbackAdvanceTimeout) {
        scheduledPlaybackTarget = null;
        return;
    }

    clearTimeout(playbackAdvanceTimeout);
    playbackAdvanceTimeout = null;
    scheduledPlaybackTarget = null;
}

function stopPlayback(): void {
    playbackSessionToken += 1;
    clearScheduledPlaybackAdvance();
    isPlaying.value = false;
    playbackBuffering.value = false;
    playbackBufferTargetTimestampMs.value = null;
}

function cancelActivePreviewRequest(): void {
    previewRequestToken += 1;
    if (previewAbortController) {
        previewAbortController.abort();
        previewAbortController = null;
    }
    previewLoading.value = false;
}

function resetPendingPreview(): void {
    cancelActivePreviewRequest();
    debouncePending.value = false;
    playbackBuffering.value = false;
    clearScheduledPreviewLoad();
}

function returnToLive(): void {
    stopPlayback();
    resetPendingPreview();
    cancelFoxholePlaybackFramePrefetches();
    clearPendingFrameTrackingState();
    previewError.value = '';
    setPlaybackPosition(liveEdgeTimestampMs.value, true);
    clearFoxholeMapPlaybackPreview();
}

function getPlaybackAdvanceTarget(index: number): PlaybackAdvanceTarget | null {
    const nextTimelineItem = getTimelineItemIfInRange(index + 1);
    const nextTimestamp = parsePlaybackTimestamp(nextTimelineItem?.capturedAt);
    if (nextTimestamp !== null) {
        return {
            mode: 'timestamp',
            timestampMs: nextTimestamp,
        };
    }

    if (isLoopingPlayback.value) {
        const loopTimestamp = parsePlaybackTimestamp(getTimelineItemAt(0)?.capturedAt);
        if (loopTimestamp !== null) {
            return {
                mode: 'timestamp',
                timestampMs: loopTimestamp,
            };
        }
    }

    return liveEdgeTimestampMs.value === null ? null : { mode: 'live' };
}

function schedulePreviewLoad(delayMs: number): void {
    clearScheduledPreviewLoad();
    debouncePending.value = delayMs > 0;
    scrubTimeout = setTimeout(() => {
        scrubTimeout = null;
        debouncePending.value = false;
        void loadSelectedPreviewFrame();
    }, delayMs);
}

function setPlaybackPosition(nextTimestampMs: number | null, nextLiveValue: boolean, silent = false): number | null {
    isLive.value = nextLiveValue;
    playheadTimestampMs.value = nextLiveValue ? null : clampTimestampToWindow(nextTimestampMs);

    const nextIndex = nextLiveValue ? maxIndex.value : findClosestTimelineIndex(playheadTimestampMs.value);
    if (nextIndex === null) {
        return null;
    }

    const clampedIndex = clampIndex(nextIndex, maxIndex.value);
    if (selectedIndex.value !== clampedIndex) {
        if (silent) {
            suppressPreviewLoad = true;
        }
        selectedIndex.value = clampedIndex;
    }

    return clampedIndex;
}

async function loadCachedPreviewFrameAtIndex(index: number): Promise<boolean> {
    const timelineItem = getTimelineItemAt(index);
    if (!timelineItem?.id || isLive.value) {
        return false;
    }

    const requestToken = previewRequestToken;
    previewError.value = '';

    const frame = await peekCachedFoxholePlaybackFrame({
        frameId: timelineItem.id,
    });
    if (requestToken !== previewRequestToken || isLive.value || !frame) {
        return false;
    }

    markFrameReady(timelineItem.id);
    applyPreviewFrame(frame);
    return true;
}

function scrubToTimestamp(
    nextTimestampMs: number | null,
    options: {
        silentPreviewLoad?: boolean;
        previewCachedFrame?: boolean;
    } = {},
): void {
    if (!timelineItems.value.length) {
        return;
    }

    const clampedTimestamp = clampTimestampToWindow(nextTimestampMs);
    if (clampedTimestamp === null) {
        return;
    }
    if (liveEdgeTimestampMs.value !== null && clampedTimestamp >= liveEdgeTimestampMs.value) {
        returnToLive();
        return;
    }

    stopPlayback();
    resetPendingPreview();
    cancelFoxholePlaybackFramePrefetches();
    clearPendingFrameTrackingState();
    previewError.value = '';
    const nextIndex = setPlaybackPosition(clampedTimestamp, false, options.silentPreviewLoad === true);
    if (options.previewCachedFrame === true && nextIndex !== null) {
        void loadCachedPreviewFrameAtIndex(nextIndex);
    }
}

function scrubToMinuteOffset(
    nextMinuteOffset: number,
    options: {
        silentPreviewLoad?: boolean;
        previewCachedFrame?: boolean;
    } = {},
): void {
    scrubToTimestamp(resolveTimestampFromMinuteOffset(nextMinuteOffset), options);
}

function jumpToStart(): void {
    scrubToTimestamp(windowStartTimestampMs.value);
}

function stepBackward(): void {
    if (!timelineItems.value.length) {
        return;
    }

    const currentTimestamp = currentPlayheadTimestampMs.value ?? liveEdgeTimestampMs.value;
    if (currentTimestamp === null) {
        return;
    }

    scrubToTimestamp(currentTimestamp - MINUTE_MS);
}

function stepForward(): void {
    if (!timelineItems.value.length || isLive.value) {
        return;
    }

    const currentTimestamp = currentPlayheadTimestampMs.value;
    if (currentTimestamp === null) {
        return;
    }

    scrubToTimestamp(currentTimestamp + MINUTE_MS);
}

function applyPreviewFrame(frame: FoxholePlaybackFrameRecord): void {
    setFoxholeMapPlaybackPreview({
        shardId: frame.payload.shardId,
        warId: frame.payload.warId,
        warNumber: frame.payload.warNumber,
        capturedAt: frame.capturedAt,
        eventId: frame.id,
        eventType: 'timeline-playback',
        eventLabel: `24h playback ${formatClockLabel(parsePlaybackTimestamp(frame.capturedAt))}`,
        warStart: frame.payload.warStart,
        conquestEndTime: frame.payload.warEnd,
        resistanceStart: frame.payload.resistanceStart,
        scheduledConquestEndTime: frame.payload.scheduledConquestEndTime,
        requiredVictoryTowns: frame.payload.requiredVictoryTowns,
        shortRequiredVictoryTowns: frame.payload.shortRequiredVictoryTowns,
        winner: frame.payload.winner,
        reports: frame.payload.reports,
        labels: frame.payload.labels,
        icons: frame.payload.icons,
    });
}

async function loadPreviewFrameAtIndex(index: number): Promise<boolean> {
    const timelineItem = getTimelineItemAt(index);
    if (!timelineItem?.id || isLive.value) {
        return false;
    }

    if (previewAbortController) {
        previewAbortController.abort();
    }

    const requestToken = ++previewRequestToken;
    const abortController = new AbortController();
    previewAbortController = abortController;
    previewLoading.value = true;
    previewError.value = '';

    try {
        const frame = await getOrFetchFrame(timelineItem.id, abortController.signal);
        markFrameReady(timelineItem.id);

        if (requestToken !== previewRequestToken) {
            return false;
        }

        applyPreviewFrame(frame);
        return true;
    } catch (caughtError: unknown) {
        if (requestToken !== previewRequestToken) {
            return false;
        }
        if (isAbortError(caughtError)) {
            return false;
        }

        const statusMessage = typeof caughtError === 'object' && caughtError && 'data' in caughtError
            ? (caughtError as { data?: { statusMessage?: string; }; }).data?.statusMessage
            : undefined;
        const message = typeof caughtError === 'object' && caughtError && 'message' in caughtError
            ? (caughtError as { message?: string; }).message
            : undefined;
        previewError.value = statusMessage || message || 'Unable to load playback frame.';
        return false;
    } finally {
        if (requestToken === previewRequestToken) {
            previewAbortController = null;
            previewLoading.value = false;
        }
    }
}

function schedulePlaybackAdvance(sessionToken: number, target: PlaybackAdvanceTarget, delayMs = playbackStepMs.value): void {
    clearScheduledPlaybackAdvance();
    if (target.mode === 'timestamp') {
        const clampedTimestampMs = clampTimestampToWindow(target.timestampMs);
        if (clampedTimestampMs === null) {
            return;
        }

        scheduledPlaybackTarget = {
            mode: 'timestamp',
            timestampMs: clampedTimestampMs,
        };
    } else {
        scheduledPlaybackTarget = target;
    }

    playbackAdvanceTimeout = setTimeout(() => {
        playbackAdvanceTimeout = null;
        const nextTarget = scheduledPlaybackTarget;
        scheduledPlaybackTarget = null;

        if (nextTarget === null || sessionToken !== playbackSessionToken || !isPlaying.value) {
            return;
        }

        if (nextTarget.mode === 'live') {
            returnToLive();
            return;
        }

        void playPlaybackTimestamp(nextTarget.timestampMs, sessionToken);
    }, Math.max(0, Math.round(delayMs)));
}

async function playPlaybackTimestamp(timestampMs: number, sessionToken: number): Promise<void> {
    if (sessionToken !== playbackSessionToken || !isPlaying.value || !timelineItems.value.length) {
        return;
    }

    const stepStartedAtMs = Date.now();

    const clampedTimestamp = clampTimestampToWindow(timestampMs);
    if (clampedTimestamp === null) {
        stopPlayback();
        return;
    }

    const clampedIndex = findClosestTimelineIndex(clampedTimestamp);
    if (clampedIndex === null) {
        stopPlayback();
        return;
    }

    const currentTimelineItem = getTimelineItemAt(clampedIndex);
    const currentFrameTimestamp = parsePlaybackTimestamp(currentTimelineItem?.capturedAt) ?? clampedTimestamp;

    const requiredReadyAhead = getDesiredReadyAheadCount(clampedIndex);
    playbackBufferTargetTimestampMs.value = currentFrameTimestamp;

    const alreadyBuffered = isPlaybackWindowReadyAt(clampedIndex, requiredReadyAhead);
    playbackBuffering.value = !alreadyBuffered;

    const warmedCurrentFrame = alreadyBuffered
        ? true
        : await warmPlaybackWindow(clampedIndex);
    if (sessionToken !== playbackSessionToken || !isPlaying.value) {
        playbackBufferTargetTimestampMs.value = null;
        return;
    }
    if (!warmedCurrentFrame) {
        playbackBufferTargetTimestampMs.value = null;
        previewError.value = previewError.value || 'Unable to buffer playback frame.';
        stopPlayback();
        return;
    }

    setPlaybackPosition(currentFrameTimestamp, false, true);
    playbackBufferTargetTimestampMs.value = null;
    const loaded = await loadPreviewFrameAtIndex(clampedIndex);
    if (sessionToken !== playbackSessionToken || !isPlaying.value) {
        return;
    }
    if (!loaded) {
        stopPlayback();
        return;
    }

    playbackBuffering.value = false;
    prefetchTimelineBuffer(clampedIndex);

    const nextTarget = getPlaybackAdvanceTarget(clampedIndex);
    if (nextTarget === null) {
        stopPlayback();
        return;
    }

    const elapsedMs = Date.now() - stepStartedAtMs;
    schedulePlaybackAdvance(sessionToken, nextTarget, playbackStepMs.value - elapsedMs);
}

function togglePlaybackLoop(): void {
    isLoopingPlayback.value = !isLoopingPlayback.value;

    if (!isPlaying.value || isLive.value) {
        return;
    }

    const nextTarget = getPlaybackAdvanceTarget(selectedIndex.value);
    if (nextTarget === null) {
        clearScheduledPlaybackAdvance();
        return;
    }

    schedulePlaybackAdvance(playbackSessionToken, nextTarget);
}

function cyclePlaybackSpeed(): void {
    selectedPlaybackSpeedIndex.value = (selectedPlaybackSpeedIndex.value + 1) % PLAYBACK_SPEED_OPTIONS.length;
}

async function togglePlayback(): Promise<void> {
    if (timelineItems.value.length < 2) {
        return;
    }

    if (isPlaying.value) {
        stopPlayback();
        return;
    }

    previewError.value = '';
    const liveEdge = liveEdgeTimestampMs.value;
    const nextTimestamp = (isLive.value || currentPlayheadTimestampMs.value === null || currentPlayheadTimestampMs.value >= (liveEdge ?? Number.POSITIVE_INFINITY))
        ? windowStartTimestampMs.value
        : currentPlayheadTimestampMs.value;
    if (nextTimestamp === null) {
        return;
    }

    setPlaybackPosition(nextTimestamp, false, true);
    isPlaying.value = true;
    const sessionToken = ++playbackSessionToken;
    await playPlaybackTimestamp(nextTimestamp, sessionToken);
}

function handleSliderInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
        return;
    }

    const nextMinuteOffset = Number.parseInt(target.value, 10);
    if (!Number.isFinite(nextMinuteOffset)) {
        return;
    }

    scrubToMinuteOffset(nextMinuteOffset, {
        silentPreviewLoad: true,
        previewCachedFrame: true,
    });
}

function handleSliderChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
        return;
    }

    const nextMinuteOffset = Number.parseInt(target.value, 10);
    if (!Number.isFinite(nextMinuteOffset)) {
        return;
    }

    scrubToMinuteOffset(nextMinuteOffset, {
        silentPreviewLoad: true,
        previewCachedFrame: true,
    });
    if (isLive.value || !timelineItems.value.length) {
        return;
    }

    schedulePreviewLoad(0);
}

function findClosestTimelineIndex(timestampOrCapturedAt: number | string | null | undefined): number | null {
    if (!timelineItems.value.length) {
        return null;
    }

    const targetTimestamp = typeof timestampOrCapturedAt === 'number'
        ? timestampOrCapturedAt
        : parsePlaybackTimestamp(timestampOrCapturedAt);
    if (targetTimestamp === null) {
        return null;
    }

    let bestIndex = 0;
    let bestDiff = Number.POSITIVE_INFINITY;

    timelineItems.value.forEach((item, index) => {
        const itemTimestamp = parsePlaybackTimestamp(item.capturedAt);
        if (itemTimestamp === null) {
            return;
        }

        const diff = Math.abs(itemTimestamp - targetTimestamp);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestIndex = index;
        }
    });

    return Number.isFinite(bestDiff) ? bestIndex : null;
}

function syncSelectionToActivePreview(): void {
    if (!timelineItems.value.length) {
        return;
    }

    const preview = activePreview.value;
    if (!preview) {
        if (!isPlaying.value) {
            setPlaybackPosition(liveEdgeTimestampMs.value, true, true);
        }
        return;
    }

    if (selectedShardId.value && normalizeString(preview.shardId) && normalizeString(preview.shardId) !== selectedShardId.value) {
        return;
    }

    const currentWarId = normalizeString(warContext.value.warId);
    const previewWarId = normalizeString(preview.warId);
    if (currentWarId && previewWarId && currentWarId !== previewWarId) {
        return;
    }

    const nextTimestamp = parsePlaybackTimestamp(preview.capturedAt);
    if (nextTimestamp === null) {
        return;
    }

    setPlaybackPosition(nextTimestamp, false, true);
}

async function loadSelectedPreviewFrame(): Promise<void> {
    if (!selectedTimelineItem.value || isLive.value) {
        return;
    }

    await loadPreviewFrameAtIndex(selectedIndex.value);
}

watch(selectedIndex, () => {
    if (timelineItems.value.length && !isLive.value) {
        prefetchTimelineBuffer(selectedIndex.value);
    }

    if (suppressPreviewLoad) {
        suppressPreviewLoad = false;
        return;
    }
    if (!timelineItems.value.length || isLive.value) {
        return;
    }

    schedulePreviewLoad(isPlaying.value ? 0 : SCRUB_DEBOUNCE_MS);
});

watch(playbackStepMs, () => {
    if (!isPlaying.value || isLive.value) {
        return;
    }

    const nextTarget = getPlaybackAdvanceTarget(selectedIndex.value);
    if (nextTarget === null) {
        return;
    }

    schedulePlaybackAdvance(playbackSessionToken, nextTarget);
});

watch([selectedPlaybackSpeedIndex, isLoopingPlayback], () => {
    persistPlaybackSettings();
});

watch(() => timelineItems.value.at(-1)?.id ?? '', nextFrameId => {
    if (!nextFrameId) {
        if (isLive.value) {
            clearFoxholeMapPlaybackPreview();
        }
        return;
    }

    prefetchLiveEdgeFrames();
});

watch(() => mapSettings.value.shardId, () => {
    cancelFoxholePlaybackFramePrefetches();
    clearFrameTrackingState();
    returnToLive();
});

watch([
    () => activePreview.value?.token ?? 0,
    () => timelineItems.value.length,
], () => {
    syncSelectionToActivePreview();
});

onMounted(() => {
    restorePlaybackSettings();
    void refreshPlaybackTimeline({
        mode: timelineItems.value.length ? 'incremental' : 'full',
    });
});

onUnmounted(() => {
    stopPlayback();
    resetPendingPreview();
    cancelFoxholePlaybackFramePrefetches();
});
</script>

<template>
    <footer class="foxhole-war-playback-footer" :class="{ 'is-live': isLive, 'is-playing': isPlaying }">
        <template v-if="playbackEnabled && hasTimeline">
            <div class="foxhole-war-playback-footer__bar-row">
                <div class="foxhole-war-playback-footer__status-row">
                    <div class="foxhole-war-playback-footer__timeline-status">
                        <div class="foxhole-war-playback-footer__timeline-copy">
                            <div class="foxhole-war-playback-footer__timeline-kicker">War Timeline</div>
                            <div class="foxhole-war-playback-footer__headline-row">
                                <span class="foxhole-war-playback-footer__timeline-symbol" aria-hidden="true" />
                                <span v-if="timelinePrimaryParts" class="foxhole-war-playback-footer__headline">
                                    <span class="foxhole-war-playback-footer__headline-time">{{ timelinePrimaryParts.timeLabel }}</span>
                                    <span class="foxhole-war-playback-footer__headline-divider" aria-hidden="true">·</span>
                                    <span class="foxhole-war-playback-footer__headline-date">{{ timelinePrimaryParts.dateLabel }}</span>
                                </span>
                                <span v-else class="foxhole-war-playback-footer__headline">{{ timelinePrimaryLabel }}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="foxhole-war-playback-footer__slider-stack">
                    <div class="foxhole-war-playback-footer__slider-shell" :style="sliderStyle">
                        <div class="foxhole-war-playback-footer__slider-track" />
                        <input
                            class="foxhole-war-playback-footer__slider"
                            type="range"
                            min="0"
                            :max="PLAYBACK_WINDOW_MINUTES"
                            :value="playheadMinuteOffset"
                            :disabled="loading || !hasTimeline"
                            aria-label="Playback timeline scrubber"
                            :aria-valuetext="centerStatusLabel"
                            :title="`Scrub the last 24 hours - ${centerStatusLabel}`"
                            @input="handleSliderInput"
                            @change="handleSliderChange"
                        >
                    </div>
                    <div class="foxhole-war-playback-footer__slider-scale" aria-hidden="true">
                        <span
                            v-for="tick in sliderMinorTicks"
                            :key="`minor-${tick.minuteOffset}`"
                            class="foxhole-war-playback-footer__slider-scale-tick is-minor"
                            :style="{ left: `${tick.percent}%` }"
                        />
                        <div
                            v-for="tick in sliderMajorTicks"
                            :key="`major-${tick.minuteOffset}`"
                            class="foxhole-war-playback-footer__slider-major"
                            :class="{
                                'is-start': tick.align === 'start',
                                'is-center': tick.align === 'center',
                                'is-end': tick.align === 'end',
                            }"
                            :style="{ left: `${tick.percent}%` }"
                        >
                            <span class="foxhole-war-playback-footer__slider-scale-tick is-major" />
                            <span class="foxhole-war-playback-footer__slider-scale-label">{{ tick.label }}</span>
                        </div>
                    </div>
                </div>

                <div class="foxhole-war-playback-footer__controls">
                    <div class="foxhole-war-playback-footer__playback-controls">
                        <button
                            type="button"
                            class="foxhole-war-playback-footer__control"
                            :disabled="loading || !hasTimeline"
                            aria-label="Jump to 24 hours ago"
                            title="Jump to 24 hours ago"
                            @click="jumpToStart"
                        >
                            <Icon name="ph:skip-back" />
                        </button>
                        <button
                            type="button"
                            class="foxhole-war-playback-footer__control"
                            :disabled="loading || !hasTimeline"
                            aria-label="Step back 1 minute"
                            title="Step back 1 minute"
                            @click="stepBackward"
                        >
                            <Icon name="ph:rewind" />
                        </button>
                        <button
                            type="button"
                            class="foxhole-war-playback-footer__control foxhole-war-playback-footer__control-play"
                            :class="{ 'is-active': isPlaying }"
                            :disabled="loading || timelineItems.length < 2"
                            :aria-label="isPlaying ? 'Pause playback' : 'Play timeline'"
                            :title="isPlaying ? 'Pause playback' : 'Play timeline'"
                            @click="togglePlayback"
                        >
                            <Icon :name="isPlaying ? 'ph:pause' : 'ph:play'" />
                        </button>
                        <button
                            type="button"
                            class="foxhole-war-playback-footer__control"
                            :disabled="loading || !hasTimeline"
                            aria-label="Step forward 1 minute"
                            title="Step forward 1 minute"
                            @click="stepForward"
                        >
                            <Icon name="ph:fast-forward" />
                        </button>
                        <button
                            type="button"
                            class="foxhole-war-playback-footer__control foxhole-war-playback-footer__control-speed"
                            :disabled="loading || !hasTimeline"
                            :title="`Playback speed ${playbackRateSummaryLabel}`"
                            @click="cyclePlaybackSpeed"
                        >
                            {{ selectedPlaybackSpeed.label }}
                        </button>
                        <button
                            type="button"
                            class="foxhole-war-playback-footer__control foxhole-war-playback-footer__control-loop"
                            :class="{ 'is-active': isLoopingPlayback }"
                            :disabled="loading || timelineItems.length < 2"
                            :aria-label="isLoopingPlayback ? 'Disable playback loop' : 'Enable playback loop'"
                            :title="isLoopingPlayback ? 'Disable playback loop' : 'Enable playback loop'"
                            @click="togglePlaybackLoop"
                        >
                            <Icon name="ph:repeat" />
                        </button>
                    </div>

                    <div class="foxhole-war-playback-footer__controls-meta">
                        <div
                            v-if="interactionStateBadge"
                            class="foxhole-war-playback-footer__state-badge"
                            :class="interactionStateBadge?.toneClass"
                        >
                            {{ interactionStateBadge?.label }}
                        </div>
                        <button
                            type="button"
                            class="foxhole-war-playback-footer__control foxhole-war-playback-footer__control-live"
                            :class="{ 'is-active': isLive }"
                            :disabled="loading || !hasTimeline"
                            :title="isLive ? 'Live edge' : 'Return to live edge'"
                            @click="returnToLive"
                        >
                            Live
                        </button>
                    </div>
                </div>
            </div>

        </template>

        <div v-else class="foxhole-war-playback-footer__empty">
            {{ subtitleLabel }}
        </div>

        <div v-if="previewError" class="foxhole-war-playback-footer__error">
            {{ previewError }}
        </div>
    </footer>
</template>

<style scoped>
.foxhole-war-playback-footer {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--nx-space-2);
    padding: var(--nx-space-2) var(--nx-space-3);
    border-top: 1px solid var(--nx-panel-border);
    background: var(--nx-surface);
    color: var(--nx-text);
    font-family: var(--nx-font-sans);
}

.foxhole-war-playback-footer__status-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--nx-space-3);
    flex-wrap: wrap;
}

.foxhole-war-playback-footer__timeline-status {
    min-width: 0;
    display: flex;
    flex: 1 1 auto;
    gap: var(--nx-space-2);
}

.foxhole-war-playback-footer__timeline-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.foxhole-war-playback-footer__timeline-kicker {
    color: var(--nx-text-subtle);
    font-size: var(--nx-text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.foxhole-war-playback-footer__headline-row {
    display: flex;
    align-items: baseline;
    gap: var(--nx-space-2);
    flex-wrap: wrap;
}

.foxhole-war-playback-footer__control-live {
    font-size: var(--nx-text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.foxhole-war-playback-footer__timeline-symbol {
    flex: 0 0 auto;
    width: 9px;
    height: 9px;
    margin-top: 3px;
    border: 1px solid color-mix(in srgb, var(--nx-accent) 40%, transparent);
    background: var(--nx-accent);
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--nx-on-accent) 12%, transparent);
    transform: rotate(45deg);
}

.foxhole-war-playback-footer__subtitle {
    color: var(--nx-text-muted);
    text-align: left;
    max-width: 52ch;
}

.foxhole-war-playback-footer__headline {
    display: inline-flex;
    align-items: baseline;
    gap: 0.38em;
    color: var(--nx-text-heading);
    font-size: var(--nx-text-sm);
    line-height: var(--nx-leading-tight);
    font-variant-numeric: tabular-nums;
}

.foxhole-war-playback-footer__headline-divider {
    color: var(--nx-text-subtle);
}

.foxhole-war-playback-footer__headline-date {
    color: var(--nx-text);
}

.foxhole-war-playback-footer__subtitle,
.foxhole-war-playback-footer__empty,
.foxhole-war-playback-footer__error {
    font-size: var(--nx-text-xs);
    line-height: var(--nx-leading-normal);
}

.foxhole-war-playback-footer__state-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 22px;
    padding: 0 var(--nx-space-2);
    border: 1px solid var(--nx-border);
    border-radius: var(--nx-radius-sm);
    background: var(--nx-hover-surface);
    color: var(--nx-text-muted);
    font-size: var(--nx-text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
}

.foxhole-war-playback-footer__state-badge.is-debouncing {
    border-color: color-mix(in srgb, var(--nx-warning) 35%, var(--nx-border));
    background: var(--nx-warning-muted);
    color: var(--nx-warning);
}

.foxhole-war-playback-footer__state-badge.is-loading {
    border-color: color-mix(in srgb, var(--nx-info) 35%, var(--nx-border));
    background: var(--nx-info-muted);
    color: var(--nx-info);
}

.foxhole-war-playback-footer__state-badge.is-ready {
    border-color: color-mix(in srgb, var(--nx-success) 35%, var(--nx-border));
    background: var(--nx-success-muted);
    color: var(--nx-success);
}

.foxhole-war-playback-footer__bar-row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--nx-space-2);
    padding: 0;
}

.foxhole-war-playback-footer__slider-stack {
    display: flex;
    flex-direction: column;
    gap: 0;
}

.foxhole-war-playback-footer__controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--nx-space-2);
    width: 100%;
}

.foxhole-war-playback-footer__controls-meta {
    display: inline-flex;
    align-items: center;
    gap: var(--nx-space-2);
    margin-left: auto;
}

.foxhole-war-playback-footer__playback-controls {
    display: inline-flex;
    align-items: center;
    gap: var(--nx-space-1);
    min-width: 0;
    flex-wrap: wrap;
}

.foxhole-war-playback-footer__control {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 22px;
    padding: 0 var(--nx-space-1);
    border: 1px solid var(--nx-control-border);
    border-radius: var(--nx-radius-sm);
    background: var(--nx-control-bg);
    color: var(--nx-text-muted);
    cursor: pointer;
    transition:
        border-color var(--nx-duration-fast) var(--nx-ease-out),
        background var(--nx-duration-fast) var(--nx-ease-out),
        color var(--nx-duration-fast) var(--nx-ease-out);
}

.foxhole-war-playback-footer__control:hover {
    border-color: var(--nx-border-strong);
    background: var(--nx-hover-surface);
    color: var(--nx-text);
}

.foxhole-war-playback-footer__control:disabled {
    cursor: default;
    opacity: 0.46;
}

.foxhole-war-playback-footer__control-play,
.foxhole-war-playback-footer__control-loop {
    min-width: 28px;
    padding: 0;
}

.foxhole-war-playback-footer__control-live {
    min-width: 58px;
    padding: 0 var(--nx-space-3);
}

.foxhole-war-playback-footer__control-speed {
    min-width: 38px;
    font-size: var(--nx-text-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
}

.foxhole-war-playback-footer__control-live.is-active,
.foxhole-war-playback-footer__control-play.is-active,
.foxhole-war-playback-footer__control-loop.is-active {
    border-color: color-mix(in srgb, var(--nx-accent) 45%, var(--nx-border));
    background: var(--nx-accent-muted);
    color: var(--nx-accent-text);
}

.foxhole-war-playback-footer__control-live.is-active:hover,
.foxhole-war-playback-footer__control-play.is-active:hover,
.foxhole-war-playback-footer__control-loop.is-active:hover {
    border-color: color-mix(in srgb, var(--nx-accent) 60%, var(--nx-border));
    background: var(--nx-accent-muted-hover);
    color: var(--nx-accent-text);
}

.foxhole-war-playback-footer__slider-shell {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    height: 16px;
    --foxhole-playback-progress: 0%;
}

.foxhole-war-playback-footer__slider-track {
    position: absolute;
    inset: 50% 0 auto;
    height: 7px;
    transform: translateY(-50%);
    border-radius: var(--nx-radius-pill);
    background:
        linear-gradient(90deg,
            var(--nx-accent) 0%,
            var(--nx-accent) var(--foxhole-playback-progress),
            var(--nx-surface-overlay) var(--foxhole-playback-progress),
            var(--nx-surface-overlay) 100%);
    overflow: hidden;
    pointer-events: none;
}

.foxhole-war-playback-footer__slider-track::after {
    content: none;
}

.foxhole-war-playback-footer__slider {
    appearance: none;
    position: relative;
    z-index: 1;
    width: calc(100% + 4px);
    height: 16px;
    margin: 0 -2px;
    background: transparent;
    cursor: grab;
}

.foxhole-war-playback-footer__slider:disabled {
    cursor: default;
}

.foxhole-war-playback-footer__slider:active {
    cursor: grabbing;
}

.foxhole-war-playback-footer__slider::-webkit-slider-runnable-track {
    height: 7px;
    background: transparent;
}

.foxhole-war-playback-footer__slider::-webkit-slider-thumb {
    appearance: none;
    width: 9px;
    height: 9px;
    margin-top: -2px;
    border: 1px solid color-mix(in srgb, var(--nx-accent) 45%, transparent);
    border-radius: 0;
    background: var(--nx-accent);
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--nx-on-accent) 12%, transparent);
    transform: translateY(-0.5px) rotate(45deg);
}

.foxhole-war-playback-footer__slider::-moz-range-track {
    height: 7px;
    background: transparent;
    border: 0;
}

.foxhole-war-playback-footer__slider::-moz-range-thumb {
    width: 9px;
    height: 9px;
    border: 1px solid color-mix(in srgb, var(--nx-accent) 45%, transparent);
    border-radius: 0;
    background: var(--nx-accent);
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--nx-on-accent) 12%, transparent);
    transform: translateY(0.5px) rotate(45deg);
}

.foxhole-war-playback-footer__slider:focus-visible::-webkit-slider-thumb,
.foxhole-war-playback-footer__slider:active::-webkit-slider-thumb {
    border-color: var(--nx-accent-hover);
    background: var(--nx-accent-hover);
    box-shadow: 0 0 0 3px var(--nx-accent-muted);
}

.foxhole-war-playback-footer__slider:focus-visible::-moz-range-thumb,
.foxhole-war-playback-footer__slider:active::-moz-range-thumb {
    border-color: var(--nx-accent-hover);
    background: var(--nx-accent-hover);
    box-shadow: 0 0 0 3px var(--nx-accent-muted);
}

.foxhole-war-playback-footer__slider-scale {
    position: relative;
    height: 20px;
    pointer-events: none;
    user-select: none;
}

.foxhole-war-playback-footer__slider-major,
.foxhole-war-playback-footer__slider-scale-tick {
    position: absolute;
    top: 0;
}

.foxhole-war-playback-footer__slider-scale-tick {
    width: 1px;
    background: var(--nx-border-strong);
    transform: translateX(-50%);
}

.foxhole-war-playback-footer__slider-scale-tick.is-minor {
    top: -12px;
    height: 7px;
    background: var(--nx-border);
}

.foxhole-war-playback-footer__slider-major {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 6px;
    transform: translateX(-50%);
}

.foxhole-war-playback-footer__slider-major.is-start {
    align-items: flex-start;
    transform: none;
}

.foxhole-war-playback-footer__slider-major.is-end {
    align-items: flex-end;
    transform: translateX(-100%);
}

.foxhole-war-playback-footer__slider-scale-tick.is-major {
    top: -12px;
    height: 7px;
    background: color-mix(in srgb, var(--nx-accent) 45%, transparent);
}

.foxhole-war-playback-footer__slider-major.is-start .foxhole-war-playback-footer__slider-scale-tick.is-major {
    left: 0;
    transform: none;
}

.foxhole-war-playback-footer__slider-major.is-center .foxhole-war-playback-footer__slider-scale-tick.is-major {
    left: 50%;
}

.foxhole-war-playback-footer__slider-major.is-end .foxhole-war-playback-footer__slider-scale-tick.is-major {
    left: 100%;
    background: var(--nx-accent);
    transform: translateX(-100%);
}

.foxhole-war-playback-footer__slider-scale-label {
    position: static;
    color: var(--nx-text-subtle);
    font-size: var(--nx-text-xs);
    letter-spacing: 0.08em;
    line-height: 1;
    text-transform: uppercase;
    white-space: nowrap;
}

.foxhole-war-playback-footer__empty {
    color: var(--nx-text-muted);
}

.foxhole-war-playback-footer__error {
    color: var(--nx-danger-text);
}

@media (max-width: 440px) {
    .foxhole-war-playback-footer__top,
    .foxhole-war-playback-footer__bar-row {
        flex-direction: column;
        align-items: flex-start;
    }

    .foxhole-war-playback-footer__top-meta,
    .foxhole-war-playback-footer__controls,
    .foxhole-war-playback-footer__playback-controls,
    .foxhole-war-playback-footer__slider-stack,
    .foxhole-war-playback-footer__slider-shell,
    .foxhole-war-playback-footer__snapshot {
        width: 100%;
    }

    .foxhole-war-playback-footer__top-meta {
        align-items: stretch;
    }

    .foxhole-war-playback-footer__snapshot {
        justify-content: space-between;
    }

    .foxhole-war-playback-footer__controls {
        align-items: flex-start;
    }

    .foxhole-war-playback-footer__status-row {
        width: 100%;
    }

    .foxhole-war-playback-footer__state-badge {
        margin-left: 0;
    }

    .foxhole-war-playback-footer__control-live {
        margin-left: 0;
        align-self: flex-end;
    }
}
</style>
