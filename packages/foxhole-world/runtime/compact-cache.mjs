import {readCompactBundle,CompactBundleError} from './compact-bundles.mjs';
import {openRetainedWorldCache} from './cache-retention.mjs';
import {boundedByteStream} from './bounded-byte-stream.mjs';
import {createResourceTimingObserver} from './terrain-network-observation.mjs';
const observeResourceTiming=createResourceTimingObserver();
const inflight = new Map();
// Optional resources may recover only from known transport or integrity
// failures, not arbitrary programming errors or allocation failures.
export class WorldResourceError extends Error {
    constructor(message, kind, options) {super(message, options); this.name='WorldResourceError'; this.kind=kind;}
}
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
export async function fetchCompactResource(base, ref, {signal, metrics, onNetwork, fetcher = fetch, cachesApi = globalThis.caches, now = Date.now} = {}) {
    const path = /^content\/(br|raw)\/([a-f0-9]{64})\/asset\.[a-z0-9]+$/.exec(ref.path);
    if (!path || ref.hash !== path[2] || !/^[a-f0-9]{64}$/.test(ref.decodedHash)) throw Error('Invalid compact resource');
    signal?.throwIfAborted(); const url = new URL(ref.path, base).href, key = compactResourceCacheKey(ref);
    let request = inflight.get(key);
    if (!request) {
        request = {waiters:0, observers:new Set(), controller:new AbortController(), settled:false};
        request.task = (async () => {
            const cache = await openRetainedWorldCache('foxhole-world-compact-v1', {cachesApi, now});
            request.controller.signal.throwIfAborted();
            // Old URL-keyed entries can be reused after verification, then addressed by decoded identity.
            let cached = await cache?.match(key).catch(() => null);
            if(request.controller.signal.aborted){void cached?.body?.cancel().catch(()=>{});throw request.controller.signal.reason;}
            const legacy = !cached;
            cached ??= await cache?.match(url).catch(() => null);
            if(request.controller.signal.aborted){void cached?.body?.cancel().catch(()=>{});throw request.controller.signal.reason;}
            if (cached) {
                const retained = legacy ? cached.clone() : null;
                try {
                    const bytes = await bounded(cached.headers.get('X-Foxhole-Compression') === 'gzip'
                        ? new Response(cached.body.pipeThrough(new DecompressionStream('gzip'))) : cached);
                    if (await hash(bytes) === ref.decodedHash) {
                        request.controller.signal.throwIfAborted();
                        try {if (legacy && await cache.put(key, retained)) {request.controller.signal.throwIfAborted();await cache.delete(url);}} catch (error) {if(request.controller.signal.aborted)throw request.controller.signal.reason;}
                        request.controller.signal.throwIfAborted();
                        if (metrics) metrics.cacheHits++; return bytes;
                    }
                } catch (error) {if (request.controller.signal.aborted) throw request.controller.signal.reason;} finally {void retained?.body?.cancel().catch(() => {});}
                request.controller.signal.throwIfAborted();
                await cache.delete(key).catch(() => {}); request.controller.signal.throwIfAborted();
                await cache.delete(url).catch(() => {}); request.controller.signal.throwIfAborted();
            }
            if(ref.bundle && cache){
                try{return await readCompactBundle(base,ref,{cache,signal:request.controller.signal,fetcher,metrics,onNetwork:event=>{request.observation=event;for(const notify of request.observers)try{notify(event);}catch{}}});}
                catch(error){request.controller.signal.throwIfAborted();if(!(error instanceof CompactBundleError))throw error;if(metrics)metrics.bundleFallbacks=(metrics.bundleFallbacks||0)+1;}
            }
            let response, bytes, timing; try {timing=observeResourceTiming.start(url);} catch {}
            try {
                try {response = await fetcher(url,{signal:request.controller.signal});} catch (error) {
                    if (request.controller.signal.aborted) throw request.controller.signal.reason;
                    const message='Could not fetch world resource ' + url;
                    if (error?.name==='TypeError' || error?.name==='NetworkError') throw new WorldResourceError(message,'unavailable',{cause:error});
                    throw new Error(message,{cause:error});
                }
                if(request.controller.signal.aborted){try{await response?.body?.cancel();}catch{}throw request.controller.signal.reason;}
                if (!response.ok) {try{await response.body?.cancel();}catch{}throw new WorldResourceError('World resource ' + response.status,'unavailable');}
                bytes = await bounded(response);
                request.controller.signal.throwIfAborted();
            } finally {
                if (timing) try {
                    const observation=observeResourceTiming.finish(timing,request.observers.size>0);
                    if(observation){request.observation=observation;for(const notify of request.observers)try{notify(observation);}catch{}}
                } catch {}
            }
            if (await hash(bytes) !== ref.decodedHash) throw new WorldResourceError('World resource integrity failure; check Content-Encoding headers','integrity');
            request.controller.signal.throwIfAborted();
            if (metrics) {metrics.cacheMisses++; metrics.downloadBytes += ref.bytes;}
            try {
                await cache?.put(key, ref.encoding === 'br' ? new Response(boundedByteStream(bytes).pipeThrough(new CompressionStream('gzip')), {headers:{'X-Foxhole-Compression':'gzip'}}) : new Response(boundedByteStream(bytes)));
            } catch {if (metrics) metrics.cacheWriteFailures++;}
            return bytes;
        })().finally(() => {request.settled=true;if(inflight.get(key)===request)inflight.delete(key);});
        inflight.set(key, request);
    }
    request.waiters++;
    // Use one observer per subscriber so identical callbacks remain independent.
    const observer=onNetwork?value=>{if(!signal?.aborted)try{onNetwork(value);}catch{}}:null;
    if(observer){if(request.observation)observer(request.observation);else request.observers.add(observer);}
    let onAbort;
    try {
        const result=signal?new Promise((resolve,reject)=>{
            onAbort=()=>reject(signal.reason);
            signal.addEventListener('abort',onAbort,{once:true});
            if(signal.aborted)onAbort();
            request.task.then(resolve,reject);
        }):request.task;
        const bytes=await result;signal?.throwIfAborted();
        // Every concurrent consumer needs its own transferable buffer.
        return request.waiters>1?bytes.slice(0):bytes;
    } finally {
        if(onAbort)signal.removeEventListener('abort',onAbort);
        if(observer)request.observers.delete(observer);
        request.waiters--;
        if(!request.waiters&&!request.settled){
            // Remove this generation before aborting so a new caller can retry;
            // its eventual completion must not remove a replacement request.
            if(inflight.get(key)===request)inflight.delete(key);
            request.controller.abort();
            // The final consumer must not report terminal completion until
            // an abort-ignoring body/cache operation has actually drained.
            await request.task.catch(()=>{});
        }
    }
}
