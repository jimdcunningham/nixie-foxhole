import localforage from 'localforage';
import { FOXHOLE_MAP_REGIONS } from './constants.ts';
import {
    beginShellProgressJob,
    finishShellProgressJob,
    getShellProgressJob,
    registerShellProgressCancelHandler,
    shellProgressJobIdForKind,
    updateShellProgressJob,
} from '#nixie/utils/nixie-shell-progress-queue.ts';

export const FOXHOLE_MAP_MOD_DIR = 'mods/Textures/UI/HexMaps/Processed/';
export const FOXHOLE_MAP_MOD_STORAGE_NAME = 'mapmod';
export const FOXHOLE_MAP_MOD_SHELL_JOB_ID = shellProgressJobIdForKind('map-mod-import');

export interface FoxholeMapModManifestMeta {
    version: number;
    importedAt: string;
    sourcePakName?: string;
    sourcePakBaseDir?: string;
    sourceType?: string;
}

export interface FoxholeMapModManifest extends FoxholeMapModManifestMeta {
    imagesByPath: Record<string, Blob | string>;
}

export interface FoxholeMapModImportProgress {
    active: boolean;
    fileName: string;
    currentFile: string;
    processed: number;
    total: number;
    percent: number;
    error: string | null;
}

export type FoxholeMapModChangeListener = () => void;

const MANIFEST_KEY = 'manifest';
const LEGACY_HEXMAPS_KEY = 'hexmaps';

function createEmptyImportStatus(): FoxholeMapModImportProgress {
    return {
        active: false,
        fileName: '',
        currentFile: '',
        processed: 0,
        total: 0,
        percent: 0,
        error: null,
    };
}

function getTextureKeyFromPath(path: string): string | null {
    const normalized = String(path || '').replace(/\\/g, '/');
    const match = normalized.match(/\/([^/]+)\.png$/i);
    return match?.[1] ? String(match[1]) : null;
}

export function getFoxholeMapModTexturePath(textureKey: string): string {
    return `${FOXHOLE_MAP_MOD_DIR}${textureKey}.png`;
}

export function buildFoxholeMapRegionTextureKeyMap(): Record<string, string> {
    const regionTextureKeys: Record<string, string> = {};
    for (const region of FOXHOLE_MAP_REGIONS) {
        if (!region.key || !region.textureKey) {
            continue;
        }
        regionTextureKeys[String(region.key).toLowerCase()] = region.textureKey;
    }
    return regionTextureKeys;
}

/**
 * Device-local IndexedDB cache for imported map-mod hex textures.
 * Never written into Yjs / project settings — collaborators do not receive these bytes.
 */
export class FoxholeMapModStore {
    readonly mapModStorage = localforage.createInstance({
        name: FOXHOLE_MAP_MOD_STORAGE_NAME,
    });

    private manifest: FoxholeMapModManifest | null = null;
    private textureUrlsByKey = new Map<string, string>();
    private objectUrls: string[] = [];
    private listeners = new Set<FoxholeMapModChangeListener>();
    private loadPromise: Promise<FoxholeMapModManifest | null> | null = null;
    private importStatus: FoxholeMapModImportProgress = createEmptyImportStatus();
    private importCancelRequested = false;

    get pakImportStatus(): FoxholeMapModImportProgress {
        return this.importStatus;
    }

