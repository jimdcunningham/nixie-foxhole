function normalizeOrigin(origin: string | null | undefined): string {
    return typeof origin === 'string' ? origin.trim().replace(/\/$/, '') : '';
}

function toWebSocketOrigin(origin: string): string {
    const url = new URL(origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
}

export function resolveFoxholeRealtimeSocketEndpoint(): string {
    const runtimeConfig = useRuntimeConfig();
    const localEnabled = runtimeConfig.public?.foxholeRealtimeLocalEnabled !== false;
    const fallbackOrigin = normalizeOrigin(runtimeConfig.public?.foxholeRealtimeFallbackOrigin);
    const baseOrigin = !localEnabled && fallbackOrigin
        ? fallbackOrigin
        : window.location.origin;

    return new URL('/ws/foxhole', toWebSocketOrigin(baseOrigin)).toString();
}
