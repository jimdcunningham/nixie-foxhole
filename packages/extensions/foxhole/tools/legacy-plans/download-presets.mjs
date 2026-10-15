import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import LZMA from '../../app/plugins/foxhole/legacy/lzma-browser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const FIXTURES_DIR = path.join(ROOT, 'tests/fixtures/legacy-plans');
const RAW_DIR = path.join(FIXTURES_DIR, 'raw');
const EXTRACTED_DIR = path.join(FIXTURES_DIR, 'extracted');
const MANIFEST_PATH = path.join(FIXTURES_DIR, 'manifest.json');
const DEFAULT_PRESET_MAP_PATH = path.join(__dirname, 'preset-map.json');
const DEFAULT_SUPABASE_URL = 'https://ifctwudzlrbveneapsau.supabase.co';
const DEFAULT_GAME_KITCHEN = process.env.GAME_KITCHEN_PATH || 'C:/Code/game-kitchen';
const PAGE_SIZE = 1000;

function parseArgs(argv) {
    const options = {
        gameKitchen: DEFAULT_GAME_KITCHEN,
        /** @type {'all' | 'presets'} */
        source: 'all',
        /** @type {'all' | 'public' | 'unlisted'} */
        privacy: 'all',
        only: null,
        limit: null,
        force: false,
        extract: true,
        concurrency: 4,
        retries: 6,
        presetMapPath: DEFAULT_PRESET_MAP_PATH,
        supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL,
        supabaseKey: process.env.NUXT_PUBLIC_SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '',
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--force') {
            options.force = true;
        } else if (arg === '--no-extract') {
            options.extract = false;
        } else if (arg === '--game-kitchen') {
            options.gameKitchen = argv[++i];
        } else if (arg === '--source') {
            const value = String(argv[++i] || '').trim();
            if (value !== 'all' && value !== 'presets') {
                throw new Error(`Invalid --source ${value} (expected all|presets)`);
            }
            options.source = value;
        } else if (arg === '--privacy') {
            const value = String(argv[++i] || '').trim();
            if (value !== 'all' && value !== 'public' && value !== 'unlisted') {
                throw new Error(`Invalid --privacy ${value} (expected all|public|unlisted)`);
            }
            options.privacy = value;
        } else if (arg === '--only') {
            options.only = String(argv[++i] || '')
                .split(',')
                .map(value => value.trim())
                .filter(Boolean);
        } else if (arg === '--limit') {
            options.limit = Number(argv[++i]);
        } else if (arg === '--concurrency') {
            options.concurrency = Math.max(1, Number(argv[++i]) || 4);
        } else if (arg === '--retries') {
            options.retries = Math.max(0, Number(argv[++i]) || 0);
        } else if (arg === '--preset-map') {
            options.presetMapPath = path.resolve(argv[++i]);
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        }
    }

    return options;
}

function printHelp() {
    console.log(`Usage: node tools/legacy-plans/download-presets.mjs [options]

Downloads legacy Foxhole blueprint zips from the public Supabase blueprints
storage URLs. The storage bucket cannot be listed with the anon key, so the
catalog comes from the blueprints table (each row points at
blueprints/{id}/versions/{version}.zip).

Options:
  --source all|presets    all foxhole blueprints (default) or presetMap only
  --privacy all|public|unlisted
                          filter when --source=all (default: all)
  --game-kitchen <path>   Path to game-kitchen repo (for presetMap extract)
  --preset-map <path>     Preset map JSON (default: tools/legacy-plans/preset-map.json)
  --only <keys|ids>       Comma-separated preset keys and/or blueprint ids
  --limit <n>             Download at most N blueprints
  --concurrency <n>       Parallel downloads (default: 4)
  --retries <n>           Retries on 429/5xx (default: 6)
  --force                 Re-download even if zip exists
  --no-extract            Skip writing extracted project JSON
  --help                  Show this help

Environment:
  NUXT_PUBLIC_SUPABASE_URL   Supabase project URL
  NUXT_PUBLIC_SUPABASE_KEY   Supabase anon key
`);
}

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return;
    }
    const text = fs.readFileSync(filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const eq = trimmed.indexOf('=');
        if (eq <= 0) {
            continue;
        }
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) {
            process.env[key] = value;
        }
    }
}

function extractPresetMapFromGameKitchen(gameKitchenPath) {
    const dataPath = path.join(gameKitchenPath, 'app/plugins/foxhole/data.js');
    if (!fs.existsSync(dataPath)) {
        throw new Error(`game-kitchen data.js not found at ${dataPath}`);
    }
    const src = fs.readFileSync(dataPath, 'utf8');
    const pm = src.match(/"presetMap"\s*:\s*\{([\s\S]*?)\n\t\},/);
    if (!pm) {
        throw new Error('Could not locate presetMap in game-kitchen data.js');
    }
    const presetMap = {};
    for (const m of pm[1].matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)) {
        presetMap[m[1]] = m[2];
    }
    return presetMap;
}

