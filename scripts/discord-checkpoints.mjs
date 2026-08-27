const AUTOMATIC_POLL_COMMANDS = new Set(['monitor', 'monitor-once']);

export function shouldSendDiscordCheckpoints(command) {
    return AUTOMATIC_POLL_COMMANDS.has(String(command ?? '').trim().toLowerCase());
}

export function createDiscordCheckpointPayload({ checkpoint, description, branch, buildId, color = 0x4b9cff }) {
    const normalizedCheckpoint = String(checkpoint ?? '').trim();
    const normalizedDescription = String(description ?? '').trim();
    const normalizedBranch = String(branch ?? 'unknown').trim() || 'unknown';
    const normalizedBuildId = String(buildId ?? 'unknown').trim() || 'unknown';
    if (!normalizedCheckpoint) {
        throw new Error('Discord checkpoint notifications require a checkpoint name.');
    }
    if (!normalizedDescription) {
        throw new Error('Discord checkpoint notifications require a description.');
    }

    return {
        username: 'FoxWatch',
        content: `FoxWatch: ${normalizedCheckpoint} — ${normalizedBranch} BuildID ${normalizedBuildId}.`,
        allowed_mentions: { parse: [] },
        embeds: [{
            title: normalizedCheckpoint,
            description: normalizedDescription,
            color,
            fields: [
                { name: 'Branch', value: normalizedBranch, inline: true },
                { name: 'Build ID', value: normalizedBuildId, inline: true },
            ],
            timestamp: new Date().toISOString(),
        }],
    };
}

export async function sendDiscordCheckpoint({
    webhookUrl,
    checkpoint,
    description,
    branch,
    buildId,
    color = 0x4b9cff,
    logger,
    fetchImpl = fetch,
}) {
    if (!webhookUrl) {
        return false;
    }
    try {
        const response = await fetchImpl(webhookUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(createDiscordCheckpointPayload({
                checkpoint,
                description,
                branch,
                buildId,
                color,
            })),
            signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
            throw new Error(`Discord returned HTTP ${response.status}.`);
        }
        return true;
    } catch (error) {
        logger?.error(`Discord notification failed: ${error instanceof Error ? error.message : error}`);
        return false;
    }
}
