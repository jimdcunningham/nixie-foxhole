export interface FoxholePlaybackEventFilterPreset {
    id: string;
    label: string;
    eventTypes: readonly string[];
}

export const FOXHOLE_PLAYBACK_EVENT_FILTER_TYPES = Object.freeze([
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

export const FOXHOLE_PLAYBACK_EVENT_FILTER_PRESETS = Object.freeze<FoxholePlaybackEventFilterPreset[]>([
    {
        id: 'all',
        label: 'All',
        eventTypes: FOXHOLE_PLAYBACK_EVENT_FILTER_TYPES,
    },
    {
        id: 'frontline',
        label: 'Frontline',
        eventTypes: [
            'town-captured',
            'town-neutralized',
            'town-claimed',
            'town-base-upgraded',
            'town-base-downgraded',
        ],
    },
    {
        id: 'strategic',
        label: 'Strategic',
        eventTypes: [
            'rocket-targeted',
            'rocket-impact',
            'rocket-ready',
            'victory-town-scorched',
            'short-conquest-scheduled',
        ],
    },
    {
        id: 'lifecycle',
        label: 'Lifecycle',
        eventTypes: [
            'war-started',
            'resistance-started',
            'war-ended',
            'war-winner-declared',
        ],
    },
]);

export function hasMatchingFoxholePlaybackEventTypes(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }

    const leftSet = new Set(left);
    return right.every(item => leftSet.has(item));
}

export function formatFoxholePlaybackEventTypeLabel(eventType: string): string {
    switch (eventType) {
        case 'town-captured':
            return 'Town Changed Hands';
        case 'town-neutralized':
            return 'Town Neutralized';
        case 'town-claimed':
            return 'Town Claimed';
        case 'town-base-upgraded':
            return 'Town Base Upgraded';
        case 'town-base-downgraded':
            return 'Town Base Downgraded';
        case 'rocket-targeted':
            return 'Rocket Targeted';
        case 'rocket-impact':
            return 'Rocket Impact';
        case 'rocket-ready':
            return 'Rocket Ready';
        case 'victory-town-scorched':
            return 'Victory Town Scorched';
        case 'short-conquest-scheduled':
            return 'Short Conquest Scheduled';
        case 'war-started':
            return 'War Started';
        case 'resistance-started':
            return 'Resistance Started';
        case 'war-ended':
            return 'War Ended';
        case 'war-winner-declared':
            return 'Winner Declared';
        default:
            return eventType || 'Event';
    }
}
