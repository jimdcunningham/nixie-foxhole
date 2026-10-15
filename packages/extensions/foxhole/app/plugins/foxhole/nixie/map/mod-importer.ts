import { getFoxholeMapModStore } from './mod-store.ts';
import type { FoxholeMapModImportProgress } from './mod-store.ts';
import { ModImporter } from './mod-pak.js';

export interface FoxholeMapModImportResult {
    pngCount: number;
    processedCount: number;
    total?: number;
    pakName?: string;
    mapCount?: number;
    outputDir?: string;
    mapDir?: string;
    cancelled?: boolean;
}

export type FoxholeMapModProgressCallback = (progress: FoxholeMapModImportProgress) => void;

function asArrayBufferContents(contents: ArrayBuffer | Blob): ArrayBuffer | Blob {
    return contents;
}

/**
 * Import a Unreal .pak hex-map mod into the device-local map-mod store.
 */
export async function importFoxholeMapModPak(options: {
    contents: ArrayBuffer | Blob;
    fileName?: string;
    onProgress?: FoxholeMapModProgressCallback;
}): Promise<FoxholeMapModImportResult> {
    const store = getFoxholeMapModStore();
    const game = store.createImporterGameAdapter();
    return await ModImporter.importPak({
        game,
        contents: asArrayBufferContents(options.contents),
        fileName: options.fileName ?? 'mod.pak',
        onProgress: options.onProgress,
    }) as FoxholeMapModImportResult;
}

/**
 * Import loose PNG hex-map textures into the device-local map-mod store.
 * Each entry should provide `{ file: File, data: Blob }` matching legacy game-kitchen shape.
 */
export async function importFoxholeMapModPngFiles(options: {
    files: Array<{ file: File; data: Blob; }>;
    onProgress?: FoxholeMapModProgressCallback;
}): Promise<FoxholeMapModImportResult> {
    const store = getFoxholeMapModStore();
    const game = store.createImporterGameAdapter();
    return await ModImporter.importPngFiles({
        game,
        files: options.files,
        onProgress: options.onProgress,
    }) as FoxholeMapModImportResult;
}

export { ModImporter };