    get revision(): string {
        return (this.manifest?.importedAt || 'empty').replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    subscribe(listener: FoxholeMapModChangeListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emitChange(): void {
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (error) {
                console.warn('[foxhole:map-mod] listener failed:', error);
            }
        }
    }

    private syncShellProgressJob(): void {
        const status = this.importStatus;
        if (!status.active) {
            finishShellProgressJob(FOXHOLE_MAP_MOD_SHELL_JOB_ID);
            return;
        }

        const title = status.fileName
            ? `Importing ${status.fileName}`
            : 'Importing Map Mod';
        const percent = status.total > 0 ? status.percent : null;

        if (!getShellProgressJob(FOXHOLE_MAP_MOD_SHELL_JOB_ID)) {
            beginShellProgressJob({
                id: FOXHOLE_MAP_MOD_SHELL_JOB_ID,
                kind: 'map-mod-import',
                title,
                currentFile: status.currentFile,
                processed: status.processed,
                total: status.total,
                percent,
                cancellable: true,
            });
            return;
        }

        updateShellProgressJob(FOXHOLE_MAP_MOD_SHELL_JOB_ID, {
            title,
            currentFile: status.currentFile,
            processed: status.processed,
            total: status.total,
            percent,
            error: status.error,
        });
    }

    setPakImportStatus(update: Partial<FoxholeMapModImportProgress> = {}): void {
        const wasActive = this.importStatus.active === true;
        this.importStatus = {
            ...this.importStatus,
            ...update,
        };

        if (this.importStatus.active && !wasActive) {
            this.importCancelRequested = false;
        }

        if (!this.importStatus.active && wasActive) {
            this.importCancelRequested = false;
            finishShellProgressJob(FOXHOLE_MAP_MOD_SHELL_JOB_ID);
        } else if (this.importStatus.active) {
            this.syncShellProgressJob();
        }

        this.emitChange();
    }

    requestCancelImport(): void {
        if (!this.importStatus.active) {
            return;
        }
        this.importCancelRequested = true;
    }

    isImportCancelRequested(): boolean {
        return this.importCancelRequested === true;
    }

    hasImportedMapMod(): boolean {
        return !!(this.manifest?.imagesByPath && Object.keys(this.manifest.imagesByPath).length);
    }

    getManifestMeta(): FoxholeMapModManifestMeta | null {
        if (!this.manifest) {
            return null;
        }
        const { imagesByPath: _imagesByPath, ...meta } = this.manifest;
        return meta;
    }

    getTextureUrl(textureKey: string): string | null {
        return this.textureUrlsByKey.get(textureKey) ?? null;
    }

    hasTexture(textureKey: string): boolean {
        return this.textureUrlsByKey.has(textureKey);
    }

    ensureLoaded(): Promise<FoxholeMapModManifest | null> {
        if (!this.loadPromise) {
            this.loadPromise = this.loadMapModCache().finally(() => {
                // Keep promise so concurrent callers share the first load; reset on clear/save.
            });
        }
        return this.loadPromise;
    }

    async saveMapModCache(manifest: FoxholeMapModManifest): Promise<void> {
        if (!manifest || typeof manifest !== 'object') {
            throw new Error('Invalid map mod manifest');
        }

        const { imagesByPath = {}, ...manifestMeta } = manifest;
        await this.mapModStorage.clear();
        await this.mapModStorage.setItem(MANIFEST_KEY, manifestMeta);

        for (const [path, sourceValue] of Object.entries(imagesByPath)) {
            if (!path) {
                continue;
            }
            await this.mapModStorage.setItem(path, sourceValue);
        }
    }

    async loadMapModCache(): Promise<FoxholeMapModManifest | null> {
        const manifestMeta = await this.mapModStorage.getItem<FoxholeMapModManifestMeta>(MANIFEST_KEY);

        if (manifestMeta && typeof manifestMeta === 'object') {
            const imagesByPath: Record<string, Blob | string> = {};
            await this.mapModStorage.iterate((value, key) => {
                if (key === MANIFEST_KEY || key === LEGACY_HEXMAPS_KEY) {
                    return;
                }
                if (typeof value === 'string' || (typeof Blob !== 'undefined' && value instanceof Blob)) {
                    imagesByPath[key] = value;
                }
            });
            this.manifest = {
                ...manifestMeta,
                imagesByPath,
            };
        } else {
            const legacy = await this.mapModStorage.getItem<FoxholeMapModManifest>(LEGACY_HEXMAPS_KEY);
            this.manifest = legacy && typeof legacy === 'object' ? legacy : null;
        }

        this.registerMapModTextures();
        this.emitChange();
        return this.manifest;
    }

    private revokeObjectUrls(): void {
        if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
            this.objectUrls = [];
            return;
        }
        for (const objectUrl of this.objectUrls) {
            try {
                URL.revokeObjectURL(objectUrl);
            } catch {
                // ignore invalid/revoked URLs
            }
        }
        this.objectUrls = [];
    }

    private registerMapModTextures(): void {
        const imagesByPath = this.manifest?.imagesByPath || {};
        this.revokeObjectUrls();
        this.textureUrlsByKey.clear();

        for (const [path, sourceValue] of Object.entries(imagesByPath)) {
            const textureKey = getTextureKeyFromPath(path);
            if (!textureKey) {
                continue;
            }

            let src: string | null = null;
            if (typeof sourceValue === 'string') {
                src = sourceValue;
            } else if (
                typeof Blob !== 'undefined'
                && sourceValue instanceof Blob
                && typeof URL !== 'undefined'
                && typeof URL.createObjectURL === 'function'
            ) {
                src = URL.createObjectURL(sourceValue);
                this.objectUrls.push(src);
            }

            if (!src) {
                continue;
            }
            this.textureUrlsByKey.set(textureKey, src);
        }
    }

    async refreshMapModCache(): Promise<boolean> {
        this.loadPromise = null;
        await this.loadMapModCache();
        return this.hasImportedMapMod();
    }

    async clearMapModCache(): Promise<boolean> {
        await this.mapModStorage.clear();
        this.revokeObjectUrls();
        this.manifest = null;
        this.textureUrlsByKey.clear();
        this.loadPromise = null;
        this.emitChange();
        return true;
    }

    /** Adapter shape expected by the ported ModImporter / PakImporter. */
    createImporterGameAdapter(): {
        data: {
            foxhole: {
                maps: Record<string, { key: string; textureKey: string; }>;
            };
        };
        foxholeMap: FoxholeMapModStore;
        constructionMenuComponent: null;
    } {
        const maps: Record<string, { key: string; textureKey: string; }> = {};
        for (const region of FOXHOLE_MAP_REGIONS) {
            maps[region.key] = {
                key: region.key,
                textureKey: region.textureKey,
            };
        }
        return {
            data: {
                foxhole: {
                    maps,
                },
            },
            foxholeMap: this,
            constructionMenuComponent: null,
        };
    }
}

let sharedMapModStore: FoxholeMapModStore | null = null;

export function getFoxholeMapModStore(): FoxholeMapModStore {
    if (!sharedMapModStore) {
        sharedMapModStore = new FoxholeMapModStore();
        registerShellProgressCancelHandler('map-mod-import', () => {
            sharedMapModStore?.requestCancelImport();
        });
        void sharedMapModStore.ensureLoaded().catch(error => {
            console.warn('[foxhole:map-mod] Failed to load map mod cache:', error);
        });
    }
    return sharedMapModStore;
}
