interface TextureEntry<T> {
    promise: Promise<T>;
    references: number;
    unloading: Promise<void> | null;
}

/** Native and ECS canvases can draw the same map concurrently. */
export class FoxholeMapTexturePool<T> {
    private readonly entries = new Map<string, TextureEntry<T>>();
    private readonly loadTexture: (url: string) => Promise<T>;
    private readonly unloadTexture: (url: string) => Promise<void>;
    constructor(load: (url: string) => Promise<T>, unload: (url: string) => Promise<void>) {
        this.loadTexture = load;
        this.unloadTexture = unload;
    }

    createOwner() {
        const owned = new Map<string, TextureEntry<T>>();
        const load = async (url: string): Promise<T> => {
            const held = owned.get(url);
            if (held) return held.promise;
            let entry = this.entries.get(url);
            if (entry?.unloading) {
                await entry.unloading;
                return load(url);
            }
            if (!entry) {
                entry = { promise: Promise.resolve().then(() => this.loadTexture(url)), references: 0, unloading: null };
                this.entries.set(url, entry);
            }
            entry.references++;
            owned.set(url, entry);
            try {
                return await entry.promise;
            } catch (error) {
                if (owned.get(url) === entry) {
                    owned.delete(url);
                    entry.references--;
                    if (!entry.references && this.entries.get(url) === entry) this.entries.delete(url);
                }
                throw error;
            }
        };
        const release = async (url: string): Promise<void> => {
            const entry = owned.get(url);
            if (!entry) return;
            owned.delete(url);
            if (--entry.references > 0) return;
            entry.unloading = entry.promise.then(() => this.unloadTexture(url), () => {}).finally(() => {
                if (this.entries.get(url) === entry) this.entries.delete(url);
            });
            await entry.unloading;
        };
        return { load, release, releaseAll: () => Promise.all([...owned.keys()].map(release)).then(() => {}) };
    }
}
