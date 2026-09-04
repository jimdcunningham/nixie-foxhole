import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createNixieCheckpointPayload,
    sendCheckpointNotification,
    shouldSendCheckpointNotifications,
} from './checkpoint-notifications.mjs';

test('enables checkpoint notifications only for automatic polling commands', () => {
    assert.equal(shouldSendCheckpointNotifications('monitor'), true);
    assert.equal(shouldSendCheckpointNotifications('monitor-once'), true);
    assert.equal(shouldSendCheckpointNotifications('monitor-now'), false);
    assert.equal(shouldSendCheckpointNotifications('refresh'), false);
});

test('formats a FoxWatch checkpoint as a Nixie system message', () => {
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

test('sends a checkpoint to Nixie with an idempotency key', async () => {
    const requests = [];
    const sent = await sendCheckpointNotification({
        nixieWebhookUrl: 'https://api.nixiejs.com/functions/v1/webhooks/integration/secret',
        checkpoint: 'New Foxhole Build Detected',
        description: 'A new build is available.',
        branch: 'devbranch',
        buildId: '24850000',
        logger: { error() {} },
        fetchImpl: async (url, init) => {
            requests.push({ url, init });
            return { ok: true, status: 204 };
        },
    });

    assert.equal(sent, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.nixiejs.com/functions/v1/webhooks/integration/secret');
    assert.equal(requests[0].init.headers['idempotency-key'], 'foxwatch:New Foxhole Build Detected:devbranch:24850000');
});

test('keeps Nixie delivery failures separate from monitor execution', async () => {
    const errors = [];
    const sent = await sendCheckpointNotification({
        nixieWebhookUrl: 'https://api.nixiejs.com/functions/v1/webhooks/integration/secret',
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
    assert.deepEqual(errors, ['Nixie notification failed: Nixie returned HTTP 404.']);
});

test('does not attempt delivery when Nixie notifications are disabled', async () => {
    let called = false;
    const sent = await sendCheckpointNotification({
        nixieWebhookUrl: null,
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
