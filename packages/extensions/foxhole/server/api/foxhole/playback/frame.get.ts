import { createError, defineEventHandler, getQuery, setResponseHeader } from 'h3';
import { assertFoxholePlaybackApiEnabled, isFoxholeRealtimeLocalEnabled } from '#foxhole-server/utils/service-config.ts';
import { getFoxholePlaybackFrame } from '#foxhole-server/utils/playback.ts';
import { startFoxholeRealtimeService } from '#foxhole-server/utils/runtime.ts';

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export default defineEventHandler(async event => {
    assertFoxholePlaybackApiEnabled();
    const query = getQuery(event);
    const frameId = normalizeString(query.frameId) || null;
    const at = normalizeString(query.at) || null;

    if (!frameId && !at && isFoxholeRealtimeLocalEnabled()) {
        await startFoxholeRealtimeService();
    }

    const startedAt = performance.now();
    const frame = await getFoxholePlaybackFrame({
        frameId,
        shardId: normalizeString(query.shardId) || null,
        warId: normalizeString(query.warId) || null,
        at,
    });

    if (!frame) {
        throw createError({
            statusCode: 404,
            statusMessage: 'Foxhole playback frame not found.',
        });
    }

    setResponseHeader(event, 'Server-Timing', `playback;dur=${(performance.now() - startedAt).toFixed(2)}`);
    return frame;
});
