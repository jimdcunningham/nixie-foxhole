import type { RealtimeChannel, RealtimePostgresInsertPayload } from '@supabase/supabase-js';
import { computed, readonly, ref, watch } from 'vue';
import { isInitialFoxholeOwnershipEvent } from './foxholeWarObservationBaseline.ts';
import type { ComputedRef } from 'vue';
import {
    activateFoxholePlaybackEvent,
    getFoxholePlaybackActionErrorMessage,
    isFoxholePlaybackLocationEvent,
} from '#foxhole/composables/foxholeMapNavigation.ts';
import type { FoxholePlaybackEventRecord } from '#foxhole/composables/useFoxholeWarPanelData.ts';
import { showNxToast } from '#nixie/composables/useNxToast.ts';
import type { NxToastKind } from '#nixie/composables/useNxToast.ts';
import type { NixieRuntimeServiceHandle, NixieRuntimeServiceContext } from '#nixie/plugins/nixie/registry/index.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import { readFoxholeMapSettings } from '#foxhole/plugins/foxhole/nixie/map-settings.ts';
import { FOXHOLE_MAP_REGIONS } from '#foxhole/plugins/foxhole/nixie/map/constants.ts';
import { formatFoxholePlaybackEventTypeLabel as formatEventTypeLabel } from '#foxhole/components/nixie/foxhole/foxholeWarHistoryFilters.ts';

