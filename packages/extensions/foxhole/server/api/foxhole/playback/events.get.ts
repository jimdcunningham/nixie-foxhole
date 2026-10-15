import { defineEventHandler, getQuery } from 'h3';
import { assertFoxholePlaybackApiEnabled } from '#foxhole-server/utils/service-config.ts';
import { listFoxholePlaybackEvents } from '#foxhole-server/utils/playback.ts';

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function readBooleanQuery(value: unknown): boolean {
    const normalized = normalizeString(value).toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export default defineEventHandler(async event => {
    assertFoxholePlaybackApiEnabled();
    const query = getQuery(event);
    const shardId = normalizeString(query.shardId) || null;
    const warId = normalizeString(query.warId) || null;
    const mapKey = normalizeString(query.mapKey) || null;
    const eventType = normalizeString(query.eventType) || null;
    const includeLegacy = readBooleanQuery(query.includeLegacy);
    const startAt = normalizeString(query.startAt) || null;
    const endAt = normalizeString(query.endAt) || null;
    const limit = Number.parseInt(normalizeString(query.limit), 10);
    const items = await listFoxholePlaybackEvents({
        shardId,
        warId,
        mapKey,
        eventType,
        includeLegacy,
        startAt,
        endAt,
        limit: Number.isFinite(limit) ? limit : undefined,
    });

    return {
        shardId,
        warId,
        mapKey,
        eventType,
        includeLegacy,
        count: items.length,
        items,
    };
});
