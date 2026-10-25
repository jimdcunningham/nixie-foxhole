import {openRetainedWorldCache} from './cache-retention.mjs';
const inflight = new Map();
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
export const compactResourceCacheKey = ref => 'https://foxhole-world-resource.invalid/sha256/' + ref.decodedHash;
async function bounded(response, maximum = 512 * 1024 ** 2) {
    const chunks = []; let size = 0;
    try {
        for await (const chunk of response.body ?? []) {size += chunk.length; if (size > maximum) throw Error('World resource exceeds decoded budget'); chunks.push(chunk);}
    } finally {void response.body?.cancel().catch(() => {});}
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
    return bytes.buffer;
}
export async function fetchCompactResource(base, ref, {signal, metrics, fetcher = fetch, cachesApi = globalThis.caches, now = Date.now} = {}) {
    const path = /^content\/(br|raw)\/([a-f0-9]{64})\/asset\.[a-z0-9]+$/.exec(ref.path);
    if (!path || ref.hash !== path[2] || !/^[a-f0-9]{64}$/.test(ref.decodedHash)) throw Error('Invalid compact resource');
    signal?.throwIfAborted(); const url = new URL(ref.path, base).href, key = compactResourceCacheKey(ref);
    let task = inflight.get(key);
    if (!task) {
        task = (async () => {
            const cache = await openRetainedWorldCache('foxhole-world-compact-v1', {cachesApi, now});
            // Old URL-keyed entries can be reused after verification, then addressed by decoded identity.
            let cached = await cache?.match(key).catch(() => null); const legacy = !cached;
            cached ??= await cache?.match(url).catch(() => null);
            if (cached) {
                const retained = cached.clone();
                try {
                    const bytes = await bounded(cached.headers.get('X-Foxhole-Compression') === 'gzip'
                        ? new Response(cached.body.pipeThrough(new DecompressionStream('gzip'))) : cached);
                    if (await hash(bytes) === ref.decodedHash) {
                        try {if (legacy) {await cache.put(key, retained); await cache.delete(url);}} catch {}
                        if (metrics) metrics.cacheHits++; return bytes;
                    }
                } catch {} finally {void retained.body?.cancel().catch(() => {});}
                await cache.delete(key).catch(() => {}); await cache.delete(url).catch(() => {});
            }
            let response;
            try {response = await fetcher(url);} catch (error) {throw new Error('Could not fetch world resource ' + url, {cause:error});}
            if (!response.ok) {void response.body?.cancel().catch(() => {}); throw Error('World resource ' + response.status);}
            const bytes = await bounded(response);
            if (await hash(bytes) !== ref.decodedHash) throw Error('World resource integrity failure; check Content-Encoding headers');
            if (metrics) {metrics.cacheMisses++; metrics.downloadBytes += ref.bytes;}
            try {
                await cache?.put(key, ref.encoding === 'br' ? new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')), {headers:{'X-Foxhole-Compression':'gzip'}}) : new Response(bytes));
            } catch {if (metrics) metrics.cacheWriteFailures++;}
            return bytes;
        })().finally(() => inflight.delete(key));
        inflight.set(key, task);
    }
    const bytes = await task; signal?.throwIfAborted(); return bytes;
}
