import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import nativeFs from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';

import {
    sendCheckpointNotifications,
    shouldSendCheckpointNotifications,
} from './discord-checkpoints.mjs';
import { buildPakInventory, readJson, writeJsonAtomic } from './pipeline-core.mjs';
import {
    FOXHOLE_APP_ID,
    FOXWATCH_MONITOR_SCHEMA_VERSION,
    createMonitorState,
    parseSteamAppInfoBuilds,
    parseSteamAppManifest,
    redactSensitiveText,
    selectLatestSteamBuild,
    selectInactiveAcquisitionSlot,
    shouldAcquireSteamBuild,
    shouldRunFoxWatch,
    validateDiscordWebhookUrl,
    validateNixieWebhookUrl,
    validateMonitorConfig,
    validateMonitorInterval,
    verifyInstalledAppManifest,
} from './steam-monitor-core.mjs';

const STEAMCMD_DOWNLOAD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';
const TASK_NAME = 'Nixie FoxWatch Monitor';
const LOCK_STALE_AFTER_MS = 16 * 60 * 60 * 1_000;

export const steamMonitorCommands = Object.freeze([
    'setup-monitor',
    'install-monitor-app',
    'open-monitor',
    'monitor-once',
    'monitor',
    'monitor-now',
    'monitor-status',
    'monitor-logs',
    'uninstall-monitor',
]);

export async function runSteamMonitorCommand({ command, args, repoRoot, runnerScriptPath }) {
    const paths = createMonitorPaths(repoRoot);
    if (command === 'open-monitor') {
        await manageMonitorApp(paths, 'open');
        return;
    }
    if (command === 'monitor-status') {
        await printMonitorStatus({ paths });
        return;
    }
    if (command === 'monitor-logs') {
        await printMonitorLogs(paths, args);
        return;
    }
    if (command === 'uninstall-monitor') {
        await manageMonitorApp(paths, 'uninstall');
        await manageScheduledTask(paths, 'uninstall');
        console.log('Removed the FoxWatch monitor app startup entry and legacy scheduled task. Local Steam installations, state, and logs were preserved.');
        return;
    }
    const logger = await createMonitorLogger(paths);
    if (command === 'setup-monitor') {
        await setupMonitor({ args, repoRoot, runnerScriptPath, paths, logger });
        return;
    }
    if (command === 'install-monitor-app') {
        const config = validateMonitorConfig(await loadMonitorConfig(paths));
        await installMonitorApp({
            paths,
            repoRoot,
            runnerScriptPath,
            config,
            logger,
            openWindow: true,
            startPaused: hasFlag(args, 'paused'),
        });
        return;
    }
    if (command === 'monitor-now') {
        await monitorOnce({
            paths,
            repoRoot,
            runnerScriptPath,
            logger,
            forceRefresh: hasFlag(args, 'force-refresh'),
            notifyCheckpoints: shouldSendCheckpointNotifications(command),
        });
        return;
    }
    if (command === 'monitor-once') {
        await monitorOnce({
            paths,
            repoRoot,
            runnerScriptPath,
            logger,
            notifyCheckpoints: shouldSendCheckpointNotifications(command),
        });
        return;
    }
    if (command === 'monitor') {
        const config = await loadMonitorConfig(paths);
        logger.info(`FoxWatch monitor running in the foreground every ${config.intervalMinutes} minute(s). Press Ctrl+C to stop.`);
        while (true) {
            try {
                await monitorOnce({
                    paths,
                    repoRoot,
                    runnerScriptPath,
                    logger,
                    notifyCheckpoints: shouldSendCheckpointNotifications(command),
                });
            } catch (error) {
                logger.error(error instanceof Error ? error.stack ?? error.message : String(error));
            }
            await delay(config.intervalMinutes * 60_000);
        }
    }
    throw new Error(`Unsupported FoxWatch monitor command: ${command}`);
}

function createMonitorPaths(repoRoot) {
    const foxwatchRoot = path.join(repoRoot, 'tools', 'foxwatch');
    const localRoot = path.join(foxwatchRoot, 'local');
    return {
        repoRoot,
        foxwatchRoot,
        localRoot,
        configPath: path.join(localRoot, 'monitor.config.v1.json'),
        secretsPath: path.join(localRoot, 'credentials', 'monitor.secrets.dpapi.v1.json'),
        statePath: path.join(localRoot, 'state', 'monitor-state.v1.json'),
        monitorSettingsPath: path.join(localRoot, 'state', 'monitor-app-settings.v1.json'),
        receiptsRoot: path.join(localRoot, 'state', 'acquisitions'),
        lockPath: path.join(localRoot, 'locks', 'monitor.lock.json'),
        logsRoot: path.join(localRoot, 'logs'),
        downloadsRoot: path.join(localRoot, 'downloads'),
        steamCmdRoot: path.join(localRoot, 'steamcmd'),
        installsRoot: path.join(localRoot, 'installs'),
        archiveScriptPath: path.join(foxwatchRoot, 'scripts', 'foxwatch-expand-archive.ps1'),
        secretsScriptPath: path.join(foxwatchRoot, 'scripts', 'foxwatch-monitor-secrets.ps1'),
        taskScriptPath: path.join(foxwatchRoot, 'scripts', 'foxwatch-monitor-task.ps1'),
        monitorAppScriptPath: path.join(foxwatchRoot, 'scripts', 'foxwatch-monitor-app.ps1'),
        monitorProjectPath: path.join(foxwatchRoot, 'monitor', 'FoxWatchMonitor.csproj'),
        monitorAppRoot: path.join(localRoot, 'monitor-app'),
        monitorAppExecutablePath: path.join(localRoot, 'monitor-app', 'FoxWatchMonitor.exe'),
        monitorHostConfigPath: path.join(localRoot, 'monitor-app', 'host.config.v1.json'),
    };
}

