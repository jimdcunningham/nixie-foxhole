import { defineEventHandler } from 'h3';
import { assertFoxholePlaybackApiEnabled } from '#foxhole-server/utils/service-config.ts';
import { listFoxholePlaybackShards } from '#foxhole-server/utils/playback.ts';

export default defineEventHandler(async () => {
    assertFoxholePlaybackApiEnabled();
    const shards = await listFoxholePlaybackShards();
    return {
        shards,
    };
});
