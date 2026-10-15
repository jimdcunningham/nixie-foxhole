import { processBlueprintModerationBatch } from '#foxhole-server/utils/blueprint-moderation.ts';

export default defineTask({
    meta: { name: 'nixie:blueprints:moderate', description: 'Moderate legacy blueprint text and images in the configured queue order.' },
    async run() {
        const result = await processBlueprintModerationBatch();
        if (result.processed || 'error' in result) console.info('[nixie:blueprints:moderation]', result);
        return { result };
    },
});
