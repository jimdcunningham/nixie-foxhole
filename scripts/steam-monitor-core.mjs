import { createHash } from 'node:crypto';

export const FOXHOLE_APP_ID = '505460';
export const FOXWATCH_MONITOR_SCHEMA_VERSION = 1;
export const FOXWATCH_MONITOR_BRANCHES = Object.freeze(['public', 'devbranch']);
export const FOXWATCH_MONITOR_SLOTS = Object.freeze(['a', 'b']);

export function normalizeMonitorBranch(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'dev' || normalized === 'development') {
        return 'devbranch';
    }
    if (!FOXWATCH_MONITOR_BRANCHES.includes(normalized)) {
        throw new Error(`FoxWatch monitor branch must be one of: ${FOXWATCH_MONITOR_BRANCHES.join(', ')}.`);
    }
    return normalized;
}

export function validateMonitorInterval(value) {
    const interval = Number.parseInt(String(value), 10);
    if (!Number.isInteger(interval) || interval < 5 || interval > 1_440) {
        throw new Error('FoxWatch monitor interval must be between 5 and 1440 minutes.');
    }
    return interval;
}

export function validateMonitorConfig(config) {
    if (config?.schemaVersion !== FOXWATCH_MONITOR_SCHEMA_VERSION) {
        throw new Error(`Unsupported FoxWatch monitor configuration schema: ${config?.schemaVersion ?? 'missing'}.`);
    }
    const branchMode = String(config.branchMode ?? 'latest').trim().toLowerCase();
    if (branchMode !== 'latest') {
        throw new Error('FoxWatch monitor branch mode must be latest.');
    }
    const intervalMinutes = validateMonitorInterval(config.intervalMinutes);
    const steamUsername = String(config.steamUsername ?? '').trim();
    if (!steamUsername) {
        throw new Error('FoxWatch monitor configuration requires a Steam username.');
    }
    if (/\r|\n/.test(steamUsername)) {
        throw new Error('FoxWatch monitor Steam username contains unsupported control characters.');
    }
    const blenderPath = String(config.blenderPath ?? '').trim();
    if (!blenderPath) {
        throw new Error('FoxWatch monitor configuration requires a resolved Blender executable path.');
    }
    return {
        ...config,
        schemaVersion: FOXWATCH_MONITOR_SCHEMA_VERSION,
        branchMode,
        intervalMinutes,
        steamUsername,
        blenderPath,
        discordEnabled: Boolean(config.discordEnabled),
        heartbeatHours: Number.isFinite(config.heartbeatHours) && config.heartbeatHours > 0
            ? config.heartbeatHours
            : 24,
    };
}

export function selectLatestSteamBuild(builds) {
    const publicBuildId = String(builds?.public ?? '');
    const devBuildId = String(builds?.devbranch ?? '');
    if (!/^\d+$/.test(publicBuildId) || !/^\d+$/.test(devBuildId)) {
        throw new Error('Steam must report numeric BuildIDs for both public and devbranch before FoxWatch can select the latest build.');
    }
    if (BigInt(devBuildId) > BigInt(publicBuildId)) {
        return { branch: 'devbranch', buildId: devBuildId };
    }
    return { branch: 'public', buildId: publicBuildId };
}

export function parseSteamAppInfoBuilds(output, appId = FOXHOLE_APP_ID) {
    const root = parseNamedVdfObject(output, appId);
    const branches = findObjectByKey(root, 'branches');
    if (!branches) {
        throw new Error(`Steam app info for ${appId} did not contain a branches object.`);
    }

    const builds = {};
    for (const branch of FOXWATCH_MONITOR_BRANCHES) {
        const branchDocument = getObjectValue(branches, branch);
        const buildId = getStringValue(branchDocument, 'buildid');
        if (buildId && /^\d+$/.test(buildId)) {
            builds[branch] = buildId;
        }
    }
    return builds;
}

export function parseSteamAppManifest(text) {
    const document = parseNamedVdfObject(text, 'AppState');
    const appId = getStringValue(document, 'appid');
    const buildId = getStringValue(document, 'buildid');
    const userConfig = getObjectValue(document, 'UserConfig');
    const betaKey = getStringValue(userConfig, 'BetaKey') ?? '';
    return { appId, buildId, betaKey };
}

