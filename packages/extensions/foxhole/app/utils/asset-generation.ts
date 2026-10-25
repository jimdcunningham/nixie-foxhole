/** Async preparation cannot replace the active catalog until the host accepts its state. */
export interface FoxholeAssetGeneration {
    generationHash: string;
    readProductCatalog(id: string): Promise<{baseUrl: string; sha256: string; text: string}>;
}
export function createFoxholeAssetGenerationSelector<T>(prepare: (generation: FoxholeAssetGeneration) => Promise<T>,
    activate: (value: T | null, generation: FoxholeAssetGeneration | null) => void) {
    const prepared = new Map<string, Promise<T>>();
    let active: string | null | undefined;
    return async (generation: FoxholeAssetGeneration | null): Promise<() => void> => {
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