function loadPresetMap(options) {
    if (fs.existsSync(options.presetMapPath)) {
        return JSON.parse(fs.readFileSync(options.presetMapPath, 'utf8'));
    }
    console.log(`preset-map.json missing; extracting from ${options.gameKitchen}`);
    const presetMap = extractPresetMapFromGameKitchen(options.gameKitchen);
    fs.mkdirSync(path.dirname(options.presetMapPath), { recursive: true });
    fs.writeFileSync(options.presetMapPath, `${JSON.stringify(presetMap, null, '\t')}\n`);
    return presetMap;
}

function invertPresetMap(presetMap) {
    /** @type {Record<string, string>} */
    const byId = {};
    for (const [key, id] of Object.entries(presetMap)) {
        byId[String(id)] = key;
    }
    return byId;
}

function fixtureFileName(blueprintId, presetKeyById) {
    const presetKey = presetKeyById[blueprintId];
    if (presetKey) {
        return `${presetKey}.zip`;
    }
    return `bp-${blueprintId}.zip`;
}

async function fetchAllBlueprints(supabaseUrl, supabaseKey, privacy) {
    /** @type {Array<{ id: string; name: string; version: string; privacy: string | null; approved: boolean | null; }>} */
    const rows = [];
    let offset = 0;

    while (true) {
        const params = new URLSearchParams();
        params.set('select', 'id,name,version,privacy,approved');
        params.set('game', 'eq.foxhole');
        params.set('version', 'not.is.null');
        params.set('deleted_at', 'is.null');
        params.set('order', 'created_at.asc');
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', String(offset));
        if (privacy === 'public' || privacy === 'unlisted') {
            params.set('privacy', `eq.${privacy}`);
        }

        const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/blueprints?${params}`, {
            headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
                Accept: 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`Failed to list blueprints: ${response.status} ${response.statusText}`);
        }
        const page = await response.json();
        if (!Array.isArray(page) || page.length === 0) {
            break;
        }
        for (const row of page) {
            if (row?.id && row?.version) {
                rows.push({
                    id: String(row.id),
                    name: String(row.name ?? row.id),
                    version: String(row.version),
                    privacy: row.privacy ?? null,
                    approved: row.approved ?? null,
                });
            }
        }
        if (page.length < PAGE_SIZE) {
            break;
        }
        offset += PAGE_SIZE;
    }

    return rows;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
    return status === 429 || status === 408 || status >= 500;
}

async function downloadZip(url, destinationPath, retries = 6) {
    let attempt = 0;
    while (true) {
        const response = await fetch(url);
        if (response.ok) {
            const buffer = Buffer.from(await response.arrayBuffer());
            fs.writeFileSync(destinationPath, buffer);
            return buffer;
        }

        const retryable = isRetryableStatus(response.status);
        if (!retryable || attempt >= retries) {
            throw new Error(`Download failed ${response.status} ${response.statusText}: ${url}`);
        }

        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterMs = retryAfterHeader && Number.isFinite(Number(retryAfterHeader))
            ? Number(retryAfterHeader) * 1000
            : 0;
        const backoffMs = Math.max(retryAfterMs, Math.min(30_000, 750 * (2 ** attempt)))
            + Math.floor(Math.random() * 250);
        attempt += 1;
        console.warn(`retry ${attempt}/${retries} after ${response.status} (${backoffMs}ms): ${path.basename(destinationPath)}`);
        await sleep(backoffMs);
    }
}

async function extractProjectJson(zipBuffer) {
    const zip = await JSZip.loadAsync(zipBuffer);
    const lzmaFile = zip.file('project.lzma');
    const jsonFile = zip.file('project.json');
    let text;
    if (lzmaFile) {
        const bytes = await lzmaFile.async('uint8array');
        text = LZMA.decompress(bytes);
        if (typeof text !== 'string') {
            throw new Error('Unexpected LZMA decompress result');
        }
    } else if (jsonFile) {
        text = await jsonFile.async('string');
    } else {
        throw new Error('Archive missing project.lzma and project.json');
    }
    return JSON.parse(text);
}

async function mapPool(items, concurrency, worker) {
    let index = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (index < items.length) {
            const current = index;
            index += 1;
            await worker(items[current], current);
        }
    });
    await Promise.all(workers);
}

async function main() {
    loadEnvFile(path.join(ROOT, '.env'));
    loadEnvFile(path.join(DEFAULT_GAME_KITCHEN, '.env'));

    const options = parseArgs(process.argv.slice(2));
    options.supabaseKey = options.supabaseKey
        || process.env.NUXT_PUBLIC_SUPABASE_KEY
        || process.env.SUPABASE_ANON_KEY
        || '';
    options.supabaseUrl = options.supabaseUrl
        || process.env.NUXT_PUBLIC_SUPABASE_URL
        || DEFAULT_SUPABASE_URL;

    if (!options.supabaseKey) {
        console.error('Missing NUXT_PUBLIC_SUPABASE_KEY (or SUPABASE_ANON_KEY). Load from apps/nixie-studio/.env or game-kitchen/.env.');
        process.exit(1);
    }

    fs.mkdirSync(RAW_DIR, { recursive: true });
    if (options.extract) {
        fs.mkdirSync(EXTRACTED_DIR, { recursive: true });
    }

    const presetMap = loadPresetMap(options);
    const presetKeyById = invertPresetMap(presetMap);

    /** @type {Array<{ id: string; name: string; version: string; privacy: string | null; approved: boolean | null; presetKey: string | null; fileName: string; }>} */
    let entries = [];

    if (options.source === 'presets') {
        entries = Object.entries(presetMap).map(([presetKey, blueprintId]) => ({
            id: String(blueprintId),
            name: presetKey,
            version: '',
            privacy: null,
            approved: null,
            presetKey,
            fileName: `${presetKey}.zip`,
        }));
    } else {
        console.log(`Fetching foxhole blueprints catalog (privacy=${options.privacy})…`);
        const rows = await fetchAllBlueprints(options.supabaseUrl, options.supabaseKey, options.privacy);
        entries = rows.map(row => ({
            ...row,
            presetKey: presetKeyById[row.id] ?? null,
            fileName: fixtureFileName(row.id, presetKeyById),
        }));
        console.log(`Cataloged ${entries.length} blueprint(s)`);
    }

    if (options.only?.length) {
        const onlySet = new Set(options.only);
        entries = entries.filter(entry => (
            onlySet.has(entry.id)
            || (entry.presetKey && onlySet.has(entry.presetKey))
            || onlySet.has(entry.fileName.replace(/\.zip$/u, ''))
        ));
    }
    if (Number.isFinite(options.limit) && options.limit > 0) {
        entries = entries.slice(0, options.limit);
    }

    // Resolve missing versions for preset-only mode.
    if (options.source === 'presets') {
        for (const entry of entries) {
            if (entry.version) {
                continue;
            }
            const params = new URLSearchParams({
                select: 'id,name,version,privacy,approved',
                id: `eq.${entry.id}`,
            });
            const response = await fetch(`${options.supabaseUrl.replace(/\/$/, '')}/rest/v1/blueprints?${params}`, {
                headers: {
                    apikey: options.supabaseKey,
                    Authorization: `Bearer ${options.supabaseKey}`,
                    Accept: 'application/json',
                },
            });
            if (!response.ok) {
                throw new Error(`Failed to resolve blueprint ${entry.id}: ${response.status}`);
            }
            const rows = await response.json();
            const row = Array.isArray(rows) ? rows[0] : null;
            if (!row?.version) {
                throw new Error(`Blueprint ${entry.id} has no version`);
            }
            entry.version = String(row.version);
            entry.name = String(row.name ?? entry.name);
            entry.privacy = row.privacy ?? null;
            entry.approved = row.approved ?? null;
        }
    }

    console.log(`Downloading ${entries.length} blueprint(s) → ${RAW_DIR} (concurrency=${options.concurrency})`);

    let downloaded = 0;
    let skipped = 0;
    let failed = 0;
    /** @type {Array<Record<string, unknown>>} */
    const manifestEntries = [];

    await mapPool(entries, options.concurrency, async entry => {
        const zipPath = path.join(RAW_DIR, entry.fileName);
        const manifestEntry = {
            id: entry.id,
            name: entry.name,
            version: entry.version,
            privacy: entry.privacy,
            approved: entry.approved,
            presetKey: entry.presetKey,
            fileName: entry.fileName,
        };

        if (fs.existsSync(zipPath) && !options.force) {
            skipped += 1;
            manifestEntries.push({ ...manifestEntry, status: 'skipped' });
            console.log(`skip  ${entry.fileName}`);
            return;
        }

        try {
            const url = `${options.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/blueprints/${entry.id}/versions/${entry.version}.zip`;
            const buffer = await downloadZip(url, zipPath, options.retries);
            downloaded += 1;
            console.log(`ok    ${entry.fileName} (${buffer.length} bytes) — ${entry.name}`);

            if (options.extract) {
                const projectJson = await extractProjectJson(buffer);
                const jsonName = entry.fileName.replace(/\.zip$/iu, '.json');
                fs.writeFileSync(
                    path.join(EXTRACTED_DIR, jsonName),
                    `${JSON.stringify(projectJson, null, '\t')}\n`,
                );
            }
            manifestEntries.push({ ...manifestEntry, status: 'downloaded', bytes: buffer.length });
        } catch (error) {
            failed += 1;
            const message = error instanceof Error ? error.message : String(error);
            console.error(`fail  ${entry.fileName}: ${message}`);
            manifestEntries.push({ ...manifestEntry, status: 'failed', error: message });
        }
    });

    manifestEntries.sort((a, b) => String(a.fileName).localeCompare(String(b.fileName)));
    fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        source: options.source,
        privacy: options.privacy,
        count: manifestEntries.length,
        downloaded,
        skipped,
        failed,
        entries: manifestEntries,
    }, null, '\t')}\n`);

    console.log(`Done. downloaded=${downloaded} skipped=${skipped} failed=${failed}`);
    console.log(`Wrote ${MANIFEST_PATH}`);
    if (failed > 0) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
