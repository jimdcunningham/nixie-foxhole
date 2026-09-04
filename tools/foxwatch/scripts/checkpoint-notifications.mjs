const AUTOMATIC_POLL_COMMANDS = new Set(['monitor', 'monitor-once']);

export function shouldSendCheckpointNotifications(command) {
    return AUTOMATIC_POLL_COMMANDS.has(String(command ?? '').trim().toLowerCase());
}

function checkpointNotification({ checkpoint, description, branch, buildId, color = 0x4b9cff }) {
    const normalizedCheckpoint = String(checkpoint ?? '').trim();
    const normalizedDescription = String(description ?? '').trim();
    const normalizedBranch = String(branch ?? 'unknown').trim() || 'unknown';
    const normalizedBuildId = String(buildId ?? 'unknown').trim() || 'unknown';
    if (!normalizedCheckpoint) throw new Error('Checkpoint notifications require a checkpoint name.');
    if (!normalizedDescription) throw new Error('Checkpoint notifications require a description.');
    return {
        checkpoint: normalizedCheckpoint,
        content: `FoxWatch: ${normalizedCheckpoint} — ${normalizedBranch} BuildID ${normalizedBuildId}.`,
        embed: {
            title: normalizedCheckpoint,
            description: normalizedDescription,
            color,
            fields: [
                { name: 'Branch', value: normalizedBranch, inline: true },
                { name: 'Build ID', value: normalizedBuildId, inline: true },
            ],
            timestamp: new Date().toISOString(),
        },
    };
}

function nixiePayload(notification) {
    return {
        content: notification.content,
        embed: {
            ...notification.embed,
            color: `#${notification.embed.color.toString(16).padStart(6, '0').toUpperCase()}`,
        },
    };
}

export function createNixieCheckpointPayload({ checkpoint, description, branch, buildId, color = 0x4b9cff }) {
    return nixiePayload(checkpointNotification({ checkpoint, description, branch, buildId, color }));
}

function retryableWebhookStatus(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function sendCheckpointNotification({
    nixieWebhookUrl,
    checkpoint,
    description,
    branch,
    buildId,
    color = 0x4b9cff,
    logger,
    fetchImpl = fetch,
}) {
    if (!nixieWebhookUrl) return false;

    const notification = checkpointNotification({ checkpoint, description, branch, buildId, color });
    let lastError;
    try {
        for (let attempt = 1; attempt <= 4; attempt += 1) {
            let retryable = true;
            try {
                const response = await fetchImpl(nixieWebhookUrl, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'idempotency-key': `foxwatch:${notification.checkpoint}:${branch}:${buildId}`,
                    },
                    body: JSON.stringify(nixiePayload(notification)),
                    signal: AbortSignal.timeout(15_000),
                });
                if (response.ok) return true;
                lastError = new Error(`Nixie returned HTTP ${response.status}.`);
                retryable = retryableWebhookStatus(response.status);
            } catch (error) {
                lastError = error;
            }
            if (!retryable || attempt >= 4) throw lastError;
            await new Promise(resolve => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
        }
        throw lastError;
    } catch (error) {
        logger?.error(`Nixie notification failed: ${error instanceof Error ? error.message : error}`);
        return false;
    }
}
