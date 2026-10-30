import {createCacheEnumeration,trackedCacheSummary,freshCacheSummary} from './cache-enumeration.mjs';
import {batchRetainedCacheWrites} from './cache-write-batch.mjs';
const HOUR = 3600000, IDLE = 30 * 24 * HOUR, ACTIVE = 2 * HOUR, SUMMARY_RECHECK = 30000;
const policies = new WeakMap();
const urlOf = key => typeof key === 'string' ? key : key.url;
const cancel = response => { void response?.body?.cancel().catch(() => {}); };

/** Keep compressed bodies unchanged; access metadata has its own small cache. */
export async function openRetainedWorldCache(name, {cachesApi = globalThis.caches, now = Date.now, budget = 1024 ** 3, maxEntries = 16384, idleDelay = SUMMARY_RECHECK} = {}) {
    if (!cachesApi) return null;
    let owned = policies.get(cachesApi);
    if (!owned) {owned = new Map(); policies.set(cachesApi, owned);}
    const identity = name + ':' + budget + ':' + maxEntries + ':' + idleDelay;
    if (!owned.has(identity)) owned.set(identity, (async () => {
        const body = await cachesApi.open(name), usage = await cachesApi.open('foxhole-world-cache-usage-v1').catch(() => null);
        const maintenance = await cachesApi.open('foxhole-world-cache-maintenance-v1').catch(() => null);
        let serial = owned.get('queue:' + name);
        if (!serial) {serial = {pending:Promise.resolve()}; owned.set('queue:' + name, serial);}
        let nextCleanup = 0, cursor = 0, pendingCleanup, cleanupTimer;
        const summaryKey = 'https://foxhole-world-cache.invalid/' + name + '/_summary';
        const recent = new Map();
        let accounting;
        async function commitSummary(previous,next,changes){
            const record=trackedCacheSummary(previous,next,changes,{time:now()});
            await usage?.put(summaryKey,new Response(JSON.stringify(record))).catch(()=>{});
            accounting?.schedule(record);
        }
        const metadataKey = key => 'https://foxhole-world-cache.invalid/' + name + '/' + encodeURIComponent(urlOf(key));
        const mutate = task => {
            const pending = serial.pending.then(() => globalThis.navigator?.locks
                ? navigator.locks.request(name, task) : task());
            serial.pending = pending.catch(() => {}); return pending;
        };
        async function readUsage(key) {
            const response = await usage?.match(metadataKey(key)).catch(() => null);
            if (!response) return null;
            try {
                const value = await response.json();
                return Number.isFinite(value.lastUsedAt) && value.lastUsedAt >= 0 && value.lastUsedAt <= now()
                    ? {lastUsedAt:value.lastUsedAt, activeUntil:Number.isFinite(value.activeUntil) && value.activeUntil <= value.lastUsedAt + ACTIVE ? value.activeUntil : 0} : null;
            } catch {return null;}
        }
        const fresh = (value, time, active) => value && time >= value.lastUsedAt && time - value.lastUsedAt < HOUR
            && (!active || value.activeUntil >= time + HOUR);
        const remember = (key, value) => {
            recent.delete(urlOf(key)); if (recent.size >= maxEntries) recent.delete(recent.keys().next().value);
            recent.set(urlOf(key), value);
        };
        async function writeUsage(key, active = false, known) {
            const time = now(), remembered = recent.get(urlOf(key));
            // A supplied record reflects shared state under the cache lock. It may
            // have changed since this context remembered an earlier lease.
            if (known === undefined && fresh(remembered, time, active)) return;
            const old = known === undefined ? await readUsage(key) : known;
            // Another context can delete the body while this context still
            // holds a valid lease. Preserve that lease when recreating usage.
            const rememberedActive = remembered && remembered.lastUsedAt <= time ? remembered.activeUntil : 0;
            if (fresh(old, time, active) && (old.activeUntil ?? 0) >= rememberedActive) {remember(key, old); return;}
            const value = {lastUsedAt:time, activeUntil:Math.max(old?.activeUntil ?? 0, rememberedActive ?? 0, active ? time + ACTIVE : 0)};
            await usage?.put(metadataKey(key), new Response(JSON.stringify(value))).catch(() => {});
            remember(key, value);
        }
        // Keep the lock until every started cache operation settles, even on failure.
        async function forEachBounded(values, fn) {
            let next = 0;
            const results = await Promise.allSettled(Array.from({length:Math.min(16, values.length)}, async () => {
                while (next < values.length) {const index = next++; await fn(values[index], index);}
            }));
            const failed = results.find(result => result.status === 'rejected');
            if (failed) throw failed.reason;
        }
        // Batches share one outer retention lock, so their independent deletions
        // must also serialize summary read / invalidate / restore transactions.
        let removals = Promise.resolve();
        function remove(key, options = {}) {
            const pending = removals.then(() => removeOne(key, options));
            removals = pending.catch(() => {}); return pending;
        }
        async function removeOne(key, {keepActiveUsage = false} = {}) {
            // Explicit deletion removes even a corrupt active body, but its
            // lease must protect a replacement written by another context.
            const active = keepActiveUsage && (await readUsage(key))?.activeUntil > now();
            let summary, removedBytes;
            try {summary = await (await usage?.match(summaryKey))?.json();} catch {}
            const time = now();
            const valid = Number.isSafeInteger(summary?.bytes) && summary.bytes >= 0
                && Number.isSafeInteger(summary?.count) && summary.count > 0
                && Number.isFinite(summary?.verifiedAt) && summary.verifiedAt <= time
                && freshCacheSummary(summary,time,SUMMARY_RECHECK);
            if (valid) {
                const previous = await body.match(key);
                if (previous) {
                    try {
                        const header = previous.headers.get('X-Foxhole-Cached-Bytes')
                            ?? previous.headers.get('X-Foxhole-Recipe-Bytes')
                            ?? previous.headers.get('X-Foxhole-Pixel-Bytes');
                        const declared = header === null ? NaN : Number(header);
                        // Full-scan accounting uses falsy headers as a request to read bytes.
                        // Other malformed numeric headers invalidate the total instead.
                        if (!declared) removedBytes = (await previous.arrayBuffer()).byteLength;
                        else if (Number.isSafeInteger(declared) && declared > 0) removedBytes = declared;
                    } finally {cancel(previous);}
                }
            }
            // Invalidate first: a failed delete or terminated context must not
            // leave a seemingly current total that includes the wrong body.
            let cleared = false;
            if (usage) {await usage.delete(summaryKey); cleared = true;}
            recent.delete(urlOf(key));
            if (!active) await usage?.delete(metadataKey(key)).catch(() => {});
            const deleted = await body.delete(key);
            if (deleted && cleared && valid && Number.isSafeInteger(removedBytes)
                && summary.bytes >= removedBytes) {
                // Preserve the last full verification time; crash-safe mutations
                // refresh incremental accounting separately.
                await commitSummary(summary,{
                    bytes:summary.bytes - removedBytes, count:summary.count - 1,
                    verifiedAt:summary.verifiedAt,
                },[[key,false]]);
            }
            return deleted;
        }
        const stale = value => value && value.activeUntil <= now() && now() - value.lastUsedAt >= IDLE + HOUR;
        // Enumeration can take seconds for a large cache. It is only a candidate
        // snapshot: every deletion is revalidated under the normal retention lock.
        async function cleanupCandidates(force, suppliedKeys) {
            let shared;
            try {shared = await (await maintenance?.match(summaryKey))?.json();} catch {}
            const time = now();
            if (!force && Number.isFinite(shared?.next) && shared.next > time && shared.next <= time + 60000) return;
            const keys = suppliedKeys ?? await body.keys();
            const position = Number.isSafeInteger(shared?.cursor) && shared.cursor >= 0 ? shared.cursor : cursor;
            const batch = keys.length ? Array.from({length:Math.min(128, keys.length)}, (_, n) => keys[(position + n) % keys.length]) : [];
            await mutate(async () => {
                await forEachBounded(batch, async key => {
                    // It may have been deleted or replaced after enumeration.
                    const value = await body.match(key); if (!value) return;
                    cancel(value);
                    const access = await readUsage(key);
                    if (!access) await writeUsage(key, false, access);
                    else if (stale(access)) await remove(key);
                });
            });
            cursor = keys.length ? (position + 128) % keys.length : 0;
            await maintenance?.put(summaryKey, new Response(JSON.stringify({next:now()+60000,cursor}))).catch(() => {});
        }
        function runCleanup(force = false, keys) {
            // The separate maintenance lock coalesces enumeration across workers
            // without blocking foreground retention reads, leases, or writes.
            if (globalThis.navigator?.locks) return navigator.locks.request(name + ':maintenance',
                force ? {} : {ifAvailable:true}, lock => lock ? cleanupCandidates(force,keys) : undefined);
            return cleanupCandidates(force,keys);
        }
        function scheduleCleanup() {
            if(accounting){accounting.activity();return;}
            if (cleanupTimer || pendingCleanup || now() < nextCleanup) return;
            nextCleanup = now() + 60000;
            cleanupTimer = setTimeout(() => {
                cleanupTimer = undefined;
                pendingCleanup = Promise.resolve().then(() => runCleanup()).catch(() => {}).finally(() => {pendingCleanup = undefined;});
            }, 1000);
            cleanupTimer.unref?.();
        }
        const matchExclusive = key => mutate(async () => {
            const value = await body.match(key); if (!value) return undefined;
            const access = await readUsage(key);
            if (stale(access)) {cancel(value); await remove(key); return undefined;}
            await writeUsage(key, false, access); return value;
        });
        if(usage)accounting=createCacheEnumeration({name,body,summaryKey,now,recheck:SUMMARY_RECHECK,idleDelay,mutate,
            readSummary:async()=>{try{return await (await usage.match(summaryKey))?.json();}catch{return null;}},
            writeSummary:record=>usage.put(summaryKey,new Response(JSON.stringify(record))),
            readActivity:async()=>{try{return (await (await maintenance?.match(summaryKey+'/activity'))?.json())?.lastActiveAt;}catch{return 0;}},
            writeActivity:time=>maintenance?.put(summaryKey+'/activity',new Response(JSON.stringify({lastActiveAt:time}))),
            onSnapshot:keys=>runCleanup(false,keys),
            skipEnumeration:async summary=>{if(Number.isSafeInteger(summary?.count))return false;try{const value=await (await maintenance?.match(summaryKey))?.json();return value?.next>now()&&value.next<=now()+60000;}catch{return false;}},
        });
        const retained = {
            async match(key) {
                // A shared lock permits independent hits to read simultaneously,
                // while an exclusive writer cannot evict or replace the body.
                // Missing/old metadata needs mutation, so retry under exclusive lock.
                scheduleCleanup();
                if (!globalThis.navigator?.locks) return matchExclusive(key);
                const hit = await navigator.locks.request(name, {mode:'shared'}, async () => {
                    const value = await body.match(key);
                    // A miss observed while writers are excluded is already final
                    // for this lookup. It has no usage record to renew or expire.
                    if (!value) return {value:undefined};
                    const access = await readUsage(key);
                    if (!fresh(access, now(), false)) {cancel(value); return null;}
                    remember(key, access);
                    return {value};
                });
                if (!hit) return matchExclusive(key);
                return hit.value;
            },
            async put(key, response) {
                // These bytes are already gzip-compressed when the calling cache uses gzip.
                const bytes = await response.arrayBuffer();
                if (bytes.byteLength > budget) return false;
                scheduleCleanup();
                return mutate(async () => {
                    let summary;
                    try {summary = await (await usage?.match(summaryKey))?.json();} catch {}
                    const previous = await body.match(key);
                    const previousBytes = previous ? Number(previous.headers.get('X-Foxhole-Cached-Bytes') ?? previous.headers.get('X-Foxhole-Recipe-Bytes') ?? previous.headers.get('X-Foxhole-Pixel-Bytes')) || (await previous.arrayBuffer()).byteLength : 0;
                    cancel(previous);
                    async function store(total, count, verifiedAt) {
                        const headers = new Headers(response.headers); headers.set('X-Foxhole-Cached-Bytes', String(bytes.byteLength));
                        if(usage)await usage.delete(summaryKey);
                        await body.put(key, new Response(bytes, {headers}));
                        // A different context may have deleted or renewed this
                        // record since our last hit; consult shared metadata.
                        await writeUsage(key, false, await readUsage(key));
                        await commitSummary(summary,{bytes:total + bytes.byteLength,count:count + 1,verifiedAt},[[key,true]]);
                        return true;
                    }
                    // All supported cache writers share this lock and update the summary.
                    // Legacy writers omit verifiedAt, and deletions invalidate the summary.
                    // Reconcile healthy totals during idle; legacy totals and budget pressure still require a full check.
                    const time = now(), verifiedAt = summary?.verifiedAt;
                    const valid = Number.isSafeInteger(summary?.bytes) && summary.bytes >= previousBytes
                        && Number.isSafeInteger(summary?.count) && summary.count >= (previous ? 1 : 0);
                    const count = valid ? summary.count - (previous ? 1 : 0) : 0;
                    if (valid && freshCacheSummary(summary,time,SUMMARY_RECHECK)
                        && summary.bytes - previousBytes + bytes.byteLength <= budget && count < maxEntries) {
                        return store(summary.bytes - previousBytes, count, verifiedAt);
                    }
                    const keys = await body.keys();
                    const actualCount = keys.length - (previous ? 1 : 0);
                    if (valid && summary.count === keys.length
                        && summary.bytes - previousBytes + bytes.byteLength <= budget && actualCount < maxEntries) {
                        return store(summary.bytes - previousBytes, actualCount, time);
                    }
                    const candidates = keys.filter(request => urlOf(request) !== urlOf(key)), rows = new Array(candidates.length);
                    await forEachBounded(candidates, async (request, index) => {
                        const [value, access] = await Promise.all([body.match(request), readUsage(request)]);
                        try {
                            rows[index] = {key:request, bytes:Number(value?.headers.get('X-Foxhole-Cached-Bytes') ?? value?.headers.get('X-Foxhole-Recipe-Bytes') ?? value?.headers.get('X-Foxhole-Pixel-Bytes')) || (value ? (await value.arrayBuffer()).byteLength : 0),
                                used:access?.lastUsedAt ?? now(), active:(access?.activeUntil ?? 0) > now()};
                        } finally {cancel(value);}
                    });
                    rows.sort((a,b) => a.used - b.used);
                    let total = rows.reduce((sum,row) => sum + row.bytes, 0), remaining = rows.length;
                    for (const row of rows) {
                        if (total + bytes.byteLength <= budget && remaining < maxEntries) break;
                        if (!row.active && await remove(row.key)) {total -= row.bytes; remaining--;}
                    }
                    if (total + bytes.byteLength > budget || remaining >= maxEntries) return false;
                    return store(total, remaining, time);
                });
            },
            keys: () => body.keys(),
            delete: key => mutate(() => remove(key, {keepActiveUsage:true})),
            touch: (keys, {onProgress} = {}) => { scheduleCleanup(); return mutate(async () => {
                // Each key has independent metadata. Bound concurrency to avoid serial
                // cache round trips for a large region while holding the retention lock.
                const unique = [...new Set(Array.from(keys, urlOf))];
                let completed = 0;
                const notify = () => { try { onProgress?.({completed, total:unique.length}); } catch {} };
                notify();
                await forEachBounded(unique, async key => {
                    // Recheck shared metadata: another context may have deleted
                    // and recreated a previously leased body in the meantime.
                    let value = await readUsage(key);
                    if (stale(value)) {await remove(key); value = null;}
                    await writeUsage(key, true, value);
                    completed++; notify();
                });
            }); },
            cleanup: async () => {
                if (cleanupTimer) {clearTimeout(cleanupTimer); cleanupTimer = undefined;}
                if (pendingCleanup) await pendingCleanup;
                nextCleanup = now() + 60000;
                await runCleanup(true);
            },
        };
        return batchRetainedCacheWrites(retained,{body,usage,summaryKey,now,budget,maxEntries,summaryRecheck:SUMMARY_RECHECK,mutate,writeUsage,readUsage,commitSummary});
    })().catch(() => {owned.delete(identity); return null;}));
    return owned.get(identity);
}

