#!/usr/bin/env node
/**
 * Map-mod .pak diagnostic harness.
 *
 * Usage:
 *   node ./tools/map-mod/run-map-mod-harness.mjs --pak "C:/path/to/mod.pak"
 *   node ./tools/map-mod/run-map-mod-harness.mjs --pak "...pak" --out tmp/map-mod-harness --limit 3 --write-dds
 *   node ./tools/map-mod/run-map-mod-harness.mjs --pak "...pak" --decode --limit 1
 *
 * --decode runs GPU BC7→PNG via Playwright Chromium when available.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    diagnoseMapModPak,
    getMapModFastDecodeMode,
    setMapModFastDecodeMode,
} from '../../app/plugins/foxhole/nixie/map/mod-pak.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const foxholeRoot = path.resolve(__dirname, '../..');

function printUsage() {
    console.log(`Map-mod pak harness

Options:
  --pak <path>       Required. Path to a Foxhole map-mod .pak
  --out <dir>        Output directory (default: tmp/map-mod-harness/<pak-stem>)
  --limit <n>        Only diagnose / decode the first N maps
  --write-dds        Write BC7 DDS samples for diagnosed maps
  --decode           Attempt GPU decode to PNG via Playwright Chromium
  --slow-decode      Disable FH fast-decode mode before --decode
  --help             Show this help
`);
}

function parseArgs(argv) {
    const options = {
        pak: null,
        out: null,
        limit: Infinity,
        writeDds: false,
        decode: false,
        slowDecode: false,
        help: false,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--write-dds') {
            options.writeDds = true;
            continue;
        }
        if (arg === '--decode') {
            options.decode = true;
            continue;
        }
        if (arg === '--slow-decode') {
            options.slowDecode = true;
            continue;
        }
        if (arg === '--pak') {
            options.pak = argv[++i] ?? null;
            continue;
        }
        if (arg === '--out') {
            options.out = argv[++i] ?? null;
            continue;
        }
        if (arg === '--limit') {
            const value = Number(argv[++i]);
            options.limit = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : Infinity;
            continue;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }

    return options;
}

async function tryDecodeWithPlaywright(report, outDir, { limit, slowDecode }) {
    let playwright;
    try {
        playwright = await import('playwright');
    } catch {
        console.warn('[map-mod-harness] Playwright is not installed; skipping --decode.');
        console.warn('  Install temporarily with: npm install -D playwright && npx playwright install chromium');
        return null;
    }

    if (slowDecode) {
        setMapModFastDecodeMode(false);
    }

    const browser = await playwright.chromium.launch({
        headless: true,
        args: [
            '--enable-unsafe-webgpu',
            '--enable-features=Vulkan,UseSkiaRenderer',
            '--ignore-gpu-blocklist',
        ],
    });

    try {
        const page = await browser.newPage();
        const modPakUrl = pathToFileURL(
            path.join(foxholeRoot, 'app/plugins/foxhole/nixie/map/mod-pak.js'),
        ).href;

        await page.addInitScript({
            content: `
                window.__MAP_MOD_HARNESS__ = {
                    modPakUrl: ${JSON.stringify(modPakUrl)},
                    fastDecode: ${JSON.stringify(!slowDecode)},
                };
            `,
        });

        await page.setContent(`<!doctype html><html><body>
<script type="module">
const { PakImporter, setMapModFastDecodeMode } = await import(window.__MAP_MOD_HARNESS__.modPakUrl);
setMapModFastDecodeMode(window.__MAP_MOD_HARNESS__.fastDecode === true);
window.__mapModDecode = async (arrayBuffer, limit) => {
  const importer = new PakImporter(arrayBuffer);
  const maps = importer.exportHexMaps({ skipDecode: true }).slice(0, limit);
  const results = [];
  for (const map of maps) {
    const started = performance.now();
    let blob = null;
    let error = null;
    try {
      blob = await importer.mapToPngBlob(map);
    } catch (err) {
      error = err?.message || String(err);
    }
    let pngBytes = null;
    if (blob) {
      pngBytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    }
    const meta = importer.extractGeneratorBc7PayloadMeta({ files: map.raw });
    results.push({
      region: map.region,
      assetPath: map.assetPath,
      ok: Boolean(blob),
      error,
      elapsedMs: Math.round(performance.now() - started),
      pngByteLength: pngBytes?.length ?? 0,
      pngBytes,
      payloadStart: meta?.start ?? null,
      payloadSource: meta?.source ?? null,
    });
  }
  return results;
};
window.__mapModReady = true;
</script>
</body></html>`, { waitUntil: 'domcontentloaded' });

        await page.waitForFunction(() => window.__mapModReady === true, null, { timeout: 30000 });

        const mapsToDecode = Math.min(
            Number.isFinite(limit) ? limit : report.maps.length,
            report.maps.length,
        );

        const decodeResults = await page.evaluate(async ({ bufferBytes, limit: decodeLimit }) => {
            const bytes = new Uint8Array(bufferBytes);
            return await window.__mapModDecode(bytes.buffer, decodeLimit);
        }, {
            bufferBytes: Array.from(new Uint8Array(report.__buffer)),
            limit: mapsToDecode,
        });

        const pngDir = path.join(outDir, 'png');
        await mkdir(pngDir, { recursive: true });
        const summary = [];
        for (const entry of decodeResults) {
            const safeName = String(entry.region || entry.assetPath || 'map')
                .replace(/[^a-zA-Z0-9_-]+/g, '_');
            if (entry.pngBytes?.length) {
                const pngPath = path.join(pngDir, `${safeName}.png`);
                await writeFile(pngPath, Buffer.from(entry.pngBytes));
                summary.push({
                    region: entry.region,
                    assetPath: entry.assetPath,
                    ok: true,
                    elapsedMs: entry.elapsedMs,
                    pngPath,
                    pngByteLength: entry.pngByteLength,
                    payloadStart: entry.payloadStart,
                    payloadSource: entry.payloadSource,
                });
            } else {
                summary.push({
                    region: entry.region,
                    assetPath: entry.assetPath,
                    ok: false,
                    error: entry.error,
                    elapsedMs: entry.elapsedMs,
                    payloadStart: entry.payloadStart,
                    payloadSource: entry.payloadSource,
                });
            }
        }

        await writeFile(
            path.join(outDir, 'decode-summary.json'),
            `${JSON.stringify({
                fastDecodeMode: getMapModFastDecodeMode(),
                count: summary.length,
                okCount: summary.filter(item => item.ok).length,
                entries: summary,
            }, null, 2)}\n`,
            'utf8',
        );

        return summary;
    } finally {
        await browser.close();
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help || !options.pak) {
        printUsage();
        process.exit(options.help ? 0 : 1);
    }

    const pakPath = path.resolve(options.pak);
    const pakStem = path.basename(pakPath, path.extname(pakPath));
    const outDir = path.resolve(
        options.out || path.join(foxholeRoot, 'tmp/map-mod-harness', pakStem),
    );
    await mkdir(outDir, { recursive: true });

    console.log(`[map-mod-harness] Reading ${pakPath}`);
    globalThis.__FOXHOLE_MAP_MOD_FORCE_LOG__ = true;
    const file = await readFile(pakPath);
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);

    const report = diagnoseMapModPak(buffer, {
        limit: options.limit,
        includeFingerprints: true,
    });
    report.__buffer = buffer;

    const serializable = {
        version: report.version,
        sourcePak: pakPath,
        fastDecodeMode: report.fastDecodeMode,
        generatorPayloadStartHint: report.generatorPayloadStartHint,
        bc7: report.bc7,
        mapCount: report.mapCount,
        diagnosedCount: report.diagnosedCount,
        startHistogram: report.startHistogram,
        entries: report.entries,
    };

    const diagnosticsPath = path.join(outDir, 'diagnostics.json');
    await writeFile(diagnosticsPath, `${JSON.stringify(serializable, null, 2)}\n`, 'utf8');
    console.log(`[map-mod-harness] Wrote ${diagnosticsPath}`);
    console.log(`[map-mod-harness] Maps: ${report.mapCount}, diagnosed: ${report.diagnosedCount}`);
    console.log('[map-mod-harness] Payload start histogram:', report.startHistogram);

    if (options.writeDds) {
        const ddsDir = path.join(outDir, 'dds');
        await mkdir(ddsDir, { recursive: true });
        for (let i = 0; i < report.diagnosedCount; i += 1) {
            const sample = report.buildDdsForEntry(i);
            if (!sample) {
                continue;
            }
            const safeName = String(sample.region || sample.assetPath || `map_${i}`)
                .replace(/[^a-zA-Z0-9_-]+/g, '_');
            const ddsPath = path.join(ddsDir, `${safeName}.dds`);
            await writeFile(ddsPath, sample.dds);
            console.log(`[map-mod-harness] DDS ${ddsPath} (start=${sample.start}, source=${sample.source})`);
        }
    }

    if (options.decode) {
        console.log(`[map-mod-harness] Decoding with fastDecode=${!options.slowDecode}…`);
        const summary = await tryDecodeWithPlaywright(report, outDir, {
            limit: options.limit,
            slowDecode: options.slowDecode,
        });
        if (summary) {
            const ok = summary.filter(item => item.ok).length;
            console.log(`[map-mod-harness] Decoded ${ok}/${summary.length} PNGs into ${path.join(outDir, 'png')}`);
        }
    }

    console.log('[map-mod-harness] Done.');
}

main().catch(error => {
    console.error('[map-mod-harness] Failed:', error);
    process.exit(1);
});