export function verifyInstalledAppManifest({ manifest, expectedBuildId, expectedBranch }) {
    const branch = normalizeMonitorBranch(expectedBranch);
    if (manifest?.appId !== FOXHOLE_APP_ID) {
        throw new Error(`Steam installed app manifest reported app ${manifest?.appId ?? 'unknown'}, expected ${FOXHOLE_APP_ID}.`);
    }
    if (manifest?.buildId !== String(expectedBuildId)) {
        throw new Error(`Steam installed build ${manifest?.buildId ?? 'unknown'} does not match requested build ${expectedBuildId}.`);
    }
    const betaKey = String(manifest?.betaKey ?? '').trim().toLowerCase();
    if (branch === 'devbranch' && betaKey !== 'devbranch') {
        throw new Error(`Steam installed manifest did not confirm devbranch (BetaKey=${betaKey || 'empty'}).`);
    }
    if (branch === 'public' && betaKey && betaKey !== 'public' && betaKey !== 'none') {
        throw new Error(`Steam installed manifest still targets beta branch ${betaKey}.`);
    }
}

export function selectInactiveAcquisitionSlot(activeSlot) {
    return activeSlot === 'a' ? 'b' : 'a';
}

export function shouldAcquireSteamBuild(branchState, remoteBuildId) {
    return branchState?.acquiredBuildId !== String(remoteBuildId)
        || !FOXWATCH_MONITOR_SLOTS.includes(branchState?.activeSlot);
}

export function shouldRunFoxWatch(branchState, remoteBuildId, { forceRefresh = false } = {}) {
    return forceRefresh || branchState?.successfulBuildId !== String(remoteBuildId);
}

export function resolveVerifiedMonitorPakSource(state, receipt, expectedReceiptPath) {
    const selectedBranchValue = String(state?.selectedBranch ?? '').trim();
    const selectedBuildId = String(state?.selectedBuildId ?? '').trim();
    if (!selectedBranchValue && !selectedBuildId) {
        return null;
    }
    if (!selectedBranchValue || !/^\d+$/.test(selectedBuildId)) {
        throw new Error('FoxWatch monitor state has an incomplete selected Steam build.');
    }

    const branch = normalizeMonitorBranch(selectedBranchValue);
    const branchState = state?.branches?.[branch];
    if (branchState?.acquiredBuildId !== selectedBuildId
        || !FOXWATCH_MONITOR_SLOTS.includes(branchState?.activeSlot)
        || !branchState?.pakDirectory
        || !branchState?.pakFingerprint) {
        throw new Error(
            `FoxWatch monitor has selected ${branch} BuildID ${selectedBuildId}, but that build is not fully acquired and verified.`,
        );
    }
    if (!expectedReceiptPath
        || normalizeLocalPath(branchState.acquisitionReceiptPath) !== normalizeLocalPath(expectedReceiptPath)) {
        throw new Error(`FoxWatch monitor acquisition receipt path is inconsistent for ${branch} BuildID ${selectedBuildId}.`);
    }
    if (receipt?.schemaVersion !== FOXWATCH_MONITOR_SCHEMA_VERSION
        || receipt?.appId !== FOXHOLE_APP_ID
        || receipt?.branch !== branch
        || receipt?.buildId !== selectedBuildId
        || receipt?.slot !== branchState.activeSlot
        || normalizeLocalPath(receipt?.pakDirectory) !== normalizeLocalPath(branchState.pakDirectory)
        || receipt?.pakFingerprint !== branchState.pakFingerprint) {
        throw new Error(`FoxWatch monitor acquisition receipt is invalid for ${branch} BuildID ${selectedBuildId}.`);
    }

    return {
        branch,
        buildId: selectedBuildId,
        pakDirectory: branchState.pakDirectory,
        pakFingerprint: branchState.pakFingerprint,
    };
}

