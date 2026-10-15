import { computed } from 'vue';
import { currentWarObservationTimeline, isInitialFoxholeOwnershipEvent } from './foxholeWarObservationBaseline.ts';
import { useFoxholeWarPanelData } from '#foxhole/composables/useFoxholeWarPanelData.ts';
import type { FoxholeFactionKey } from '#foxhole/composables/useFoxholeWarPanelData.ts';

interface FoxholeWarFactionSummary {
    totalCasualties: number;
    totalHourlyCasualties: number | null;
    victoryTowns: number;
    rocketSites: number;
    rockets: number;
}

interface FoxholeTownOwnershipEventData {
    nextTeamId?: string;
}

interface WarFactionDisplayStats {
    key: FoxholeFactionKey;
    label: string;
    shortLabel: string;
    victoryTowns: number;
    rocketSites: number;
    rockets: number;
    totalCasualties: number;
    hourlyCasualties: number | null;
    progressPercent: number;
    townsToVictory: number | null;
}

interface WarTrendPoint {
    timestampMs: number;
    differential: number;
    colonialControlledTowns: number;
    wardenControlledTowns: number;
    x: number;
    y: number;
}

export interface WarLeadSummary {
    leader: FoxholeFactionKey | null;
    title: string;
    subtitle: string;
    leadLabel: string;
}

export interface WarMomentumSummary {
    leader: FoxholeFactionKey | null;
    title: string;
    subtitle: string;
    badge: string;
}

export interface WarSignalCard {
    label: string;
    value: string;
    detail: string;
}

export interface WarBreakdownRow {
    label: string;
    colonial: string;
    warden: string;
}

export interface WarSummaryViewState {
    kind: 'loading' | 'empty';
    kicker: string;
    title: string;
    detail: string;
}

export interface WarControlTrendSeries {
    points: WarTrendPoint[];
    colonialPath: string;
    wardenPath: string;
    colonialAreaPath: string;
    wardenAreaPath: string;
    baselineY: number;
    maxAbsDiff: number;
    latestDiff: number;
    delta: number;
    scaleTopLabel: string;
    scaleMidLabel: string;
    scaleBottomLabel: string;
    latestLeadLabel: string;
    swingLabel: string;
}

export interface WarVictoryRacePoint {
    timestampMs: number;
    colonialVictoryTowns: number;
    wardenVictoryTowns: number;
    requiredVictoryTowns: number;
    x: number;
    colonialY: number;
    wardenY: number;
}

export interface WarVictoryRaceSeries {
    points: WarVictoryRacePoint[];
    colonialPath: string;
    wardenPath: string;
    targetY: number;
    targetValue: number;
    scaleTopLabel: string;
    scaleBottomLabel: string;
    colonialLatestLabel: string;
    wardenLatestLabel: string;
}

export interface WarVictoryRaceSummary {
    leader: FoxholeFactionKey | null;
    title: string;
    subtitle: string;
}

