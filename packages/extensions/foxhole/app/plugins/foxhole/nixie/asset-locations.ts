let resolvePublished: ((path: string) => string) | null = null;
const sourceUrls = new Map<string, string>();
export function installFoxholeAssetLocations(resolve: ((path: string) => string) | null): void {
    resolvePublished = resolve;
    sourceUrls.clear();
}
export function hasFoxholeAssetLocations(): boolean {
    return resolvePublished !== null;
}
/** Retain authored identity after immutable delivery replaces filenames with hashes. */
export function resolveFoxholeAssetSourceUrl(url: string): string {
    return sourceUrls.get(url) ?? url;
}
export function resolveFoxholeAssetUrl(url: string, baseUrl = '/foxhole/assets/'): string {
    if (!resolvePublished) {
        return url;
    }
    const prefixes = [...new Set([baseUrl, '/foxhole/assets/'])];
    for (const prefix of prefixes) {
        if (url.startsWith(prefix)) {
            const path = url.slice(prefix.length);
            const resolved = resolvePublished(path);
            sourceUrls.set(resolved, `/foxhole/assets/${path}`);
            return resolved;
        }
    }
    return url;
}
