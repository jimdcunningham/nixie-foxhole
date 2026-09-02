import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createMonitorState,
    normalizeMonitorBranch,
    parseSteamAppInfoBuilds,
    parseSteamAppManifest,
    quoteSteamConsoleValue,
    resolveVerifiedMonitorPakSource,
    selectLatestSteamBuild,
    selectInactiveAcquisitionSlot,
    shouldAcquireSteamBuild,
    shouldRunFoxWatch,
    validateDiscordWebhookUrl,
    validateNixieWebhookUrl,
    validateMonitorConfig,
    verifyInstalledAppManifest,
} from './steam-monitor-core.mjs';

test('resolves the monitor-managed PAK only from matching acquired state and receipt', () => {
    const receiptPath = 'C:/repo/tools/foxwatch/local/state/acquisitions/public/222.json';
    const state = {
        selectedBranch: 'public',
        selectedBuildId: '222',
        branches: {
            public: {
                activeSlot: 'a',
                acquiredBuildId: '222',
                pakDirectory: 'C:/repo/tools/foxwatch/local/installs/public/a/game/War/Content/Paks',
                pakFingerprint: 'pak-222',
                acquisitionReceiptPath: receiptPath,
            },
        },
    };
    const receipt = {
        schemaVersion: 1,
        appId: '505460',
        branch: 'public',
        buildId: '222',
        slot: 'a',
        pakDirectory: state.branches.public.pakDirectory,
        pakFingerprint: 'pak-222',
    };

    assert.deepEqual(resolveVerifiedMonitorPakSource(state, receipt, receiptPath), {
        branch: 'public',
        buildId: '222',
        pakDirectory: state.branches.public.pakDirectory,
        pakFingerprint: 'pak-222',
    });
    assert.equal(resolveVerifiedMonitorPakSource({ branches: {} }, null, receiptPath), null);
});

test('rejects stale monitor state and acquisition receipts', () => {
    const receiptPath = 'C:/repo/tools/foxwatch/local/state/acquisitions/public/222.json';
    const branchState = {
        activeSlot: 'a',
        acquiredBuildId: '221',
        pakDirectory: 'C:/repo/paks',
        pakFingerprint: 'pak-221',
        acquisitionReceiptPath: receiptPath,
    };
    const state = {
        selectedBranch: 'public',
        selectedBuildId: '222',
        branches: { public: branchState },
    };
    assert.throws(
        () => resolveVerifiedMonitorPakSource(state, null, receiptPath),
        /not fully acquired and verified/,
    );

    branchState.acquiredBuildId = '222';
    assert.throws(
        () => resolveVerifiedMonitorPakSource(state, {
            schemaVersion: 1,
            appId: '505460',
            branch: 'public',
            buildId: '221',
            slot: 'a',
            pakDirectory: branchState.pakDirectory,
            pakFingerprint: branchState.pakFingerprint,
        }, receiptPath),
        /receipt is invalid/,
    );
});

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
        heartbeatHours: 24,
    });
    assert.equal(config.branchMode, 'latest');
    assert.equal(config.blenderPath, 'C:/Blender/blender.exe');
    assert.equal(Object.hasOwn(config, 'heartbeatHours'), false);
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

test('accepts only Nixie webhook URLs', () => {
    assert.equal(
        validateNixieWebhookUrl('https://api.nixiejs.com/functions/v1/webhooks/integration/secret?ignored=true'),
        'https://api.nixiejs.com/functions/v1/webhooks/integration/secret',
    );
    assert.throws(() => validateNixieWebhookUrl('http://api.nixiejs.com/functions/v1/webhooks/integration/secret'), /HTTPS/);
    assert.throws(() => validateNixieWebhookUrl('https://api.nixiejs.com/api/webhooks/integration/secret'), /expected webhook format/);
});
