let resolvePublished: ((path: string) => string) | null = null;
export function installFoxholeAssetLocations(resolve: (path: string) => string): void { resolvePublished = resolve; }
export function hasFoxholeAssetLocations(): boolean { return resolvePublished !== null; }
export function resolveFoxholeAssetUrl(url: string, baseUrl = '/foxhole/assets/'): string {
    if (!resolvePublished) return url;
    const prefixes = [...new Set([baseUrl, '/foxhole/assets/'])];
    for (const prefix of prefixes) if (url.startsWith(prefix)) return resolvePublished(url.slice(prefix.length));
    return url;
}