interface WarLeadChartVertex {
    x: number;
    y: number;
    differential: number;
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

function normalizeFactionKey(teamId: string | null | undefined): FoxholeFactionKey | null {
    switch (String(teamId ?? '').trim()) {
        case 'COLONIALS':
        case 'c':
        case 'colonial':
            return 'colonial';
        case 'WARDENS':
        case 'w':
        case 'warden':
            return 'warden';
        default:
            return null;
    }
}

function parsePlaybackTimestamp(value: string | null | undefined): number | null {
    if (!value) {
        return null;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function asTownOwnershipEventData(value: unknown): FoxholeTownOwnershipEventData | null {
    return value && typeof value === 'object' ? value as FoxholeTownOwnershipEventData : null;
}

function readControlledTownCount(
    controlledTowns: Record<string, number> | null | undefined,
    factionKey: FoxholeFactionKey,
): number {
    if (!controlledTowns) {
        return 0;
    }

    let total = 0;
    for (const [teamId, count] of Object.entries(controlledTowns)) {
        if (normalizeFactionKey(teamId) !== factionKey) {
            continue;
        }

        total += Number.isFinite(count) ? count : 0;
    }
    return total;
}

function buildTrendPath(points: readonly WarLeadChartVertex[]): string {
    if (!points.length) {
        return '';
    }

    return points
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
        .join(' ');
}

function buildAreaPath(points: readonly WarLeadChartVertex[], baselineY: number): string {
    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    if (!firstPoint || !lastPoint) {
        return '';
    }

    return [
        `M ${firstPoint.x.toFixed(2)} ${baselineY.toFixed(2)}`,
        ...points.map(point => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
        `L ${lastPoint.x.toFixed(2)} ${baselineY.toFixed(2)}`,
        'Z',
    ].join(' ');
}

function leadSide(differential: number): FoxholeFactionKey | null {
    if (differential > 0) {
        return 'colonial';
    }
    if (differential < 0) {
        return 'warden';
    }
    return null;
}

function interpolateZeroCrossing(
    left: WarLeadChartVertex,
    right: WarLeadChartVertex,
): WarLeadChartVertex {
    const span = left.differential - right.differential;
    const t = span === 0 ? 0.5 : left.differential / span;
    return {
        x: left.x + ((right.x - left.x) * t),
        y: left.y + ((right.y - left.y) * t),
        differential: 0,
    };
}

function buildSignedLeadGeometry(
    points: readonly WarLeadChartVertex[],
    baselineY: number,
): Pick<WarControlTrendSeries, 'colonialPath' | 'wardenPath' | 'colonialAreaPath' | 'wardenAreaPath'> {
    const colonialLineChunks: WarLeadChartVertex[][] = [];
    const wardenLineChunks: WarLeadChartVertex[][] = [];
    const colonialAreaChunks: WarLeadChartVertex[][] = [];
    const wardenAreaChunks: WarLeadChartVertex[][] = [];

    let activeSide: FoxholeFactionKey | null = null;
    let activeChunk: WarLeadChartVertex[] = [];

    const resolveSide = (index: number): FoxholeFactionKey | null => {
        const direct = leadSide(points[index]?.differential ?? 0);
        if (direct) {
            return direct;
        }
        if (activeSide) {
            return activeSide;
        }

        for (let lookAhead = index + 1; lookAhead < points.length; lookAhead += 1) {
            const next = leadSide(points[lookAhead]?.differential ?? 0);
            if (next) {
                return next;
            }
        }

        for (let lookBehind = index - 1; lookBehind >= 0; lookBehind -= 1) {
            const previous = leadSide(points[lookBehind]?.differential ?? 0);
            if (previous) {
                return previous;
            }
        }

        return null;
    };

    const flushActiveChunk = () => {
        if (!activeSide || activeChunk.length < 2) {
            activeChunk = [];
            activeSide = null;
            return;
        }

        if (activeSide === 'colonial') {
            colonialLineChunks.push(activeChunk);
            colonialAreaChunks.push(activeChunk);
        } else {
            wardenLineChunks.push(activeChunk);
            wardenAreaChunks.push(activeChunk);
        }

        activeChunk = [];
        activeSide = null;
    };

    const appendVertex = (vertex: WarLeadChartVertex, side: FoxholeFactionKey) => {
        if (activeSide !== side) {
            flushActiveChunk();
            activeSide = side;
            activeChunk = [vertex];
            return;
        }

        activeChunk.push(vertex);
    };

    for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        if (!point) {
            continue;
        }

        const side = resolveSide(index);
        if (!side) {
            continue;
        }

        const previous = points[index - 1];
        if (previous) {
            const previousDiff = previous.differential;
            const currentDiff = point.differential;
            const crossesZero = (previousDiff > 0 && currentDiff < 0) || (previousDiff < 0 && currentDiff > 0);
            if (crossesZero) {
                const crossing = interpolateZeroCrossing(previous, point);
                const previousSide = previousDiff > 0 ? 'colonial' : 'warden';
                appendVertex(crossing, previousSide);
                flushActiveChunk();
                appendVertex(crossing, side);
            }
        }

        appendVertex(point, side);
    }

    flushActiveChunk();

    return {
        colonialPath: colonialLineChunks.map(chunk => buildTrendPath(chunk)).filter(Boolean).join(' '),
        wardenPath: wardenLineChunks.map(chunk => buildTrendPath(chunk)).filter(Boolean).join(' '),
        colonialAreaPath: colonialAreaChunks.map(chunk => buildAreaPath(chunk, baselineY)).filter(Boolean).join(' '),
        wardenAreaPath: wardenAreaChunks.map(chunk => buildAreaPath(chunk, baselineY)).filter(Boolean).join(' '),
    };
}

function formatLeadAmountLabel(differential: number): string {
    if (differential > 0) {
        return `COL +${differential}`;
    }
    if (differential < 0) {
        return `WARD +${Math.abs(differential)}`;
    }
    return 'Even';
}

function formatLeadSwingLabel(delta: number): string {
    if (delta > 0) {
        return `Swing COL +${delta}`;
    }
    if (delta < 0) {
        return `Swing WARD +${Math.abs(delta)}`;
    }
    return 'No Swing';
}

function hasVictoryTownSummary(summary: { victoryTowns?: Record<string, number>; } | null | undefined): boolean {
    return Boolean(summary?.victoryTowns && typeof summary.victoryTowns === 'object');
}

function formatWarValue(value: number | null | undefined): string {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return '--';
    }
    return value.toLocaleString();
}

function formatWarCompactValue(value: number | null | undefined): string {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return '--';
    }
    if (value >= 1000000) {
        return `${Math.floor(value / 100000) / 10}m`;
    }
    if (value >= 1000) {
        return `${Math.floor(value / 100) / 10}k`;
    }
    return value.toLocaleString();
}

function formatRemainingTowns(value: number | null | undefined): string {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return '--';
    }
    if (value <= 0) {
        return 'Ready';
    }
    return `${value} needed`;
}

function formatRaceProgress(current: number | null | undefined, target: number | null | undefined): string {
    return `${formatWarValue(current)} / ${formatWarValue(target)}`;
}

function createSummaryViewState(
    tab: 'pulse' | 'timeline' | 'breakdown',
    kind: WarSummaryViewState['kind'],
): WarSummaryViewState {
    if (tab === 'pulse') {
        return kind === 'loading'
            ? {
                kind,
                kicker: 'Live summary',
                title: 'Loading live war summary',
                detail: 'Pulling the latest victory towns, casualty totals, and momentum signals from the server.',
            }
            : {
                kind,
                kicker: 'Live summary',
                title: 'Awaiting fresh war data',
                detail: 'Pulse cards will populate once the latest war frame arrives for this shard.',
            };
    }

    if (tab === 'timeline') {
        return kind === 'loading'
            ? {
                kind,
                kicker: '24h playback',
                title: 'Loading recent playback',
                detail: 'Gathering the latest 24-hour frame history and event feed.',
            }
            : {
                kind,
                kicker: '24h playback',
                title: 'Awaiting playback data',
                detail: 'There is no usable 24-hour playback window for this shard yet.',
            };
    }

    return kind === 'loading'
        ? {
            kind,
            kicker: 'War split',
            title: 'Loading comparison view',
            detail: 'Preparing the current side-by-side town and casualty breakdown.',
        }
        : {
            kind,
            kicker: 'War split',
            title: 'Awaiting fresh war data',
            detail: 'The breakdown will appear once the latest summary frame is available.',
        };
}