async function setupMonitor({ args, repoRoot, runnerScriptPath, paths, logger }) {
    if (process.platform !== 'win32') {
        throw new Error('FoxWatch monitor setup currently supports Windows only.');
    }
    const existingConfig = await readJson(paths.configPath);
    const existingSecrets = await readJson(paths.secretsPath);
    const nonInteractive = hasFlag(args, 'non-interactive');
    const interactive = !nonInteractive;
    const requestedInterval = getOption(args, 'interval-minutes')
        ?? existingConfig?.intervalMinutes
        ?? (interactive ? await promptWithDefault('Polling interval in minutes', '10') : 10);
    const requestedUsername = getOption(args, 'steam-username')
        ?? process.env.FOXWATCH_STEAM_USERNAME
        ?? existingConfig?.steamUsername
        ?? (interactive ? await promptRequired('Steam username') : null);
    if (!requestedUsername) {
        throw new Error('Non-interactive setup requires --steam-username or FOXWATCH_STEAM_USERNAME.');
    }
    const blenderPath = await resolveBlenderPath(args, existingConfig);

    let encryptedSteamPassword = existingSecrets?.encryptedSteamPassword ?? null;
    if (process.env.FOXWATCH_STEAM_PASSWORD) {
        encryptedSteamPassword = await encryptSecret(paths, process.env.FOXWATCH_STEAM_PASSWORD);
    } else if (!encryptedSteamPassword || hasFlag(args, 'replace-credentials')) {
        if (nonInteractive) {
            throw new Error('Non-interactive setup requires FOXWATCH_STEAM_PASSWORD when no encrypted password exists.');
        }
        encryptedSteamPassword = await promptEncryptedSecret(paths, 'Steam password');
    }

    const discordDisabled = hasFlag(args, 'no-discord');
    let encryptedDiscordWebhook = discordDisabled ? null : existingSecrets?.encryptedDiscordWebhook ?? null;
    if (!discordDisabled && process.env.FOXWATCH_DISCORD_WEBHOOK_URL) {
        validateDiscordWebhookUrl(process.env.FOXWATCH_DISCORD_WEBHOOK_URL);
        encryptedDiscordWebhook = await encryptSecret(paths, process.env.FOXWATCH_DISCORD_WEBHOOK_URL);
    } else if (!discordDisabled && !encryptedDiscordWebhook && interactive) {
        const useDiscord = (await promptWithDefault('Configure Discord notifications? (Y/n)', 'Y')).toLowerCase() !== 'n';
        if (useDiscord) {
            encryptedDiscordWebhook = await promptEncryptedSecret(paths, 'Discord webhook URL');
            validateDiscordWebhookUrl(await decryptSecret(paths, encryptedDiscordWebhook));
        }
    }

    const nixieDisabled = hasFlag(args, 'no-nixie');
    let encryptedNixieWebhook = nixieDisabled ? null : existingSecrets?.encryptedNixieWebhook ?? null;
    if (!nixieDisabled && process.env.FOXWATCH_NIXIE_WEBHOOK_URL) {
        validateNixieWebhookUrl(process.env.FOXWATCH_NIXIE_WEBHOOK_URL);
        encryptedNixieWebhook = await encryptSecret(paths, process.env.FOXWATCH_NIXIE_WEBHOOK_URL);
    } else if (!nixieDisabled && !encryptedNixieWebhook && interactive) {
        const useNixie = (await promptWithDefault('Configure Nixie notifications? (y/N)', 'N')).toLowerCase() === 'y';
        if (useNixie) {
            encryptedNixieWebhook = await promptEncryptedSecret(paths, 'Nixie webhook URL');
            validateNixieWebhookUrl(await decryptSecret(paths, encryptedNixieWebhook));
        }
    }

    const config = validateMonitorConfig({
        schemaVersion: FOXWATCH_MONITOR_SCHEMA_VERSION,
        branchMode: 'latest',
        intervalMinutes: validateMonitorInterval(requestedInterval),
        steamUsername: requestedUsername,
        blenderPath,
        discordEnabled: Boolean(encryptedDiscordWebhook),
        nixieEnabled: Boolean(encryptedNixieWebhook),
        minimumAvailableMemoryGiB: 12,
        steamAppId: FOXHOLE_APP_ID,
        createdAt: existingConfig?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });
    const secrets = {
        schemaVersion: FOXWATCH_MONITOR_SCHEMA_VERSION,
        encryptedSteamPassword,
        encryptedDiscordWebhook,
        encryptedNixieWebhook,
    };

    await fs.mkdir(paths.localRoot, { recursive: true });
    await writeJsonAtomic(paths.configPath, config);
    await writeJsonAtomic(paths.secretsPath, secrets);

    logger.info('Bootstrapping the local SteamCMD metadata client...');
    const metadataSteamRoot = path.join(paths.steamCmdRoot, 'metadata');
    const steamCmdPath = await ensureSteamCmd(paths, metadataSteamRoot, logger);
    const password = await decryptSecret(paths, encryptedSteamPassword);
    const builds = await queryRemoteSteamBuilds({
        steamCmdPath,
        username: config.steamUsername,
        password,
        logger,
    });
    const selected = selectLatestSteamBuild(builds);
    logger.info(
        `Steam authentication verified; public=${builds.public}, devbranch=${builds.devbranch}. `
            + `Selected ${selected.branch} BuildID ${selected.buildId}.`,
    );

    await configureMonitorApp({ paths, repoRoot, runnerScriptPath, config, logger });
    logger.info(`FoxWatch tray monitor configured to select the highest public/devbranch BuildID every ${config.intervalMinutes} minute(s).`);
    logger.info('The tray monitor is running in the Windows notification area.');
}