interface FoxholePlaybackEventServiceBindings {
    mapSettings: ComputedRef<ReturnType<typeof readFoxholeMapSettings>>;
    playbackEnabled: ComputedRef<boolean>;
    supabase: ReturnType<typeof useSupabaseClient>;
    runtime: NixieRuntimeServiceContext['runtime'];
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

interface FoxholeShardOption {
    id: string;
    name: string;
    default: boolean;
}

interface FoxholeTownOwnershipEventData {
    mapKey?: string;
    townName?: string;
    previousTeamId?: string;
    nextTeamId?: string;
}

interface FoxholeTownClaimedEventData {
    mapKey?: string;
    townName?: string | null;
    teamId?: string | null;
}

interface FoxholeTownBaseTierEventData {
    mapKey?: string;
    townName?: string | null;
    teamId?: string | null;
    baseType?: string | null;
    previousTier?: number | null;
    nextTier?: number | null;
}

interface FoxholeRocketEventData {
    mapKey?: string;
    teamId?: string | null;
    nearestTownName?: string | null;
}

interface FoxholeVictoryTownScorchedEventData {
    mapKey?: string;
    townName?: string | null;
    teamId?: string | null;
}

interface FoxholeWarLifecycleEventData {
    winner?: string | null;
    scheduledConquestEndTime?: number | null;
    shortRequiredVictoryTowns?: number | null;
}

const LIVE_EVENT_WINDOW_LIMIT = 160;
const FOXHOLE_MAP_REGION_BY_KEY = new Map(FOXHOLE_MAP_REGIONS.map(region => [region.key, region]));

const sharedLiveEvents = ref<FoxholePlaybackEventRecord[]>([]);
const knownLiveEventIds = new Set<string>();
const toastedEventIds = new Set<string>();
const liveToastTimes: number[] = [];
const LIVE_TOAST_WINDOW_MS = 10_000;
const LIVE_TOAST_WINDOW_LIMIT = 3;
const knownShardLabels = new Map<string, string>();

let bindings: FoxholePlaybackEventServiceBindings | null = null;
let playbackEventsChannel: RealtimeChannel | null = null;
let shardLabelLoadPromise: Promise<void> | null = null;

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function asNumberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mapPlaybackEventRow(row: FoxholePlaybackEventRow): FoxholePlaybackEventRecord {
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

function asTownOwnershipEventData(value: unknown): FoxholeTownOwnershipEventData | null {
    return value && typeof value === 'object' ? value as FoxholeTownOwnershipEventData : null;
}

function asTownClaimedEventData(value: unknown): FoxholeTownClaimedEventData | null {
    return value && typeof value === 'object' ? value as FoxholeTownClaimedEventData : null;
}

function asTownBaseTierEventData(value: unknown): FoxholeTownBaseTierEventData | null {
    return value && typeof value === 'object' ? value as FoxholeTownBaseTierEventData : null;
}

function asRocketEventData(value: unknown): FoxholeRocketEventData | null {
    return value && typeof value === 'object' ? value as FoxholeRocketEventData : null;
}

function asVictoryTownScorchedEventData(value: unknown): FoxholeVictoryTownScorchedEventData | null {
    return value && typeof value === 'object' ? value as FoxholeVictoryTownScorchedEventData : null;
}

function asWarLifecycleEventData(value: unknown): FoxholeWarLifecycleEventData | null {
    return value && typeof value === 'object' ? value as FoxholeWarLifecycleEventData : null;
}

function formatTeamLabel(teamId: string | null | undefined): string {
    switch (String(teamId ?? '').trim()) {
        case 'COLONIALS':
            return 'Colonials';
        case 'WARDENS':
            return 'Wardens';
        default:
            return 'Unknown';
    }
}

function getFoxholeRegionLabel(mapKey: string | null | undefined): string {
    const normalizedMapKey = normalizeString(mapKey);
    if (!normalizedMapKey) {
        return '';
    }

    return FOXHOLE_MAP_REGION_BY_KEY.get(normalizedMapKey)?.name ?? normalizedMapKey.toUpperCase();
}

async function ensureShardLabelsLoaded(): Promise<void> {
    if (!shardLabelLoadPromise && knownShardLabels.size === 0) {
        shardLabelLoadPromise = (async () => {
            try {
                const shards = await $fetch<FoxholeShardOption[]>('/api/foxhole/shards');
                for (const shard of Array.isArray(shards) ? shards : []) {
                    const shardId = normalizeString(shard?.id);
                    const shardName = normalizeString(shard?.name);
                    if (!shardId || !shardName) {
                        continue;
                    }

                    knownShardLabels.set(shardId, shardName);
                }
            } catch (error) {
                console.error('Failed to load Foxhole shard labels for playback events.', error);
            }
        })().finally(() => {
            shardLabelLoadPromise = null;
        });
    }

    if (shardLabelLoadPromise) {
        await shardLabelLoadPromise;
    }
}

function getShardLabel(shardId: string | null | undefined): string {
    const normalizedShardId = normalizeString(shardId);
    if (!normalizedShardId) {
        return '';
    }

    return knownShardLabels.get(normalizedShardId) ?? normalizedShardId.toUpperCase();
}

function getPlaybackEventMapKey(event: FoxholePlaybackEventRecord): string {
    const townEvent = asTownOwnershipEventData(event.data);
    const claimedEvent = asTownClaimedEventData(event.data);
    const tierEvent = asTownBaseTierEventData(event.data);
    const rocketEvent = asRocketEventData(event.data);
    const scorchedEvent = asVictoryTownScorchedEventData(event.data);

    return normalizeString(
        townEvent?.mapKey
        ?? claimedEvent?.mapKey
        ?? tierEvent?.mapKey
        ?? rocketEvent?.mapKey
        ?? scorchedEvent?.mapKey
        ?? event.mapKey,
    );
}

function describePlaybackEvent(event: FoxholePlaybackEventRecord): string {
    const regionLabel = getFoxholeRegionLabel(getPlaybackEventMapKey(event));

    if (event.eventType === 'town-captured') {
        const townEvent = asTownOwnershipEventData(event.data);
        const townName = String(townEvent?.townName ?? regionLabel ?? 'Town').trim() || 'Town';
        const nextTeam = formatTeamLabel(townEvent?.nextTeamId);
        const previousTeam = formatTeamLabel(townEvent?.previousTeamId);
        if (previousTeam !== 'Unknown') {
            return `${townName} captured by ${nextTeam} from ${previousTeam}`;
        }
        return `${townName} captured by ${nextTeam}`;
    }

    if (event.eventType === 'town-neutralized') {
        const townEvent = asTownOwnershipEventData(event.data);
        const townName = String(townEvent?.townName ?? regionLabel ?? 'Town').trim() || 'Town';
        const previousTeam = formatTeamLabel(townEvent?.previousTeamId);
        return previousTeam === 'Unknown' ? `${townName} neutralized` : `${townName} neutralized from ${previousTeam}`;
    }

    if (event.eventType === 'town-claimed') {
        const townEvent = asTownClaimedEventData(event.data);
        const townName = String(townEvent?.townName ?? regionLabel ?? 'Town').trim() || 'Town';
        const team = formatTeamLabel(townEvent?.teamId);
        return team === 'Unknown' ? `${townName} claimed` : `${townName} claimed by ${team}`;
    }

    if (event.eventType === 'town-base-upgraded' || event.eventType === 'town-base-downgraded') {
        const tierEvent = asTownBaseTierEventData(event.data);
        const townName = String(tierEvent?.townName ?? regionLabel ?? 'Town').trim() || 'Town';
        const baseType = normalizeString(tierEvent?.baseType) === 'relic' ? 'Relic base' : 'Town base';
        const team = formatTeamLabel(tierEvent?.teamId);
        const nextTier = asNumberOrNull(tierEvent?.nextTier);
        const tierLabel = nextTier === null ? 'new tier' : `tier ${nextTier}`;
        if (event.eventType === 'town-base-upgraded') {
            return team === 'Unknown'
                ? `${baseType} at ${townName} upgraded to ${tierLabel}`
                : `${team} upgraded ${baseType.toLowerCase()} at ${townName} to ${tierLabel}`;
        }

        return team === 'Unknown'
            ? `${baseType} at ${townName} changed to ${tierLabel}`
            : `${team} downgraded ${baseType.toLowerCase()} at ${townName} to ${tierLabel}`;
    }

    if (event.eventType === 'rocket-targeted') {
        const rocketEvent = asRocketEventData(event.data);
        const nearestTownName = normalizeString(rocketEvent?.nearestTownName);
        if (nearestTownName) {
            return `Rocket target marked near ${nearestTownName}`;
        }
        return regionLabel ? `Rocket target marked in ${regionLabel}` : 'Rocket target marked';
    }

    if (event.eventType === 'rocket-impact') {
        const rocketEvent = asRocketEventData(event.data);
        const nearestTownName = normalizeString(rocketEvent?.nearestTownName);
        if (nearestTownName) {
            return `Rocket impact near ${nearestTownName}`;
        }
        return regionLabel ? `Rocket impact recorded in ${regionLabel}` : 'Rocket impact recorded';
    }

    if (event.eventType === 'rocket-ready') {
        const rocketEvent = asRocketEventData(event.data);
        const nearestTownName = normalizeString(rocketEvent?.nearestTownName);
        if (nearestTownName) {
            return `Rocket ready near ${nearestTownName}`;
        }
        return regionLabel ? `Rocket ready in ${regionLabel}` : 'Rocket ready';
    }

    if (event.eventType === 'victory-town-scorched') {
        const scorchedEvent = asVictoryTownScorchedEventData(event.data);
        const townName = String(scorchedEvent?.townName ?? regionLabel ?? 'Victory Town').trim() || 'Victory Town';
        return `${townName} scorched`;
    }

    const lifecycleEvent = asWarLifecycleEventData(event.data);
    if (event.eventType === 'short-conquest-scheduled') {
        const scheduledEnd = asNumberOrNull(lifecycleEvent?.scheduledConquestEndTime);
        const shortRequiredVictoryTowns = asNumberOrNull(lifecycleEvent?.shortRequiredVictoryTowns);
        const scheduledLabel = scheduledEnd === null ? 'scheduled' : `scheduled for ${new Date(scheduledEnd).toLocaleString()}`;
        if (shortRequiredVictoryTowns === null) {
            return `Short conquest ${scheduledLabel}`;
        }

        return `Short conquest ${scheduledLabel} at ${shortRequiredVictoryTowns} victory towns`;
    }

    if (event.eventType === 'war-started') {
        return 'War started';
    }

    if (event.eventType === 'resistance-started') {
        return 'War entered resistance';
    }

    if (event.eventType === 'war-ended') {
        const winner = formatTeamLabel(lifecycleEvent?.winner);
        return winner === 'Unknown' ? 'War ended' : `War ended with ${winner} victory`;
    }

    if (event.eventType === 'war-winner-declared') {
        const winner = formatTeamLabel(lifecycleEvent?.winner);
        return winner === 'Unknown' ? 'War winner declared' : `${winner} declared victorious`;
    }

    return formatEventTypeLabel(event.eventType);
}

function getEventToastKind(event: FoxholePlaybackEventRecord): NxToastKind {
    switch (event.eventType) {
        case 'town-captured':
        case 'town-base-upgraded':
        case 'rocket-ready':
        case 'war-started':
        case 'war-winner-declared':
            return 'success';
        case 'town-neutralized':
        case 'town-base-downgraded':
        case 'rocket-targeted':
        case 'rocket-impact':
        case 'victory-town-scorched':
        case 'war-ended':
            return 'warning';
        default:
            return 'info';
    }
}

function getToastActionLabel(event: FoxholePlaybackEventRecord): string {
    return isFoxholePlaybackLocationEvent(event) ? 'Locate' : 'Preview';
}

function bindFoxholePlaybackEventService(context: FoxholePlaybackEventServiceBindings): void {
    bindings = context;
}

function getSelectedShardId(): string {
    return bindings ? normalizeString(bindings.mapSettings.value.shardId) : '';
}

function trimSharedLiveEvents(): void {
    if (sharedLiveEvents.value.length <= LIVE_EVENT_WINDOW_LIMIT) {
        return;
    }

    sharedLiveEvents.value = sharedLiveEvents.value.slice(0, LIVE_EVENT_WINDOW_LIMIT);
    knownLiveEventIds.clear();
    for (const event of sharedLiveEvents.value) {
        if (event.id) {
            knownLiveEventIds.add(event.id);
        }
    }
}

function resetFoxholePlaybackEventServiceState(): void {
    sharedLiveEvents.value = [];
    knownLiveEventIds.clear();
    toastedEventIds.clear();
    liveToastTimes.length = 0;
}

function maybeToastPlaybackEvent(event: FoxholePlaybackEventRecord): void {
    if (!bindings?.mapSettings.value.eventFeedToasts || !event.id || toastedEventIds.has(event.id)) {
        return;
    }

    const selectedShardId = getSelectedShardId();
    if (!selectedShardId || event.shardId !== selectedShardId) {
        return;
    }

    toastedEventIds.add(event.id);
    const now = Date.now();
    while (liveToastTimes.length && liveToastTimes[0]! <= now - LIVE_TOAST_WINDOW_MS) {
        liveToastTimes.shift();
    }
    // Keep the full live feed, but do not stack a toast for every event in a poll batch.
    if (liveToastTimes.length >= LIVE_TOAST_WINDOW_LIMIT) return;
    liveToastTimes.push(now);
    void previewFoxholePlaybackEventToast(event);
}

export function previewFoxholePlaybackEventToast(event: FoxholePlaybackEventRecord): void {
    void (async () => {
        await ensureShardLabelsLoaded();
        const shardLabel = getShardLabel(event.shardId);

        showNxToast({
            title: formatEventTypeLabel(event.eventType),
            message: `${describePlaybackEvent(event)}${shardLabel ? ` · ${shardLabel}` : ''}`,
            kind: getEventToastKind(event),
            durationMs: 5200,
            actionLabel: getToastActionLabel(event),
            onClick: async () => {
                const currentBindings = bindings;
                if (!currentBindings) {
                    return;
                }

                try {
                    await activateFoxholePlaybackEvent({
                        runtime: currentBindings.runtime,
                        mapSettings: currentBindings.mapSettings.value,
                        event,
                        eventLabel: describePlaybackEvent(event),
                    });
                } catch (error: unknown) {
                    const message = getFoxholePlaybackActionErrorMessage(error, 'Unable to open this event.');
                    showNxToast({
                        message,
                        kind: 'error',
                        durationMs: 5200,
                    });
                }
            },
        });
    })();
}

function appendLivePlaybackEvent(event: FoxholePlaybackEventRecord): void {
    if (!event.id || knownLiveEventIds.has(event.id) || isInitialFoxholeOwnershipEvent(event)) {
        return;
    }

    knownLiveEventIds.add(event.id);
    sharedLiveEvents.value = [event, ...sharedLiveEvents.value];
    trimSharedLiveEvents();
    maybeToastPlaybackEvent(event);
}

function subscribeToPlaybackEvents(): void {
    if (playbackEventsChannel || !bindings?.playbackEnabled.value || !getSelectedShardId()) {
        return;
    }

    playbackEventsChannel = bindings.supabase
        .channel('foxhole-war-history-events-shared')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'foxhole_war_events',
        }, payload => {
            const row = (payload as RealtimePostgresInsertPayload<FoxholePlaybackEventRow>).new;
            const event = mapPlaybackEventRow(row);
            if (!event.id || !event.eventType) {
                return;
            }

            appendLivePlaybackEvent(event);
        })
        .subscribe();
}

