import type { FoxholePlaybackEventRecord, FoxholePlaybackTimelineItem, FoxholeWarSummary } from './useFoxholeWarPanelData.ts';

/** Initial ownership is timestamped at conquest start, not at the map poll that discovered it. */
export function isInitialFoxholeOwnershipEvent(event: FoxholePlaybackEventRecord): boolean {
    if (event.eventType !== 'town-captured' || !event.data || typeof event.data !== 'object') return false;
    const data = event.data as { previousTeamId?: string; capturedTimestamp?: number };
    return data.previousTeamId === 'NONE' && typeof data.capturedTimestamp === 'number'
        && data.capturedTimestamp < Date.parse(event.observedAt);
}

export function currentWarObservationTimeline(items: readonly FoxholePlaybackTimelineItem[], war: FoxholeWarSummary | null): FoxholePlaybackTimelineItem[] {
    const current = items.filter(item => (!war?.warId || item.warId === war.warId)
        && (!war?.warStart || Date.parse(item.capturedAt) >= war.warStart));
    // Known town count stays stable through captures/neutralizations. A lower count
    // means ownership was still being hydrated, not that territory was lost.
    const coverage = (item: FoxholePlaybackTimelineItem) => Object.values(item.summary?.controlledTowns ?? {}).reduce((sum, count) => sum + count, 0);
    const completeCoverage = Math.max(0, ...current.map(coverage));
    return current.filter(item => coverage(item) === completeCoverage && completeCoverage > 0);
}