async function monitorOnce({
    paths,
    repoRoot,
    runnerScriptPath,
    logger,
    forceRefresh = false,
    notifyCheckpoints = false,
}) {
    const lock = await acquireMonitorLock(paths.lockPath);
    let config;
    let secrets;
    let discordWebhookUrl = null;
    let nixieWebhookUrl = null;
    let state;
    let branchState;
    let activeBranch = null;
    let remoteBuildId = null;
    let failureCheckpoint = 'FoxWatch Monitor Failed';
    try {
        config = await loadMonitorConfig(paths);
        secrets = await loadMonitorSecrets(paths);
        const password = await decryptSecret(paths, secrets.encryptedSteamPassword);
        if (notifyCheckpoints && config.discordEnabled && secrets.encryptedDiscordWebhook) {
            discordWebhookUrl = validateDiscordWebhookUrl(await decryptSecret(paths, secrets.encryptedDiscordWebhook));
        }
        if (notifyCheckpoints && config.nixieEnabled && secrets.encryptedNixieWebhook) {
            nixieWebhookUrl = validateNixieWebhookUrl(await decryptSecret(paths, secrets.encryptedNixieWebhook));
        }
        state = createMonitorState(await readJson(paths.statePath));
        state.lastPollAt = new Date().toISOString();

        const metadataSteamRoot = path.join(paths.steamCmdRoot, 'metadata');
        failureCheckpoint = 'SteamCMD Poll Failed';
        const steamCmdPath = await ensureSteamCmd(paths, metadataSteamRoot, logger);
        const builds = await queryRemoteSteamBuilds({
            steamCmdPath,
            username: config.steamUsername,
            password,
            logger,
        });
        const selected = selectLatestSteamBuild(builds);
        activeBranch = selected.branch;
        remoteBuildId = selected.buildId;
        branchState = { ...(state.branches[activeBranch] ?? {}) };
        state.selectedBranch = activeBranch;
        state.selectedBuildId = remoteBuildId;
        state.observedBuilds = { ...builds };
        logger.info(
            `Steam builds: public=${builds.public}, devbranch=${builds.devbranch}; `
            + `selected ${activeBranch} BuildID ${remoteBuildId}.`,
        );
        const foundNewBuild = branchState.lastObservedBuildId !== remoteBuildId;
        delete branchState.discordMessageId;
        if (foundNewBuild) {
            await sendCheckpointNotifications({
                discordWebhookUrl,
                nixieWebhookUrl,
                checkpoint: 'New Foxhole Build Detected',
                description: 'An automatic Steam poll found a Foxhole build that has not been processed by this monitor yet.',
                branch: activeBranch,
                buildId: remoteBuildId,
                logger,
            });
        }
        branchState.lastObservedBuildId = remoteBuildId;
        branchState.lastObservedAt = new Date().toISOString();
        state.branches[activeBranch] = branchState;
        await writeJsonAtomic(paths.statePath, state);

        let acquisitionRequired = shouldAcquireSteamBuild(branchState, remoteBuildId);
        if (!acquisitionRequired) {
            try {
                await verifyAcquisitionReceipt(branchState, remoteBuildId);
                logger.info(`Steam ${activeBranch} BuildID ${remoteBuildId} is already acquired and verified.`);
            } catch (error) {
                acquisitionRequired = true;
                logger.error(`Cached Steam acquisition is no longer trustworthy and will be rebuilt: ${error instanceof Error ? error.message : error}`);
            }
        }

        if (acquisitionRequired) {
            failureCheckpoint = 'SteamCMD Acquisition Failed';
            const acquisition = await acquireSteamBuild({
                config,
                branch: activeBranch,
                password,
                remoteBuildId,
                branchState,
                paths,
                logger,
            });
            branchState = {
                ...branchState,
                activeSlot: acquisition.slot,
                acquiredBuildId: remoteBuildId,
                acquiredAt: new Date().toISOString(),
                pakDirectory: acquisition.pakDirectory,
                pakFingerprint: acquisition.pakFingerprint,
                acquisitionReceiptPath: acquisition.receiptPath,
            };
            state.branches[activeBranch] = branchState;
            await writeJsonAtomic(paths.statePath, state);
        }

        if (!shouldRunFoxWatch(branchState, remoteBuildId, { forceRefresh })) {
            logger.info(`FoxWatch already completed successfully for ${activeBranch} BuildID ${remoteBuildId}; no work required.`);
            return;
        }

        const availableGiB = os.freemem() / 1024 ** 3;
        const minimumGiB = Number(config.minimumAvailableMemoryGiB ?? 12);
        if (availableGiB < minimumGiB) {
            branchState.deferredAt = new Date().toISOString();
            branchState.deferredReason = `Only ${availableGiB.toFixed(1)} GiB RAM available; ${minimumGiB} GiB required.`;
            state.branches[activeBranch] = branchState;
            await writeJsonAtomic(paths.statePath, state);
            logger.info(`Deferring FoxWatch for BuildID ${remoteBuildId}: ${branchState.deferredReason}`);
            return;
        }

        failureCheckpoint = 'FoxWatch Refresh Failed';
        await sendCheckpointNotifications({
            discordWebhookUrl,
            nixieWebhookUrl,
            checkpoint: 'FoxWatch Refresh Started',
            description: 'The automatic poll is starting a full FoxWatch deep refresh for this build.',
            branch: activeBranch,
            buildId: remoteBuildId,
            logger,
        });
        branchState.pipelineStartedAt = new Date().toISOString();
        state.branches[activeBranch] = branchState;
        await writeJsonAtomic(paths.statePath, state);

        const startedAt = performance.now();
        await runAndTee(process.execPath, [
            runnerScriptPath,
            'refresh',
            '--deep',
            '--pak-path',
            branchState.pakDirectory,
        ], {
            cwd: repoRoot,
            logger,
            label: 'FoxWatch deep refresh',
            env: {
                ...process.env,
                BLENDER_PATH: config.blenderPath,
            },
        });
        const durationMs = performance.now() - startedAt;
        branchState.successfulBuildId = remoteBuildId;
        branchState.successfulAt = new Date().toISOString();
        branchState.lastDurationMs = Math.round(durationMs);
        branchState.lastError = null;
        branchState.deferredAt = null;
        branchState.deferredReason = null;
        state.branches[activeBranch] = branchState;
        await writeJsonAtomic(paths.statePath, state);
        await sendCheckpointNotifications({
            discordWebhookUrl,
            nixieWebhookUrl,
            checkpoint: 'FoxWatch Refresh Finished',
            description: `The FoxWatch refresh completed successfully in ${formatDuration(durationMs)}.`,
            branch: activeBranch,
            buildId: remoteBuildId,
            color: 0x43d9a3,
            logger,
        });
        logger.info(`FoxWatch completed successfully for ${activeBranch} BuildID ${remoteBuildId} in ${formatDuration(durationMs)}.`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(error instanceof Error ? error.stack ?? error.message : String(error));
        if (state && activeBranch) {
            branchState = { ...(state.branches[activeBranch] ?? branchState ?? {}) };
            branchState.lastError = message;
            branchState.lastFailedAt = new Date().toISOString();
            state.branches[activeBranch] = branchState;
            await writeJsonAtomic(paths.statePath, state).catch(() => {});
        }
        await sendCheckpointNotifications({
            discordWebhookUrl,
            nixieWebhookUrl,
            checkpoint: failureCheckpoint,
            description: message.slice(0, 1_000),
            branch: activeBranch ?? 'unknown',
            buildId: remoteBuildId ?? branchState?.lastObservedBuildId ?? 'unknown',
            color: 0xe05252,
            logger,
        });
        throw error;
    } finally {
        await releaseMonitorLock(paths.lockPath, lock);
    }
}

async function acquireSteamBuild({ config, branch, password, remoteBuildId, branchState, paths, logger }) {
    const slot = selectInactiveAcquisitionSlot(branchState.activeSlot);
    const slotSteamRoot = path.join(paths.steamCmdRoot, branch, slot);
    const installRoot = path.join(paths.installsRoot, branch, slot, 'game');
    const steamCmdPath = await ensureSteamCmd(paths, slotSteamRoot, logger);
    await fs.mkdir(installRoot, { recursive: true });
    logger.info(`Acquiring Steam ${branch} BuildID ${remoteBuildId} into slot ${slot}...`);

    const appUpdateArgs = branch === 'devbranch'
        ? [FOXHOLE_APP_ID, '-beta', 'devbranch', 'validate']
        : [FOXHOLE_APP_ID, 'validate'];
    const output = await runSteamCommand(steamCmdPath, [
        '+@ShutdownOnFailedCommand', '1',
        '+force_install_dir', installRoot,
        '+login', config.steamUsername, password,
        '+app_update', ...appUpdateArgs,
        '+quit',
    ], {
        secrets: [password],
        logger,
        timeoutMs: 2 * 60 * 60 * 1_000,
    });
    if (!/Success!\s+App ['"]?505460['"]? fully installed\.?/i.test(output)) {
        throw new Error('SteamCMD exited without confirming that Foxhole was fully installed.');
    }

    const appManifestCandidates = [
        path.join(installRoot, 'steamapps', `appmanifest_${FOXHOLE_APP_ID}.acf`),
        path.join(slotSteamRoot, 'steamapps', `appmanifest_${FOXHOLE_APP_ID}.acf`),
    ];
    const appManifestPath = await firstExistingPath(appManifestCandidates);
    if (!appManifestPath) {
        throw new Error(
            `SteamCMD reported a successful Foxhole install but wrote no appmanifest_${FOXHOLE_APP_ID}.acf `
            + `under ${installRoot} or ${slotSteamRoot}.`,
        );
    }
    const appManifestText = await fs.readFile(appManifestPath, 'utf8');
    const appManifest = parseSteamAppManifest(appManifestText);
    verifyInstalledAppManifest({
        manifest: appManifest,
        expectedBuildId: remoteBuildId,
        expectedBranch: branch,
    });

    const pakDirectory = path.join(installRoot, 'War', 'Content', 'Paks');
    const pakInventory = await buildPakInventory(pakDirectory);
    if (pakInventory.entries.length === 0) {
        throw new Error(`Steam BuildID ${remoteBuildId} contained no PAK, UTOC, or UCAS files under ${pakDirectory}.`);
    }

    // FoxWatch discovers the Steam BuildID by walking upward from the PAK
    // directory. Copy the verified manifest next to the isolated game install
    // only after every acquisition check has passed.
    await fs.writeFile(path.join(installRoot, `appmanifest_${FOXHOLE_APP_ID}.acf`), appManifestText, 'utf8');
    const verifiedInventory = await buildPakInventory(pakDirectory);
    if (verifiedInventory.steamBuildId !== remoteBuildId) {
        throw new Error(`FoxWatch PAK inventory resolved Steam BuildID ${verifiedInventory.steamBuildId ?? 'unknown'}, expected ${remoteBuildId}.`);
    }

    const receiptPath = path.join(paths.receiptsRoot, branch, `${remoteBuildId}.json`);
    await writeJsonAtomic(receiptPath, {
        schemaVersion: FOXWATCH_MONITOR_SCHEMA_VERSION,
        appId: FOXHOLE_APP_ID,
        branch,
        buildId: remoteBuildId,
        slot,
        verifiedAt: new Date().toISOString(),
        steamManifestPath: appManifestPath,
        pakDirectory,
        pakFingerprint: verifiedInventory.fingerprint,
        pakEntries: verifiedInventory.entries,
    });
    logger.info(`Verified Steam ${branch} BuildID ${remoteBuildId} with ${verifiedInventory.entries.length} PAK container file(s).`);
    return {
        slot,
        pakDirectory,
        pakFingerprint: verifiedInventory.fingerprint,
        pakCount: verifiedInventory.entries.length,
        receiptPath,
    };
}

async function verifyAcquisitionReceipt(branchState, expectedBuildId) {
    if (!branchState?.acquisitionReceiptPath) {
        throw new Error(`Steam BuildID ${expectedBuildId} has no acquisition receipt.`);
    }
    const receipt = await readJson(branchState.acquisitionReceiptPath);
    if (receipt?.buildId !== String(expectedBuildId)
        || receipt?.pakDirectory !== branchState.pakDirectory
        || receipt?.pakFingerprint !== branchState.pakFingerprint) {
        throw new Error(`Steam BuildID ${expectedBuildId} acquisition receipt is missing or inconsistent.`);
    }
    const inventory = await buildPakInventory(receipt.pakDirectory);
    if (inventory.steamBuildId !== String(expectedBuildId) || inventory.fingerprint !== receipt.pakFingerprint) {
        throw new Error(`Steam BuildID ${expectedBuildId} PAK inventory changed after verification.`);
    }
}

async function queryRemoteSteamBuilds({ steamCmdPath, username, password, logger }) {
    if (!password) {
        throw new Error('Steam password is empty. Rerun setup-monitor with --replace-credentials.');
    }
    logger.info('Checking Steam branch metadata...');
    const output = await runSteamCommand(steamCmdPath, [
        '+@ShutdownOnFailedCommand', '1',
        '+login', username, password,
        '+app_info_update', '1',
        '+app_info_print', FOXHOLE_APP_ID,
        '+quit',
    ], {
        secrets: [password],
        logger,
        timeoutMs: 5 * 60 * 1_000,
    });
    return parseSteamAppInfoBuilds(output);
}

async function runSteamCommand(executable, args, { secrets, logger, timeoutMs }) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const child = spawn(executable, args, {
            cwd: path.dirname(executable),
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            shell: false,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill();
            reject(new Error(`SteamCMD exceeded its ${Math.round(timeoutMs / 60_000)} minute time limit.`));
        }, timeoutMs);
        child.on('error', error => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(error);
        });
        child.on('exit', code => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            const output = redactSensitiveText(`${stdout}\n${stderr}`, secrets);
            if (code === 0) {
                resolve(output);
            } else {
                logger.error(output.slice(-8_000));
                reject(new Error(`SteamCMD exited with code ${code}.`));
            }
        });
    });
}

