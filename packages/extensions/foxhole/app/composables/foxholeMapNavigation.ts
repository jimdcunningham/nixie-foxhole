import {computed} from 'vue';
import type { FoxholePlaybackEventRecord } from '#foxhole/composables/useFoxholeWarPanelData.ts';
import {
    FOXHOLE_MAP_REGIONS,
    FOXHOLE_REGION_HEIGHT,
    FOXHOLE_REGION_WIDTH,
    getFoxholeRegionPosition,
} from '#foxhole/plugins/foxhole/nixie/map/constants.ts';
import {
    FOXHOLE_MAP_SETTING_KEYS,
    serializeFoxholeMapStringList,

} from '#foxhole/plugins/foxhole/nixie/map-settings.ts';
import type { FoxholeMapSettings } from '#foxhole/plugins/foxhole/nixie/map-settings.ts';
import {
    getFoxholeMapSearchCameraTarget,

} from '#foxhole/plugins/foxhole/nixie/map/search.ts';
import type { FoxholeMapSearchEntry } from '#foxhole/plugins/foxhole/nixie/map/search.ts';
import { fetchFoxholePlaybackFrame } from '#foxhole/plugins/foxhole/nixie/map/playback-frame-cache.ts';
import {
    clearFoxholeMapPlaybackPreview,
    setFoxholeMapPlaybackPreview,
} from '#foxhole/plugins/foxhole/nixie/map/playback-preview.ts';
import type { NixieEditorRuntime } from '#nixie/plugins/nixie/runtime/editor-runtime.ts';
import { getNixieEditorDocumentSessionBridge } from '#nixie/utils/nixie-editor-document-session-bridge.ts';
import { focusFoxholeSceneV2MapEntry } from '#foxhole/plugins/foxhole/nixie/scene-map-navigation-adapter.ts';

interface FoxholeTownOwnershipEventData {
    mapKey?: string;
    townName?: string;
    x?: number | null;
    y?: number | null;
}

interface FoxholeTownClaimedEventData {
    mapKey?: string;
    townName?: string | null;
    x?: number | null;
    y?: number | null;
}

interface FoxholeTownBaseTierEventData {
    mapKey?: string;
    townName?: string | null;
    x?: number | null;
    y?: number | null;
}

interface FoxholeRocketEventData {
    mapKey?: string;
    nearestTownName?: string | null;
    x?: number | null;
    y?: number | null;
}

interface FoxholeVictoryTownScorchedEventData {
    mapKey?: string;
    townName?: string | null;
    x?: number | null;
    y?: number | null;
}

export interface FocusFoxholeMapSearchEntryOptions {
    runtime: NixieEditorRuntime;
    mapSettings: Pick<FoxholeMapSettings, 'regionKeys'>;
    entry: FoxholeMapSearchEntry;
    shardId?: string | null;
    ensureMapEnabled?: boolean;
    clearPlaybackPreview?: boolean;
    reason?: string;
}

export interface ActivateFoxholePlaybackEventOptions {
    runtime: NixieEditorRuntime;
    mapSettings: Pick<FoxholeMapSettings, 'regionKeys'>;
    event: FoxholePlaybackEventRecord;
    eventLabel: string;
    onLoadingEventIdChange?: (eventId: string) => void;
    onErrorMessageChange?: (message: string) => void;
    reason?: string;
}

const FOXHOLE_MAP_REGION_BY_KEY = computed(() => new Map(FOXHOLE_MAP_REGIONS.map(region => [region.key, region])));

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
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

function getFoxholeRegionLabel(mapKey: string | null | undefined): string {
    const normalizedMapKey = normalizeString(mapKey);
    if (!normalizedMapKey) {
        return '';
    }

    return FOXHOLE_MAP_REGION_BY_KEY.value.get(normalizedMapKey)?.name ?? normalizedMapKey.toUpperCase();
}

function getFoxholePlaybackEventLocationEntry(event: FoxholePlaybackEventRecord): FoxholeMapSearchEntry | null {
    const townEvent = asTownOwnershipEventData(event.data);
    const claimedEvent = asTownClaimedEventData(event.data);
    const tierEvent = asTownBaseTierEventData(event.data);
    const rocketEvent = asRocketEventData(event.data);
    const scorchedEvent = asVictoryTownScorchedEventData(event.data);
    const regionKey = normalizeString(
        townEvent?.mapKey
        ?? claimedEvent?.mapKey
        ?? tierEvent?.mapKey
        ?? rocketEvent?.mapKey
        ?? scorchedEvent?.mapKey
        ?? event.mapKey,
    );
    const x = Number(townEvent?.x ?? claimedEvent?.x ?? tierEvent?.x ?? rocketEvent?.x ?? scorchedEvent?.x);
    const y = Number(townEvent?.y ?? claimedEvent?.y ?? tierEvent?.y ?? rocketEvent?.y ?? scorchedEvent?.y);
    if (!regionKey || !Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
    }

    const region = FOXHOLE_MAP_REGION_BY_KEY.value.get(regionKey);
    if (!region) {
        return null;
    }

    const regionPosition = getFoxholeRegionPosition(region);
    const isRocketEvent = event.eventType === 'rocket-targeted'
        || event.eventType === 'rocket-impact'
        || event.eventType === 'rocket-ready';
    const label = isRocketEvent
        ? normalizeString(rocketEvent?.nearestTownName) || 'Rocket Event'
        : String(townEvent?.townName ?? claimedEvent?.townName ?? tierEvent?.townName ?? scorchedEvent?.townName ?? 'Town').trim() || 'Town';
    const regionLabel = getFoxholeRegionLabel(regionKey) || regionKey;

    return {
        id: `history-event:${normalizeString(event.id) || normalizeString(event.observedAt) || regionKey}`,
        type: isRocketEvent ? 'district' : 'town',
        label,
        regionKey,
        regionLabel,
        searchLabel: isRocketEvent ? `${label} ${regionLabel} ${event.eventType}` : label,
        worldPosition: {
            x: regionPosition.x - (FOXHOLE_REGION_WIDTH / 2) + (x * FOXHOLE_REGION_WIDTH),
            y: regionPosition.y - (FOXHOLE_REGION_HEIGHT / 2) + (y * FOXHOLE_REGION_HEIGHT),
        },
    };
}

