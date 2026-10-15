import { createError, getRequestURL } from 'h3';
import type { H3Event } from 'h3';

function normalizeOrigin(origin: string | null | undefined): string {
    return typeof origin === 'string' ? origin.trim().replace(/\/$/, '') : '';
}

export function isFoxholeRealtimeLocalEnabled(): boolean {
    const runtimeConfig = useRuntimeConfig();
    return runtimeConfig.public?.foxholeRealtimeLocalEnabled !== false;
}

export function isFoxholeRealtimeAutostartEnabled(): boolean {
    const runtimeConfig = useRuntimeConfig();
    return runtimeConfig.foxholeRealtimeAutostartEnabled === true;
}

export function isFoxholePlaybackApiEnabled(): boolean {
    const runtimeConfig = useRuntimeConfig();
    return runtimeConfig.public?.foxholePlaybackApiEnabled !== false;
}

export function isFoxholePlaybackDbLoggingEnabled(): boolean {
    const runtimeConfig = useRuntimeConfig();
    return runtimeConfig.foxholePlaybackDbLoggingEnabled !== false;
}

export function assertFoxholePlaybackApiEnabled(): void {
    if (isFoxholePlaybackApiEnabled()) {
        return;
    }

    throw createError({
        statusCode: 503,
        statusMessage: 'Foxhole playback API is disabled on this host.',
    });
}

export function getFoxholeRealtimeFallbackOrigin(): string {
    const runtimeConfig = useRuntimeConfig();
    return normalizeOrigin(runtimeConfig.public?.foxholeRealtimeFallbackOrigin);
}

export async function fetchFoxholeRealtimeFallback(event: H3Event, path: string): Promise<unknown> {
    const fallbackOrigin = getFoxholeRealtimeFallbackOrigin();
    if (!fallbackOrigin) {
        throw createError({
            statusCode: 503,
            statusMessage: 'Foxhole realtime is disabled on this host and no fallback origin is configured.',
        });
    }

    const requestOrigin = normalizeOrigin(getRequestURL(event).origin);
    if (fallbackOrigin === requestOrigin) {
        throw createError({
            statusCode: 503,
            statusMessage: 'Foxhole realtime fallback origin resolves to this host while local realtime is disabled.',
        });
    }

    return await $fetch(new URL(path, `${fallbackOrigin}/`).toString());
}