async function ensureSteamCmd(paths, destinationRoot, logger) {
    const executable = path.join(destinationRoot, 'steamcmd.exe');
    const readyStampPath = path.join(destinationRoot, 'foxwatch-steamcmd-ready.v1');
    if (await pathExists(executable) && await pathExists(readyStampPath)) {
        return executable;
    }
    await fs.mkdir(paths.downloadsRoot, { recursive: true });
    const archivePath = path.join(paths.downloadsRoot, 'steamcmd.zip');
    if (!await pathExists(archivePath)) {
        logger.info('Downloading the official SteamCMD bootstrap archive...');
        const response = await fetch(STEAMCMD_DOWNLOAD_URL, { signal: AbortSignal.timeout(5 * 60 * 1_000) });
        if (!response.ok) {
            throw new Error(`SteamCMD download failed with HTTP ${response.status}.`);
        }
        const temporaryPath = `${archivePath}.${process.pid}.${randomUUID()}.tmp`;
        await fs.writeFile(temporaryPath, Buffer.from(await response.arrayBuffer()));
        await fs.rename(temporaryPath, archivePath);
    }
    await fs.mkdir(destinationRoot, { recursive: true });
    if (!await pathExists(executable)) {
        try {
            await runCaptured('powershell.exe', [
                '-NoLogo',
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                paths.archiveScriptPath,
                '-ArchivePath',
                archivePath,
                '-DestinationPath',
                destinationRoot,
            ]);
        } catch (error) {
            await fs.unlink(archivePath).catch(() => {});
            throw new Error(`SteamCMD bootstrap archive could not be extracted and will be downloaded again: ${error instanceof Error ? error.message : error}`);
        }
    }
    try {
        await runCaptured(executable, ['+quit'], { cwd: destinationRoot });
    } catch (initialError) {
        if (!await pathExists(executable)) {
            throw initialError;
        }
        logger.info('SteamCMD bootstrap replaced itself during its initial update; verifying the updated executable...');
        await delay(1_000);
        await runCaptured(executable, ['+quit'], { cwd: destinationRoot });
    }
    if (!await pathExists(executable)) {
        throw new Error(`SteamCMD bootstrap did not produce ${executable}.`);
    }
    await fs.writeFile(readyStampPath, `${new Date().toISOString()}\n`, 'utf8');
    return executable;
}

