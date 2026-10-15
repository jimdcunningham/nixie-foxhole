import { defineEventHandler } from 'h3';
import type { H3Event } from 'h3';
import { fetchFoxholeRealtimeFallback, isFoxholeRealtimeLocalEnabled } from '#foxhole-server/utils/service-config.ts';
import { getFoxholeRealtimeStats, startFoxholeRealtimeService } from '#foxhole-server/utils/runtime.ts';

export default defineEventHandler(async (event: H3Event) => {
    if (!isFoxholeRealtimeLocalEnabled()) {
        return await fetchFoxholeRealtimeFallback(event, '/api/foxhole/stats');
    }

    await startFoxholeRealtimeService();
    return getFoxholeRealtimeStats();
});
