import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { isInitialFoxholeOwnershipEvent } from './foxholeWarObservationBaseline.ts';
import type { NxActivityFeedGroup } from '#nixie/components/NxActivityFeed.vue';
import {
    cloneFoxholeWarDebugPreset,
    getFoxholeWarDebugPresetRef,
} from '#foxhole/composables/foxholeWarDebugState.ts';
import {
    describeFoxholePlaybackEvent,
    formatFoxholePlaybackEventMeta,
    formatFoxholePlaybackRelativeTimestamp,
    getFoxholePlaybackEventGroupMeta,
    getFoxholePlaybackEventIcon,
    getFoxholePlaybackEventTone,
} from '#foxhole/composables/foxholeWarPlaybackEventPresentation.ts';
import { useFoxholePlaybackEventService } from '#foxhole/composables/useFoxholePlaybackEventService.ts';
import type { FoxholePlaybackEventRecord } from '#foxhole/composables/useFoxholeWarPanelData.ts';
import { readFoxholeMapSettings } from '#foxhole/plugins/foxhole/nixie/map-settings.ts';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';

const PLAYBACK_EVENT_LIMIT = 50;

function getEventSortTimestamp(event: FoxholePlaybackEventRecord): number {
    const parsed = Date.parse(event.observedAt);
    return Number.isFinite(parsed) ? parsed : 0;
}

function buildPlaybackEventDedupKey(event: FoxholePlaybackEventRecord): string {
    return [
        event.eventType,
        event.shardId,
        event.mapKey ?? '',
        JSON.stringify(event.data ?? null),
    ].join('|');
}

function isDuplicatePlaybackEvent(left: FoxholePlaybackEventRecord, right: FoxholePlaybackEventRecord): boolean {
    if (left.id && right.id && left.id === right.id) {
        return true;
    }

    return buildPlaybackEventDedupKey(left) === buildPlaybackEventDedupKey(right);
}

function dedupeAndTrimPlaybackEvents(items: readonly FoxholePlaybackEventRecord[]): FoxholePlaybackEventRecord[] {
    const sortedItems = [...items].sort((left, right) => getEventSortTimestamp(right) - getEventSortTimestamp(left));
    const dedupedItems: FoxholePlaybackEventRecord[] = [];

    for (const item of sortedItems) {
        if (isInitialFoxholeOwnershipEvent(item)) continue;
        if (dedupedItems.some(existing => isDuplicatePlaybackEvent(existing, item))) {
            continue;
        }

        dedupedItems.push(item);
        if (dedupedItems.length >= PLAYBACK_EVENT_LIMIT) {
            break;
        }
    }

    return dedupedItems;
}