async function loadMonitorConfig(paths) {
    const config = await readJson(paths.configPath);
    if (!config) {
        throw new Error('FoxWatch monitor is not configured. Run `npm run foxwatch -- setup-monitor` first.');
    }
    return validateMonitorConfig(config);
}

async function loadMonitorSecrets(paths) {
    const secrets = await readJson(paths.secretsPath);
    if (secrets?.schemaVersion !== FOXWATCH_MONITOR_SCHEMA_VERSION || !secrets.encryptedSteamPassword) {
        throw new Error('FoxWatch monitor encrypted credentials are missing. Rerun setup-monitor with --replace-credentials.');
    }
    return secrets;
}

async function promptEncryptedSecret(paths, prompt) {
    return (await runCaptured('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        paths.secretsScriptPath,
        '-Action',
        'prompt-encrypt',
        '-Prompt',
        prompt,
    ], { inheritStdin: true })).trim();
}

async function encryptSecret(paths, value) {
    return (await runCaptured('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        paths.secretsScriptPath,
        '-Action',
        'encrypt-stdin',
    ], { stdin: value })).trim();
}

async function decryptSecret(paths, encryptedValue) {
    return runCaptured('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        paths.secretsScriptPath,
        '-Action',
        'decrypt-stdin',
    ], { stdin: encryptedValue });
}

