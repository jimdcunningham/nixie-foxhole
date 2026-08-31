import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDiscordCheckpointPayload,
    createNixieCheckpointPayload,
    sendCheckpointNotifications,
    sendDiscordCheckpoint,
    shouldSendCheckpointNotifications,
    shouldSendDiscordCheckpoints,
} from './discord-checkpoints.mjs';

test('enables Discord checkpoints only for automatic polling commands', () => {
    assert.equal(shouldSendDiscordCheckpoints('monitor'), true);
    assert.equal(shouldSendDiscordCheckpoints('monitor-once'), true);
    assert.equal(shouldSendDiscordCheckpoints('monitor-now'), false);
    assert.equal(shouldSendDiscordCheckpoints('refresh'), false);
});

test('enables dual-destination checkpoints for the same automatic polling commands', () => {
    assert.equal(shouldSendCheckpointNotifications('monitor'), true);
    assert.equal(shouldSendCheckpointNotifications('monitor-once'), true);
    assert.equal(shouldSendCheckpointNotifications('monitor-now'), false);
});

test('formats append-only FoxWatch checkpoint messages with branch and build details', () => {
    const payload = createDiscordCheckpointPayload({
        checkpoint: 'New Foxhole Build Detected',
        description: 'An automatic Steam poll found a build that has not been processed yet.',
        branch: 'devbranch',
        buildId: '24850000',
    });

    assert.equal(payload.content, 'FoxWatch: New Foxhole Build Detected — devbranch BuildID 24850000.');
    assert.equal(payload.embeds[0].title, 'New Foxhole Build Detected');
    assert.deepEqual(payload.embeds[0].fields, [
        { name: 'Branch', value: 'devbranch', inline: true },
        { name: 'Build ID', value: '24850000', inline: true },
    ]);
    assert.deepEqual(payload.allowed_mentions, { parse: [] });
});

test('formats the same checkpoint for a Nixie system message', () => {
    const payload = createNixieCheckpointPayload({
        checkpoint: 'FoxWatch Refresh Finished',
        description: 'The refresh completed successfully.',
        branch: 'public',
        buildId: '24842742',
        color: 0x43d9a3,
    });

    assert.equal(payload.content, 'FoxWatch: FoxWatch Refresh Finished — public BuildID 24842742.');
    assert.equal(payload.embed.title, 'FoxWatch Refresh Finished');
    assert.equal(payload.embed.color, '#43D9A3');
    assert.deepEqual(payload.embed.fields, [
        { name: 'Branch', value: 'public', inline: true },
        { name: 'Build ID', value: '24842742', inline: true },
    ]);
});

test('dual-sends one checkpoint model to Discord and Nixie', async () => {
    const requests = [];
    const result = await sendCheckpointNotifications({
        discordWebhookUrl: 'https://discord.com/api/webhooks/123/token',
        nixieWebhookUrl: 'https://api.nixiejs.com/v1/webhooks/integration/secret',
        checkpoint: 'New Foxhole Build Detected',
        description: 'A new build is available.',
        branch: 'devbranch',
        buildId: '24850000',
        logger: { error() {} },
        fetchImpl: async (url, init) => {
            requests.push({ url, body: JSON.parse(init.body) });
            return { ok: true, status: 204 };
        },
    });

    assert.deepEqual(result, { discord: true, nixie: true });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].body.embeds[0].title, requests[1].body.embed.title);
});

test('posts every Discord checkpoint as a new message', async () => {
    const requests = [];
    const sent = await sendDiscordCheckpoint({
        webhookUrl: 'https://discord.com/api/webhooks/123/token',
        checkpoint: 'FoxWatch Refresh Started',
        description: 'The automatic poll is starting a full refresh.',
        branch: 'public',
        buildId: '24842742',
        logger: { error() {} },
        fetchImpl: async (url, init) => {
            requests.push({ url, init });
            return { ok: true, status: 204 };
        },
    });

    assert.equal(sent, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://discord.com/api/webhooks/123/token');
    assert.equal(requests[0].init.method, 'POST');
    assert.doesNotMatch(requests[0].url, /\/messages\//);
});

test('keeps Discord delivery failures separate from monitor execution', async () => {
    const errors = [];
    const sent = await sendDiscordCheckpoint({
        webhookUrl: 'https://discord.com/api/webhooks/123/token',
        checkpoint: 'SteamCMD Poll Failed',
        description: 'Authentication failed.',
        branch: 'public',
        buildId: 'unknown',
        logger: {
            error(message) {
                errors.push(message);
            },
        },
        fetchImpl: async () => ({ ok: false, status: 404 }),
    });

    assert.equal(sent, false);
    assert.deepEqual(errors, ['Discord notification failed: Discord returned HTTP 404.']);
});

test('does not attempt Discord delivery when notifications are disabled for the run', async () => {
    let called = false;
    const sent = await sendDiscordCheckpoint({
        webhookUrl: null,
        checkpoint: 'FoxWatch Refresh Finished',
        description: 'The refresh completed successfully.',
        branch: 'public',
        buildId: '24842742',
        logger: { error() {} },
        fetchImpl: async () => {
            called = true;
            return { ok: true, status: 204 };
        },
    });

    assert.equal(sent, false);
    assert.equal(called, false);
});
