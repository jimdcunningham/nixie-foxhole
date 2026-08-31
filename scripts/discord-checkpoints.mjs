const AUTOMATIC_POLL_COMMANDS = new Set(['monitor', 'monitor-once']);

export function shouldSendCheckpointNotifications(command) {
    return AUTOMATIC_POLL_COMMANDS.has(String(command ?? '').trim().toLowerCase());
}

export const shouldSendDiscordCheckpoints = shouldSendCheckpointNotifications;

function checkpointEmbed({ checkpoint, description, branch, buildId, color = 0x4b9cff }) {
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

function discordPayload(notification) {
    return {
        username: 'FoxWatch',
        content: notification.content,
        allowed_mentions: { parse: [] },
        embeds: [notification.embed],
    };
}

export function createDiscordCheckpointPayload({ checkpoint, description, branch, buildId, color = 0x4b9cff }) {
    return discordPayload(checkpointEmbed({ checkpoint, description, branch, buildId, color }));
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
    return nixiePayload(checkpointEmbed({ checkpoint, description, branch, buildId, color }));
}

function retryableWebhookStatus(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function sendCheckpointDestination({ name, webhookUrl, payload, headers = {}, logger, fetchImpl }) {
    if (!webhookUrl) return false;
    try {
        const attempts = name === 'Nixie' ? 4 : 1;
        let lastError;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                const response = await fetchImpl(webhookUrl, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', ...headers },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(15_000),
                });
                if (response.ok) return true;
                lastError = new Error(`${name} returned HTTP ${response.status}.`);
                if (!retryableWebhookStatus(response.status)) throw lastError;
            } catch (error) {
                lastError = error;
                if (attempt >= attempts) throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
        }
        throw lastError;
    } catch (error) {
        logger?.error(`${name} notification failed: ${error instanceof Error ? error.message : error}`);
        return false;
    }
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
    return await sendCheckpointDestination({
        name: 'Discord',
        webhookUrl,
        payload: createDiscordCheckpointPayload({ checkpoint, description, branch, buildId, color }),
        logger,
        fetchImpl,
    });
}

export async function sendCheckpointNotifications({
    discordWebhookUrl,
    nixieWebhookUrl,
    checkpoint,
    description,
    branch,
    buildId,
    color = 0x4b9cff,
    logger,
    fetchImpl = fetch,
}) {
    const notification = checkpointEmbed({ checkpoint, description, branch, buildId, color });
    const [discord, nixie] = await Promise.all([
        sendCheckpointDestination({ name: 'Discord', webhookUrl: discordWebhookUrl, payload: discordPayload(notification), logger, fetchImpl }),
        sendCheckpointDestination({
            name: 'Nixie',
            webhookUrl: nixieWebhookUrl,
            payload: nixiePayload(notification),
            headers: { 'idempotency-key': `foxwatch:${notification.checkpoint}:${branch}:${buildId}` },
            logger,
            fetchImpl,
        }),
    ]);
    return { discord, nixie };
}