async function manageScheduledTask(paths, action, options = {}) {
    const args = [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        paths.taskScriptPath,
        '-Action',
        action,
        '-TaskName',
        TASK_NAME,
    ];
    if (action === 'install') {
        args.push(
            '-NodePath', options.nodePath,
            '-RunnerPath', options.runnerScriptPath,
            '-WorkingDirectory', options.repoRoot,
            '-IntervalMinutes', String(options.intervalMinutes),
        );
    }
    return (await runCaptured('powershell.exe', args)).trim();
}

async function installMonitorApp({ paths, repoRoot, runnerScriptPath, config, logger, openWindow, startPaused = false }) {
    if (process.platform !== 'win32') {
        throw new Error('FoxWatch monitor app currently supports Windows only.');
    }
    if (await pathExists(paths.monitorAppExecutablePath)) {
        logger.info('Stopping the existing FoxWatch tray monitor before updating it...');
        await manageMonitorApp(paths, 'uninstall');
    }
    logger.info('Publishing the FoxWatch tray monitor...');
    await fs.mkdir(paths.monitorAppRoot, { recursive: true });
    const publishOutput = await runCaptured('dotnet', [
        'publish',
        paths.monitorProjectPath,
        '--configuration',
        'Release',
        '--runtime',
        'win-x64',
        '--self-contained',
        'false',
        '--output',
        paths.monitorAppRoot,
    ]);
    if (publishOutput.trim()) logger.info(publishOutput.trim());
    await writeMonitorHostConfig({ paths, repoRoot, runnerScriptPath, config });

    await manageScheduledTask(paths, 'uninstall');
    await manageMonitorApp(paths, 'install', { startPaused });
    if (openWindow) await manageMonitorApp(paths, 'open');
    logger.info('FoxWatch tray monitor installed, started, and registered for current-user Windows startup.');
}

