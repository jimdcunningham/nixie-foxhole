import { shallowRef } from 'vue';

export interface FoxholePlaybackPreviewLayerEntry {
    version?: number | null;
    items?: unknown[];
}

export interface FoxholePlaybackPreviewReportEntry {
    totalEnlistments?: number | null;
    factions?: Record<string, Record<string, number>>;
    dayOfWar?: number | null;
    version?: number | null;
}

export interface FoxholeMapPlaybackPreviewState {
    token: number;
    shardId: string;
    warId: string | null;
    warNumber: number | null;
    capturedAt: string;
    eventId?: string;
    eventType?: string;
    eventLabel?: string;
    warStart?: number | null;
    conquestEndTime?: number | null;
    resistanceStart?: number | null;
    scheduledConquestEndTime?: number | null;
    requiredVictoryTowns?: number | null;
    shortRequiredVictoryTowns?: number | null;
    winner?: string | null;
    reports: Record<string, FoxholePlaybackPreviewReportEntry | null | undefined>;
    labels: Record<string, FoxholePlaybackPreviewLayerEntry | null | undefined>;
    icons: Record<string, FoxholePlaybackPreviewLayerEntry | null | undefined>;
}

const foxholeMapPlaybackPreviewRef = shallowRef<FoxholeMapPlaybackPreviewState | null>(null);
let foxholeMapPlaybackPreviewToken = 0;

export function getFoxholeMapPlaybackPreviewRef() {
    return foxholeMapPlaybackPreviewRef;
}

export function setFoxholeMapPlaybackPreview(
    preview: Omit<FoxholeMapPlaybackPreviewState, 'token'>,
): FoxholeMapPlaybackPreviewState {
    foxholeMapPlaybackPreviewToken += 1;
    const nextPreview: FoxholeMapPlaybackPreviewState = {
        ...preview,
        token: foxholeMapPlaybackPreviewToken,
    };
    foxholeMapPlaybackPreviewRef.value = nextPreview;
    return nextPreview;
}

export function clearFoxholeMapPlaybackPreview(): void {
    foxholeMapPlaybackPreviewRef.value = null;
}
