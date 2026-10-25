import type {NixieExperimentalAssetPackEntryV1, NixieExperimentalProductCatalogV1} from '@nixiejs/extension-sdk';
export interface CatalogReceipt {url: string; sha256: string; byteLength: number;}
export interface FoxholeCatalogPin {schemaVersion: number; baseUrl: string; catalog: CatalogReceipt; completion?: CatalogReceipt;}
export interface FoxholeCatalogLibrary {
    catalog: NixieExperimentalProductCatalogV1;
    files: Map<string, {url: string; entry: NixieExperimentalAssetPackEntryV1}>;
    worldIndex?: CatalogReceipt;
    worldBaseUrl?: string;
    resolve(path: string): string;
}
export function readPinnedCatalogJson<T>(receipt: CatalogReceipt, fetcher?: typeof fetch): Promise<T>;
export function loadFoxholeCatalogLibrary(pin: FoxholeCatalogPin, read?: <T>(receipt: CatalogReceipt) => Promise<T>): Promise<FoxholeCatalogLibrary>;
export function createFoxholeCatalogLibrary(baseUrl: string, value: unknown): FoxholeCatalogLibrary;
