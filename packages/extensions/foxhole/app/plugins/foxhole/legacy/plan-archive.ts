import { checkLegacyBlueprintSave } from '#foxhole/utils/legacy-blueprint-save.ts';
import JSZip from 'jszip';
import { decompressLegacyLzma } from './plan-lzma.ts';
import type { LegacyPlanArchiveAsset, LegacyPlanArchiveContents, LegacyPlanSave } from './plan-types.ts';
import { LEGACY_BLUEPRINT_LIMITS, checkLegacyBlueprintZip } from '#nixie/utils/legacy-blueprint-archive-bounds.ts';

async function boundedZipEntry(file: JSZip.JSZipObject, expected: number, deadline: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const chunks: Uint8Array[] = [];
        let total = 0;
        // JSZip 3.10.1 supports per-entry streams but omits this method from JSZipObject's declaration.
        const stream = (file as JSZip.JSZipObject & {
            internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
        }).internalStream('uint8array');
        stream.on('data', chunk => {
            total += chunk.length;
            if (total > expected || Date.now() > deadline) {
                stream.pause();
                reject(new Error('Blueprint ZIP expansion exceeds import limit.'));
                return;
            }
            chunks.push(chunk);
        }).on('error', reject).on('end', () => {
            if (total !== expected) {
                reject(new Error('Blueprint ZIP size is inconsistent.'));
                return;
            }
            const bytes = new Uint8Array(total);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.length;
            }
            resolve(bytes);
        }).resume();
    });
}

function toUint8Array(source: ArrayBuffer | Uint8Array | Buffer): Uint8Array {
    if (source instanceof Uint8Array) {
        return source;
    }
    return new Uint8Array(source);
}

function cloneJson<T>(value: T): T {
    return structuredClone(value);
}

function decodeUtf8(bytes: Uint8Array): string {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function looksLikeZip(bytes: Uint8Array): boolean {
    return bytes.length >= 4
        && bytes[0] === 0x50
        && bytes[1] === 0x4b
        && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
        && (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
}

function parseLegacyProjectJson(projectText: string): LegacyPlanSave {
    try {
        return JSON.parse(projectText) as LegacyPlanSave;
    } catch (error) {
        throw new Error(`Failed to parse legacy plan project JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export function isLegacyPlanSave(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.roots) || (record.settings && typeof record.settings === 'object')) {
        return false;
    }
    return Array.isArray(record.entities)
        || typeof record.version === 'string'
        || typeof record.version === 'number';
}

/**
 * Reads legacy Foxhole `.plan` / `.zip` archives or bare `project.json` payloads.
 */
export class LegacyPlanArchiveReader {
    private readonly bounded: boolean;
    constructor(bounded = false) {
        this.bounded = bounded;
    }

    async read(source: ArrayBuffer | Uint8Array | Buffer): Promise<LegacyPlanArchiveContents> {
        const deadline = Date.now() + LEGACY_BLUEPRINT_LIMITS.elapsedMs;
        const rawBytes = toUint8Array(source);
        if (this.bounded && (rawBytes.length > LEGACY_BLUEPRINT_LIMITS.archiveBytes || !looksLikeZip(rawBytes))) {
            throw new Error('Blueprint bridge requires a bounded ZIP archive.');
        }

        if (!looksLikeZip(rawBytes)) {
            const projectText = decodeUtf8(rawBytes).replace(/^\uFEFF/, '');
            const trimmed = projectText.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                const projectJson = parseLegacyProjectJson(projectText);
                if (!isLegacyPlanSave(projectJson)) {
                    throw new Error('JSON file is not a legacy Foxhole plan save');
                }
                return {
                    rawZipBytes: new Uint8Array(),
                    projectJson: cloneJson(projectJson),
                    assets: [],
                    compressed: false,
                };
            }
            throw new Error('Legacy plan file is not a zip archive or JSON save');
        }

        const sizes = this.bounded ? checkLegacyBlueprintZip(rawBytes) : null;
        const zip = await JSZip.loadAsync(rawBytes);
        const lzmaFile = zip.file('project.lzma');
        const jsonFile = zip.file('project.json');

        let projectText: string;
        let compressed = false;
        if (lzmaFile) {
            const compressedBytes = sizes ? await boundedZipEntry(lzmaFile, sizes.get('project.lzma')!, deadline) : await lzmaFile.async('uint8array');
            projectText = decompressLegacyLzma(compressedBytes, this.bounded);
            compressed = true;
        } else if (jsonFile) {
            projectText = sizes ? decodeUtf8(await boundedZipEntry(jsonFile, sizes.get('project.json')!, deadline)) : await jsonFile.async('string');
        } else {
            throw new Error('Legacy plan archive is missing project.lzma and project.json');
        }

        const projectJson = parseLegacyProjectJson(projectText);
        if (this.bounded) {
            checkLegacyBlueprintSave(projectJson);
        }
        const assets: LegacyPlanArchiveAsset[] = [];
        const assetFolder = zip.folder('assets');
        if (assetFolder) {
            const assetFiles = Object.values(zip.files).filter(file => (
                !file.dir
                && file.name.startsWith('assets/')
                && file.name !== 'assets/'
            ));
            for (const file of assetFiles) {
                assets.push({
                    path: file.name,
                    bytes: sizes ? await boundedZipEntry(file, sizes.get(file.name)!, deadline) : await file.async('uint8array'),
                });
            }
        }

        if (this.bounded && Date.now() > deadline) {
            throw new Error('Blueprint archive processing exceeds the import time limit.');
        }
        return {
            rawZipBytes: new Uint8Array(rawBytes),
            projectJson: cloneJson(projectJson),
            assets,
            compressed,
        };
    }

    async readFromJson(projectJson: LegacyPlanSave): Promise<LegacyPlanArchiveContents> {
        return {
            rawZipBytes: new Uint8Array(),
            projectJson: cloneJson(projectJson),
            assets: [],
            compressed: false,
        };
    }
}

export async function isLegacyPlanArchiveBytes(source: ArrayBuffer | Uint8Array | Buffer): Promise<boolean> {
    const rawBytes = toUint8Array(source);
    if (!looksLikeZip(rawBytes)) {
        try {
            const text = decodeUtf8(rawBytes).replace(/^\uFEFF/, '').trim();
            if (!(text.startsWith('{') || text.startsWith('['))) {
                return false;
            }
            return isLegacyPlanSave(JSON.parse(text));
        } catch {
            return false;
        }
    }

    try {
        const zip = await JSZip.loadAsync(rawBytes);
        if (zip.file('project.lzma')) {
            return true;
        }
        const jsonFile = zip.file('project.json');
        if (!jsonFile) {
            return false;
        }
        const text = await jsonFile.async('string');
        return isLegacyPlanSave(JSON.parse(text));
    } catch {
        return false;
    }
}
