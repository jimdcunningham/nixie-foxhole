import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
    useFoxholeWarPanelData,

} from '#foxhole/composables/useFoxholeWarPanelData.ts';
import type { FoxholeWarSummary } from '#foxhole/composables/useFoxholeWarPanelData.ts';

export interface FoxholeWarStatusDetail {
    label: string;
    title: string | null;
}

export interface FoxholeWarPhaseDisplay {
    label: string;
    toneClass: string;
}

export function useFoxholeWarStatusHeader() {
    const headerNow = ref(Date.now());
    const { warSummary } = useFoxholeWarPanelData();

    let headerNowInterval: ReturnType<typeof setInterval> | null = null;

    const winningFaction = computed<'colonial' | 'warden' | null>(() => {
        return normalizeFactionWinner(warSummary.value?.winner);
    });

    const warPhaseDisplay = computed<FoxholeWarPhaseDisplay>(() => {
        const summary = warSummary.value;
        const winner = winningFaction.value;

        if (winner) {
            return {
                label: `${formatFactionLabel(winner)} win`,
                toneClass: winner === 'colonial' ? 'is-colonial-victory' : 'is-warden-victory',
            };
        }
        if (summary?.conquestEndTime) {
            return {
                label: 'Awaiting Winner',
                toneClass: 'is-ended',
            };
        }
        if (isResistancePhaseActive(summary)) {
            return {
                label: 'Resistance',
                toneClass: 'is-resistance',
            };
        }
        if (summary?.scheduledConquestEndTime && headerNow.value >= summary.scheduledConquestEndTime) {
            return {
                label: 'Cutoff',
                toneClass: 'is-cutoff',
            };
        }
        if (summary?.warStart) {
            return {
                label: 'Conquest',
                toneClass: 'is-conquest',
            };
        }
        return {
            label: 'Awaiting data',
            toneClass: 'is-neutral',
        };
    });

    const statusDetail = computed<FoxholeWarStatusDetail>(() => {
        const summary = warSummary.value;
        if (!summary) {
            return {
                label: 'Awaiting live war data',
                title: null,
            };
        }

        const winner = winningFaction.value;
        const conquestEndTime = summary.conquestEndTime;
        const scheduledConquestEndTime = summary.scheduledConquestEndTime;

        if (conquestEndTime) {
            return {
                label: `Ended ${formatElapsedDurationCompact(conquestEndTime, headerNow.value)} ago`,
                title: `Ended on ${formatDateTimeLabel(conquestEndTime)}`,
            };
        }

        if (winner) {
            return {
                label: `${formatFactionLabel(winner)} declared victorious`,
                title: null,
            };
        }

        if (isResistancePhaseActive(summary) && summary.resistanceStart) {
            return {
                label: `Resistance ${formatElapsedDurationCompact(summary.resistanceStart, headerNow.value)} ago`,
                title: `Resistance started ${formatDateTimeLabel(summary.resistanceStart)}`,
            };
        }

        if (scheduledConquestEndTime) {
            if (headerNow.value < scheduledConquestEndTime) {
                return {
                    label: `Ending in ${formatRemainingDurationCompact(headerNow.value, scheduledConquestEndTime)}`,
                    title: `Ending on ${formatDateTimeLabel(scheduledConquestEndTime)}`,
                };
            }

            return {
                label: `Ended on ${formatDateTimeLabel(scheduledConquestEndTime)}`,
                title: `Ended on ${formatDateTimeLabel(scheduledConquestEndTime)}`,
            };
        }

        if (summary.warStart) {
            return {
                label: `Started ${formatElapsedDurationCompact(summary.warStart, headerNow.value)} ago`,
                title: `Started on ${formatDateTimeLabel(summary.warStart)}`,
            };
        }

        return {
            label: 'Awaiting live war data',
            title: null,
        };
    });

    onMounted(() => {
        headerNowInterval = setInterval(() => {
            headerNow.value = Date.now();
        }, 15_000);
    });

    onUnmounted(() => {
        if (headerNowInterval) {
            clearInterval(headerNowInterval);
            headerNowInterval = null;
        }
    });

    return {
        warSummary,
        warPhaseDisplay,
        statusDetail,
    };
}

function isResistancePhaseActive(summary: FoxholeWarSummary | null | undefined): boolean {
    const resistanceStart = summary?.resistanceStart;
    if (!resistanceStart) {
        return false;
    }

    const warStart = summary?.warStart;
    if (!warStart) {
        return true;
    }

    return resistanceStart >= warStart;
}

function normalizeFactionWinner(teamId: string | null | undefined): 'colonial' | 'warden' | null {
    switch (String(teamId ?? '').trim().toUpperCase()) {
        case 'COLONIALS':
        case 'COLONIAL':
        case 'C':
            return 'colonial';
        case 'WARDENS':
        case 'WARDEN':
        case 'W':
            return 'warden';
        default:
            return null;
    }
}

function formatFactionLabel(faction: 'colonial' | 'warden'): string {
    return faction === 'colonial' ? 'Colonials' : 'Wardens';
}

function formatDateTimeLabel(timestamp: number): string {
    return new Date(timestamp).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function formatDurationCompact(durationMs: number, zeroLabel = 'under a minute'): string {
    const totalSeconds = Math.floor(Math.max(0, durationMs) / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (days > 0) {
        return hours > 0
            ? `${days} day${days === 1 ? '' : 's'}, ${hours} hour${hours === 1 ? '' : 's'}`
            : `${days} day${days === 1 ? '' : 's'}`;
    }
    if (hours > 0) {
        return minutes > 0
            ? `${hours} hour${hours === 1 ? '' : 's'}, ${minutes} minute${minutes === 1 ? '' : 's'}`
            : `${hours} hour${hours === 1 ? '' : 's'}`;
    }
    if (minutes > 0) {
        return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }

    return zeroLabel;
}

function formatElapsedDurationCompact(startTime: number, currentTime: number, zeroLabel = 'under a minute'): string {
    return formatDurationCompact(currentTime - startTime, zeroLabel);
}

function formatRemainingDurationCompact(currentTime: number, targetTime: number): string {
    return formatDurationCompact(targetTime - currentTime);
}
