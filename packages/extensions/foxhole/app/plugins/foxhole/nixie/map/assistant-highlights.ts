import { readonly, shallowRef } from 'vue';

export type FoxholeMapAssistantHighlight = {
    id: string;
    label: string;
    worldPosition: {
        x: number;
        y: number;
    };
};

export type FoxholeMapAssistantHighlightState = {
    token: number;
    entries: FoxholeMapAssistantHighlight[];
};

const foxholeMapAssistantHighlightsRef = shallowRef<FoxholeMapAssistantHighlightState | null>(null);
let foxholeMapAssistantHighlightsToken = 0;
let clearTimer: ReturnType<typeof setTimeout> | null = null;

const DEFAULT_TTL_MS = 45_000;

export function getFoxholeMapAssistantHighlightsRef() {
    return readonly(foxholeMapAssistantHighlightsRef);
}

export function setFoxholeMapAssistantHighlights(
    entries: readonly FoxholeMapAssistantHighlight[],
    options: { ttlMs?: number; } = {},
): FoxholeMapAssistantHighlightState {
    if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
    }

    const normalized = entries
        .map(entry => ({
            id: String(entry.id ?? '').trim(),
            label: String(entry.label ?? '').trim(),
            worldPosition: {
                x: Number(entry.worldPosition?.x),
                y: Number(entry.worldPosition?.y),
            },
        }))
        .filter(entry => (
            entry.id
            && entry.label
            && Number.isFinite(entry.worldPosition.x)
            && Number.isFinite(entry.worldPosition.y)
        ));

    foxholeMapAssistantHighlightsToken += 1;
    const next: FoxholeMapAssistantHighlightState = {
        token: foxholeMapAssistantHighlightsToken,
        entries: normalized,
    };
    foxholeMapAssistantHighlightsRef.value = next;

    const ttlMs = typeof options.ttlMs === 'number' && options.ttlMs > 0
        ? options.ttlMs
        : DEFAULT_TTL_MS;
    clearTimer = setTimeout(() => {
        if (foxholeMapAssistantHighlightsRef.value?.token === next.token) {
            foxholeMapAssistantHighlightsRef.value = null;
        }
        clearTimer = null;
    }, ttlMs);

    return next;
}

export function clearFoxholeMapAssistantHighlights(): void {
    if (clearTimer) {
        clearTimeout(clearTimer);
        clearTimer = null;
    }
    foxholeMapAssistantHighlightsRef.value = null;
}