async function configureMonitorApp({ paths, repoRoot, runnerScriptPath, config, logger }) {
    if (!await pathExists(paths.monitorAppExecutablePath)) {
        await installMonitorApp({ paths, repoRoot, runnerScriptPath, config, logger, openWindow: false });
        return;
    }
    await writeMonitorHostConfig({ paths, repoRoot, runnerScriptPath, config });
    await manageScheduledTask(paths, 'uninstall');
    await manageMonitorApp(paths, 'install');
    logger.info('Updated the existing FoxWatch tray monitor configuration without replacing the running app.');
}

async function writeMonitorHostConfig({ paths, repoRoot, runnerScriptPath, config }) {
    await writeJsonAtomic(paths.monitorHostConfigPath, {
        schemaVersion: 1,
        repoRoot,
        nodePath: process.execPath,
        runnerScriptPath,
        logsRoot: paths.logsRoot,
        statePath: paths.statePath,
        settingsPath: paths.monitorSettingsPath,
        intervalMinutes: config.intervalMinutes,
    });
}

async function manageMonitorApp(paths, action, options = {}) {
    const args = [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        paths.monitorAppScriptPath,
        '-Action',
        action,
        '-ExecutablePath',
        paths.monitorAppExecutablePath,
        '-SettingsPath',
        paths.monitorSettingsPath,
    ];
    if (action === 'install' && options.startPaused) args.push('-StartPaused');
    return (await runCaptured('powershell.exe', args)).trim();
}

async function printMonitorStatus({ paths }) {
    const config = await readJson(paths.configPath);
    const state = await readJson(paths.statePath);
    const taskStatus = process.platform === 'win32'
        ? await manageScheduledTask(paths, 'status')
        : 'unsupported\tnon-Windows platform';
    const appStatus = process.platform === 'win32'
        ? await manageMonitorApp(paths, 'status')
        : 'unsupported\tnon-Windows platform';
    console.log(`App: ${appStatus}`);
    console.log(`Legacy task: ${taskStatus}`);
    if (!config) {
        console.log('Configuration: missing');
        return;
    }
    console.log('Branch selection: highest BuildID across public and devbranch');
    console.log(`Interval: ${config.intervalMinutes} minutes`);
    console.log(`Discord: ${config.discordEnabled ? 'enabled' : 'disabled'}`);
    console.log(`Nixie: ${config.nixieEnabled ? 'enabled' : 'disabled'}`);
    console.log(`Last poll: ${state?.lastPollAt ?? 'never'}`);
    console.log(`Last selected branch: ${state?.selectedBranch ?? 'none'}`);
    console.log(`Last selected BuildID: ${state?.selectedBuildId ?? 'none'}`);
    for (const branch of ['public', 'devbranch']) {
        const branchState = state?.branches?.[branch];
        console.log(`${branch}: observed=${state?.observedBuilds?.[branch] ?? 'none'}, acquired=${branchState?.acquiredBuildId ?? 'none'}, successful=${branchState?.successfulBuildId ?? 'none'}`);
        if (branchState?.lastError) console.log(`${branch} last error: ${branchState.lastError}`);
    }
}

async function printMonitorLogs(paths, args) {
    const requestedLines = Number.parseInt(getOption(args, 'lines') ?? '100', 10);
    const files = (await fs.readdir(paths.logsRoot).catch(() => []))
        .filter(file => file.endsWith('.log'))
        .sort();
    const latest = files.at(-1);
    if (!latest) {
        console.log('No FoxWatch monitor logs exist yet.');
        return;
    }
    const content = await fs.readFile(path.join(paths.logsRoot, latest), 'utf8');
    console.log(content.split(/\r?\n/).slice(-Math.max(1, requestedLines)).join('\n'));
}

