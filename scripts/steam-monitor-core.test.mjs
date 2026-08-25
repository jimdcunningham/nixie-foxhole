import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createMonitorState,
    normalizeMonitorBranch,
    parseSteamAppInfoBuilds,
    parseSteamAppManifest,
    quoteSteamConsoleValue,
    selectLatestSteamBuild,
    selectInactiveAcquisitionSlot,
    shouldAcquireSteamBuild,
    shouldRunFoxWatch,
    validateDiscordWebhookUrl,
    validateMonitorConfig,
    verifyInstalledAppManifest,
} from './steam-monitor-core.mjs';

test('parses public and devbranch BuildIDs from Steam app info', () => {
    const text = `AppID : 505460\n"505460"\n{\n  "common"\n  {\n    "branches"\n    {\n      "public" { "buildid" "111" "timeupdated" "1" }\n      "devbranch" { "buildid" "222" "timeupdated" "2" }\n    }\n  }\n}`;
    assert.deepEqual(parseSteamAppInfoBuilds(text), { public: '111', devbranch: '222' });
});

test('parses and verifies an installed devbranch app manifest', () => {
    const manifest = parseSteamAppManifest(`"AppState" { "appid" "505460" "buildid" "222" "UserConfig" { "BetaKey" "devbranch" } }`);
    assert.deepEqual(manifest, { appId: '505460', buildId: '222', betaKey: 'devbranch' });
    assert.doesNotThrow(() => verifyInstalledAppManifest({
        manifest,
        expectedBuildId: '222',
        expectedBranch: 'devbranch',
    }));
});

test('rejects a stale installed build and wrong beta branch', () => {
    assert.throws(() => verifyInstalledAppManifest({
        manifest: { appId: '505460', buildId: '221', betaKey: 'public' },
        expectedBuildId: '222',
        expectedBranch: 'devbranch',
    }), /does not match requested build/);
    assert.throws(() => verifyInstalledAppManifest({
        manifest: { appId: '505460', buildId: '222', betaKey: '' },
        expectedBuildId: '222',
        expectedBranch: 'devbranch',
    }), /did not confirm devbranch/);
});

test('keeps acquisition and successful pipeline state separate', () => {
    const state = { activeSlot: 'a', acquiredBuildId: '222', successfulBuildId: '111' };
    assert.equal(shouldAcquireSteamBuild(state, '222'), false);
    assert.equal(shouldRunFoxWatch(state, '222'), true);
    assert.equal(shouldRunFoxWatch({ ...state, successfulBuildId: '222' }, '222'), false);
    assert.equal(shouldRunFoxWatch({ ...state, successfulBuildId: '222' }, '222', { forceRefresh: true }), true);
    assert.equal(selectInactiveAcquisitionSlot('a'), 'b');
    assert.equal(selectInactiveAcquisitionSlot(null), 'a');
});

test('normalizes branches and constructs a clean state', () => {
    assert.equal(normalizeMonitorBranch('DEV'), 'devbranch');
    assert.equal(normalizeMonitorBranch('public'), 'public');
    assert.deepEqual(createMonitorState(), {
        schemaVersion: 1,
        branches: {},
        lastPollAt: null,
        lastHeartbeatAt: null,
    });
});

test('selects the numerically newest branch and prefers public for ties', () => {
    assert.deepEqual(
        selectLatestSteamBuild({ public: '21803671', devbranch: '21804000' }),
        { branch: 'devbranch', buildId: '21804000' },
    );
    assert.deepEqual(
        selectLatestSteamBuild({ public: '21805000', devbranch: '21804000' }),
        { branch: 'public', buildId: '21805000' },
    );
    assert.deepEqual(
        selectLatestSteamBuild({ public: '21805000', devbranch: '21805000' }),
        { branch: 'public', buildId: '21805000' },
    );
    assert.throws(() => selectLatestSteamBuild({ public: '21805000' }), /both public and devbranch/);
});

test('validates a complete local monitor configuration', () => {
    const config = validateMonitorConfig({
        schemaVersion: 1,
        branchMode: 'latest',
        intervalMinutes: 10,
        steamUsername: 'foxwatch-bot',
        blenderPath: 'C:/Blender/blender.exe',
        discordEnabled: true,
    });
    assert.equal(config.branchMode, 'latest');
    assert.equal(config.blenderPath, 'C:/Blender/blender.exe');
    assert.equal(config.heartbeatHours, 24);
});

test('quotes Steam console values and rejects control characters', () => {
    assert.equal(quoteSteamConsoleValue('a"b\\c'), '"a\\"b\\c"');
    assert.throws(() => quoteSteamConsoleValue('line\nbreak'), /control characters/);
});

test('accepts only Discord incoming webhook URLs', () => {
    assert.equal(
        validateDiscordWebhookUrl('https://discord.com/api/webhooks/123/token_value?wait=true'),
        'https://discord.com/api/webhooks/123/token_value',
    );
    assert.throws(() => validateDiscordWebhookUrl('https://example.com/api/webhooks/123/token'), /discord.com/);
});
