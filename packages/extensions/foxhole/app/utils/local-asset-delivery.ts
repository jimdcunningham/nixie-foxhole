/** Mutable checkout assets must bypass the publication's persistent cache. */
export function createLocalFoxholeAssetDelivery(baseUrl: string, fetcher: typeof fetch = fetch) {
    const resolve = (path: string) => new URL(path, baseUrl).href;
    const fetchLocal: typeof fetch = (input, options) => fetcher(input, { ...options, cache: 'no-store' });
    return {
        resolve,
        fetch: fetchLocal,
        world: {
            baseUrl: resolve('world/'),
            loadIndex: async () => {
                const response = await fetchLocal(resolve('world/index.json'));
                if (!response.ok) throw new Error('Local world index is unavailable (' + response.status + ').');
                return response.json();
            },
        },
    };
}
