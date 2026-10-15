import { shallowRef } from 'vue';
import type {
    FoxholePlaybackEventRecord,
    FoxholePlaybackTimelineItem,
    FoxholeWarSummary,
} from '#foxhole/composables/useFoxholeWarPanelData.ts';

export interface FoxholeWarDebugShardSummary {
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

export interface FoxholeWarDebugPreset {
    id: string;
    label: string;
    description: string;
    warSummary: FoxholeWarSummary | null;
    playbackEnabled: boolean;
    warSummaryLoading: boolean;
    playbackEventsLoading: boolean;
    playbackTimelineLoading: boolean;
    playbackEventsError: string;
    playbackTimelineError: string;
    playbackEvents24h: FoxholePlaybackEventRecord[];
    playbackTimeline: FoxholePlaybackTimelineItem[];
    historyEvents: FoxholePlaybackEventRecord[];
    historyShards: FoxholeWarDebugShardSummary[];
}

interface FoxholeWarDebugPresetDefinition {
    id: string;
    label: string;
    description: string;
    build: (now: number) => FoxholeWarDebugPreset;
}

interface FoxholeWarDebugToastPreviewDefinition {
    id: string;
    label: string;
    build: (now: number) => FoxholePlaybackEventRecord;
}

interface TimelinePoint {
    hoursAgo: number;
    colonials: number;
    wardens: number;
    none: number;
    colonialVictory: number;
    wardenVictory: number;
}

interface ScenarioHistoryOptions {
    scheduledConquestEndTime?: number | null;
    shortRequiredVictoryTowns?: number | null;
    resistanceStartTime?: number | null;
    conquestEndTime?: number | null;
    winner?: string | null;
}

interface BuildPresetOptions {
    id: string;
    label: string;
    description: string;
    warStart: number | null;
    warSummary?: FoxholeWarSummary | null;
    playbackEnabled?: boolean;
    warSummaryLoading?: boolean;
    playbackEventsLoading?: boolean;
    playbackTimelineLoading?: boolean;
    playbackEventsError?: string;
    playbackTimelineError?: string;
    scheduledConquestEndTime?: number | null;
    resistanceStart?: number | null;
    conquestEndTime?: number | null;
    winner?: string | null;
    requiredVictoryTowns?: number | null;
    shortRequiredVictoryTowns?: number | null;
    colonialVictoryTowns?: number;
    wardenVictoryTowns?: number;
    colonialCasualties?: number;
    colonialHourlyCasualties?: number;
    wardenCasualties?: number;
    wardenHourlyCasualties?: number;
    timelineOverrides?: Array<Partial<TimelinePoint> & { index: number; }>;
    historyOptions?: ScenarioHistoryOptions;
    historyEvents?: FoxholePlaybackEventRecord[];
    historyShards?: FoxholeWarDebugShardSummary[];
    playbackEvents24h?: FoxholePlaybackEventRecord[];
    playbackTimeline?: FoxholePlaybackTimelineItem[];
}

const DEBUG_SHARD_ID = 'live';
const DEBUG_WAR_ID = '70700931-54cf-4b72-bfc0-037f70d0a464';
const DEBUG_WAR_NUMBER = 134;
const DEBUG_REQUIRED_VICTORY_TOWNS = 18;
const DEBUG_SHORT_REQUIRED_VICTORY_TOWNS = 16;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const activeFoxholeWarDebugPreset = shallowRef<FoxholeWarDebugPreset | null>(null);

const BASE_TIMELINE_POINTS = Object.freeze<TimelinePoint[]>([
    { hoursAgo: 24, colonials: 235, wardens: 193, none: 4, colonialVictory: 14, wardenVictory: 13 },
    { hoursAgo: 22, colonials: 232, wardens: 197, none: 3, colonialVictory: 14, wardenVictory: 13 },
    { hoursAgo: 20, colonials: 231, wardens: 199, none: 2, colonialVictory: 15, wardenVictory: 13 },
    { hoursAgo: 18, colonials: 232, wardens: 200, none: 0, colonialVictory: 15, wardenVictory: 14 },
    { hoursAgo: 14, colonials: 228, wardens: 203, none: 1, colonialVictory: 15, wardenVictory: 14 },
    { hoursAgo: 10, colonials: 227, wardens: 204, none: 1, colonialVictory: 16, wardenVictory: 14 },
    { hoursAgo: 6, colonials: 227, wardens: 203, none: 2, colonialVictory: 16, wardenVictory: 14 },
    { hoursAgo: 4, colonials: 225, wardens: 196, none: 11, colonialVictory: 15, wardenVictory: 13 },
    { hoursAgo: 2, colonials: 227, wardens: 204, none: 1, colonialVictory: 16, wardenVictory: 14 },
    { hoursAgo: 0, colonials: 226, wardens: 199, none: 8, colonialVictory: 16, wardenVictory: 14 },
]);

function toIso(timestampMs: number): string {
    return new Date(timestampMs).toISOString();
}

function cloneData<T>(value: T): T {
    if (value === null || value === undefined || typeof value !== 'object') {
        return value;
    }

    return JSON.parse(JSON.stringify(value)) as T;
}

function createEvent(
    id: string,
    eventType: string,
    observedAtMs: number,
    data: unknown,
    options: {
        mapKey?: string | null;
        source?: string;
    } = {},
): FoxholePlaybackEventRecord {
    return {
        id,
        shardId: DEBUG_SHARD_ID,
        warId: DEBUG_WAR_ID,
        warNumber: DEBUG_WAR_NUMBER,
        mapKey: options.mapKey ?? null,
        eventType,
        source: options.source ?? 'debug-fixture',
        observedAt: toIso(observedAtMs),
        data,
    };
}

function sortEventsDescending(events: readonly FoxholePlaybackEventRecord[]): FoxholePlaybackEventRecord[] {
    return [...events].sort((left, right) => {
        const leftTimestamp = Date.parse(left.observedAt);
        const rightTimestamp = Date.parse(right.observedAt);
        if (leftTimestamp !== rightTimestamp) {
            return rightTimestamp - leftTimestamp;
        }

        return right.id.localeCompare(left.id);
    });
}

function createTimelineItem(index: number, point: TimelinePoint, now: number): FoxholePlaybackTimelineItem {
    return {
        id: `debug-frame-${index + 1}`,
        shardId: DEBUG_SHARD_ID,
        warId: DEBUG_WAR_ID,
        warNumber: DEBUG_WAR_NUMBER,
        capturedAt: toIso(now - (point.hoursAgo * HOUR_MS)),
        frameSequence: 5000 + index,
        summary: {
            controlledTowns: {
                COLONIALS: point.colonials,
                WARDENS: point.wardens,
                NONE: point.none,
            },
            victoryTowns: {
                COLONIALS: point.colonialVictory,
                WARDENS: point.wardenVictory,
            },
            requiredVictoryTowns: DEBUG_REQUIRED_VICTORY_TOWNS,
        },
    };
}

function buildTimeline(
    now: number,
    overrides: Array<Partial<TimelinePoint> & { index: number; }> = [],
): FoxholePlaybackTimelineItem[] {
    const points = BASE_TIMELINE_POINTS.map(point => ({ ...point }));

    for (const override of overrides) {
        const target = points[override.index];
        if (!target) {
            continue;
        }

        points[override.index] = {
            ...target,
            ...override,
        };
    }

    return points
        .map((point, index) => createTimelineItem(index, point, now))
        .sort((left, right) => {
            const leftSequence = typeof left.frameSequence === 'number' ? left.frameSequence : 0;
            const rightSequence = typeof right.frameSequence === 'number' ? right.frameSequence : 0;
            return leftSequence - rightSequence;
        });
}

function createSummary(options: {
    warStart: number | null;
    scheduledConquestEndTime?: number | null;
    resistanceStart?: number | null;
    conquestEndTime?: number | null;
    winner?: string | null;
    requiredVictoryTowns?: number | null;
    shortRequiredVictoryTowns?: number | null;
    colonialVictoryTowns?: number;
    wardenVictoryTowns?: number;
    colonialCasualties?: number;
    colonialHourlyCasualties?: number;
    wardenCasualties?: number;
    wardenHourlyCasualties?: number;
}): FoxholeWarSummary {
    return {
        warId: DEBUG_WAR_ID,
        warNumber: DEBUG_WAR_NUMBER,
        shardId: DEBUG_SHARD_ID,
        warStart: options.warStart ?? null,
        conquestEndTime: options.conquestEndTime ?? null,
        resistanceStart: options.resistanceStart ?? null,
        scheduledConquestEndTime: options.scheduledConquestEndTime ?? null,
        requiredVictoryTowns: options.requiredVictoryTowns ?? DEBUG_REQUIRED_VICTORY_TOWNS,
        shortRequiredVictoryTowns: options.shortRequiredVictoryTowns ?? null,
        winner: options.winner ?? null,
        lastUpdatedAt: Date.now(),
        factions: {
            colonial: {
                totalCasualties: options.colonialCasualties ?? 298_821,
                totalHourlyCasualties: options.colonialHourlyCasualties ?? 1_645,
                victoryTowns: options.colonialVictoryTowns ?? 15,
                rocketSites: 0,
                rockets: 0,
            },
            warden: {
                totalCasualties: options.wardenCasualties ?? 318_549,
                totalHourlyCasualties: options.wardenHourlyCasualties ?? 1_785,
                victoryTowns: options.wardenVictoryTowns ?? 14,
                rocketSites: 0,
                rockets: 0,
            },
        },
    };
}

function buildScenarioHistoryEvents(now: number, options: ScenarioHistoryOptions = {}): FoxholePlaybackEventRecord[] {
    const warStartTime = now - (5 * DAY_MS);
    const events: FoxholePlaybackEventRecord[] = [
        createEvent('debug-war-started', 'war-started', now - (23 * HOUR_MS), {
            warId: DEBUG_WAR_ID,
            warNumber: DEBUG_WAR_NUMBER,
            conquestStartTime: warStartTime,
            requiredVictoryTowns: DEBUG_REQUIRED_VICTORY_TOWNS,
            shortRequiredVictoryTowns: options.shortRequiredVictoryTowns ?? null,
        }),
        createEvent('debug-saltbrook-captured', 'town-captured', now - (20 * HOUR_MS), {
            x: 0.303757,
            y: 0.38162574,
            mapKey: 'EndlessShoreHex',
            townName: 'Saltbrook Channel',
            nextTeamId: 'COLONIALS',
            previousTeamId: 'WARDENS',
            capturedTimestamp: now - (20 * HOUR_MS),
        }, {
            mapKey: 'EndlessShoreHex',
            source: 'dynamic-map',
        }),
        createEvent('debug-mara-claimed', 'town-claimed', now - (18 * HOUR_MS), {
            x: 0.8549705,
            y: 0.48427492,
            mapKey: 'FarranacCoastHex',
            townName: 'Mara',
            teamId: 'COLONIALS',
        }, {
            mapKey: 'FarranacCoastHex',
            source: 'dynamic-map',
        }),
        createEvent('debug-long-whine-captured', 'town-captured', now - (16 * HOUR_MS), {
            x: 0.35783502,
            y: 0.209964,
            mapKey: 'LinnMercyHex',
            townName: 'The Long Whine',
            nextTeamId: 'WARDENS',
            previousTeamId: 'COLONIALS',
            capturedTimestamp: now - (16 * HOUR_MS),
        }, {
            mapKey: 'LinnMercyHex',
            source: 'dynamic-map',
        }),
        createEvent('debug-long-whine-upgraded', 'town-base-upgraded', now - (15 * HOUR_MS), {
            x: 0.35783502,
            y: 0.209964,
            mapKey: 'LinnMercyHex',
            townName: 'The Long Whine',
            teamId: 'WARDENS',
            baseType: 'RelicBase',
            previousTier: 2,
            nextTier: 3,
        }, {
            mapKey: 'LinnMercyHex',
        }),
        createEvent('debug-saltbrook-rocket-ready', 'rocket-ready', now - (12 * HOUR_MS), {
            x: 0.303757,
            y: 0.38162574,
            mapKey: 'EndlessShoreHex',
            teamId: 'COLONIALS',
            nearestTownName: 'Saltbrook Channel',
        }, {
            mapKey: 'EndlessShoreHex',
        }),
        createEvent('debug-saltbrook-rocket-targeted', 'rocket-targeted', now - (11 * HOUR_MS), {
            x: 0.303757,
            y: 0.38162574,
            mapKey: 'EndlessShoreHex',
            teamId: 'COLONIALS',
            nearestTownName: 'Saltbrook Channel',
        }, {
            mapKey: 'EndlessShoreHex',
        }),
        createEvent('debug-saltbrook-rocket-impact', 'rocket-impact', now - (10 * HOUR_MS), {
            x: 0.303757,
            y: 0.38162574,
            mapKey: 'EndlessShoreHex',
            teamId: 'COLONIALS',
            nearestTownName: 'Saltbrook Channel',
        }, {
            mapKey: 'EndlessShoreHex',
        }),
        createEvent('debug-bone-haft-neutralized', 'town-neutralized', now - (8 * HOUR_MS), {
            x: 0.50207216,
            y: 0.22624204,
            mapKey: 'FarranacCoastHex',
            townName: 'The Bone Haft',
            nextTeamId: 'NONE',
            previousTeamId: 'COLONIALS',
            capturedTimestamp: now - (8 * HOUR_MS),
        }, {
            mapKey: 'FarranacCoastHex',
            source: 'dynamic-map',
        }),
        createEvent('debug-faden-neutralized', 'town-neutralized', now - (6 * HOUR_MS), {
            x: 0.36492845,
            y: 0.20000526,
            mapKey: 'KuuraStrandHex',
            townName: 'Faden Point',
            nextTeamId: 'NONE',
            previousTeamId: 'COLONIALS',
            capturedTimestamp: now - (6 * HOUR_MS),
        }, {
            mapKey: 'KuuraStrandHex',
            source: 'dynamic-map',
        }),
        createEvent('debug-faden-downgraded', 'town-base-downgraded', now - (5 * HOUR_MS), {
            x: 0.36492845,
            y: 0.20000526,
            mapKey: 'KuuraStrandHex',
            townName: 'Faden Point',
            teamId: 'COLONIALS',
            baseType: 'TownBase',
            previousTier: 3,
            nextTier: 2,
        }, {
            mapKey: 'KuuraStrandHex',
        }),
        createEvent('debug-vessel-scorched', 'victory-town-scorched', now - (4 * HOUR_MS), {
            x: 0.36351255,
            y: 0.715022,
            mapKey: 'DrownedValeHex',
            townName: 'Vessel',
            teamId: 'WARDENS',
        }, {
            mapKey: 'DrownedValeHex',
        }),
        // Fresh rows for Live feed grouping (Live Now / Last Hour / Earlier Today).
        createEvent('debug-wane-captured', 'town-captured', now - (90 * 1000), {
            x: 0.512,
            y: 0.418,
            mapKey: 'StemaLandingHex',
            townName: 'The Wane',
            nextTeamId: 'COLONIALS',
            previousTeamId: 'WARDENS',
            capturedTimestamp: now - (90 * 1000),
        }, {
            mapKey: 'StemaLandingHex',
            source: 'dynamic-map',
        }),
        createEvent('debug-pippeli-neutralized', 'town-neutralized', now - (3 * 60 * 1000), {
            x: 0.448,
            y: 0.392,
            mapKey: 'PalantineBermHex',
            townName: 'The Pippeli Stones',
            nextTeamId: 'NONE',
            previousTeamId: 'COLONIALS',
            capturedTimestamp: now - (3 * 60 * 1000),
        }, {
            mapKey: 'PalantineBermHex',
            source: 'dynamic-map',
        }),
        createEvent('debug-jade-claimed', 'town-claimed', now - (18 * 60 * 1000), {
            x: 0.612,
            y: 0.545,
            mapKey: 'FarranacCoastHex',
            townName: 'Jade Cove',
            teamId: 'WARDENS',
        }, {
            mapKey: 'FarranacCoastHex',
            source: 'dynamic-map',
        }),
        createEvent('debug-crossing-upgraded', 'town-base-upgraded', now - (41 * 60 * 1000), {
            x: 0.35783502,
            y: 0.209964,
            mapKey: 'LinnMercyHex',
            townName: 'Crossing',
            teamId: 'WARDENS',
            baseType: 'RelicBase',
            previousTier: 2,
            nextTier: 3,
        }, {
            mapKey: 'LinnMercyHex',
        }),
        createEvent('debug-victa-captured', 'town-captured', now - (75 * 60 * 1000), {
            x: 0.264298,
            y: 0.318744,
            mapKey: 'FarranacCoastHex',
            townName: 'Victa',
            nextTeamId: 'COLONIALS',
            previousTeamId: 'WARDENS',
            capturedTimestamp: now - (75 * 60 * 1000),
        }, {
            mapKey: 'FarranacCoastHex',
            source: 'dynamic-map',
        }),
        createEvent('debug-lipsia-neutralized', 'town-neutralized', now - (3 * HOUR_MS), {
            x: 0.391,
            y: 0.462,
            mapKey: 'StemaLandingHex',
            townName: 'Lipsia',
            nextTeamId: 'NONE',
            previousTeamId: 'WARDENS',
            capturedTimestamp: now - (3 * HOUR_MS),
        }, {
            mapKey: 'StemaLandingHex',
            source: 'dynamic-map',
        }),
    ];

    if (typeof options.scheduledConquestEndTime === 'number' && Number.isFinite(options.scheduledConquestEndTime)) {
        events.push(createEvent('debug-short-conquest-scheduled', 'short-conquest-scheduled', now - (3 * HOUR_MS), {
            warId: DEBUG_WAR_ID,
            warNumber: DEBUG_WAR_NUMBER,
            scheduledConquestEndTime: options.scheduledConquestEndTime,
            shortRequiredVictoryTowns: options.shortRequiredVictoryTowns ?? DEBUG_SHORT_REQUIRED_VICTORY_TOWNS,
        }));
    }

    if (typeof options.resistanceStartTime === 'number' && Number.isFinite(options.resistanceStartTime)) {
        events.push(createEvent('debug-resistance-started', 'resistance-started', now - (90 * 60 * 1000), {
            warId: DEBUG_WAR_ID,
            warNumber: DEBUG_WAR_NUMBER,
            resistanceStartTime: options.resistanceStartTime,
        }));
    }

    if (typeof options.conquestEndTime === 'number' && Number.isFinite(options.conquestEndTime)) {
        events.push(createEvent('debug-war-ended', 'war-ended', now - (45 * 60 * 1000), {
            warId: DEBUG_WAR_ID,
            warNumber: DEBUG_WAR_NUMBER,
            conquestEndTime: options.conquestEndTime,
            winner: options.winner ?? null,
        }));
    }

    if (options.winner) {
        events.push(createEvent('debug-war-winner-declared', 'war-winner-declared', now - (30 * 60 * 1000), {
            warId: DEBUG_WAR_ID,
            warNumber: DEBUG_WAR_NUMBER,
            winner: options.winner,
        }));
    }

    return sortEventsDescending(events);
}

function createUnresolvedHistoryShards(): FoxholeWarDebugShardSummary[] {
    return [{
        shardId: DEBUG_SHARD_ID,
        latestWarId: null,
        latestWarNumber: null,
        latestCapturedAt: null,
        latestSource: null,
        latestFrameSequence: 0,
        availableWars: [],
    }];
}

function buildHistoryShards(playbackTimeline: readonly FoxholePlaybackTimelineItem[]): FoxholeWarDebugShardSummary[] {
    const latestTimelineItem = playbackTimeline[playbackTimeline.length - 1];

    return [{
        shardId: DEBUG_SHARD_ID,
        latestWarId: DEBUG_WAR_ID,
        latestWarNumber: DEBUG_WAR_NUMBER,
        latestCapturedAt: latestTimelineItem?.capturedAt ?? null,
        latestSource: 'debug-fixture',
        latestFrameSequence: typeof latestTimelineItem?.frameSequence === 'number' ? latestTimelineItem.frameSequence : 0,
        availableWars: [{
            warId: DEBUG_WAR_ID,
            warNumber: DEBUG_WAR_NUMBER,
            latestCapturedAt: latestTimelineItem?.capturedAt ?? null,
            latestFrameSequence: typeof latestTimelineItem?.frameSequence === 'number' ? latestTimelineItem.frameSequence : 0,
        }],
    }];
}

function buildPreset(options: BuildPresetOptions, now: number): FoxholeWarDebugPreset {
    const playbackTimeline = options.playbackTimeline
        ? clonePlaybackTimeline(options.playbackTimeline)
        : buildTimeline(now, options.timelineOverrides ?? []);
    const historyEvents = options.historyEvents
        ? clonePlaybackEvents(options.historyEvents)
        : buildScenarioHistoryEvents(now, options.historyOptions);
    const playbackEvents24h = options.playbackEvents24h
        ? clonePlaybackEvents(options.playbackEvents24h)
        : clonePlaybackEvents(historyEvents);

    return {
        id: options.id,
        label: options.label,
        description: options.description,
        warSummary: options.warSummary === undefined
            ? createSummary({
                warStart: options.warStart,
                scheduledConquestEndTime: options.scheduledConquestEndTime ?? null,
                resistanceStart: options.resistanceStart ?? null,
                conquestEndTime: options.conquestEndTime ?? null,
                winner: options.winner ?? null,
                requiredVictoryTowns: options.requiredVictoryTowns ?? DEBUG_REQUIRED_VICTORY_TOWNS,
                shortRequiredVictoryTowns: options.shortRequiredVictoryTowns ?? null,
                colonialVictoryTowns: options.colonialVictoryTowns,
                wardenVictoryTowns: options.wardenVictoryTowns,
                colonialCasualties: options.colonialCasualties,
                colonialHourlyCasualties: options.colonialHourlyCasualties,
                wardenCasualties: options.wardenCasualties,
                wardenHourlyCasualties: options.wardenHourlyCasualties,
            })
            : (options.warSummary ? cloneWarSummary(options.warSummary) : null),
        playbackEnabled: options.playbackEnabled ?? true,
        warSummaryLoading: options.warSummaryLoading ?? false,
        playbackEventsLoading: options.playbackEventsLoading ?? false,
        playbackTimelineLoading: options.playbackTimelineLoading ?? false,
        playbackEventsError: options.playbackEventsError ?? '',
        playbackTimelineError: options.playbackTimelineError ?? '',
        playbackEvents24h,
        playbackTimeline,
        historyEvents,
        historyShards: options.historyShards
            ? cloneData(options.historyShards)
            : buildHistoryShards(playbackTimeline),
    };
}

const FOXHOLE_WAR_DEBUG_PRESET_DEFINITIONS_INTERNAL = Object.freeze<FoxholeWarDebugPresetDefinition[]>([
    {
        id: 'frontline-live',
        label: 'Live Frontline',
        description: 'Baseline live conquest state with real sample towns and frontline events.',
        build: now => buildPreset({
            id: 'frontline-live',
            label: 'Live Frontline',
            description: 'Baseline live conquest state with real sample towns and frontline events.',
            warStart: now - (5 * DAY_MS),
            colonialVictoryTowns: 15,
            wardenVictoryTowns: 14,
        }, now),
    },
    {
        id: 'race-tied',
        label: 'Race Tied',
        description: 'Active war where neither side has created any daylight in the summary cards.',
        build: now => {
            const flatTimeline = buildTimeline(now, BASE_TIMELINE_POINTS.map((_point, index) => ({
                index,
                colonials: 216,
                wardens: 216,
                none: 0,
                colonialVictory: 15,
                wardenVictory: 15,
            })));

            return buildPreset({
                id: 'race-tied',
                label: 'Race Tied',
                description: 'Active war where neither side has created any daylight in the summary cards.',
                warStart: now - (5 * DAY_MS),
                colonialVictoryTowns: 15,
                wardenVictoryTowns: 15,
                colonialHourlyCasualties: 1_742,
                wardenHourlyCasualties: 1_781,
                playbackTimeline: flatTimeline,
            }, now);
        },
    },
    {
        id: 'clear-control',
        label: 'Clear Control',
        description: 'Live conquest state where the Colonials have built a decisive lead without ending the war.',
        build: now => {
            const colonialPressureTimeline = buildTimeline(now, BASE_TIMELINE_POINTS.map((_point, index) => ({
                index,
                colonials: 208 + index,
                wardens: 208 - Math.min(index, 6),
                none: Math.max(0, 16 - index),
                colonialVictory: 12 + Math.min(index, 5),
                wardenVictory: 12 - Math.min(index, 1),
            })));

            return buildPreset({
                id: 'clear-control',
                label: 'Clear Control',
                description: 'Live conquest state where the Colonials have built a decisive lead without ending the war.',
                warStart: now - (5 * DAY_MS),
                colonialVictoryTowns: 17,
                wardenVictoryTowns: 11,
                colonialHourlyCasualties: 1_588,
                wardenHourlyCasualties: 1_944,
                playbackTimeline: colonialPressureTimeline,
            }, now);
        },
    },
    {
        id: 'win-line-pressure',
        label: 'Win Line Pressure',
        description: 'One faction is sitting on the win line while the war is still technically live.',
        build: now => {
            const closingTimeline = buildTimeline(now, BASE_TIMELINE_POINTS.map((_point, index) => ({
                index,
                colonials: 210 + Math.min(index, 7),
                wardens: 207 - Math.min(index, 4),
                none: Math.max(0, 15 - index),
                colonialVictory: 15 + Math.min(index, 3),
                wardenVictory: 14 + Math.min(index, 3),
            })));

            return buildPreset({
                id: 'win-line-pressure',
                label: 'Win Line Pressure',
                description: 'One faction is sitting on the win line while the war is still technically live.',
                warStart: now - (5 * DAY_MS),
                colonialVictoryTowns: 18,
                wardenVictoryTowns: 17,
                colonialHourlyCasualties: 1_611,
                wardenHourlyCasualties: 1_902,
                playbackTimeline: closingTimeline,
            }, now);
        },
    },
    {
        id: 'split-momentum',
        label: 'Split Momentum',
        description: 'Colonials own capture tempo, but Wardens are still the side that swung territory.',
        build: now => {
            const splitEvents = sortEventsDescending([
                ...buildScenarioHistoryEvents(now),
                createEvent('debug-crooked-island-captured', 'town-captured', now - (110 * 60 * 1000), {
                    x: 0.264298,
                    y: 0.318744,
                    mapKey: 'FarranacCoastHex',
                    townName: 'Victa',
                    nextTeamId: 'COLONIALS',
                    previousTeamId: 'WARDENS',
                    capturedTimestamp: now - (110 * 60 * 1000),
                }, {
                    mapKey: 'FarranacCoastHex',
                    source: 'dynamic-map',
                }),
                createEvent('debug-ash-fields-captured', 'town-captured', now - (55 * 60 * 1000), {
                    x: 0.421278,
                    y: 0.643122,
                    mapKey: 'ClahstraHex',
                    townName: 'Thunderfoot',
                    nextTeamId: 'COLONIALS',
                    previousTeamId: 'WARDENS',
                    capturedTimestamp: now - (55 * 60 * 1000),
                }, {
                    mapKey: 'ClahstraHex',
                    source: 'dynamic-map',
                }),
            ]);

            return buildPreset({
                id: 'split-momentum',
                label: 'Split Momentum',
                description: 'Colonials own capture tempo, but Wardens are still the side that swung territory.',
                warStart: now - (5 * DAY_MS),
                colonialVictoryTowns: 15,
                wardenVictoryTowns: 14,
                historyEvents: splitEvents,
                playbackEvents24h: splitEvents,
            }, now);
        },
    },
    {
        id: 'playback-loading',
        label: 'Playback Loading',
        description: 'The live summary is available, but the 24-hour playback window is still loading.',
        build: now => buildPreset({
            id: 'playback-loading',
            label: 'Playback Loading',
            description: 'The live summary is available, but the 24-hour playback window is still loading.',
            warStart: now - (5 * DAY_MS),
            colonialVictoryTowns: 15,
            wardenVictoryTowns: 14,
            playbackEventsLoading: true,
            playbackTimelineLoading: true,
            playbackTimeline: [],
            playbackEvents24h: [],
            historyEvents: [],
        }, now),
    },
    {
        id: 'no-playback-frames',
        label: 'No Playback Frames',
        description: 'The live summary exists, but there are no playback frames or event rows for the last 24 hours yet.',
        build: now => buildPreset({
            id: 'no-playback-frames',
            label: 'No Playback Frames',
            description: 'The live summary exists, but there are no playback frames or event rows for the last 24 hours yet.',
            warStart: now - (5 * DAY_MS),
            colonialVictoryTowns: 15,
            wardenVictoryTowns: 14,
            playbackTimeline: [],
            playbackEvents24h: [],
            historyEvents: [],
        }, now),
    },
    {
        id: 'scheduled-cutoff',
        label: 'Scheduled Cutoff',
        description: 'Upcoming short-conquest cutoff with a narrow town lead.',
        build: now => {
            const scheduledConquestEndTime = now + (3 * HOUR_MS);
            return buildPreset({
                id: 'scheduled-cutoff',
                label: 'Scheduled Cutoff',
                description: 'Upcoming short-conquest cutoff with a narrow town lead.',
                warStart: now - (5 * DAY_MS),
                scheduledConquestEndTime,
                shortRequiredVictoryTowns: DEBUG_SHORT_REQUIRED_VICTORY_TOWNS,
                colonialVictoryTowns: 16,
                wardenVictoryTowns: 15,
                historyOptions: {
                    scheduledConquestEndTime,
                    shortRequiredVictoryTowns: DEBUG_SHORT_REQUIRED_VICTORY_TOWNS,
                },
            }, now);
        },
    },
    {
        id: 'resistance-phase',
        label: 'Resistance Phase',
        description: 'Cutoff has passed and the war has entered resistance.',
        build: now => {
            const scheduledConquestEndTime = now - (2 * HOUR_MS);
            const resistanceStart = now - (75 * 60 * 1000);
            return buildPreset({
                id: 'resistance-phase',
                label: 'Resistance Phase',
                description: 'Cutoff has passed and the war has entered resistance.',
                warStart: now - (5 * DAY_MS),
                scheduledConquestEndTime,
                resistanceStart,
                shortRequiredVictoryTowns: DEBUG_SHORT_REQUIRED_VICTORY_TOWNS,
                colonialVictoryTowns: 16,
                wardenVictoryTowns: 15,
                timelineOverrides: [
                    { index: 8, colonials: 220, wardens: 204, none: 8 },
                    { index: 9, colonials: 219, wardens: 205, none: 8 },
                ],
                historyOptions: {
                    scheduledConquestEndTime,
                    shortRequiredVictoryTowns: DEBUG_SHORT_REQUIRED_VICTORY_TOWNS,
                    resistanceStartTime: resistanceStart,
                },
            }, now);
        },
    },
    {
        id: 'ended-awaiting-winner',
        label: 'Ended Awaiting Winner',
        description: 'Conquest has ended but the winner has not been declared yet.',
        build: now => {
            const scheduledConquestEndTime = now - (3 * HOUR_MS);
            const resistanceStart = now - (2 * HOUR_MS);
            const conquestEndTime = now - (35 * 60 * 1000);
            return buildPreset({
                id: 'ended-awaiting-winner',
                label: 'Ended Awaiting Winner',
                description: 'Conquest has ended but the winner has not been declared yet.',
                warStart: now - (5 * DAY_MS),
                scheduledConquestEndTime,
                resistanceStart,
                conquestEndTime,
                shortRequiredVictoryTowns: DEBUG_SHORT_REQUIRED_VICTORY_TOWNS,
                colonialVictoryTowns: 16,
                wardenVictoryTowns: 16,
                timelineOverrides: [
                    { index: 8, colonials: 215, wardens: 212, none: 8 },
                    { index: 9, colonials: 214, wardens: 213, none: 8 },
                ],
                historyOptions: {
                    scheduledConquestEndTime,
                    shortRequiredVictoryTowns: DEBUG_SHORT_REQUIRED_VICTORY_TOWNS,
                    resistanceStartTime: resistanceStart,
                    conquestEndTime,
                },
            }, now);
        },
    },
    {
        id: 'colonial-victory',
        label: 'Colonial Victory',
        description: 'Ended war with Colonials declared victorious.',
        build: now => {
            const scheduledConquestEndTime = now - (4 * HOUR_MS);
            const resistanceStart = now - (2 * HOUR_MS);
            const conquestEndTime = now - (50 * 60 * 1000);
            return buildPreset({
                id: 'colonial-victory',
                label: 'Colonial Victory',
                description: 'Ended war with Colonials declared victorious.',
                warStart: now - (5 * DAY_MS),
                scheduledConquestEndTime,
                resistanceStart,
                conquestEndTime,
                winner: 'COLONIALS',
                shortRequiredVictoryTowns: DEBUG_SHORT_REQUIRED_VICTORY_TOWNS,
                colonialVictoryTowns: 18,
                wardenVictoryTowns: 12,
                colonialCasualties: 304_219,
                colonialHourlyCasualties: 1_904,
                wardenCasualties: 322_804,
                wardenHourlyCasualties: 1_742,
                timelineOverrides: [
                    { index: 7, colonials: 220, wardens: 203, none: 10 },
                    { index: 8, colonials: 223, wardens: 201, none: 8 },
                    { index: 9, colonials: 226, wardens: 198, none: 6 },
                ],
                historyOptions: {
                    scheduledConquestEndTime,
                    shortRequiredVictoryTowns: DEBUG_SHORT_REQUIRED_VICTORY_TOWNS,
                    resistanceStartTime: resistanceStart,
                    conquestEndTime,
                    winner: 'COLONIALS',
                },
            }, now);
        },
    },
    {
        id: 'warden-victory',
        label: 'Warden Victory',
        description: 'Ended war with Wardens declared victorious.',
        build: now => {
            const scheduledConquestEndTime = now - (4 * HOUR_MS);
            const resistanceStart = now - (2 * HOUR_MS);
            const conquestEndTime = now - (55 * 60 * 1000);
            return buildPreset({
                id: 'warden-victory',
                label: 'Warden Victory',
                description: 'Ended war with Wardens declared victorious.',
                warStart: now - (5 * DAY_MS),
                scheduledConquestEndTime,
                resistanceStart,
                conquestEndTime,
                winner: 'WARDENS',
                shortRequiredVictoryTowns: DEBUG_SHORT_REQUIRED_VICTORY_TOWNS,
                colonialVictoryTowns: 11,
                wardenVictoryTowns: 18,
                colonialCasualties: 301_442,
                colonialHourlyCasualties: 1_688,
                wardenCasualties: 325_138,
                wardenHourlyCasualties: 1_966,
                timelineOverrides: [
                    { index: 7, colonials: 217, wardens: 208, none: 7 },
                    { index: 8, colonials: 213, wardens: 214, none: 6 },
                    { index: 9, colonials: 209, wardens: 218, none: 4 },
                ],
                historyOptions: {
                    scheduledConquestEndTime,
                    shortRequiredVictoryTowns: DEBUG_SHORT_REQUIRED_VICTORY_TOWNS,
                    resistanceStartTime: resistanceStart,
                    conquestEndTime,
                    winner: 'WARDENS',
                },
            }, now);
        },
    },
    {
        id: 'history-feed-coverage',
        label: 'History Feed Coverage',
        description: 'Synthetic all-types event history covering every current history filter and toast state.',
        build: now => {
            const scheduledConquestEndTime = now + (90 * 60 * 1000);
            const resistanceStart = now - (80 * 60 * 1000);
            const conquestEndTime = now - (30 * 60 * 1000);
            const coverageEvents = buildScenarioHistoryEvents(now, {
                scheduledConquestEndTime,
                shortRequiredVictoryTowns: DEBUG_SHORT_REQUIRED_VICTORY_TOWNS,
                resistanceStartTime: resistanceStart,
                conquestEndTime,
                winner: 'WARDENS',
            });
            return buildPreset({
                id: 'history-feed-coverage',
                label: 'History Feed Coverage',
                description: 'Synthetic all-types event history covering every current history filter and toast state.',
                warStart: now - (5 * DAY_MS),
                scheduledConquestEndTime,
                shortRequiredVictoryTowns: DEBUG_SHORT_REQUIRED_VICTORY_TOWNS,
                colonialVictoryTowns: 15,
                wardenVictoryTowns: 15,
                historyEvents: coverageEvents,
                playbackEvents24h: coverageEvents,
            }, now);
        },
    },
    {
        id: 'initial-loading',
        label: 'Initial Loading',
        description: 'First-load state while the summary and playback queries are still in flight.',
        build: now => buildPreset({
            id: 'initial-loading',
            label: 'Initial Loading',
            description: 'First-load state while the summary and playback queries are still in flight.',
            warStart: null,
            warSummary: null,
            warSummaryLoading: true,
            playbackEventsLoading: true,
            playbackTimelineLoading: true,
            playbackTimeline: [],
            playbackEvents24h: [],
            historyEvents: [],
            historyShards: createUnresolvedHistoryShards(),
        }, now),
    },
    {
        id: 'awaiting-data',
        label: 'Awaiting Data',
        description: 'No usable war summary has arrived yet, even though loading is no longer active.',
        build: now => buildPreset({
            id: 'awaiting-data',
            label: 'Awaiting Data',
            description: 'No usable war summary has arrived yet, even though loading is no longer active.',
            warStart: null,
            warSummary: null,
            playbackTimeline: [],
            playbackEvents24h: [],
            historyEvents: [],
            historyShards: createUnresolvedHistoryShards(),
        }, now),
    },
    {
        id: 'playback-disabled',
        label: 'Playback Disabled',
        description: 'Live summary data exists, but playback capture is disabled on this host.',
        build: now => buildPreset({
            id: 'playback-disabled',
            label: 'Playback Disabled',
            description: 'Live summary data exists, but playback capture is disabled on this host.',
            warStart: now - (5 * DAY_MS),
            colonialVictoryTowns: 15,
            wardenVictoryTowns: 14,
            playbackEnabled: false,
            playbackTimeline: [],
            playbackEvents24h: [],
            historyEvents: [],
        }, now),
    },
    {
        id: 'playback-error',
        label: 'Playback Error',
        description: 'Live summary data exists, but the 24-hour playback feed failed to load.',
        build: now => buildPreset({
            id: 'playback-error',
            label: 'Playback Error',
            description: 'Live summary data exists, but the 24-hour playback feed failed to load.',
            warStart: now - (5 * DAY_MS),
            colonialVictoryTowns: 15,
            wardenVictoryTowns: 14,
            playbackTimeline: [],
            playbackEvents24h: [],
            historyEvents: [],
            playbackTimelineError: 'Unable to load last 24 hours of playback.',
        }, now),
    },
]);

const FOXHOLE_WAR_DEBUG_TOAST_PREVIEW_DEFINITIONS_INTERNAL = Object.freeze<FoxholeWarDebugToastPreviewDefinition[]>([
    {
        id: 'town-captured',
        label: 'Town Changed Hands',
        build: now => buildScenarioHistoryEvents(now).find(event => event.eventType === 'town-captured') ?? createEvent('debug-fallback-town-captured', 'town-captured', now, {
            mapKey: 'EndlessShoreHex',
            townName: 'Saltbrook Channel',
            previousTeamId: 'WARDENS',
            nextTeamId: 'COLONIALS',
        }, { mapKey: 'EndlessShoreHex' }),
    },
    {
        id: 'town-neutralized',
        label: 'Town Neutralized',
        build: now => buildScenarioHistoryEvents(now).find(event => event.eventType === 'town-neutralized') ?? createEvent('debug-fallback-town-neutralized', 'town-neutralized', now, {
            mapKey: 'KuuraStrandHex',
            townName: 'Faden Point',
            previousTeamId: 'COLONIALS',
            nextTeamId: 'NONE',
        }, { mapKey: 'KuuraStrandHex' }),
    },
    {
        id: 'town-claimed',
        label: 'Town Claimed',
        build: now => buildScenarioHistoryEvents(now).find(event => event.eventType === 'town-claimed') ?? createEvent('debug-fallback-town-claimed', 'town-claimed', now, {
            mapKey: 'FarranacCoastHex',
            townName: 'Mara',
            teamId: 'COLONIALS',
        }, { mapKey: 'FarranacCoastHex' }),
    },
    {
        id: 'town-base-upgraded',
        label: 'Town Base Upgraded',
        build: now => buildScenarioHistoryEvents(now).find(event => event.eventType === 'town-base-upgraded') ?? createEvent('debug-fallback-town-base-upgraded', 'town-base-upgraded', now, {
            mapKey: 'LinnMercyHex',
            townName: 'The Long Whine',
            teamId: 'WARDENS',
            baseType: 'RelicBase',
            previousTier: 2,
            nextTier: 3,
        }, { mapKey: 'LinnMercyHex' }),
    },
    {
        id: 'town-base-downgraded',
        label: 'Town Base Downgraded',
        build: now => buildScenarioHistoryEvents(now).find(event => event.eventType === 'town-base-downgraded') ?? createEvent('debug-fallback-town-base-downgraded', 'town-base-downgraded', now, {
            mapKey: 'KuuraStrandHex',
            townName: 'Faden Point',
            teamId: 'COLONIALS',
            baseType: 'TownBase',
            previousTier: 3,
            nextTier: 2,
        }, { mapKey: 'KuuraStrandHex' }),
    },
    {
        id: 'rocket-ready',
        label: 'Rocket Ready',
        build: now => buildScenarioHistoryEvents(now).find(event => event.eventType === 'rocket-ready') ?? createEvent('debug-fallback-rocket-ready', 'rocket-ready', now, {
            mapKey: 'EndlessShoreHex',
            nearestTownName: 'Saltbrook Channel',
            teamId: 'COLONIALS',
        }, { mapKey: 'EndlessShoreHex' }),
    },
    {
        id: 'rocket-targeted',
        label: 'Rocket Targeted',
        build: now => buildScenarioHistoryEvents(now).find(event => event.eventType === 'rocket-targeted') ?? createEvent('debug-fallback-rocket-targeted', 'rocket-targeted', now, {
            mapKey: 'EndlessShoreHex',
            nearestTownName: 'Saltbrook Channel',
            teamId: 'COLONIALS',
        }, { mapKey: 'EndlessShoreHex' }),
    },
    {
        id: 'rocket-impact',
        label: 'Rocket Impact',
        build: now => buildScenarioHistoryEvents(now).find(event => event.eventType === 'rocket-impact') ?? createEvent('debug-fallback-rocket-impact', 'rocket-impact', now, {
            mapKey: 'EndlessShoreHex',
            nearestTownName: 'Saltbrook Channel',
            teamId: 'COLONIALS',
        }, { mapKey: 'EndlessShoreHex' }),
    },
    {
        id: 'victory-town-scorched',
        label: 'Victory Town Scorched',
        build: now => buildScenarioHistoryEvents(now).find(event => event.eventType === 'victory-town-scorched') ?? createEvent('debug-fallback-victory-town-scorched', 'victory-town-scorched', now, {
            mapKey: 'DrownedValeHex',
            townName: 'Vessel',
            teamId: 'WARDENS',
        }, { mapKey: 'DrownedValeHex' }),
    },
    {
        id: 'short-conquest-scheduled',
        label: 'Short Conquest Scheduled',
        build: now => buildScenarioHistoryEvents(now, {
            scheduledConquestEndTime: now + (2 * HOUR_MS),
            shortRequiredVictoryTowns: DEBUG_SHORT_REQUIRED_VICTORY_TOWNS,
        }).find(event => event.eventType === 'short-conquest-scheduled') ?? createEvent('debug-fallback-short-conquest-scheduled', 'short-conquest-scheduled', now, {
            scheduledConquestEndTime: now + (2 * HOUR_MS),
            shortRequiredVictoryTowns: DEBUG_SHORT_REQUIRED_VICTORY_TOWNS,
        }),
    },
    {
        id: 'war-started',
        label: 'War Started',
        build: now => buildScenarioHistoryEvents(now).find(event => event.eventType === 'war-started') ?? createEvent('debug-fallback-war-started', 'war-started', now, {
            warId: DEBUG_WAR_ID,
            warNumber: DEBUG_WAR_NUMBER,
            conquestStartTime: now - (5 * DAY_MS),
            requiredVictoryTowns: DEBUG_REQUIRED_VICTORY_TOWNS,
        }),
    },
    {
        id: 'resistance-started',
        label: 'Resistance Started',
        build: now => buildScenarioHistoryEvents(now, {
            scheduledConquestEndTime: now - HOUR_MS,
            shortRequiredVictoryTowns: DEBUG_SHORT_REQUIRED_VICTORY_TOWNS,
            resistanceStartTime: now - (30 * 60 * 1000),
        }).find(event => event.eventType === 'resistance-started') ?? createEvent('debug-fallback-resistance-started', 'resistance-started', now, {
            warId: DEBUG_WAR_ID,
            warNumber: DEBUG_WAR_NUMBER,
            resistanceStartTime: now - (30 * 60 * 1000),
        }),
    },
    {
        id: 'war-ended',
        label: 'War Ended',
        build: now => buildScenarioHistoryEvents(now, {
            scheduledConquestEndTime: now - HOUR_MS,
            shortRequiredVictoryTowns: DEBUG_SHORT_REQUIRED_VICTORY_TOWNS,
            resistanceStartTime: now - (70 * 60 * 1000),
            conquestEndTime: now - (20 * 60 * 1000),
        }).find(event => event.eventType === 'war-ended') ?? createEvent('debug-fallback-war-ended', 'war-ended', now, {
            warId: DEBUG_WAR_ID,
            warNumber: DEBUG_WAR_NUMBER,
            conquestEndTime: now - (20 * 60 * 1000),
            winner: null,
        }),
    },
    {
        id: 'war-winner-declared',
        label: 'Winner Declared',
        build: now => buildScenarioHistoryEvents(now, {
            scheduledConquestEndTime: now - HOUR_MS,
            shortRequiredVictoryTowns: DEBUG_SHORT_REQUIRED_VICTORY_TOWNS,
            resistanceStartTime: now - (70 * 60 * 1000),
            conquestEndTime: now - (25 * 60 * 1000),
            winner: 'WARDENS',
        }).find(event => event.eventType === 'war-winner-declared') ?? createEvent('debug-fallback-war-winner-declared', 'war-winner-declared', now, {
            warId: DEBUG_WAR_ID,
            warNumber: DEBUG_WAR_NUMBER,
            winner: 'WARDENS',
        }),
    },
]);

function cloneWarSummary(summary: FoxholeWarSummary | null | undefined): FoxholeWarSummary | null {
    if (!summary) {
        return null;
    }

    return {
        ...summary,
        factions: {
            colonial: {
                ...summary.factions.colonial,
            },
            warden: {
                ...summary.factions.warden,
            },
        },
    };
}

function clonePlaybackEvents(events: readonly FoxholePlaybackEventRecord[]): FoxholePlaybackEventRecord[] {
    return events.map(event => ({
        ...event,
        data: cloneData(event.data),
    }));
}

function clonePlaybackTimeline(items: readonly FoxholePlaybackTimelineItem[]): FoxholePlaybackTimelineItem[] {
    return items.map(item => ({
        ...item,
        summary: item.summary
            ? {
                controlledTowns: item.summary.controlledTowns
                    ? { ...item.summary.controlledTowns }
                    : undefined,
                victoryTowns: item.summary.victoryTowns
                    ? { ...item.summary.victoryTowns }
                    : undefined,
                requiredVictoryTowns: item.summary.requiredVictoryTowns ?? null,
            }
            : undefined,
    }));
}

export const FOXHOLE_WAR_DEBUG_PRESET_DEFINITIONS = FOXHOLE_WAR_DEBUG_PRESET_DEFINITIONS_INTERNAL.map(definition => ({
    id: definition.id,
    label: definition.label,
    description: definition.description,
}));

export const FOXHOLE_WAR_DEBUG_TOAST_PREVIEW_DEFINITIONS = FOXHOLE_WAR_DEBUG_TOAST_PREVIEW_DEFINITIONS_INTERNAL.map(definition => ({
    id: definition.id,
    label: definition.label,
}));

export function getFoxholeWarDebugPresetRef() {
    return activeFoxholeWarDebugPreset;
}

export function buildFoxholeWarDebugPreset(id: string, now = Date.now()): FoxholeWarDebugPreset | null {
    const definition = FOXHOLE_WAR_DEBUG_PRESET_DEFINITIONS_INTERNAL.find(candidate => candidate.id === id);
    if (!definition) {
        return null;
    }

    return definition.build(now);
}

export function setFoxholeWarDebugPreset(id: string, now = Date.now()): FoxholeWarDebugPreset | null {
    const preset = buildFoxholeWarDebugPreset(id, now);
    activeFoxholeWarDebugPreset.value = preset;
    return preset;
}

export function clearFoxholeWarDebugPreset(): void {
    activeFoxholeWarDebugPreset.value = null;
}

export function buildFoxholeWarDebugToastPreview(id: string, now = Date.now()): FoxholePlaybackEventRecord | null {
    const definition = FOXHOLE_WAR_DEBUG_TOAST_PREVIEW_DEFINITIONS_INTERNAL.find(candidate => candidate.id === id);
    if (!definition) {
        return null;
    }

    return definition.build(now);
}

export function cloneFoxholeWarDebugPreset(preset: FoxholeWarDebugPreset | Readonly<FoxholeWarDebugPreset>): FoxholeWarDebugPreset {
    return {
        id: preset.id,
        label: preset.label,
        description: preset.description,
        warSummary: cloneWarSummary(preset.warSummary),
        playbackEnabled: preset.playbackEnabled,
        warSummaryLoading: preset.warSummaryLoading,
        playbackEventsLoading: preset.playbackEventsLoading,
        playbackTimelineLoading: preset.playbackTimelineLoading,
        playbackEventsError: preset.playbackEventsError,
        playbackTimelineError: preset.playbackTimelineError,
        playbackEvents24h: clonePlaybackEvents(preset.playbackEvents24h),
        playbackTimeline: clonePlaybackTimeline(preset.playbackTimeline),
        historyEvents: clonePlaybackEvents(preset.historyEvents),
        historyShards: cloneData(preset.historyShards),
    };
}
