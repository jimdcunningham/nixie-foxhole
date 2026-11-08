import { strToU8, zipSync } from 'fflate';
import { buildMapPak, encodeBc7 } from './deadlands-pak-export.mjs';
import textureTemplates from './full-map-texture-templates.json';
import type { RegionBakeLoadProfile } from './region-bake.ts';

const width = 2048;
const height = 1776;
const payloadSize = width * height;
// Bump when the bake renderer, mask, or BC7 output changes.
const recoveryCacheName = 'nixie.foxhole.full-map-bake.v1';

export async function clearFoxholeFullMapBakeCache(): Promise<void> {
    await globalThis.caches?.delete(recoveryCacheName);
}

async function hashInputs(inputs: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(inputs));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readRecoveredTile(cache: Cache, key: string, signature: string) {
    try {
        const response = await cache.match(key);
        if (response?.headers.get('x-bake-signature') !== signature) return null;
        const bytes = new Uint8Array(await response.arrayBuffer());
        const pngSize = bytes.length - payloadSize;
        if (pngSize <= 8 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return null;
        return { png: bytes.subarray(0, pngSize), bc7: bytes.subarray(pngSize) };
    } catch {
        return null;
    }
}

const templateFooterSize = 28;
// Cooked 2K texture headers and footers from the verified Nixie full map export.
// The bundled metadata contains no BC7 payloads.
const templates = new Map(Object.entries(textureTemplates).map(([key, metadata]) =>
    [key.toLowerCase(), { key, metadata }] as const));

function buildTextureEntry(template: { key: string; metadata: string }, bc7: Uint8Array) {
    const metadata = Uint8Array.from(atob(template.metadata), char => char.charCodeAt(0));
    const headerSize = metadata.length - templateFooterSize;
    const data = new Uint8Array(metadata.length + payloadSize);
    data.set(metadata.subarray(0, headerSize));
    data.set(bc7, headerSize);
    data.set(metadata.subarray(headerSize), headerSize + payloadSize);
    return { path: 'War/Content/Textures/UI/HexMaps/Processed/' + template.key + '.uasset', data };
}

export async function exportFoxholeFullMap(
    regions: readonly { key: string; textureKey: string; name: string }[],
    bake: (key: string, onStage: (stage: string) => void) => Promise<{ png: Blob; loadProfile?: RegionBakeLoadProfile }>,
    signal: AbortSignal,
    onProgress: (message: string, processed: number, total: number, region?: string) => void,
    cacheInputs: (key: string) => string | undefined,
    catalogInputs: string,
) {
    if (!regions.length) throw new Error('The world has no map regions.');
    const started = performance.now();
    const missing = regions.filter(region => !templates.has(region.textureKey.toLowerCase()));
    if (missing.length) throw new Error('Missing bundled 2K texture templates for: ' + missing.map(region => region.name).join(', '));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not read the baked map pixels.');
    const cache = typeof caches === 'undefined' ? null : await caches.open(recoveryCacheName).catch(() => null);
    const catalogSignature = cache ? await hashInputs(catalogInputs) : '';
    const entries = [];
    const pngs: Record<string, Uint8Array<ArrayBuffer>> = {};
    const setupMs = Math.round(performance.now() - started);
    const timings = [];
    for (const [index, region] of regions.entries()) {
        signal.throwIfAborted();
        const regionStarted = performance.now();
        const template = templates.get(region.textureKey.toLowerCase())!;
        const inputs = cache ? cacheInputs(region.key) : undefined;
        const signature = inputs ? await hashInputs(JSON.stringify([catalogSignature, inputs])) : undefined;
        const cacheKey = new URL('/__nixie/foxhole/full-map-bake/' + encodeURIComponent(region.key), location.href).href;
        const recovered = cache && signature ? await readRecoveredTile(cache, cacheKey, signature) : null;
        signal.throwIfAborted();
        if (recovered && cacheInputs(region.key) === inputs) {
            onProgress('Reusing saved bake', index + 1, regions.length, region.name);
            entries.push(buildTextureEntry(template, recovered.bc7));
            pngs[region.textureKey + '.png'] = recovered.png;
            timings.push({ region: region.name, textureKey: region.textureKey, totalMs: Math.round(performance.now() - regionStarted), recovered: true });
            continue;
        }
        let phaseStarted = regionStarted;
        let phase = 'load';
        const stagesMs: Record<string, number> = {};
        function enterPhase(next: string) {
            const now = performance.now();
            stagesMs[phase] = Math.round(now - phaseStarted);
            phase = next;
            phaseStarted = now;
        }
        const { png, loadProfile } = await bake(region.key, stage => {
            if (stage === 'Rendering') enterPhase('render');
            if (stage === 'Writing PNG') enterPhase('png');
            if (stage === 'Releasing renderer resources') enterPhase('release');
            onProgress(stage, index, regions.length, region.name);
        });
        enterPhase('bc7');
        onProgress('Encoding BC7', index, regions.length, region.name);
        signal.throwIfAborted();
        const bitmap = await createImageBitmap(png);
        try {
            if (bitmap.width !== width || bitmap.height !== height) throw new Error('Unexpected bake size for ' + region.name);
            context.clearRect(0, 0, width, height);
            context.drawImage(bitmap, 0, 0);
        } finally {
            bitmap.close();
        }
        const pixels = context.getImageData(0, 0, width, height).data;
        if (!pixels.some((value, index) => index % 4 === 3 && value !== 0)) {
            throw new Error('Empty region bake for ' + region.name);
        }
        const bc7 = encodeBc7(pixels);
        if (bc7.byteLength !== payloadSize) throw new Error('Unexpected BC7 size for ' + region.name);
        entries.push(buildTextureEntry(template, bc7));
        const pngBytes = new Uint8Array(await png.arrayBuffer());
        pngs[region.textureKey + '.png'] = pngBytes;
        if (cache && signature && cacheInputs(region.key) === inputs) {
            enterPhase('save');
            await cache.put(cacheKey, new Response(new Blob([png, Uint8Array.from(bc7)]), {
                headers: { 'x-bake-signature': signature },
            })).catch(error => console.warn('[foxhole:map-bake] Could not save recovery tile:', error));
        }
        enterPhase('done');
        timings.push({ region: region.name, textureKey: region.textureKey, totalMs: Math.round(performance.now() - regionStarted), stagesMs, loadProfile });
        await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    signal.throwIfAborted();
    onProgress('Packaging Pak and PNGs…', regions.length, regions.length);
    const packagingStarted = performance.now();
    const pak = await buildMapPak(entries);
    signal.throwIfAborted();
    // PNG data is already compressed.
    const report = { width, height, supersampling: 2, setupMs, pakPackagingMs: Math.round(performance.now() - packagingStarted), regions: timings };
    pngs['bake-timings.json'] = strToU8(JSON.stringify(report, null, 2));
    const archive = new Blob([Uint8Array.from(zipSync(pngs, { level: 0 }))], { type: 'application/zip' });
    return { pak, archive, elapsedMs: Math.round(performance.now() - started) };
}