export function useFoxholeWarLiveFeed() {
    const runtime = useNixieRuntime();
    const settingsStore = useNixieSettingsStore();
    const runtimeConfig = useRuntimeConfig();
    const { liveEvents: sharedLiveEvents } = useFoxholePlaybackEventService();
    const foxholeWarDebugPreset = getFoxholeWarDebugPresetRef();

    const events = ref<FoxholePlaybackEventRecord[]>([]);
    const eventsLoading = ref(false);
    const eventsError = ref('');
    const relativeNow = ref(Date.now());
    const appliedSharedLiveEventIds = new Set<string>();

    let relativeNowInterval: ReturnType<typeof setInterval> | null = null;

    const mapSettings = computed(() => readFoxholeMapSettings(
        runtime.projectStore.settings,
        settingId => settingsStore.getValue(settingId),
    ));

    const playbackEnabled = computed(() => {
        const activePreset = foxholeWarDebugPreset.value;
        if (activePreset) {
            return activePreset.playbackEnabled;
        }

        return runtimeConfig.public?.foxholePlaybackApiEnabled !== false;
    });

    const selectedShardId = computed(() => {
        const shardId = String(mapSettings.value.shardId ?? '').trim();
        return shardId;
    });

    const usingDebugPreset = computed(() => foxholeWarDebugPreset.value !== null);

    const activityGroups = computed<NxActivityFeedGroup[]>(() => {
        const groups: NxActivityFeedGroup[] = [];
        const groupsById = new Map<string, NxActivityFeedGroup>();

        for (const event of events.value) {
            const groupMeta = getFoxholePlaybackEventGroupMeta(event.observedAt, relativeNow.value);
            let group = groupsById.get(groupMeta.id);
            if (!group) {
                group = {
                    id: groupMeta.id,
                    label: groupMeta.label,
                    items: [],
                };
                groupsById.set(groupMeta.id, group);
                groups.push(group);
            }

            const relative = formatFoxholePlaybackRelativeTimestamp(event.observedAt, relativeNow.value);
            const baseMeta = formatFoxholePlaybackEventMeta(event);
            group.items.push({
                id: event.id,
                title: describeFoxholePlaybackEvent(event),
                meta: baseMeta ? `${baseMeta} · ${relative}` : relative,
                icon: getFoxholePlaybackEventIcon(event.eventType),
                tone: getFoxholePlaybackEventTone(event),
            });
        }

        return groups;
    });

    const eventsById = computed(() => {
        const map = new Map<string, FoxholePlaybackEventRecord>();
        for (const event of events.value) {
            map.set(event.id, event);
        }
        return map;
    });

    function applyDebugPresetEvents(): boolean {
        const activePreset = foxholeWarDebugPreset.value;
        if (!activePreset) {
            return false;
        }

        const preset = cloneFoxholeWarDebugPreset(activePreset);
        eventsLoading.value = preset.playbackEventsLoading;
        eventsError.value = preset.playbackEventsError
            || (!preset.playbackEnabled ? 'Playback capture is disabled on this host.' : '');
        events.value = preset.playbackEventsLoading
            ? []
            : dedupeAndTrimPlaybackEvents(preset.historyEvents);
        appliedSharedLiveEventIds.clear();
        return true;
    }

    function applyLivePlaybackEvent(event: FoxholePlaybackEventRecord): void {
        if (usingDebugPreset.value) {
            return;
        }

        if (!selectedShardId.value || event.shardId !== selectedShardId.value) {
            return;
        }

        if (events.value.some(existing => isDuplicatePlaybackEvent(existing, event))) {
            return;
        }

        eventsError.value = '';
        events.value = dedupeAndTrimPlaybackEvents([event, ...events.value]);
    }

    function syncSharedLiveEventsIntoPanel(options: { resetApplied?: boolean; } = {}): void {
        if (usingDebugPreset.value) {
            return;
        }

        if (options.resetApplied) {
            appliedSharedLiveEventIds.clear();
        }

        const unseenEvents = sharedLiveEvents.value
            .filter(event => event.id && !appliedSharedLiveEventIds.has(event.id))
            .reverse();

        for (const event of unseenEvents) {
            if (!event.id) {
                continue;
            }

            appliedSharedLiveEventIds.add(event.id);
            applyLivePlaybackEvent(event);
        }
    }

    async function loadPlaybackEvents(): Promise<void> {
        if (applyDebugPresetEvents()) {
            return;
        }

        if (!playbackEnabled.value) {
            events.value = [];
            eventsError.value = 'Playback capture is disabled on this host.';
            return;
        }

        eventsLoading.value = true;
        eventsError.value = '';
        try {
            const response = await $fetch<{ items?: FoxholePlaybackEventRecord[]; }>('/api/foxhole/playback/events', {
                query: {
                    shardId: selectedShardId.value || undefined,
                    limit: PLAYBACK_EVENT_LIMIT,
                },
            });
            events.value = dedupeAndTrimPlaybackEvents(response?.items ?? []);
            syncSharedLiveEventsIntoPanel({ resetApplied: true });
        } catch (caughtError: unknown) {
            const statusMessage = typeof caughtError === 'object' && caughtError && 'data' in caughtError
                ? (caughtError as { data?: { statusMessage?: string; }; }).data?.statusMessage
                : undefined;
            const message = typeof caughtError === 'object' && caughtError && 'message' in caughtError
                ? (caughtError as { message?: string; }).message
                : undefined;
            eventsError.value = statusMessage || message || 'Unable to load playback events.';
        } finally {
            eventsLoading.value = false;
        }
    }

    watch(selectedShardId, () => {
        void loadPlaybackEvents();
    });

    watch(foxholeWarDebugPreset, () => {
        void loadPlaybackEvents();
    });

    watch(sharedLiveEvents, () => {
        syncSharedLiveEventsIntoPanel();
    }, { deep: true });

    onMounted(() => {
        void loadPlaybackEvents();
        relativeNowInterval = setInterval(() => {
            relativeNow.value = Date.now();
        }, 30_000);
    });

    onUnmounted(() => {
        if (relativeNowInterval) {
            clearInterval(relativeNowInterval);
            relativeNowInterval = null;
        }
    });

    return {
        mapSettings,
        eventsLoading,
        eventsError,
        activityGroups,
        eventsById,
        loadPlaybackEvents,
    };
}