/** A mounted region renews its physical-source/derived-buffer graph without fetching it. */
export function createWorldCacheLease(options = {}) {
    const held = new Map(), pending = new Map(); let timer, disposed = false;
    const report = async (name, keys, onProgress) => {try {await (await openRetainedWorldCache(name, options))?.touch(keys, {onProgress});} catch {}};
    async function flush() {for (const [name, keys] of held) await report(name, keys);}
    return {
        async use(name, values, {onProgress} = {}) {
            if (disposed) return;
            const keys = held.get(name) ?? new Set(), inFlight = pending.get(name) ?? new Map(), added = [], waiting = new Set();
            for (const value of typeof values === 'string' ? [values] : values) {
                const key = urlOf(value);
                if (!keys.has(key)) {keys.add(key); added.push(key);}
                else if (inFlight.has(key)) waiting.add(inFlight.get(key));
            }
            held.set(name, keys);
            if (!timer && (options.cachesApi ?? globalThis.caches)) {timer = setInterval(() => void flush(), 60000); timer.unref?.();}
            if (added.length) {
                // Overlapping callers must wait for the first registration too.
                const registration = report(name, added, onProgress);
                for (const key of added) inFlight.set(key, registration);
                pending.set(name, inFlight); waiting.add(registration);
                void registration.finally(() => {
                    for (const key of added) if (inFlight.get(key) === registration) inFlight.delete(key);
                    if (!inFlight.size && pending.get(name) === inFlight) pending.delete(name);
                });
            }
            if (waiting.size) await Promise.all(waiting);
        },
        flush,
        dispose() {if (disposed) return; disposed = true; clearInterval(timer); held.clear(); pending.clear();},
    };
}
