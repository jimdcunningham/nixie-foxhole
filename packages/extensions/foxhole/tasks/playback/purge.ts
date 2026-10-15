import { purgeExpiredFoxholePlaybackData } from '#foxhole-server/utils/playback.ts';

export default defineTask({
    meta: {
        name: 'foxhole:playback:purge',
        description: 'Purge expired Foxhole playback frames, checkpoints, and war events.',
    },
    async run() {
        console.info('[foxhole] starting playback purge task');

        const result = await purgeExpiredFoxholePlaybackData();

        console.info('[foxhole] completed playback purge task', {
            purgedFrameCount: typeof result?.purgedFrameCount === 'number' ? result.purgedFrameCount : null,
            purgedCheckpointCount: typeof result?.purgedCheckpointCount === 'number' ? result.purgedCheckpointCount : null,
            purgedLegacyEventCount: typeof result?.purgedLegacyEventCount === 'number' ? result.purgedLegacyEventCount : null,
            purgedExpiredEventCount: typeof result?.purgedExpiredEventCount === 'number' ? result.purgedExpiredEventCount : null,
            frameRetentionHours: typeof result?.frameRetentionHours === 'number' ? result.frameRetentionHours : null,
            eventRetentionDays: typeof result?.eventRetentionDays === 'number' ? result.eventRetentionDays : null,
            frameCutoff: typeof result?.frameCutoff === 'string' ? result.frameCutoff : null,
            eventCutoff: typeof result?.eventCutoff === 'string' ? result.eventCutoff : null,
        });

        return { result };
    },
});
