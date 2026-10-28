/** Isolated map data for one observer document; no shared browser persistence. */
export function createFoxholeObserverMapStorage(source = null, select = value => value) {
    const values = new Map();
    const deleted = new Set();
    function seedEntry(key, value) {
        const selected = select(value, key);
        if (selected !== undefined && !values.has(key) && !deleted.has(key)) {
            values.set(key, structuredClone(selected));
        }
    }
    return {
        async getItem(key) {
            if (!values.has(key) && !deleted.has(key) && source) {
                try {
                    const value = await source.getItem(key);
                    if (value !== null) seedEntry(key, value);
                } catch { /* Offline or unavailable storage leaves an empty snapshot. */ }
            }
            return values.has(key) ? structuredClone(values.get(key)) : null;
        },
        async setItem(key, value) {
            values.set(key, structuredClone(value));
            deleted.delete(key);
            return value;
        },
        async removeItem(key) {
            values.delete(key);
            deleted.add(key);
        },
        async iterate(iterator) {
            if (source) {
                try {
                    // Copy synchronously within the callback; LocalForage does not
                    // await callbacks during iteration.
                    await source.iterate((value, key) => { seedEntry(key, value); });
                } catch { /* Use whatever was already available in memory. */ }
            }
            let iteration = 0;
            for (const [key, value] of values) {
                const result = iterator(structuredClone(value), key, ++iteration);
                if (result !== undefined) return result;
            }
        },
    };
}

/** Persisted region records can contain labels from the editor's generation. */
export function selectFoxholeObserverWarData(value, key) {
    if (key === 'war') return value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const selected = {};
    if (Object.hasOwn(value, 'icons')) selected.icons = value.icons;
    if (Object.hasOwn(value, 'reports')) selected.reports = value.reports;
    if (value.__nixieLiveLabels === true && value.labels && Array.isArray(value.labels.items)) {
        selected.labels = value.labels;
        selected.__nixieLiveLabels = true;
    }
    return Object.keys(selected).length ? selected : undefined;
}

/** Only labels received from a server update gain provenance in persistent cache. */
export function mergeFoxholeMapServerEntry(previous, update) {
    const merged = { ...previous, ...update };
    if (Object.hasOwn(update, 'labels')) {
        if (update.labels && Array.isArray(update.labels.items)) merged.__nixieLiveLabels = true;
        else delete merged.__nixieLiveLabels;
    }
    return merged;
}

/** Routing only selects disposable storage; it does not grant observer authority. */
export function isFoxholeObserverDocument(windowObject) {
    if (!windowObject || windowObject.parent === windowObject) return false;
    return windowObject.location.pathname.replace(/\/+$/, '').endsWith('/_scene-v2-observer');
}

export function shouldUseFoxholeLocalAssetDelivery(isDevelopment, assetMode, windowObject) {
    return isDevelopment && assetMode === 'local' && !isFoxholeObserverDocument(windowObject);
}