export function createPakInventoryFingerprint(entries) {
    const canonical = entries
        .map(entry => ({
            path: String(entry.path).replaceAll('\\', '/'),
            size: String(entry.size),
            mtimeNs: String(entry.mtimeNs),
        }))
        .sort((left, right) => left.path.localeCompare(right.path));
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function normalizeLocalPath(value) {
    return String(value ?? '').replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}

export function quoteSteamConsoleValue(value) {
    const normalized = String(value ?? '');
    if (/\r|\n|\0/.test(normalized)) {
        throw new Error('Steam credential contains unsupported control characters.');
    }
    return `"${normalized.replaceAll('"', '\\"')}"`;
}

export function redactSensitiveText(value, secrets) {
    let output = String(value ?? '');
    for (const secret of secrets ?? []) {
        if (secret) {
            output = output.replaceAll(String(secret), '[REDACTED]');
        }
    }
    return output;
}

export function validateDiscordWebhookUrl(value) {
    let url;
    try {
        url = new URL(String(value));
    } catch {
        throw new Error('Discord webhook URL is not a valid URL.');
    }
    if (url.protocol !== 'https:' || !['discord.com', 'discordapp.com'].includes(url.hostname.toLowerCase())) {
        throw new Error('Discord webhook URL must use HTTPS on discord.com.');
    }
    if (!/^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname)) {
        throw new Error('Discord webhook URL does not match the expected incoming webhook format.');
    }
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
}

export function createMonitorState(existing = null) {
    return {
        schemaVersion: FOXWATCH_MONITOR_SCHEMA_VERSION,
        branches: existing?.schemaVersion === FOXWATCH_MONITOR_SCHEMA_VERSION
            ? { ...existing.branches }
            : {},
        lastPollAt: existing?.lastPollAt ?? null,
        lastHeartbeatAt: existing?.lastHeartbeatAt ?? null,
    };
}

function parseNamedVdfObject(text, objectName) {
    const tokens = tokenizeVdf(text);
    for (let index = 0; index < tokens.length - 1; index += 1) {
        if (tokens[index] !== objectName || tokens[index + 1] !== '{') {
            continue;
        }
        const [value] = parseVdfObject(tokens, index + 2);
        return value;
    }
    throw new Error(`Unable to find VDF object ${objectName}.`);
}

function tokenizeVdf(text) {
    const tokens = [];
    const source = String(text ?? '');
    for (let index = 0; index < source.length;) {
        const character = source[index];
        if (/\s/.test(character)) {
            index += 1;
            continue;
        }
        if (character === '/' && source[index + 1] === '/') {
            index = source.indexOf('\n', index + 2);
            if (index < 0) break;
            continue;
        }
        if (character === '{' || character === '}') {
            tokens.push(character);
            index += 1;
            continue;
        }
        if (character !== '"') {
            index += 1;
            continue;
        }
        index += 1;
        let value = '';
        while (index < source.length) {
            const current = source[index];
            if (current === '"') {
                index += 1;
                break;
            }
            if (current === '\\' && index + 1 < source.length) {
                const next = source[index + 1];
                if (next === '\\' || next === '"') {
                    value += next;
                    index += 2;
                    continue;
                }
            }
            value += current;
            index += 1;
        }
        tokens.push(value);
    }
    return tokens;
}

function parseVdfObject(tokens, startIndex) {
    const value = {};
    let index = startIndex;
    while (index < tokens.length) {
        if (tokens[index] === '}') {
            return [value, index + 1];
        }
        const key = tokens[index];
        const next = tokens[index + 1];
        if (typeof key !== 'string' || next === undefined) {
            throw new Error('Malformed VDF object.');
        }
        if (next === '{') {
            const [child, childEnd] = parseVdfObject(tokens, index + 2);
            value[key] = child;
            index = childEnd;
        } else {
            value[key] = next;
            index += 2;
        }
    }
    throw new Error('Unterminated VDF object.');
}

function findObjectByKey(value, expectedKey) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    for (const [key, child] of Object.entries(value)) {
        if (key.toLowerCase() === expectedKey.toLowerCase() && child && typeof child === 'object') {
            return child;
        }
    }
    for (const child of Object.values(value)) {
        const match = findObjectByKey(child, expectedKey);
        if (match) return match;
    }
    return null;
}

function getObjectValue(value, key) {
    if (!value || typeof value !== 'object') return null;
    const match = Object.entries(value).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
    return match?.[1] && typeof match[1] === 'object' ? match[1] : null;
}

function getStringValue(value, key) {
    if (!value || typeof value !== 'object') return null;
    const match = Object.entries(value).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
    return typeof match?.[1] === 'string' ? match[1] : null;
}
