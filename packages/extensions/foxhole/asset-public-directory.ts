/** Nitro directories may use either separator, case, or a trailing slash on Windows. */
export function withoutLocalAssetPublicDirectory<T extends { dir?: string }>(entries: T[], publicDirectory: string): T[] {
    const normalized = (value: string) => value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
    const target = normalized(publicDirectory);
    return entries.filter(entry => !entry.dir || normalized(entry.dir) !== target);
}
