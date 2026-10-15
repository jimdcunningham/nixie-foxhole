declare module './mod-pak.js' {
    export function getMapModFastDecodeMode(): boolean;
    export function setMapModFastDecodeMode(enabled: boolean): boolean;

    export function diagnoseMapModPak(buffer: ArrayBuffer, options?: {
        limit?: number;
        includeFingerprints?: boolean;
    }): {
        version: number;
        fastDecodeMode: boolean;
        generatorPayloadStartHint: number;
        bc7: { width: number; height: number; textureSize: number; };
        mapCount: number;
        diagnosedCount: number;
        startHistogram: Record<string, number>;
        entries: Array<Record<string, unknown>>;
        buildDdsForEntry: (index?: number) => {
            region: string | null;
            assetPath: string;
            width: number;
            height: number;
            start: number;
            source: string;
            dds: Uint8Array;
        } | null;
        importer: PakImporter;
        maps: unknown[];
    };

    export class PakImporter {
        constructor(buffer: ArrayBuffer);
        exportHexMaps(options?: { skipDecode?: boolean; }): Array<{
            region: string | null;
            assetPath: string;
            format: string;
            blob: Blob | null;
            raw: {
                uasset: ArrayBuffer | null;
                uexp: ArrayBuffer | null;
                ubulk: ArrayBuffer | null;
            };
        }>;
        extractGeneratorBc7PayloadMeta(assetData: unknown): {
            payload: Uint8Array;
            start: number;
            source: string;
            width: number;
            height: number;
            payloadSize: number;
            formatCandidates: string[];
            bytesPerBlock: number;
            footerLen?: number;
            footerOffset?: number;
            headerShift?: number;
        } | null;
        getTextureDiagnostics(mapData: unknown): Record<string, unknown>;
        mapToPngBlob(mapData: unknown): Promise<Blob | null>;
        importHexMaps(options?: Record<string, unknown>): Promise<{
            pakName: string;
            mapCount: number;
            processedCount: number;
            pngCount: number;
            outputDir: string;
        }>;
    }

    export class ModImporter {
        static importPak(options: {
            game: unknown;
            contents: ArrayBuffer | Blob;
            fileName?: string;
            onProgress?: ((progress: Record<string, unknown>) => void) | null;
        }): Promise<{
            pakName: string;
            mapCount: number;
            processedCount: number;
            pngCount: number;
            outputDir: string;
        }>;

        static importPngFiles(options: {
            game: unknown;
            files: Array<{ file: File; data: Blob; }>;
            onProgress?: ((progress: Record<string, unknown>) => void) | null;
        }): Promise<{
            pngCount: number;
            processedCount: number;
            total: number;
            mapDir: string;
        }>;
    }
}
