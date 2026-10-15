import { FOXHOLE_MAP_REGIONS } from '#foxhole/plugins/foxhole/nixie/map/constants.ts';
import type { FoxholePlaybackEventRecord } from '#foxhole/composables/useFoxholeWarPanelData.ts';
import { formatFoxholePlaybackEventTypeLabel } from '#foxhole/components/nixie/foxhole/foxholeWarHistoryFilters.ts';

const FOXHOLE_MAP_REGION_BY_KEY = new Map(FOXHOLE_MAP_REGIONS.map(region => [region.key, region]));

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
}

interface FoxholeWarLifecycleEventData {
    scheduledConquestEndTime?: number | null;
    shortRequiredVictoryTowns?: number | null;
    winner?: string | null;
}

function normalizeString(value: unknown): string {
    return String(value ?? '').trim();
}

function asNumberOrNull(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
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

export function describeFoxholePlaybackEvent(event: FoxholePlaybackEventRecord): string {
    const regionLabel = getFoxholeRegionLabel(getPlaybackEventMapKey(event));

    if (event.eventType === 'town-captured') {
        const townEvent = asTownOwnershipEventData(event.data);
        const townName = String(townEvent?.townName ?? regionLabel ?? 'Town').trim() || 'Town';
        const nextTeam = formatTeamLabel(townEvent?.nextTeamId);
        if (nextTeam === 'Unknown') {
            return `${townName} captured`;
        }
        return `${nextTeam} captured ${townName}`;
    }

    if (event.eventType === 'town-neutralized') {
        const townEvent = asTownOwnershipEventData(event.data);
        const townName = String(townEvent?.townName ?? regionLabel ?? 'Town').trim() || 'Town';
        const previousTeam = formatTeamLabel(townEvent?.previousTeamId);
        return previousTeam === 'Unknown' ? `${townName} neutralized` : `${previousTeam} lost ${townName}`;
    }

    if (event.eventType === 'town-claimed') {
        const townEvent = asTownClaimedEventData(event.data);
        const townName = String(townEvent?.townName ?? regionLabel ?? 'Town').trim() || 'Town';
        const team = formatTeamLabel(townEvent?.teamId);
        return team === 'Unknown' ? `${townName} claimed` : `${team} claimed ${townName}`;
    }

    if (event.eventType === 'town-base-upgraded' || event.eventType === 'town-base-downgraded') {
        const tierEvent = asTownBaseTierEventData(event.data);
        const townName = String(tierEvent?.townName ?? regionLabel ?? 'Town').trim() || 'Town';
        const isRelic = normalizeString(tierEvent?.baseType) === 'relic';
        const team = formatTeamLabel(tierEvent?.teamId);
        const nextTier = asNumberOrNull(tierEvent?.nextTier);
        const tierLabel = nextTier === null ? 'new tier' : `T${nextTier}`;
        const placeLabel = isRelic ? `${townName} relic` : townName;
        if (event.eventType === 'town-base-upgraded') {
            return team === 'Unknown'
                ? `${placeLabel} upgraded to ${tierLabel}`
                : `${team} upgraded ${placeLabel} to ${tierLabel}`;
        }

        return team === 'Unknown'
            ? `${placeLabel} downgraded to ${tierLabel}`
            : `${team} downgraded ${placeLabel} to ${tierLabel}`;
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

    return formatFoxholePlaybackEventTypeLabel(event.eventType);
}

export function formatFoxholePlaybackEventSentence(event: FoxholePlaybackEventRecord): string {
    const description = describeFoxholePlaybackEvent(event).trim();
    if (!description) {
        return 'Event.';
    }

    return /[.!?]$/.test(description) ? description : `${description}.`;
}

export function formatFoxholePlaybackAbsoluteTimestamp(
    observedAt: string,
): string {
    const parsed = Date.parse(observedAt);
    if (!Number.isFinite(parsed)) {
        return 'Unknown';
    }

    return new Date(parsed).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
    });
}

export function formatFoxholePlaybackEventMeta(
    event: FoxholePlaybackEventRecord,
): string {
    return getFoxholeRegionLabel(getPlaybackEventMapKey(event)) || '';
}

