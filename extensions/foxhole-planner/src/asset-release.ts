import { parseNixieExperimentalAssetPackIndexV1, parseNixieExperimentalAssetPackV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import type { NixieExperimentalAssetPackEntryV1, NixieExperimentalAssetPackV1 } from '@nixie/extension-sdk';
export interface AssetReceipt { url: string; sha256: string; byteLength: number; }
export interface FoxholeAssetReleaseDocument {
    schemaVersion: 1;
    format: 'foxwatch-asset-release-v1';
    worldBaseUrl: string;
    packs: Record<string, { pack: NixieExperimentalAssetPackV1; mapping: AssetReceipt; }>;
    bootstrap: Record<string, Omit<AssetReceipt, 'url'> & { path: string; mediaType: string; }>;
}
export async function readPinnedAssetJson<T>(receipt: AssetReceipt, fetcher: typeof fetch = fetch): Promise<T> {
    parseNixieExperimentalAssetPackV1({ contractVersion: 1, id: 'metadata', manifest: receipt });
    const response = await fetcher(receipt.url, { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body) throw new Error('Pinned asset metadata is unavailable (' + response.status + ').');
    const reader = response.body.getReader(), output = new Uint8Array(receipt.byteLength);
    let offset = 0;
    try {
        while (true) {
            const { done, value } = await reader.read(); if (done) break;
            if (offset + value.length > output.length) throw new Error('Pinned metadata exceeds its receipt.');
            output.set(value, offset); offset += value.length;
        }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', output))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (offset !== output.length || hash !== receipt.sha256) throw new Error('Pinned asset metadata integrity mismatch.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(output)) as T;
}
export interface PublishedAssetLocation { url: string; entry: NixieExperimentalAssetPackEntryV1; }
export async function loadFoxholeAssetRelease(receipt: AssetReceipt, read = readPinnedAssetJson) {
    const release = await read<FoxholeAssetReleaseDocument>(receipt);
    if (release.schemaVersion !== 1 || release.format !== 'foxwatch-asset-release-v1') throw new Error('Unsupported FoxWatch asset release.');
    const base = new URL('./', receipt.url), world = new URL(release.worldBaseUrl);
    if (world.origin !== base.origin || !world.href.startsWith(base.href) || !world.pathname.endsWith('/') || world.search || world.hash) throw new Error('World assets escape the pinned release directory.');
    const files = new Map<string, PublishedAssetLocation>(), entries = new Map<string, NixieExperimentalAssetPackEntryV1>();
    for (const group of ['catalog', 'support', 'world-runtime']) {
        const descriptor = release.packs[group];
        if (!descriptor) throw new Error('Missing asset release group: ' + group);
        const pack = parseNixieExperimentalAssetPackV1(descriptor.pack);
        for (const url of [pack.manifest.url, descriptor.mapping.url]) if (!url.startsWith(base.href) || new URL(url).origin !== base.origin) throw new Error('Asset metadata escapes the release directory.');
        const [rawIndex, mapping] = await Promise.all([read<unknown>(pack.manifest), read<{ schemaVersion: number; files: Record<string, { path: string; }>; }>(descriptor.mapping)]);
        const index = parseNixieExperimentalAssetPackIndexV1(rawIndex), byPath = new Map(index.assets.map(entry => [entry.path, entry]));
        if (mapping.schemaVersion !== 1) throw new Error('Unsupported asset path mapping.');
        for (const entry of index.assets) entries.set(entry.path, entry);
        for (const [path, binding] of Object.entries(mapping.files)) {
            const entry = byPath.get(binding.path);
            if (!entry) throw new Error('Unindexed publication path: ' + path);
            const url = new URL(entry.sourcePath ?? entry.path, pack.manifest.url).href;
            const previous = files.get(path);
            if (previous && previous.entry.sha256 !== entry.sha256) throw new Error('Conflicting publication path: ' + path);
            files.set(path, { url, entry });
        }
    }
    const bootstrap = release.bootstrap['world/index.json'];
    if (!bootstrap || bootstrap.mediaType !== 'application/json') throw new Error('Missing world bootstrap index.');
    // Bootstrap paths use the same portable path contract as ordinary pack entries.
    parseNixieExperimentalAssetPackIndexV1({ contractVersion: 1, assets: [bootstrap] });
    const worldIndex = { url: new URL(bootstrap.path, base).href, sha256: bootstrap.sha256, byteLength: bootstrap.byteLength };
    return { release, files, entries, worldIndex, resolve(path: string) {
        const location = files.get(path);
        if (!location) throw new Error('Asset is absent from the pinned publication: ' + path);
        return location.url;
    } };
}
