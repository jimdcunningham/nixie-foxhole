import { defineEventHandler, getQuery } from 'h3';
import { assertFoxholePlaybackApiEnabled } from '#foxhole-server/utils/service-config.ts';
import { listFoxholePlaybackTimeline } from '#foxhole-server/utils/playback.ts';

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export default defineEventHandler(async event => {
    assertFoxholePlaybackApiEnabled();
    const query = getQuery(event);
    const shardId = normalizeString(query.shardId);
    const warId = normalizeString(query.warId) || null;
    const startAt = normalizeString(query.startAt) || null;
    const endAt = normalizeString(query.endAt) || null;
    const limit = Number.parseInt(normalizeString(query.limit), 10);
    const items = await listFoxholePlaybackTimeline({
        shardId,
        warId,
        startAt,
        endAt,
        limit: Number.isFinite(limit) ? limit : undefined,
    });

    return {
        shardId,
        warId,
        count: items.length,
        startAt: items[0]?.capturedAt ?? null,
        endAt: items[items.length - 1]?.capturedAt ?? null,
        items,
    };
});
