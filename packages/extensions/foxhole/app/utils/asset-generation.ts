import type { NixieExperimentalAssetPackEntryV1, NixieExperimentalProductCatalogV1 } from '@nixiejs/extension-sdk';

/** Async preparation cannot replace the active catalog until the host accepts its state. */
export interface FoxholeAssetGeneration {
    generationHash: string;
    distribution?: 'development' | 'published' | 'workspace';
    readProductCatalog(id: string): Promise<{
        baseUrl: string;
        sha256: string;
        text: string;
        entries?: ReadonlyMap<string, Readonly<NixieExperimentalAssetPackEntryV1>>;
    }>;
}

interface PreparedProductCatalog {
    baseUrl: string;
    sha256: string;
    catalog: NixieExperimentalProductCatalogV1;
    entries?: ReadonlyMap<string, Readonly<NixieExperimentalAssetPackEntryV1>>;
}

// Asset delivery and previews prepare together. Share the decode without keeping a second
// catalog cache or reusing a document across generation readers.
const pendingCatalogs = new WeakMap<FoxholeAssetGeneration['readProductCatalog'], Promise<PreparedProductCatalog>>();

export function readFoxholeProductCatalog(generation: FoxholeAssetGeneration): Promise<PreparedProductCatalog> {
    const reader = generation.readProductCatalog;
    const existing = pendingCatalogs.get(reader);
    if (existing) return existing;
    const pending = generation.readProductCatalog('foxhole.catalog').then(({baseUrl, sha256, text, entries}) => ({
        baseUrl, sha256, catalog: JSON.parse(text) as NixieExperimentalProductCatalogV1, entries,
    })).finally(() => pendingCatalogs.delete(reader));
    pendingCatalogs.set(reader, pending);
    return pending;
}
export function createFoxholeAssetGenerationSelector<T, Generation extends FoxholeAssetGeneration>(prepare: (generation: Generation) => Promise<T>,
    activate: (value: T | null, generation: Generation | null) => void) {
    const prepared = new Map<string, Promise<T>>();
    let active: string | null | undefined;
    return async (generation: Generation | null): Promise<() => void> => {
        const key = generation?.generationHash ?? null;
        if (key === active) return () => {};
        let value: T | null = null;
        if (generation) {
            let pending = prepared.get(generation.generationHash);
            if (!pending) {
                pending = prepare(generation);
                prepared.set(generation.generationHash, pending);
                void pending.catch(() => {if (prepared.get(generation.generationHash) === pending) prepared.delete(generation.generationHash);});
                while (prepared.size > 3) prepared.delete(prepared.keys().next().value!);
            }
            value = await pending;
        }
        return () => {if (active !== key) {activate(value, generation); active = key;}};
    };
}
