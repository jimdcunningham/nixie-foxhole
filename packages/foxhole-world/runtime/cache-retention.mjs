const HOUR = 3600000, IDLE = 30 * 24 * HOUR, ACTIVE = 2 * HOUR;
const policies = new WeakMap();
const urlOf = key => typeof key === 'string' ? key : key.url;
const cancel = response => { void response?.body?.cancel().catch(() => {}); };

/** Keep compressed bodies unchanged; access metadata has its own small cache. */
export async function openRetainedWorldCache(name, {cachesApi = globalThis.caches, now = Date.now, budget = 1024 ** 3, maxEntries = 16384} = {}) {
    if (!cachesApi) return null;
    let owned = policies.get(cachesApi);
    if (!owned) {owned = new Map(); policies.set(cachesApi, owned);}
    const identity = name + ':' + budget + ':' + maxEntries;
    if (!owned.has(identity)) owned.set(identity, (async () => {
        const body = await cachesApi.open(name), usage = await cachesApi.open('foxhole-world-cache-usage-v1').catch(() => null);
        let serial = owned.get('queue:' + name);
        if (!serial) {serial = {pending:Promise.resolve()}; owned.set('queue:' + name, serial);}
        let nextCleanup = 0, cursor = 0;
        const summaryKey = 'https://foxhole-world-cache.invalid/' + name + '/_summary';
        const recent = new Map();
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
        async function writeUsage(key, active = false) {
            const time = now(), remembered = recent.get(urlOf(key));
            if (remembered && time >= remembered.lastUsedAt && time - remembered.lastUsedAt < HOUR
                && (!active || remembered.activeUntil >= time + HOUR)) return;
            const old = await readUsage(key);
            const value = {lastUsedAt:time, activeUntil:Math.max(old?.activeUntil ?? 0, active ? time + ACTIVE : 0)};
            await usage?.put(metadataKey(key), new Response(JSON.stringify(value))).catch(() => {});
            recent.delete(urlOf(key)); if (recent.size >= maxEntries) recent.delete(recent.keys().next().value);
            recent.set(urlOf(key), value);
        }
        async function remove(key) {
            recent.delete(urlOf(key));
            await usage?.delete(metadataKey(key)).catch(() => {});
            await usage?.delete(summaryKey).catch(() => {}); return body.delete(key);
        }
        const stale = value => value && value.activeUntil <= now() && now() - value.lastUsedAt >= IDLE + HOUR;
        async function cleanup() {
            if (now() < nextCleanup) return;
            nextCleanup = now() + 60000;
            const keys = await body.keys(); if (!keys.length) return;
            for (let n = 0; n < Math.min(128, keys.length); n++) {
                const key = keys[(cursor + n) % keys.length], value = await readUsage(key);
                if (!value) await writeUsage(key);
                else if (stale(value)) await remove(key);
            }
            cursor = (cursor + 128) % keys.length;
        }
        return {
            async match(key) {
                return mutate(async () => {
                    const value = await body.match(key); if (!value) {await cleanup(); return undefined;}
                    if (stale(await readUsage(key))) {cancel(value); await remove(key); await cleanup(); return undefined;}
                    await writeUsage(key); await cleanup(); return value;
                });
            },
            async put(key, response) {
                // These bytes are already gzip-compressed when the calling cache uses gzip.
                const bytes = await response.arrayBuffer();
                if (bytes.byteLength > budget) return false;
                return mutate(async () => {
                    await cleanup();
                    const keys = await body.keys();
                    let summary;
                    try {summary = await (await usage?.match(summaryKey))?.json();} catch {}
                    const previous = await body.match(key);
                    const previousBytes = previous ? Number(previous.headers.get('X-Foxhole-Cached-Bytes') ?? previous.headers.get('X-Foxhole-Recipe-Bytes')) || (await previous.arrayBuffer()).byteLength : 0;
                    cancel(previous);
                    async function store(total, count) {
                        const headers = new Headers(response.headers); headers.set('X-Foxhole-Cached-Bytes', String(bytes.byteLength));
                        await body.put(key, new Response(bytes, {headers})); await writeUsage(key);
                        await usage?.put(summaryKey,new Response(JSON.stringify({bytes:total + bytes.byteLength,count:count + 1}))).catch(() => {});
                        return true;
                    }
                    // Serialized totals avoid reopening every large body on each download.
                    // A changed entry count invalidates totals left by an older client.
                    const count = keys.length - (previous ? 1 : 0);
                    if (Number.isSafeInteger(summary?.bytes) && summary.bytes >= previousBytes && summary.count === keys.length
                        && summary.bytes - previousBytes + bytes.byteLength <= budget && count < maxEntries) {
                        return store(summary.bytes - previousBytes, count);
                    }
                    const rows = [];
                    for (const request of keys) {
                        if (urlOf(request) === urlOf(key)) continue;
                        const value = await body.match(request), access = await readUsage(request);
                        rows.push({key:request, bytes:Number(value?.headers.get('X-Foxhole-Cached-Bytes') ?? value?.headers.get('X-Foxhole-Recipe-Bytes')) || (value ? (await value.arrayBuffer()).byteLength : 0),
                            used:access?.lastUsedAt ?? now(), active:(access?.activeUntil ?? 0) > now()});
                        cancel(value);
                    }
                    rows.sort((a,b) => a.used - b.used);
                    let total = rows.reduce((sum,row) => sum + row.bytes, 0), remaining = rows.length;
                    for (const row of rows) {
                        if (total + bytes.byteLength <= budget && remaining < maxEntries) break;
                        if (!row.active && await remove(row.key)) {total -= row.bytes; remaining--;}
                    }
                    if (total + bytes.byteLength > budget || remaining >= maxEntries) return false;
                    return store(total, remaining);
                });
            },
            keys: () => body.keys(),
            delete: key => mutate(() => remove(key)),
            touch: keys => mutate(async () => {await cleanup(); for (const key of keys) {if (stale(await readUsage(key))) await remove(key); await writeUsage(key, true);}}),
            cleanup: () => mutate(async () => {nextCleanup = 0; await cleanup();}),
        };
    })().catch(() => {owned.delete(identity); return null;}));
    return owned.get(identity);
}

/** A mounted region renews its physical-source/derived-buffer graph without fetching it. */
export function createWorldCacheLease(options = {}) {
    const held = new Map(); let timer, disposed = false;
    const report = async (name, keys) => {try {await (await openRetainedWorldCache(name, options))?.touch(keys);} catch {}};
    async function flush() {for (const [name, keys] of held) await report(name, keys);}
    return {
        async use(name, values) {
            if (disposed) return;
            const keys = held.get(name) ?? new Set(), added = [];
            for (const key of typeof values === 'string' ? [values] : values) if (!keys.has(key)) {keys.add(key); added.push(key);}
            held.set(name, keys);
            if (!timer && (options.cachesApi ?? globalThis.caches)) {timer = setInterval(() => void flush(), 60000); timer.unref?.();}
            if (added.length) await report(name, added);
        },
        flush,
        dispose() {if (disposed) return; disposed = true; clearInterval(timer); held.clear();},
    };
}
