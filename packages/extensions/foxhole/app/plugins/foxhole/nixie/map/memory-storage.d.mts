export interface FoxholeObserverMapStorage {
    getItem<T>(key: string): Promise<T | null>;
    setItem<T>(key: string, value: T): Promise<T>;
    removeItem(key: string): Promise<void>;
    iterate<T, U>(iterator: (value: T, key: string, iterationNumber: number) => U | void): Promise<U | void>;
}
export function createFoxholeObserverMapStorage(
    source?: FoxholeObserverMapStorage | null,
    select?: (value: unknown, key: string) => unknown,
): FoxholeObserverMapStorage;
export function selectFoxholeObserverWarData(value: unknown, key: string): unknown;
export function mergeFoxholeMapServerEntry<T extends object>(previous: T, update: object): T;
export function isFoxholeObserverDocument(windowObject: Window | undefined): boolean;
export function shouldUseFoxholeLocalAssetDelivery(isDevelopment: boolean, assetMode: unknown, windowObject: Window | undefined): boolean;
