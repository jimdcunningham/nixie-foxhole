import fs from 'node:fs';
import path from 'node:path';

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getAssetById(manifest) {
    const byId = new Map();
    for (const asset of manifest?.assets ?? []) {
        if (!asset?.id) {
            continue;
        }
        byId.set(String(asset.id), asset);
    }
    return byId;
}

function socketSummary(asset) {
    const buildSockets = asset?.buildSockets ?? [];
    const sockets = Array.isArray(buildSockets) ? buildSockets : [];
    const names = new Set(sockets.map(s => String(s?.n ?? s?.name ?? '').trim()).filter(Boolean));
    return {
        total: sockets.length,
        names,
    };
}

function parseCliArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i += 1) {
        const a = argv[i];
        if (!a.startsWith('--')) {
            continue;
        }

        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
            args[key] = next;
            i += 1;
        } else {
            args[key] = true;
        }
    }
    return args;
}

const args = parseCliArgs(process.argv);

const baselinePath = args.baseline;
const currentPath = args.current;
const limit = Number(args.limit ?? 50);

if (!baselinePath || !currentPath) {
    console.error('Usage: node ./tools/foxwatch/scripts/audit-build-sockets.mjs --baseline <path> --current <path> [--limit <n>]');
    process.exit(1);
}

const baselineManifestPath = path.resolve(process.cwd(), baselinePath);
const currentManifestPath = path.resolve(process.cwd(), currentPath);

const baselineManifest = readJson(baselineManifestPath);
const currentManifest = readJson(currentManifestPath);

const baselineById = getAssetById(baselineManifest);
const currentById = getAssetById(currentManifest);

const baselineAssetIds = new Set(baselineById.keys());
const currentAssetIds = new Set(currentById.keys());
const allIds = new Set([...baselineAssetIds, ...currentAssetIds]);

let baselineHasSockets = 0;
let currentHasSockets = 0;
let baselineMissingButCurrentHas = 0;
let baselineHasButCurrentMissing = 0;

const missingList = [];
const purgedList = [];

for (const id of allIds) {
    const baseline = baselineById.get(id);
    const current = currentById.get(id);

    const baselineSummary = socketSummary(baseline ?? { buildSockets: [] });
    const currentSummary = socketSummary(current ?? { buildSockets: [] });

    const baselineHas = baselineSummary.total > 0;
    const currentHas = currentSummary.total > 0;

    if (baselineHas) {
        baselineHasSockets += 1;
    }
    if (currentHas) {
        currentHasSockets += 1;
    }

    if (!baselineHas && currentHas) {
        baselineMissingButCurrentHas += 1;
        missingList.push({
            id,
            baselineCount: baselineSummary.total,
            currentCount: currentSummary.total,
        });
    }

    if (baselineHas && !currentHas) {
        baselineHasButCurrentMissing += 1;
        purgedList.push({
            id,
            baselineCount: baselineSummary.total,
            currentCount: currentSummary.total,
        });
    }
}

missingList.sort((a, b) => b.currentCount - a.currentCount);
purgedList.sort((a, b) => b.baselineCount - a.baselineCount);

console.log('BuildSockets audit');
console.log(`- baseline: ${baselineManifestPath}`);
console.log(`- current:  ${currentManifestPath}`);
console.log('');
console.log(`Summary:`);
console.log(`- baseline assets with buildSockets: ${baselineHasSockets}`);
console.log(`- current assets with buildSockets:  ${currentHasSockets}`);
console.log(`- baseline missing but current has:  ${baselineMissingButCurrentHas}`);
console.log(`- baseline has but current missing:  ${baselineHasButCurrentMissing}`);
console.log('');

if (missingList.length > 0) {
    console.log(`Assets where baseline is missing sockets but current has them (top ${limit}):`);
    for (const entry of missingList.slice(0, limit)) {
        console.log(`- ${entry.id}: baseline ${entry.baselineCount}, current ${entry.currentCount}`);
    }
    console.log('');
}

if (purgedList.length > 0) {
    console.log(`Assets where baseline had sockets but current is missing them (top ${limit}):`);
    for (const entry of purgedList.slice(0, limit)) {
        console.log(`- ${entry.id}: baseline ${entry.baselineCount}, current ${entry.currentCount}`);
    }
    console.log('');
}