function unsubscribeFromPlaybackEvents(): void {
    if (!playbackEventsChannel || !bindings) {
        return;
    }

    void bindings.supabase.removeChannel(playbackEventsChannel);
    playbackEventsChannel = null;
}

function syncPlaybackEventSubscription(): void {
    if (!bindings?.playbackEnabled.value || !getSelectedShardId()) {
        unsubscribeFromPlaybackEvents();
        return;
    }

    subscribeToPlaybackEvents();
}

export function startFoxholePlaybackEventService(context: NixieRuntimeServiceContext): NixieRuntimeServiceHandle {
    const settingsStore = useNixieSettingsStore();
    const mapSettings = computed(() => readFoxholeMapSettings(
        context.runtime.projectStore.settings,
        settingId => settingsStore.getValueOr(settingId, undefined),
    ));
    const playbackEnabled = computed(() => context.publicRuntimeConfig?.foxholePlaybackApiEnabled !== false);

    bindFoxholePlaybackEventService({
        mapSettings,
        playbackEnabled,
        supabase: context.supabase as ReturnType<typeof useSupabaseClient>,
        runtime: context.runtime,
    });
    void ensureShardLabelsLoaded();

    const stopSyncWatch = watch([
        () => playbackEnabled.value,
        () => mapSettings.value.shardId,
    ], () => {
        syncPlaybackEventSubscription();
    }, {
        immediate: true,
    });

    return {
        async stop() {
            stopSyncWatch();
            unsubscribeFromPlaybackEvents();
            bindings = null;
            resetFoxholePlaybackEventServiceState();
        },
    };
}

export function useFoxholePlaybackEventService() {
    return {
        liveEvents: readonly(sharedLiveEvents),
    };
}