export function getFoxholePlaybackEventIcon(eventType: string): string {
    switch (eventType) {
        case 'town-captured':
            return 'ph:flag';
        case 'town-neutralized':
            return 'ph:prohibit';
        case 'town-claimed':
            return 'ph:map-pin';
        case 'town-base-upgraded':
            return 'ph:arrow-circle-up';
        case 'town-base-downgraded':
            return 'ph:arrow-circle-down';
        case 'rocket-targeted':
            return 'ph:crosshair';
        case 'rocket-impact':
            return 'ph:target';
        case 'rocket-ready':
            return 'ph:rocket';
        case 'victory-town-scorched':
            return 'ph:fire';
        case 'short-conquest-scheduled':
            return 'ph:hourglass';
        case 'war-started':
            return 'ph:play-circle';
        case 'resistance-started':
            return 'ph:pause-circle';
        case 'war-ended':
            return 'ph:stop-circle';
        case 'war-winner-declared':
            return 'ph:trophy';
        default:
            return 'ph:circle';
    }
}

function getFoxholePlaybackEventTeamId(event: FoxholePlaybackEventRecord): string {
    if (event.eventType === 'town-captured') {
        return normalizeString(asTownOwnershipEventData(event.data)?.nextTeamId);
    }

    if (event.eventType === 'town-claimed') {
        return normalizeString(asTownClaimedEventData(event.data)?.teamId);
    }

    if (event.eventType === 'town-base-upgraded' || event.eventType === 'town-base-downgraded') {
        return normalizeString(asTownBaseTierEventData(event.data)?.teamId);
    }

    if (
        event.eventType === 'rocket-targeted'
        || event.eventType === 'rocket-impact'
        || event.eventType === 'rocket-ready'
    ) {
        return normalizeString(asRocketEventData(event.data)?.teamId);
    }

    if (event.eventType === 'war-ended' || event.eventType === 'war-winner-declared') {
        return normalizeString(asWarLifecycleEventData(event.data)?.winner);
    }

    return '';
}

export type FoxholePlaybackEventTone = 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export function getFoxholePlaybackEventTone(event: FoxholePlaybackEventRecord): FoxholePlaybackEventTone {
    const teamId = getFoxholePlaybackEventTeamId(event);
    if (teamId === 'COLONIALS') {
        return 'success';
    }

    if (teamId === 'WARDENS') {
        return 'info';
    }

    switch (event.eventType) {
        case 'town-neutralized':
            return 'danger';
        case 'town-base-downgraded':
        case 'rocket-targeted':
        case 'rocket-impact':
        case 'victory-town-scorched':
        case 'war-ended':
            return 'warning';
        case 'short-conquest-scheduled':
        case 'war-started':
        case 'resistance-started':
            return 'info';
        case 'town-captured':
        case 'town-claimed':
        case 'town-base-upgraded':
        case 'rocket-ready':
        case 'war-winner-declared':
            return 'success';
        default:
            return 'default';
    }
}

export function formatFoxholePlaybackRelativeTimestamp(observedAt: string, currentTime: number): string {
    const parsed = Date.parse(observedAt);
    if (!Number.isFinite(parsed)) {
        return 'Unknown';
    }

    const elapsedMs = Math.max(0, currentTime - parsed);
    if (elapsedMs < 60 * 1000) {
        return 'Now';
    }

    const seconds = Math.floor(elapsedMs / 1000);
    if (seconds < 60) {
        return `${seconds}s ago`;
    }

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return `${minutes}m ago`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return `${hours}h ago`;
    }

    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

const FOXHOLE_LIVE_EVENT_GROUP_WINDOW_MS = 5 * 60 * 1000;
const FOXHOLE_HOUR_MS = 60 * 60 * 1000;
const FOXHOLE_DAY_MS = 24 * FOXHOLE_HOUR_MS;

export function getFoxholePlaybackEventGroupMeta(
    observedAt: string,
    currentTime: number,
): { id: string; label: string; } {
    const parsed = Date.parse(observedAt);
    if (!Number.isFinite(parsed)) {
        return {
            id: 'unknown',
            label: 'Unknown Time',
        };
    }

    const elapsedMs = Math.max(0, currentTime - parsed);
    if (elapsedMs < FOXHOLE_LIVE_EVENT_GROUP_WINDOW_MS) {
        return {
            id: 'live-now',
            label: 'Live Now',
        };
    }

    if (elapsedMs < FOXHOLE_HOUR_MS) {
        return {
            id: 'last-hour',
            label: 'Last Hour',
        };
    }

    const startOfToday = new Date(currentTime);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayTimestamp = startOfToday.getTime();
    if (parsed >= startOfTodayTimestamp) {
        return {
            id: 'earlier-today',
            label: 'Earlier Today',
        };
    }

    if (parsed >= startOfTodayTimestamp - FOXHOLE_DAY_MS) {
        return {
            id: 'yesterday',
            label: 'Yesterday',
        };
    }

    return {
        id: `date:${new Date(parsed).toISOString().slice(0, 10)}`,
        label: new Date(parsed).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
        }),
    };
}
