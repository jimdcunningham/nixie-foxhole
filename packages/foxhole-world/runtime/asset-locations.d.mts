export function configureWorldAssetLocations(value: { resolve(path: string): string; fetch(url: string, options?: RequestInit): Promise<Response>; } | null): void;
export function hasPinnedWorldAssets(): boolean;
export function resolveWorldAsset(baseUrl: string, path: string): string;
export function fetchWorldAsset(url: string | URL, options?: RequestInit): Promise<Response>;
