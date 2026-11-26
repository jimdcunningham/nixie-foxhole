export function encodeFoxholeCatalogKeys<T extends {products: {data?: unknown}[]; data?: unknown}>(catalog: T): T;
export function decodeFoxholeCatalogMetadata<T extends {products: {data?: unknown}[]; data?: unknown}>(catalog: T): T;
export function foxholeWorldReceiptsUseShortKeys(catalog: {data?: unknown}): boolean;