async function createMonitorLogger(paths) {
    await fs.mkdir(paths.logsRoot, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const logPath = path.join(paths.logsRoot, `foxwatch-monitor-${stamp}.log`);
    const write = (level, message) => {
        const line = `${new Date().toISOString()} ${level} ${message}`;
        console.log(line);
        try {
            nativeFs.appendFileSync(logPath, `${line}\n`, 'utf8');
        } catch {
            // Console output remains available if local log persistence fails.
        }
    };
    return {
        logPath,
        info(message) { write('INFO ', message); },
        error(message) { write('ERROR', message); },
        appendRaw(chunk) {
            try {
                nativeFs.appendFileSync(logPath, chunk, 'utf8');
            } catch {
                // The child output is still streamed to the active console.
            }
        },
    };
}

async function acquireMonitorLock(lockPath) {
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const token = randomUUID();
        try {
            const handle = await fs.open(lockPath, 'wx');
            await handle.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }));
            await handle.close();
            return token;
        } catch (error) {
            if (error?.code !== 'EEXIST') throw error;
            const existing = await readJson(lockPath).catch(() => null);
            const startedAt = Date.parse(existing?.startedAt ?? 0);
            if (existing?.pid && isProcessAlive(existing.pid)) {
                throw new Error(`FoxWatch monitor is already running as PID ${existing.pid}.`);
            }
            if (!existing?.pid && (!Number.isFinite(startedAt) || Date.now() - startedAt < LOCK_STALE_AFTER_MS)) {
                throw new Error('FoxWatch monitor lock exists but its owner cannot be verified. Remove it only after confirming no monitor is running.');
            }
            await fs.unlink(lockPath).catch(() => {});
        }
    }
    throw new Error('Unable to acquire the FoxWatch monitor lock.');
}

async function releaseMonitorLock(lockPath, token) {
    const existing = await readJson(lockPath).catch(() => null);
    if (existing?.token === token) {
        await fs.unlink(lockPath).catch(() => {});
    }
}

function isProcessAlive(pid) {
    try {
        process.kill(Number(pid), 0);
        return true;
    } catch (error) {
        return error?.code === 'EPERM';
    }
}

async function runCaptured(executable, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, {
            cwd: options.cwd,
            stdio: [options.inheritStdin ? 'inherit' : 'pipe', 'pipe', 'pipe'],
            windowsHide: true,
            shell: false,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('exit', code => {
            if (code === 0) resolve(stdout);
            else reject(new Error(`${path.basename(executable)} exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
        });
        if (!options.inheritStdin) child.stdin.end(options.stdin ?? '');
    });
}

async function runAndTee(executable, args, { cwd, logger, label, env = process.env }) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, {
            cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
        });
        child.stdout.on('data', chunk => {
            process.stdout.write(chunk);
            logger.appendRaw(chunk.toString());
        });
        child.stderr.on('data', chunk => {
            process.stderr.write(chunk);
            logger.appendRaw(chunk.toString());
        });
        child.on('error', reject);
        child.on('exit', (code, signal) => {
            if (code === 0) resolve();
            else reject(new Error(`${label} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`));
        });
    });
}

async function promptWithDefault(prompt, defaultValue) {
    const reader = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const value = (await reader.question(`${prompt} [${defaultValue}]: `)).trim();
        return value || defaultValue;
    } finally {
        reader.close();
    }
}

async function promptRequired(prompt) {
    const reader = createInterface({ input: process.stdin, output: process.stdout });
    try {
        while (true) {
            const value = (await reader.question(`${prompt}: `)).trim();
            if (value) return value;
        }
    } finally {
        reader.close();
    }
}

async function resolveBlenderPath(args, existingConfig) {
    const configured = getOption(args, 'blender-path')
        ?? process.env.BLENDER_PATH
        ?? existingConfig?.blenderPath;
    if (configured) {
        const absolutePath = path.resolve(configured);
        if (await pathExists(absolutePath)) return absolutePath;
        const resolvedCommand = await findCommandPath(configured);
        if (resolvedCommand) return resolvedCommand;
        throw new Error(`Configured Blender executable does not exist or resolve through PATH: ${configured}`);
    }
    const discovered = await findCommandPath('blender');
    if (!discovered) {
        throw new Error('Unable to locate Blender. Add it to PATH, set BLENDER_PATH, or pass --blender-path <path>.');
    }
    return discovered;
}

async function findCommandPath(command) {
    const discovered = (await runCaptured('where.exe', [command]).catch(() => ''))
        .split(/\r?\n/)
        .map(value => value.trim())
        .find(Boolean);
    return discovered && await pathExists(discovered) ? path.resolve(discovered) : null;
}

async function firstExistingPath(candidates) {
    for (const candidate of candidates) {
        if (await pathExists(candidate)) return candidate;
    }
    return null;
}

function getOption(args, name) {
    const prefix = `--${name}=`;
    for (let index = args.length - 1; index >= 0; index -= 1) {
        if (args[index].startsWith(prefix)) return args[index].slice(prefix.length);
        if (args[index] === `--${name}`) return args[index + 1] ?? null;
    }
    return null;
}

function hasFlag(args, name) {
    return args.includes(`--${name}`);
}

function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    return [hours ? `${hours}h` : null, minutes ? `${minutes}m` : null, `${seconds}s`].filter(Boolean).join(' ');
}

async function pathExists(value) {
    try {
        await fs.access(value);
        return true;
    } catch {
        return false;
    }
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