export function useFoxholeWarSummaryMetrics() {
    const {
        warSummary,
        warSummaryLoading,
        playbackEnabled,
        playbackEvents24h: rawPlaybackEvents,
        playbackSummaryTimeline: rawPlaybackTimeline,
        playbackSnapshotLoading,
        playbackSnapshotError: momentumError,
    } = useFoxholeWarPanelData();

    const playbackTimeline = computed(() => currentWarObservationTimeline(rawPlaybackTimeline.value, warSummary.value));
    const playbackEvents = computed(() => rawPlaybackEvents.value.filter(event =>
        (!warSummary.value?.warId || event.warId === warSummary.value.warId)
        && (!warSummary.value?.warStart || Date.parse(event.observedAt) >= warSummary.value.warStart)
        && !isInitialFoxholeOwnershipEvent(event)));

    const isYoungWar = computed(() => Boolean(warSummary.value?.warStart && Date.now() - warSummary.value.warStart < 24 * 60 * 60 * 1000));
    const historyWindow = computed(() => isYoungWar.value ? 'since the war started' : 'over the last 24 hours');

    const requiredVictoryTowns = computed(() => Math.max(0, warSummary.value?.requiredVictoryTowns ?? 0));

    const factionStats = computed<Record<FoxholeFactionKey, WarFactionDisplayStats>>(() => {
        const summary = warSummary.value;
        const target = requiredVictoryTowns.value;
        const colonial = summary?.factions.colonial ?? createEmptyFactionSummary();
        const warden = summary?.factions.warden ?? createEmptyFactionSummary();

        return {
            colonial: {
                key: 'colonial',
                label: 'Colonials',
                shortLabel: 'COL',
                victoryTowns: colonial.victoryTowns,
                rocketSites: colonial.rocketSites,
                rockets: colonial.rockets,
                totalCasualties: colonial.totalCasualties,
                hourlyCasualties: colonial.totalHourlyCasualties,
                progressPercent: target > 0 ? Math.min(100, (colonial.victoryTowns / target) * 100) : 0,
                townsToVictory: target > 0 ? Math.max(0, target - colonial.victoryTowns) : null,
            },
            warden: {
                key: 'warden',
                label: 'Wardens',
                shortLabel: 'WARD',
                victoryTowns: warden.victoryTowns,
                rocketSites: warden.rocketSites,
                rockets: warden.rockets,
                totalCasualties: warden.totalCasualties,
                hourlyCasualties: warden.totalHourlyCasualties,
                progressPercent: target > 0 ? Math.min(100, (warden.victoryTowns / target) * 100) : 0,
                townsToVictory: target > 0 ? Math.max(0, target - warden.victoryTowns) : null,
            },
        };
    });

    const victoryTownLead = computed(() => factionStats.value.colonial.victoryTowns - factionStats.value.warden.victoryTowns);
    const hourlyLossLead = computed(() => {
        const colonialHourly = factionStats.value.colonial.hourlyCasualties;
        const wardenHourly = factionStats.value.warden.hourlyCasualties;
        if (colonialHourly === null || wardenHourly === null) {
            return null;
        }

        return wardenHourly - colonialHourly;
    });

    const recentCaptureMomentum = computed(() => {
        const totals = {
            colonial: 0,
            warden: 0,
            neutralizations: 0,
        };

        for (const event of playbackEvents.value) {
            if (event.eventType === 'town-neutralized') {
                totals.neutralizations += 1;
                continue;
            }
            if (event.eventType !== 'town-captured') {
                continue;
            }

            const factionKey = normalizeFactionKey(asTownOwnershipEventData(event.data)?.nextTeamId);
            if (!factionKey) {
                continue;
            }
            totals[factionKey] += 1;
        }

        return {
            ...totals,
            total: totals.colonial + totals.warden,
            lead: totals.colonial - totals.warden,
        };
    });

    const recentActionCounts = computed(() => {
        let upgrades = 0;
        let downgrades = 0;
        let rockets = 0;
        let scorched = 0;

        for (const event of playbackEvents.value) {
            switch (event.eventType) {
                case 'town-base-upgraded':
                    upgrades += 1;
                    break;
                case 'town-base-downgraded':
                    downgrades += 1;
                    break;
                case 'rocket-ready':
                case 'rocket-targeted':
                case 'rocket-impact':
                    rockets += 1;
                    break;
                case 'victory-town-scorched':
                    scorched += 1;
                    break;
                default:
                    break;
            }
        }

        return {
            upgrades,
            downgrades,
            rockets,
            scorched,
        };
    });

    const controlTrendSeries = computed<WarControlTrendSeries>(() => {
        const points: WarTrendPoint[] = playbackTimeline.value
            .map(item => {
                const timestampMs = parsePlaybackTimestamp(item.capturedAt);
                if (timestampMs === null) {
                    return null;
                }

                const controlledTowns = item.summary?.controlledTowns ?? {};
                const colonialControlledTowns = readControlledTownCount(controlledTowns, 'colonial');
                const wardenControlledTowns = readControlledTownCount(controlledTowns, 'warden');

                return {
                    timestampMs,
                    differential: colonialControlledTowns - wardenControlledTowns,
                    colonialControlledTowns,
                    wardenControlledTowns,
                    x: 0,
                    y: 0,
                };
            })
            .filter((point): point is WarTrendPoint => point !== null)
            .sort((left, right) => left.timestampMs - right.timestampMs);

        if (!points.length) {
            return {
                points,
                colonialPath: '',
                wardenPath: '',
                colonialAreaPath: '',
                wardenAreaPath: '',
                baselineY: 22,
                maxAbsDiff: 2,
                latestDiff: 0,
                delta: 0,
                scaleTopLabel: 'COL +2',
                scaleMidLabel: 'Even',
                scaleBottomLabel: 'WARD +2',
                latestLeadLabel: 'Even',
                swingLabel: 'No Swing',
            };
        }

        const width = 100;
        const height = 44;
        const insetX = 0;
        const insetY = 5;
        const usableWidth = width - (insetX * 2);
        const usableHeight = height - (insetY * 2);
        const maxAbsDiff = Math.max(2, ...points.map(point => Math.abs(point.differential)));
        const rangeStartMs = points[0]?.timestampMs ?? 0;
        const rangeEndMs = points[points.length - 1]?.timestampMs ?? rangeStartMs;
        const rangeMs = Math.max(1, rangeEndMs - rangeStartMs);
        const yFor = (value: number) => insetY + ((maxAbsDiff - value) / (maxAbsDiff * 2)) * usableHeight;
        const xFor = (timestampMs: number) => points.length === 1
            ? width / 2
            : insetX + (usableWidth * (timestampMs - rangeStartMs)) / rangeMs;

        const chartPoints = points.map(point => ({
            ...point,
            x: xFor(point.timestampMs),
            y: yFor(point.differential),
        }));
        if (chartPoints.length === 1) {
            chartPoints[0]!.x = width / 2;
        } else if (chartPoints.length > 1) {
            chartPoints[0]!.x = 0;
            chartPoints[chartPoints.length - 1]!.x = width;
        }
        const firstPoint = chartPoints.at(0);
        const lastPoint = chartPoints.at(-1);

        if (!firstPoint || !lastPoint) {
            return {
                points: [],
                colonialPath: '',
                wardenPath: '',
                colonialAreaPath: '',
                wardenAreaPath: '',
                baselineY: 22,
                maxAbsDiff: 2,
                latestDiff: 0,
                delta: 0,
                scaleTopLabel: 'COL +2',
                scaleMidLabel: 'Even',
                scaleBottomLabel: 'WARD +2',
                latestLeadLabel: 'Even',
                swingLabel: 'No Swing',
            };
        }

        const baselineY = yFor(0);
        const delta = lastPoint.differential - firstPoint.differential;
        const signedGeometry = buildSignedLeadGeometry(chartPoints, baselineY);

        return {
            points: chartPoints,
            ...signedGeometry,
            baselineY,
            maxAbsDiff,
            latestDiff: lastPoint.differential,
            delta,
            scaleTopLabel: `COL +${maxAbsDiff}`,
            scaleMidLabel: 'Even',
            scaleBottomLabel: `WARD +${maxAbsDiff}`,
            latestLeadLabel: formatLeadAmountLabel(lastPoint.differential),
            swingLabel: formatLeadSwingLabel(delta),
        };
    });

    const victoryRaceSeries = computed<WarVictoryRaceSeries>(() => {
        const fallbackTarget = requiredVictoryTowns.value;

        const points: WarVictoryRacePoint[] = playbackTimeline.value
            .map(item => {
                const timestampMs = parsePlaybackTimestamp(item.capturedAt);
                if (timestampMs === null || !hasVictoryTownSummary(item.summary)) {
                    return null;
                }

                const summaryTarget = typeof item.summary?.requiredVictoryTowns === 'number'
                    ? item.summary.requiredVictoryTowns
                    : fallbackTarget;
                if (summaryTarget <= 0) {
                    return null;
                }

                return {
                    timestampMs,
                    colonialVictoryTowns: readControlledTownCount(item.summary?.victoryTowns, 'colonial'),
                    wardenVictoryTowns: readControlledTownCount(item.summary?.victoryTowns, 'warden'),
                    requiredVictoryTowns: summaryTarget,
                    x: 0,
                    colonialY: 0,
                    wardenY: 0,
                };
            })
            .filter((point): point is WarVictoryRacePoint => point !== null)
            .sort((left, right) => left.timestampMs - right.timestampMs);

        if (!points.length) {
            return {
                points,
                colonialPath: '',
                wardenPath: '',
                targetY: 5,
                targetValue: fallbackTarget,
                scaleTopLabel: fallbackTarget > 0 ? `Win ${fallbackTarget}` : 'Win',
                scaleBottomLabel: '0',
                colonialLatestLabel: 'COL --',
                wardenLatestLabel: 'WARD --',
            };
        }

        const width = 100;
        const height = 44;
        const insetX = 0;
        const insetY = 5;
        const usableWidth = width - (insetX * 2);
        const usableHeight = height - (insetY * 2);
        const targetValue = Math.max(
            fallbackTarget,
            ...points.map(point => point.requiredVictoryTowns),
        );
        const peakValue = Math.max(
            targetValue,
            ...points.map(point => Math.max(point.colonialVictoryTowns, point.wardenVictoryTowns)),
        );
        const yMax = Math.max(4, Math.ceil(peakValue * 1.05));
        const rangeStartMs = points[0]?.timestampMs ?? 0;
        const rangeEndMs = points[points.length - 1]?.timestampMs ?? rangeStartMs;
        const rangeMs = Math.max(1, rangeEndMs - rangeStartMs);
        const yFor = (value: number) => insetY + ((yMax - value) / yMax) * usableHeight;
        const xFor = (timestampMs: number) => points.length === 1
            ? width / 2
            : insetX + (usableWidth * (timestampMs - rangeStartMs)) / rangeMs;

        const chartPoints = points.map(point => ({
            ...point,
            x: xFor(point.timestampMs),
            colonialY: yFor(point.colonialVictoryTowns),
            wardenY: yFor(point.wardenVictoryTowns),
        }));
        const lastPoint = chartPoints.at(-1);

        return {
            points: chartPoints,
            colonialPath: buildTrendPath(chartPoints.map(point => ({
                x: point.x,
                y: point.colonialY,
                differential: point.colonialVictoryTowns,
            }))),
            wardenPath: buildTrendPath(chartPoints.map(point => ({
                x: point.x,
                y: point.wardenY,
                differential: point.wardenVictoryTowns,
            }))),
            targetY: yFor(targetValue),
            targetValue,
            scaleTopLabel: `Win ${targetValue}`,
            scaleBottomLabel: '0',
            colonialLatestLabel: `COL ${formatWarValue(lastPoint?.colonialVictoryTowns)}`,
            wardenLatestLabel: `WARD ${formatWarValue(lastPoint?.wardenVictoryTowns)}`,
        };
    });

    const winRaceSummary = computed<WarLeadSummary>(() => {
        if (!warSummary.value) {
            return {
                leader: null,
                title: 'Waiting for live war data',
                subtitle: 'The win race will wake up as soon as the live war cache has current victory town counts.',
                leadLabel: 'No lead yet',
            };
        }

        const townLead = victoryTownLead.value;
        const target = requiredVictoryTowns.value;
        const colonialStats = factionStats.value.colonial;

        if (townLead === 0) {
            const sharedDistance = colonialStats.townsToVictory;
            return {
                leader: null,
                title: colonialStats.victoryTowns > 0
                    ? `Race tied at ${formatWarValue(colonialStats.victoryTowns)} towns`
                    : 'Race is even',
                subtitle: target > 0 && sharedDistance !== null
                    ? `Both factions sit at ${formatWarValue(colonialStats.victoryTowns)} victory towns and need ${sharedDistance} more to reach ${formatWarValue(target)}.`
                    : 'Neither side has created any daylight in the win race yet.',
                leadLabel: 'TIED',
            };
        }

        const leader: FoxholeFactionKey = townLead > 0 ? 'colonial' : 'warden';
        const leaderStats = factionStats.value[leader];
        const trailerStats = factionStats.value[leader === 'colonial' ? 'warden' : 'colonial'];
        const leadSize = Math.abs(townLead);
        const leaderDistance = leaderStats.townsToVictory;
        const trailerDistance = trailerStats.townsToVictory;

        let title = `${leaderStats.label} lead the war`;
        if (leadSize === 1) {
            title = `${leaderStats.label} edge ahead`;
        }
        if (leadSize >= 5) {
            title = `${leaderStats.label} have clear control`;
        }
        if (leaderDistance === 0) {
            title = `${leaderStats.label} sit on the win line`;
        }

        const leaderDistanceLabel = leaderDistance === null
            ? `${leaderStats.label} are closest to the threshold`
            : leaderDistance === 0
                ? `${leaderStats.label} are on the win line`
                : `${leaderStats.label} need ${leaderDistance} more town${leaderDistance === 1 ? '' : 's'}`;
        const trailerDistanceLabel = trailerDistance === null
            ? `${trailerStats.label} are still in striking distance`
            : `${trailerStats.label} need ${trailerDistance} more town${trailerDistance === 1 ? '' : 's'}`;

        return {
            leader,
            title,
            subtitle: target > 0
                ? `${leaderStats.label} hold ${leaderStats.victoryTowns} of ${formatWarValue(target)} victory towns, ${leadSize} more than ${trailerStats.label}. ${leaderDistanceLabel}. ${trailerDistanceLabel}.`
                : `${leaderStats.label} are ${leadSize} town${leadSize === 1 ? '' : 's'} ahead in the current win race.`,
            leadLabel: `${leaderStats.shortLabel} +${leadSize}`,
        };
    });

    const winRaceTone = computed<'colonial' | 'warden' | 'neutral'>(() => {
        if (winRaceSummary.value.leader === 'colonial') {
            return 'colonial';
        }
        if (winRaceSummary.value.leader === 'warden') {
            return 'warden';
        }
        return 'neutral';
    });

    const victoryRaceSummary = computed<WarVictoryRaceSummary>(() => {
        const race = winRaceSummary.value;
        const series = victoryRaceSeries.value;
        const firstPoint = series.points[0];
        const lastPoint = series.points[series.points.length - 1];

        if (!playbackEnabled.value) {
            return {
                leader: race.leader,
                title: race.title,
                subtitle: 'Playback capture is disabled on this host, so recent victory-town pressure cannot be assessed yet.',
            };
        }

        if (!firstPoint || !lastPoint) {
            return {
                leader: race.leader,
                title: race.title,
                subtitle: 'Recent victory-town movement will fill in once initialized map observations are available.',
            };
        }

        if (isYoungWar.value && firstPoint.colonialVictoryTowns === lastPoint.colonialVictoryTowns && firstPoint.wardenVictoryTowns === lastPoint.wardenVictoryTowns) {
            return { leader: race.leader, title: race.title, subtitle: 'Starting ownership is the baseline. No victory-town movement has been observed yet.' };
        }

        const colonialDelta = lastPoint.colonialVictoryTowns - firstPoint.colonialVictoryTowns;
        const wardenDelta = lastPoint.wardenVictoryTowns - firstPoint.wardenVictoryTowns;
        const colonialNeeded = Math.max(0, lastPoint.requiredVictoryTowns - lastPoint.colonialVictoryTowns);
        const wardenNeeded = Math.max(0, lastPoint.requiredVictoryTowns - lastPoint.wardenVictoryTowns);
        const townWord = (count: number) => `victory town${count === 1 ? '' : 's'}`;

        if (!race.leader) {
            if (colonialDelta === 0 && wardenDelta === 0) {
                return {
                    leader: null,
                    title: race.title,
                    subtitle: 'Neither side unlocked a victory town over the last day, so the deadlock is holding for now.',
                };
            }

            if (colonialDelta === wardenDelta) {
                return {
                    leader: null,
                    title: race.title,
                    subtitle: `Both sides moved in lockstep ${historyWindow.value} (${colonialDelta > 0 ? `+${colonialDelta}` : colonialDelta} each), so the race is still dead even.`,
                };
            }

            const mover: FoxholeFactionKey = colonialDelta > wardenDelta ? 'colonial' : 'warden';
            const moverDelta = mover === 'colonial' ? colonialDelta : wardenDelta;
            const moverLabel = factionStats.value[mover].label;
            return {
                leader: null,
                title: race.title,
                subtitle: moverDelta > 0
                    ? `${moverLabel} found ${moverDelta} ${townWord(moverDelta)} ${historyWindow.value} and may be the first to break the tie.`
                    : `${moverLabel} slipped ${Math.abs(moverDelta)} ${historyWindow.value}, leaving the door open for whoever punches next.`,
            };
        }

        const leader = race.leader;
        const trailer: FoxholeFactionKey = leader === 'colonial' ? 'warden' : 'colonial';
        const leaderStats = factionStats.value[leader];
        const trailerStats = factionStats.value[trailer];
        const leaderDelta = leader === 'colonial' ? colonialDelta : wardenDelta;
        const trailerDelta = trailer === 'colonial' ? colonialDelta : wardenDelta;
        const leaderNeeded = leader === 'colonial' ? colonialNeeded : wardenNeeded;

        if (leaderNeeded === 0) {
            return {
                leader,
                title: race.title,
                subtitle: trailerDelta > 0
                    ? `${leaderStats.label} can end the war from here, but ${trailerStats.label} still clawed back ${trailerDelta} ${townWord(trailerDelta)} ${historyWindow.value}.`
                    : `${leaderStats.label} are parked on the win line. One clean finish and this war is over.`,
            };
        }

        if (trailerDelta > leaderDelta && trailerDelta > 0) {
            return {
                leader,
                title: race.title,
                subtitle: `${leaderStats.label} still hold the lead, but ${trailerStats.label} gained ${trailerDelta} ${townWord(trailerDelta)} ${historyWindow.value} and are cutting into it.`,
            };
        }

        if (leaderDelta < 0) {
            return {
                leader,
                title: race.title,
                subtitle: trailerDelta > 0
                    ? `${leaderStats.label} are still ahead, but they dropped ${Math.abs(leaderDelta)} while ${trailerStats.label} climbed ${trailerDelta}. The lead is getting less comfortable.`
                    : `${leaderStats.label} are still ahead, but they surrendered ${Math.abs(leaderDelta)} ${townWord(Math.abs(leaderDelta))} ${historyWindow.value} and the window is narrowing.`,
            };
        }

        if (leaderDelta > 0 && leaderDelta >= trailerDelta) {
            return {
                leader,
                title: race.title,
                subtitle: trailerDelta > 0
                    ? `${leaderStats.label} stretched the race further by taking ${leaderDelta} more, even as ${trailerStats.label} scraped ${trailerDelta} back.`
                    : trailerDelta < 0
                        ? `${leaderStats.label} pulled further clear, up ${leaderDelta} while ${trailerStats.label} slipped ${Math.abs(trailerDelta)}.`
                        : `${leaderStats.label} were the only side to move, adding ${leaderDelta} ${townWord(leaderDelta)} ${historyWindow.value}.`,
            };
        }

        if (colonialDelta === 0 && wardenDelta === 0) {
            return {
                leader,
                title: race.title,
                subtitle: `The board went quiet for 24 hours. ${leaderStats.label} keep the lead without anyone breaking through.`,
            };
        }

        return {
            leader,
            title: race.title,
            subtitle: `${isYoungWar.value ? 'Since the war started' : 'Over the last day'}, COL ${colonialDelta > 0 ? `+${colonialDelta}` : colonialDelta} and WARD ${wardenDelta > 0 ? `+${wardenDelta}` : wardenDelta}. ${leaderStats.label} still own the better seat in the race.`,
        };
    });

    const momentumSummary = computed<WarMomentumSummary>(() => {
        if (!playbackEnabled.value) {
            return {
                leader: null,
                title: 'Momentum unavailable',
                subtitle: 'Playback capture is disabled on this host, so the panel cannot call a recent push.',
                badge: 'No playback',
            };
        }

        const captureLead = recentCaptureMomentum.value.lead;
        const controlDelta = controlTrendSeries.value.delta;
        const captureLeader = captureLead === 0 ? null : (captureLead > 0 ? 'colonial' : 'warden');
        const territoryLeader = controlDelta === 0 ? null : (controlDelta > 0 ? 'colonial' : 'warden');
        const hasCaptureSignal = Math.abs(captureLead) >= 2;
        const hasTerritorySignal = Math.abs(controlDelta) >= 1;

        if (!hasCaptureSignal && !hasTerritorySignal) {
            return {
                leader: null,
                title: 'Momentum is mixed',
                subtitle: isYoungWar.value
                    ? 'Starting ownership is the baseline. No clear capture or territory momentum has emerged yet.'
                    : 'The last 24 hours are basically flat across capture tempo and territory swing.',
                badge: isYoungWar.value ? 'Even so far' : 'Even 24h',
            };
        }

        if (captureLeader && territoryLeader && captureLeader !== territoryLeader) {
            return {
                leader: null,
                title: 'Momentum is split',
                subtitle: `${captureLead > 0 ? 'Colonials' : 'Wardens'} own the capture tempo, but ${controlDelta > 0 ? 'Colonials' : 'Wardens'} are the side that swung territory.`,
                badge: isYoungWar.value ? 'Mixed so far' : 'Mixed 24h',
            };
        }

        const leader = (captureLeader ?? territoryLeader) as FoxholeFactionKey;
        const leaderLabel = factionStats.value[leader].label;
        const captureSentence = hasCaptureSignal
            ? `${captureLead > 0 ? 'Colonials' : 'Wardens'} lead captures by ${Math.abs(captureLead)}`
            : 'Capture tempo is close to even';
        const territorySentence = hasTerritorySignal
            ? `${controlDelta > 0 ? 'Colonials' : 'Wardens'} swung territory by ${Math.abs(controlDelta)}`
            : 'territory control stayed flat';

        return {
            leader,
            title: `${leaderLabel} own recent momentum`,
            subtitle: `${captureSentence}, and ${territorySentence} ${historyWindow.value}.`,
            badge: hasCaptureSignal
                ? `${leader === 'colonial' ? 'COL' : 'WARD'} +${Math.abs(captureLead)} captures`
                : `${leader === 'colonial' ? 'COL' : 'WARD'} +${Math.abs(controlDelta)} swing`,
        };
    });

    const momentumTone = computed<'colonial' | 'warden' | 'neutral'>(() => {
        if (momentumSummary.value.leader === 'colonial') {
            return 'colonial';
        }
        if (momentumSummary.value.leader === 'warden') {
            return 'warden';
        }
        return 'neutral';
    });

    const attritionSummary = computed(() => {
        const hourlyDifference = hourlyLossLead.value === null
            ? null
            : Math.abs(hourlyLossLead.value);

        if (hourlyDifference === null) {
            return {
                title: 'Hourly losses warming up',
                detail: 'Casualty averages need about an hour of samples after startup.',
            };
        }

        if (hourlyDifference < 100) {
            return {
                title: 'Losses are close',
                detail: 'Neither side is clearly winning the attrition trade right now.',
            };
        }

        const lossLead = hourlyLossLead.value;
        const sideTakingMoreLosses = lossLead > 0 ? 'Wardens' : 'Colonials';
        const advantagedSide = lossLead > 0 ? 'Colonials' : 'Wardens';

        return {
            title: `${sideTakingMoreLosses} +${formatWarCompactValue(hourlyDifference)}/hr losses`,
            detail: `${advantagedSide} are winning the attrition trade right now.`,
        };
    });

    const controlTrendSummary = computed(() => {
        const latestDiff = controlTrendSeries.value.latestDiff;
        const delta = controlTrendSeries.value.delta;

        return {
            currentLabel: latestDiff === 0
                ? 'Even territory'
                : `${latestDiff > 0 ? 'COL' : 'WARD'} +${Math.abs(latestDiff)} control`,
            swingLabel: delta === 0
                ? `Territory stayed flat ${historyWindow.value}`
                : `${delta > 0 ? 'Colonials' : 'Wardens'} swung territory by ${Math.abs(delta)} ${historyWindow.value}`,
            badgeLabel: delta === 0
                ? (isYoungWar.value ? 'Flat so far' : 'Flat 24h')
                : `${delta > 0 ? 'COL' : 'WARD'} +${Math.abs(delta)} swing`,
        };
    });

    const pulseSignalCards = computed<WarSignalCard[]>(() => {
        const captures = recentCaptureMomentum.value;
        const target = requiredVictoryTowns.value;

        return [
            {
                label: 'Win line',
                value: target > 0 ? `${formatWarValue(target)} to win` : '--',
                detail: `COL ${formatRemainingTowns(factionStats.value.colonial.townsToVictory)} | WARD ${formatRemainingTowns(factionStats.value.warden.townsToVictory)}`,
            },
            {
                label: 'Momentum',
                value: momentumSummary.value.badge,
                detail: momentumSummary.value.title,
            },
            {
                label: 'Territory',
                value: controlTrendSummary.value.currentLabel,
                detail: controlTrendSummary.value.swingLabel,
            },
            {
                label: 'Attrition',
                value: attritionSummary.value.title,
                detail: `${attritionSummary.value.detail} COL ${formatWarCompactValue(factionStats.value.colonial.hourlyCasualties)}/hr | WARD ${formatWarCompactValue(factionStats.value.warden.hourlyCasualties)}/hr`,
            },
            {
                label: isYoungWar.value ? 'War captures' : '24h captures',
                value: captures.total > 0 ? `${captures.colonial} COL / ${captures.warden} WARD` : 'Quiet',
                detail: captures.neutralizations > 0
                    ? `${captures.neutralizations} neutralizations also landed`
                    : 'Town-capture events only',
            },
        ];
    });

    const timelineMetricCards = computed<WarSignalCard[]>(() => {
        const actionCounts = recentActionCounts.value;
        const captureMomentum = recentCaptureMomentum.value;
        const latestTrendPoint = controlTrendSeries.value.points.at(-1);

        return [
            {
                label: 'Territory hold',
                value: controlTrendSummary.value.currentLabel,
                detail: latestTrendPoint
                    ? `${latestTrendPoint.colonialControlledTowns} COL vs ${latestTrendPoint.wardenControlledTowns} WARD`
                    : 'No initialized playback observations yet',
            },
            {
                label: isYoungWar.value ? 'War swing' : '24h swing',
                value: controlTrendSummary.value.swingLabel,
                detail: controlTrendSeries.value.points.length ? 'Measured from playback frames' : 'Waiting for playback data',
            },
            {
                label: 'Capture split',
                value: captureMomentum.total > 0 ? `${captureMomentum.colonial} COL / ${captureMomentum.warden} WARD` : 'Quiet',
                detail: captureMomentum.neutralizations > 0
                    ? `${captureMomentum.neutralizations} neutralizations also landed`
                    : 'Town-capture events only',
            },
            {
                label: 'Action markers',
                value: `${actionCounts.upgrades + actionCounts.downgrades} base shifts`,
                detail: `${actionCounts.rockets} rockets | ${actionCounts.scorched} scorched`,
            },
        ];
    });

    const breakdownControlSnapshot = computed(() => {
        const latestTrendPoint = controlTrendSeries.value.points.at(-1);
        if (latestTrendPoint) {
            return {
                colonial: latestTrendPoint.colonialControlledTowns,
                warden: latestTrendPoint.wardenControlledTowns,
            };
        }

        return null;
    });

    const breakdownRows = computed<WarBreakdownRow[]>(() => [
        {
            label: 'Controlled towns',
            colonial: formatWarValue(breakdownControlSnapshot.value?.colonial),
            warden: formatWarValue(breakdownControlSnapshot.value?.warden),
        },
        {
            label: 'Victory towns',
            colonial: formatWarValue(factionStats.value.colonial.victoryTowns),
            warden: formatWarValue(factionStats.value.warden.victoryTowns),
        },
        {
            label: 'To victory',
            colonial: formatRemainingTowns(factionStats.value.colonial.townsToVictory),
            warden: formatRemainingTowns(factionStats.value.warden.townsToVictory),
        },
        {
            label: 'Rocket platforms',
            colonial: formatWarValue(factionStats.value.colonial.rocketSites),
            warden: formatWarValue(factionStats.value.warden.rocketSites),
        },
        {
            label: 'Loaded rockets',
            colonial: formatWarValue(factionStats.value.colonial.rockets),
            warden: formatWarValue(factionStats.value.warden.rockets),
        },
        {
            label: 'Total losses',
            colonial: formatWarValue(factionStats.value.colonial.totalCasualties),
            warden: formatWarValue(factionStats.value.warden.totalCasualties),
        },
        {
            label: 'Hourly losses',
            colonial: formatWarValue(factionStats.value.colonial.hourlyCasualties),
            warden: formatWarValue(factionStats.value.warden.hourlyCasualties),
        },
        {
            label: isYoungWar.value ? 'War captures' : '24h captures',
            colonial: formatWarValue(recentCaptureMomentum.value.colonial),
            warden: formatWarValue(recentCaptureMomentum.value.warden),
        },
    ]);

    const pulseSummaryState = computed<WarSummaryViewState | null>(() => {
        if (warSummary.value) {
            return null;
        }

        return createSummaryViewState('pulse', warSummaryLoading.value ? 'loading' : 'empty');
    });

    const timelineSummaryState = computed<WarSummaryViewState | null>(() => {
        if (momentumError.value && !controlTrendSeries.value.points.length) {
            return null;
        }

        if (!warSummary.value) {
            return createSummaryViewState('timeline', warSummaryLoading.value ? 'loading' : 'empty');
        }

        if (!controlTrendSeries.value.points.length && playbackSnapshotLoading.value) {
            return createSummaryViewState('timeline', 'loading');
        }

        return null;
    });

    const breakdownSummaryState = computed<WarSummaryViewState | null>(() => {
        if (warSummary.value) {
            return null;
        }

        return createSummaryViewState('breakdown', warSummaryLoading.value ? 'loading' : 'empty');
    });

    return {
        warSummary,
        factionStats,
        requiredVictoryTowns,
        winRaceSummary,
        winRaceTone,
        momentumSummary,
        momentumTone,
        momentumError,
        controlTrendSeries,
        victoryRaceSeries,
        victoryRaceSummary,
        controlTrendSummary,
        pulseSignalCards,
        timelineMetricCards,
        breakdownRows,
        pulseSummaryState,
        timelineSummaryState,
        breakdownSummaryState,
        formatWarValue,
        formatRaceProgress,
        formatRemainingTowns,
    };
}