export function getFoxholePlaybackActionErrorMessage(error: unknown, fallback: string): string {
    const statusMessage = typeof error === 'object' && error && 'data' in error
        ? (error as { data?: { statusMessage?: string; }; }).data?.statusMessage
        : undefined;
    const message = typeof error === 'object' && error && 'message' in error
        ? (error as { message?: string; }).message
        : undefined;

    return normalizeString(statusMessage) || normalizeString(message) || fallback;
}

export function isFoxholePlaybackLocationEvent(event: FoxholePlaybackEventRecord): boolean {
    return event.eventType === 'town-captured'
        || event.eventType === 'town-neutralized'
        || event.eventType === 'town-claimed'
        || event.eventType === 'town-base-upgraded'
        || event.eventType === 'town-base-downgraded'
        || event.eventType === 'rocket-targeted'
        || event.eventType === 'rocket-impact'
        || event.eventType === 'rocket-ready'
        || event.eventType === 'victory-town-scorched';
}

export function focusFoxholeMapSearchEntry(options: FocusFoxholeMapSearchEntryOptions): void {
    const reason = normalizeString(options.reason) || 'foxhole-map:focus-search-entry';
    const shardId = normalizeString(options.shardId);
    const currentRegionKeys = options.mapSettings.regionKeys;
    const nextRegionKeys = currentRegionKeys.length > 0 && !currentRegionKeys.includes(options.entry.regionKey)
        ? Array.from(new Set([...currentRegionKeys, options.entry.regionKey]))
        : currentRegionKeys;

    if (options.clearPlaybackPreview) {
        clearFoxholeMapPlaybackPreview();
    }

    const patch: Record<string, boolean | string> = {
        ...(options.ensureMapEnabled ? { [FOXHOLE_MAP_SETTING_KEYS.enabled]: true } : {}),
        ...(shardId ? { [FOXHOLE_MAP_SETTING_KEYS.shardId]: shardId } : {}),
        ...(nextRegionKeys !== currentRegionKeys
            ? { [FOXHOLE_MAP_SETTING_KEYS.regionKeys]: serializeFoxholeMapStringList(nextRegionKeys) }
            : {}),
    };
    if (Object.keys(patch).length > 0) {
        options.runtime.projectStore.patchSettings(patch, reason);
    }

    const documentSession = getNixieEditorDocumentSessionBridge();
    if (documentSession?.isSceneV2Active.value) {
        const canvas = documentSession.sceneV2Editor.value?.controller.canvas;
        if (canvas) focusFoxholeSceneV2MapEntry(canvas, options.entry);
        return;
    }
    const viewport = options.runtime.session.viewportRef.value;
    if (!viewport) {
        options.runtime.session.cameraTo({
            time: 260,
            position: options.entry.worldPosition,
        });
        return;
    }

    const target = getFoxholeMapSearchCameraTarget(options.entry, viewport);
    options.runtime.session.cameraTo({
        time: 260,
        position: target.position,
        scale: target.scale,
    });
}

export async function activateFoxholePlaybackEvent(options: ActivateFoxholePlaybackEventOptions): Promise<void> {
    options.onErrorMessageChange?.('');

    const isLocationEvent = isFoxholePlaybackLocationEvent(options.event);

    try {
        if (isLocationEvent) {
            const entry = getFoxholePlaybackEventLocationEntry(options.event);
            if (!entry) {
                throw new Error('Location is unavailable for this event.');
            }

            focusFoxholeMapSearchEntry({
                runtime: options.runtime,
                mapSettings: options.mapSettings,
                entry,
                shardId: options.event.shardId,
                ensureMapEnabled: true,
                clearPlaybackPreview: true,
                reason: options.reason ?? 'foxhole-history:focus-event',
            });
            return;
        }

        const loadingEventId = normalizeString(options.event.id);
        options.onLoadingEventIdChange?.(loadingEventId);

        const frame = await fetchFoxholePlaybackFrame({
            shardId: options.event.shardId,
            warId: options.event.warId ?? undefined,
            at: options.event.observedAt,
        });
        if (!frame) {
            throw new Error('Unable to load playback frame for this event.');
        }

        setFoxholeMapPlaybackPreview({
            shardId: frame.payload.shardId,
            warId: frame.payload.warId,
            warNumber: frame.payload.warNumber,
            capturedAt: frame.capturedAt,
            eventId: options.event.id,
            eventType: options.event.eventType,
            eventLabel: options.eventLabel,
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
    } catch (error: unknown) {
        const fallback = isLocationEvent
            ? 'Location is unavailable for this event.'
            : 'Unable to load playback frame for this event.';
        const message = getFoxholePlaybackActionErrorMessage(error, fallback);
        options.onErrorMessageChange?.(message);
        throw error instanceof Error ? error : new Error(message);
    } finally {
        options.onLoadingEventIdChange?.('');
    }
}
