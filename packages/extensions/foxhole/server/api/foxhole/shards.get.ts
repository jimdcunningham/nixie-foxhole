import { fetchFoxholeRealtimeFallback, isFoxholeRealtimeLocalEnabled } from '#foxhole-server/utils/service-config.ts';
import { getFoxholeRealtimeShards, startFoxholeRealtimeService } from '#foxhole-server/utils/runtime.ts';

export default defineEventHandler(async event => {
    if (!isFoxholeRealtimeLocalEnabled()) {
        return await fetchFoxholeRealtimeFallback(event, '/api/foxhole/shards');
    }

    await startFoxholeRealtimeService();
    return getFoxholeRealtimeShards();
});
