import { gunzipSync, unzlibSync } from 'fflate';

const PAK_MAGIC = 0x5a6f12e1;

const MAP_MOD_LOG_TAG = '[foxhole:map-mod]';

/**
 * Dev-only by default (mirrors nixieLogInfo).
 * Harness can set globalThis.__FOXHOLE_MAP_MOD_FORCE_LOG__ = true.
 */
function mapModLogsEnabled() {
    try {
        if (import.meta.dev) {
            return true;
        }
    } catch {
        // ignore environments without import.meta.dev
    }
    return globalThis.__FOXHOLE_MAP_MOD_FORCE_LOG__ === true;
}

function mapModLogInfo(...args) {
    if (!mapModLogsEnabled()) {
        return;
    }
    console.info(MAP_MOD_LOG_TAG, ...args);
}

function mapModLogWarn(...args) {
    if (!mapModLogsEnabled()) {
        return;
    }
    console.warn(MAP_MOD_LOG_TAG, ...args);
}

function toNumberSafe(value) {
    const num = Number(value);
    if (!Number.isSafeInteger(num)) {
        throw new Error(`Integer exceeds JS safe range: ${value}`);
    }
    return num;
}

function toHex(bytes, maxLen = 128) {
    if (!bytes || !bytes.length) {
        return '';
    }
    const len = Math.min(maxLen, bytes.length);
    let out = '';
    for (let i = 0; i < len; i++) {
        out += bytes[i].toString(16).padStart(2, '0');
    }
    return out;
}

class BinaryReader {
    constructor(buffer, offset = 0) {
        this.buffer = buffer;
        this.view = new DataView(buffer);
        this.offset = offset;
        this.length = buffer.byteLength;
        this.utf8 = new TextDecoder('utf-8');
        this.utf16 = new TextDecoder('utf-16le');
    }

    seek(offset) {
        this.offset = offset;
    }

    skip(bytes) {
        this.offset += bytes;
    }

    u8() {
        const value = this.view.getUint8(this.offset);
        this.offset += 1;
        return value;
    }

    i32() {
        const value = this.view.getInt32(this.offset, true);
        this.offset += 4;
        return value;
    }

    u32() {
        const value = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return value;
    }

    i64() {
        const value = this.view.getBigInt64(this.offset, true);
        this.offset += 8;
        return toNumberSafe(value);
    }

    u64() {
        const value = this.view.getBigUint64(this.offset, true);
        this.offset += 8;
        return toNumberSafe(value);
    }

    bytes(size) {
        if (!Number.isInteger(size) || size < 0) {
            throw new Error(`Invalid byte read size: ${size}`);
        }
        if (this.offset + size > this.length) {
            throw new Error(
                `Out-of-bounds read (offset=${this.offset}, size=${size}, length=${this.length})`,
            );
        }
        const start = this.offset;
        this.offset += size;
        return new Uint8Array(this.buffer, start, size);
    }

    fstring() {
        const strLen = this.i32();
        if (strLen === 0) {
            return '';
        }
        if (Math.abs(strLen) > 1024 * 1024) {
            throw new Error(`Invalid FString length: ${strLen}`);
        }

        if (strLen > 0) {
            // ANSI/UTF-8 string, includes null terminator.
            const raw = this.bytes(strLen);
            const end = raw.length > 0 && raw[raw.length - 1] === 0 ? raw.length - 1 : raw.length;
            return this.utf8.decode(raw.subarray(0, end));
        }

        // UTF-16LE string, length is negative and includes null terminator.
        const charCount = Math.abs(strLen);
        const byteCount = charCount * 2;
        const raw = this.bytes(byteCount);
        const endBytes
            = raw.length >= 2 && raw[raw.length - 1] === 0 && raw[raw.length - 2] === 0
                ? raw.length - 2
                : raw.length;
        return this.utf16.decode(raw.subarray(0, endBytes));
    }
}

class UnrealPakReader {
    constructor(buffer) {
        this.buffer = buffer;
        this.bytes = new Uint8Array(buffer);
        this.reader = new BinaryReader(buffer);
        this.info = null;
        this.mountPoint = '';
        this.entries = [];
        this.lastDiagnostics = null;
    }

    collectFooterCandidates(maxCandidates = 16, scanWindow = 65536) {
        const fileSize = this.buffer.byteLength;
        const view = this.reader.view;
        const scanStart = Math.max(0, fileSize - scanWindow);
        const candidates = [];

        for (let i = fileSize - 4; i >= scanStart; i--) {
            if (view.getUint32(i, true) !== PAK_MAGIC) {
                continue;
            }

            const candidate = {
                magicOffset: i,
                version: null,
                indexOffset: null,
                indexSize: null,
                validBounds: false,
                error: null,
            };

            try {
                candidate.version = view.getInt32(i + 4, true);
                candidate.indexOffset = toNumberSafe(view.getBigUint64(i + 8, true));
                candidate.indexSize = toNumberSafe(view.getBigUint64(i + 16, true));
                candidate.validBounds
                    = candidate.version >= 1
                        && candidate.version <= 12
                        && candidate.indexOffset >= 0
                        && candidate.indexSize > 0
                        && candidate.indexOffset + candidate.indexSize <= fileSize;
            } catch (error) {
                candidate.error = error?.message || String(error);
            }

            candidates.push(candidate);
            if (candidates.length >= maxCandidates) {
                break;
            }
        }
        return candidates;
    }

    findPakInfo() {
        const fileSize = this.buffer.byteLength;
        const view = this.reader.view;
        const scanStart = Math.max(0, fileSize - 4096);
        let footerError = null;

        for (let i = fileSize - 44; i >= scanStart; i--) {
            if (view.getUint32(i, true) !== PAK_MAGIC) {
                continue;
            }

            const version = view.getInt32(i + 4, true);
            if (version < 1 || version > 12) {
                continue;
            }
            let indexOffset;
            let indexSize;
            try {
                indexOffset = toNumberSafe(view.getBigUint64(i + 8, true));
                indexSize = toNumberSafe(view.getBigUint64(i + 16, true));
            } catch {
                // False positive magic in payload; keep scanning.
                continue;
            }

            if (indexOffset < 0 || indexSize <= 0 || indexOffset + indexSize > i) {
                continue;
            }

            let compressionMethods = null;
            let indexEncrypted = false;
            if (version === 8) {
                // Foxhole's UE4.24 uses v8B: a GUID and encryption flag before
                // the magic, and five null-terminated 32-byte names after the hash.
                // The earlier UE4.22 v8A footer/entry layout is incompatible.
                if (i < 17 || i + 44 + 5 * 32 !== fileSize || indexOffset + indexSize > i - 17) {
                    footerError = new Error('Unsupported or invalid pak v8 footer; expected the UE4.23/4.24 format.');
                    continue;
                }
                compressionMethods = [];
                for (let slot = 0; slot < 5; slot++) {
                    const raw = this.bytes.subarray(i + 44 + slot * 32, i + 44 + (slot + 1) * 32);
                    const end = raw.indexOf(0);
                    if (end === -1) {
                        footerError = new Error('Invalid pak v8 compression name table.');
                        compressionMethods = null;
                        break;
                    }
                    // Preserve empty slots: method IDs are one-based table indexes.
                    compressionMethods.push(this.reader.utf8.decode(raw.subarray(0, end)));
                }
                if (!compressionMethods) {
                    continue;
                }
                indexEncrypted = this.bytes[i - 1] !== 0;
            }

            this.info = {
                magicOffset: i,
                version,
                indexOffset,
                indexSize,
                compressionMethods,
                indexEncrypted,
            };
            return this.info;
        }

        throw footerError || new Error('Could not locate Unreal pak footer.');
    }

    readLegacyIndex() {
        if (!this.info) {
            this.findPakInfo();
        }
        if (this.info.indexEncrypted) {
            throw new Error('Encrypted pak indexes are not supported.');
        }

        const diagnostics = {
            fileSize: this.buffer.byteLength,
            info: { ...this.info },
            mountPoint: null,
            fileCount: null,
            indexPrefixHex: '',
            firstEntryStart: null,
            firstEntryHex: '',
            firstEntryLayoutAttempts: [],
            parseError: null,
            footerCandidates: this.collectFooterCandidates(),
        };

        this.reader.seek(this.info.indexOffset);
        diagnostics.indexPrefixHex = toHex(new Uint8Array(this.buffer, this.info.indexOffset, Math.min(128, this.info.indexSize)));
        this.mountPoint = this.reader.fstring();
        diagnostics.mountPoint = this.mountPoint;

        const fileCount = this.reader.i32();
        diagnostics.fileCount = fileCount;
        if (fileCount < 0 || fileCount > 500000) {
            this.lastDiagnostics = diagnostics;
            throw new Error(`Invalid file count in pak index: ${fileCount}`);
        }

        const entries = [];
        const indexEnd = this.info.indexOffset + this.info.indexSize;

        const isLikelyAssetPath = path => {
            if (!path || typeof path !== 'string') {
                return false;
            }
            if (path.length < 3 || path.length > 2048) {
                return false;
            }
            for (const char of path) {
                const code = char.charCodeAt(0);
                if (code < 32 || code === 127 || code === 0xfffd) {
                    return false;
                }
            }
            // Most pak entries include an extension.
            if (!path.includes('.')) {
                return false;
            }
            return true;
        };

        const parseEntryVariant = (startOffset, layout) => {
            const r = this.reader;
            r.seek(startOffset);
            if (layout.prefixEntrySize) {
                const entrySize = r.u32();
                if (entrySize <= 0 || entrySize > 8192) {
                    throw new Error(`Invalid entry size prefix: ${entrySize}`);
                }
            }

            const readNum = () => (layout.numBits === 32 ? r.u32() : r.u64());

            const offset = readNum();
            const size = readNum();
            const uncompressedSize = readNum();
            let compressionMethod = 0;

            if (layout.hashBeforeCompression && layout.hasHash) {
                r.skip(20);
            }

            compressionMethod = r.u32();

            if (!layout.hashBeforeCompression && layout.hasHash) {
                r.skip(20);
            }

            if (layout.includeTimestamp) {
                r.skip(8);
            }

            let compressionBlocks = null;
            let encrypted = false;
            let compressionBlockSize = 0;
            if (layout.includeCompressionFields) {
                compressionBlocks = [];
                if (compressionMethod !== 0) {
                    const blockCount = r.u32();
                    if (blockCount > 100000) {
                        throw new Error(`Invalid compressed block count: ${blockCount}`);
                    }
                    for (let i = 0; i < blockCount; i++) {
                        compressionBlocks.push({ start: r.u64(), end: r.u64() });
                    }
                }
                encrypted = (r.u8() & 1) !== 0;
                compressionBlockSize = r.u32();
            }

            if (layout.trailingU32) {
                r.u32();
            }

            if (layout.postSkipBytes) {
                r.skip(layout.postSkipBytes);
            }

            if (offset < 0 || size < 0 || uncompressedSize < 0 || offset + size > this.buffer.byteLength) {
                throw new Error('Invalid entry bounds');
            }

            return {
                nextOffset: r.offset,
                entry: {
                    offset,
                    size,
                    uncompressedSize,
                    compressionMethod,
                    compressionBlocks,
                    encrypted,
                    compressionBlockSize,
                    inlineHeaderSize: layout.numBits === 64 && !layout.hashBeforeCompression
                        ? r.offset - startOffset - (layout.prefixEntrySize ? 4 : 0)
                        : null,
                },
            };
        };

        let fixedLayout = null;
        const entryLayouts = [
            // Prefer Unreal's standard layout. An uncompressed entry has the
            // same byte length as older variants, but only this layout also
            // parses compression blocks when a later entry is compressed.
            { numBits: 64, prefixEntrySize: false, hasHash: true, hashBeforeCompression: false, includeTimestamp: false, includeCompressionFields: true },
            { numBits: 64, prefixEntrySize: false, hasHash: true, hashBeforeCompression: false, includeTimestamp: false, includeCompressionFields: false },
            { numBits: 64, prefixEntrySize: false, hasHash: true, hashBeforeCompression: false, includeTimestamp: false, includeCompressionFields: false, trailingU32: true },
            { numBits: 64, prefixEntrySize: false, hasHash: true, hashBeforeCompression: false, includeTimestamp: false, includeCompressionFields: false, trailingU32: true, postSkipBytes: 1 },
            { numBits: 64, prefixEntrySize: false, hasHash: true, hashBeforeCompression: false, includeTimestamp: true, includeCompressionFields: false },
            { numBits: 64, prefixEntrySize: false, hasHash: true, hashBeforeCompression: false, includeTimestamp: true, includeCompressionFields: true },
            { numBits: 64, prefixEntrySize: false, hasHash: true, hashBeforeCompression: true, includeTimestamp: false, includeCompressionFields: false },
            { numBits: 64, prefixEntrySize: false, hasHash: true, hashBeforeCompression: true, includeTimestamp: false, includeCompressionFields: false, trailingU32: true },
            { numBits: 64, prefixEntrySize: false, hasHash: true, hashBeforeCompression: true, includeTimestamp: false, includeCompressionFields: false, trailingU32: true, postSkipBytes: 1 },
            { numBits: 64, prefixEntrySize: false, hasHash: true, hashBeforeCompression: true, includeTimestamp: true, includeCompressionFields: false },
            { numBits: 64, prefixEntrySize: false, hasHash: false, hashBeforeCompression: false, includeTimestamp: false, includeCompressionFields: false },
            { numBits: 64, prefixEntrySize: false, hasHash: false, hashBeforeCompression: false, includeTimestamp: false, includeCompressionFields: false, trailingU32: true },
            { numBits: 64, prefixEntrySize: false, hasHash: false, hashBeforeCompression: false, includeTimestamp: false, includeCompressionFields: false, trailingU32: true, postSkipBytes: 1 },
            { numBits: 64, prefixEntrySize: false, hasHash: false, hashBeforeCompression: false, includeTimestamp: true, includeCompressionFields: false },
            { numBits: 64, prefixEntrySize: true, hasHash: true, hashBeforeCompression: false, includeTimestamp: false, includeCompressionFields: false },
            { numBits: 64, prefixEntrySize: true, hasHash: true, hashBeforeCompression: false, includeTimestamp: true, includeCompressionFields: false },
            { numBits: 64, prefixEntrySize: true, hasHash: false, hashBeforeCompression: false, includeTimestamp: false, includeCompressionFields: false },
            { numBits: 32, prefixEntrySize: false, hasHash: true, hashBeforeCompression: false, includeTimestamp: false, includeCompressionFields: false },
            { numBits: 32, prefixEntrySize: false, hasHash: true, hashBeforeCompression: false, includeTimestamp: true, includeCompressionFields: false },
        ];

        const tryParseEntry = (entryStart, entryIndex) => {
            const variants = fixedLayout ? [fixedLayout] : entryLayouts;
            for (const layout of variants) {
                const layoutLabel = JSON.stringify(layout);
                try {
                    const parsed = parseEntryVariant(entryStart, layout);
                    const next = parsed.nextOffset;
                    if (next > indexEnd || (entryIndex === fileCount - 1 && next !== indexEnd)) {
                        if (entryIndex === 0) {
                            diagnostics.firstEntryLayoutAttempts.push({
                                layout: layoutLabel,
                                ok: false,
                                reason: 'invalidIndexEnd',
                                nextOffset: next,
                                indexEnd,
                            });
                        }
                        continue;
                    }
                    if (entryIndex < fileCount - 1) {
                        if (next + 4 > indexEnd) {
                            if (entryIndex === 0) {
                                diagnostics.firstEntryLayoutAttempts.push({
                                    layout: layoutLabel,
                                    ok: false,
                                    reason: 'nextOffset+4>indexEnd',
                                    nextOffset: next,
                                    indexEnd,
                                });
                            }
                            continue;
                        }

                        // Strong validation: ensure we can parse the next path.
                        let nextPath;
                        try {
                            const nextReader = new BinaryReader(this.buffer, next);
                            nextPath = nextReader.fstring();
                        } catch {
                            if (entryIndex === 0) {
                                diagnostics.firstEntryLayoutAttempts.push({
                                    layout: layoutLabel,
                                    ok: false,
                                    reason: 'nextPathReadFailed',
                                    nextOffset: next,
                                });
                            }
                            continue;
                        }
                        if (!isLikelyAssetPath(nextPath)) {
                            if (entryIndex === 0) {
                                diagnostics.firstEntryLayoutAttempts.push({
                                    layout: layoutLabel,
                                    ok: false,
                                    reason: 'nextPathNotLikelyAsset',
                                    nextOffset: next,
                                    nextPathPreview: nextPath.slice(0, 120),
                                });
                            }
                            continue;
                        }
                        if (entryIndex === 0) {
                            diagnostics.firstEntryLayoutAttempts.push({
                                layout: layoutLabel,
                                ok: true,
                                nextOffset: next,
                                nextPathPreview: nextPath.slice(0, 120),
                            });
                        }
                    }
                    if (!fixedLayout) {
                        fixedLayout = layout;
                    }
                    return parsed;
                } catch {
                    if (entryIndex === 0) {
                        diagnostics.firstEntryLayoutAttempts.push({
                            layout: layoutLabel,
                            ok: false,
                            reason: 'parseEntryVariantFailed',
                        });
                    }
                    // Try next layout.
                }
            }

            throw new Error(`Unsupported pak entry layout at index entry ${entryIndex}`);
        };

        const findFirstEntryOffset = startOffset => {
            const maxProbe = Math.min(indexEnd - 32, startOffset + 4096);
            for (let probe = startOffset; probe <= maxProbe; probe++) {
                try {
                    const probeReader = new BinaryReader(this.buffer, probe);
                    const probePath = probeReader.fstring();
                    if (!isLikelyAssetPath(probePath)) {
                        continue;
                    }
                    const parsed = tryParseEntry(probeReader.offset, 0);
                    if (parsed.nextOffset <= indexEnd) {
                        return probe;
                    }
                } catch {
                    // keep probing
                }
            }
            return startOffset;
        };

        // Newer pak versions can prepend index metadata blocks before file records.
        if (fileCount > 0) {
            const firstEntryOffset = findFirstEntryOffset(this.reader.offset);
            this.reader.seek(firstEntryOffset);
            diagnostics.firstEntryStart = firstEntryOffset;
            diagnostics.firstEntryHex = toHex(
                new Uint8Array(this.buffer, firstEntryOffset, Math.min(128, indexEnd - firstEntryOffset)),
            );
        }

        try {
            for (let i = 0; i < fileCount; i++) {
                const path = this.reader.fstring().replaceAll('\\', '/');
                const entryStart = this.reader.offset;
                const parsed = tryParseEntry(entryStart, i);
                this.reader.seek(parsed.nextOffset);
                entries.push({ path, ...parsed.entry });
            }
        } catch (error) {
            diagnostics.parseError = error?.message || String(error);
            this.lastDiagnostics = diagnostics;
            throw error;
        }

        this.entries = entries;
        this.lastDiagnostics = diagnostics;
        return entries;
    }

    diagnose() {
        const fileSize = this.buffer.byteLength;
        const footerCandidates = this.collectFooterCandidates();
        let selectedFooter = null;
        let parseResult = null;

        try {
            selectedFooter = this.findPakInfo();
        } catch (error) {
            parseResult = {
                ok: false,
                stage: 'findPakInfo',
                error: error?.message || String(error),
            };
            return {
                fileSize,
                footerCandidates,
                selectedFooter,
                parseResult,
            };
        }

        try {
            this.readLegacyIndex();
            parseResult = {
                ok: true,
                stage: 'readLegacyIndex',
                mountPoint: this.mountPoint,
                entryCount: this.entries.length,
            };
        } catch (error) {
            parseResult = {
                ok: false,
                stage: 'readLegacyIndex',
                error: error?.message || String(error),
                details: this.lastDiagnostics,
            };
        }

        return {
            fileSize,
            footerCandidates,
            selectedFooter,
            parseResult,
        };
    }

    listEntries() {
        if (!this.entries.length) {
            this.readLegacyIndex();
        }
        return this.entries;
    }

    readEntry(entry) {
        if (entry.encrypted) {
            throw new Error(`Encrypted pak entries are not supported: ${entry.path}`);
        }
        if (entry.compressionMethod !== 0) {
            return this.readCompressedEntry(entry);
        }
        const fileSize = this.buffer.byteLength;
        const base = entry.offset;
        let dataStart = base;

        // Inline FPakEntry offsets are normally zero, even for nonzero index offsets.
        // Use the index's serialized header length for every segment, including raw bulk data.
        if (entry.inlineHeaderSize && base + entry.inlineHeaderSize <= fileSize) {
            const r = new BinaryReader(this.buffer, base);
            const inlineOffset = r.u64();
            const inlineSize = r.u64();
            const inlineUncompressedSize = r.u64();
            const inlineCompression = r.u32();
            if ((inlineOffset === 0 || inlineOffset === base)
                && inlineSize === entry.size
                && inlineUncompressedSize === entry.uncompressedSize
                && inlineCompression === entry.compressionMethod) {
                dataStart = base + entry.inlineHeaderSize;
            }
        }

        // Preserve alignment for older index layouts without serialized header metadata.
        if (dataStart === base && (entry.path || '').toLowerCase().endsWith('.uasset')) {
            const end = Math.min(fileSize - entry.size, base + 8192);
            for (let i = base; i <= end; i++) {
                if (this.bytes[i] !== 0xc1 || this.bytes[i + 1] !== 0x83
                    || this.bytes[i + 2] !== 0x2a || this.bytes[i + 3] !== 0x9e) {
                    continue;
                }
                const version = readU32(this.bytes, i + 4) | 0;
                if (version <= -1 && version >= -200) {
                    dataStart = i;
                    break;
                }
            }
        }
        if (dataStart < 0 || dataStart + entry.size > fileSize) {
            throw new Error(`Invalid uncompressed entry bounds: ${entry.path}`);
        }

        return this.buffer.slice(dataStart, dataStart + entry.size);
    }

    readCompressedEntry(entry) {
        const version = this.info.version;
        const codec = version === 8
            ? this.info.compressionMethods?.[entry.compressionMethod - 1]
            : ({ 1: 'Zlib', 2: 'Gzip' })[entry.compressionMethod];
        const decompress = codec?.toLowerCase() === 'zlib'
            ? unzlibSync
            : codec?.toLowerCase() === 'gzip' ? gunzipSync : null;
        if (version < 3 || version > 8 || !decompress) {
            throw new Error(`Unsupported pak compression method ${entry.compressionMethod}${codec ? ` (${codec})` : ''} (pak v${version}): ${entry.path}`);
        }
        const blocks = entry.compressionBlocks;
        const blockSize = entry.compressionBlockSize;
        if (!blocks?.length || blockSize <= 0 || blockSize > 16 * 1024 * 1024
            || entry.uncompressedSize <= 0 || entry.uncompressedSize > 256 * 1024 * 1024
            || blocks.length !== Math.ceil(entry.uncompressedSize / blockSize)) {
            throw new Error(`Invalid compressed block metadata: ${entry.path}`);
        }

        // Pak v5 changed block ranges from absolute to relative to the entry.
        const base = this.info.version >= 5 ? entry.offset : 0;
        const dataEnd = this.info.indexOffset;
        let compressedSize = 0;
        let previousEnd = entry.offset;
        for (const block of blocks) {
            const start = base + block.start;
            const end = base + block.end;
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
                || start < previousEnd || end <= start || end > dataEnd) {
                throw new Error(`Invalid compressed block bounds: ${entry.path}`);
            }
            compressedSize += end - start;
            previousEnd = end;
        }
        if (compressedSize !== entry.size) {
            throw new Error(`Invalid compressed block sizes: ${entry.path}`);
        }

        const output = new Uint8Array(entry.uncompressedSize);
        let outputOffset = 0;
        for (const block of blocks) {
            const expectedSize = Math.min(blockSize, output.length - outputOffset);
            let decoded;
            try {
                // One extra byte lets us detect oversized output while keeping
                // decompression bounded by the advertised block size.
                decoded = decompress(this.bytes.subarray(base + block.start, base + block.end), {
                    out: new Uint8Array(expectedSize + 1),
                });
            } catch (error) {
                throw new Error(`Failed to decompress ${codec} map texture: ${entry.path}`, { cause: error });
            }
            if (decoded.length !== expectedSize) {
                throw new Error(`Decompressed block size mismatch: ${entry.path}`);
            }
            output.set(decoded, outputOffset);
            outputOffset += decoded.length;
        }
        return output.buffer;
    }
}

function normalizePath(path) {
    return (path || '').replaceAll('\\', '/');
}

function getAssetStem(path) {
    const p = normalizePath(path);
    const dot = p.lastIndexOf('.');
    return dot === -1 ? p : p.substring(0, dot);
}

function getAssetBaseName(path) {
    const p = normalizePath(path);
    const slash = p.lastIndexOf('/');
    return slash === -1 ? p : p.substring(slash + 1);
}

function hasDdsHeader(bytes) {
    return (
        bytes
        && bytes.length >= 4
        && bytes[0] === 0x44
        && bytes[1] === 0x44
        && bytes[2] === 0x53
        && bytes[3] === 0x20
    );
}

function findAsciiTokens(bytes, pattern) {
    if (!bytes?.length) {
        return [];
    }
    const text = new TextDecoder('latin1').decode(bytes);
    const matches = text.match(pattern) || [];
    return Array.from(new Set(matches));
}

function bytesToHex(bytes, maxLen = 32) {
    if (!bytes?.length) {
        return '';
    }
    const len = Math.min(maxLen, bytes.length);
    let out = '';
    for (let i = 0; i < len; i++) {
        out += bytes[i].toString(16).padStart(2, '0');
    }
    return out;
}

function findUassetHeaderOffset(bytes, maxScan = 65536) {
    if (!bytes || bytes.length < 8) {
        return -1;
    }
    const scanEnd = Math.min(bytes.length - 8, maxScan);
    for (let i = 0; i <= scanEnd; i++) {
        if (
            bytes[i] === 0xc1
            && bytes[i + 1] === 0x83
            && bytes[i + 2] === 0x2a
            && bytes[i + 3] === 0x9e
        ) {
            const ver
                = bytes[i + 4]
                    | (bytes[i + 5] << 8)
                    | (bytes[i + 6] << 16)
                    | (bytes[i + 7] << 24);
            if (ver <= -1 && ver >= -200) {
                return i;
            }
        }
    }
    return -1;
}

const FH_GENERATOR_FOOTER = new Uint8Array([
    0x00, 0x08, 0x00, 0x00, 0xf0, 0x06, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc1, 0x83, 0x2a, 0x9e,
]);
const FH_GENERATOR_FOOTER_LEN = 28;
const FH_BC7_TEXTURE_SIZE = 3637248; // 2048x1776 BC7, 1 mip
const FH_BC7_WIDTH = 2048;
const FH_BC7_HEIGHT = 1776;
const FH_GENERATOR_PAYLOAD_START_HINT = 1085;
const FH_NOISE_DIAG_SCORE_THRESHOLD = 25;
let FH_FAST_DECODE_MODE = true;

export function getMapModFastDecodeMode() {
    return FH_FAST_DECODE_MODE;
}

export function setMapModFastDecodeMode(enabled) {
    FH_FAST_DECODE_MODE = enabled === true;
    return FH_FAST_DECODE_MODE;
}

function endsWithBytes(bytes, suffix) {
    if (!bytes || bytes.length < suffix.length) {
        return false;
    }
    const start = bytes.length - suffix.length;
    for (let i = 0; i < suffix.length; i++) {
        if (bytes[start + i] !== suffix[i]) {
            return false;
        }
    }
    return true;
}

function getGeneratorFooterLength(bytes) {
    if (!bytes || bytes.length < FH_GENERATOR_FOOTER_LEN) {
        return 0;
    }
    const start = bytes.length - FH_GENERATOR_FOOTER_LEN;
    const magicOk
        = bytes[start + 24] === 0xc1
            && bytes[start + 25] === 0x83
            && bytes[start + 26] === 0x2a
            && bytes[start + 27] === 0x9e;
    if (!magicOk) {
        return 0;
    }
    const width
        = bytes[start + 0]
            | (bytes[start + 1] << 8)
            | (bytes[start + 2] << 16)
            | (bytes[start + 3] << 24);
    const height
        = bytes[start + 4]
            | (bytes[start + 5] << 8)
            | (bytes[start + 6] << 16)
            | (bytes[start + 7] << 24);
    const mipOrFlag
        = bytes[start + 8]
            | (bytes[start + 9] << 8)
            | (bytes[start + 10] << 16)
            | (bytes[start + 11] << 24);
    const zeroA
        = bytes[start + 12]
            | (bytes[start + 13] << 8)
            | (bytes[start + 14] << 16)
            | (bytes[start + 15] << 24);
    const zeroB
        = bytes[start + 20]
            | (bytes[start + 21] << 8)
            | (bytes[start + 22] << 16)
            | (bytes[start + 23] << 24);
    if (width <= 0 || width > 8192 || height <= 0 || height > 8192 || mipOrFlag !== 1 || zeroA !== 0 || zeroB !== 0) {
        return 0;
    }
    return FH_GENERATOR_FOOTER_LEN;
}

function parseGeneratorFooterAt(bytes, start) {
    if (!bytes || start < 0 || start + FH_GENERATOR_FOOTER_LEN > bytes.length) {
        return null;
    }
    const footerSlice = bytes.subarray(start, start + FH_GENERATOR_FOOTER_LEN);
    const footerLen = getGeneratorFooterLength(footerSlice);
    if (!footerLen) {
        return null;
    }
    const width
        = bytes[start + 0]
            | (bytes[start + 1] << 8)
            | (bytes[start + 2] << 16)
            | (bytes[start + 3] << 24);
    const height
        = bytes[start + 4]
            | (bytes[start + 5] << 8)
            | (bytes[start + 6] << 16)
            | (bytes[start + 7] << 24);
    return { footerLen, width, height, offset: start };
}

function findGeneratorFooter(bytes, scanWindow = 32768) {
    if (!bytes || bytes.length < FH_GENERATOR_FOOTER_LEN) {
        return null;
    }
    const minStart = Math.max(0, bytes.length - scanWindow);
    let best = null;
    let bestScore = -Infinity;
    for (let start = bytes.length - FH_GENERATOR_FOOTER_LEN; start >= minStart; start--) {
        const parsed = parseGeneratorFooterAt(bytes, start);
        if (parsed) {
            const payloadStart = start - bc7Level0Size(parsed.width, parsed.height);
            // For generator outputs, header gap is small (~1KB). Prefer that strongly.
            const plausibleHeaderGap = payloadStart >= 256 && payloadStart <= 16384;
            const distanceFromNominal = Math.abs(payloadStart - 1085);
            const score = (plausibleHeaderGap ? 100000 : 0) - distanceFromNominal;
            if (score > bestScore) {
                best = parsed;
                bestScore = score;
            }
        }
    }
    return best;
}

function parseGeneratorFooter(bytes) {
    return findGeneratorFooter(bytes);
}

function bc7Level0Size(width, height) {
    return Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
}

function rgbaLevel0Size(width, height) {
    return width * height * 4;
}

function isUncompressedRgbaPfTag(tag) {
    const normalized = String(tag || '').toUpperCase();
    return normalized === 'PF_B8G8R8A8'
        || normalized === 'PF_R8G8B8A8'
        || normalized === 'PF_A8R8G8B8';
}

function resolveUncompressedPixelLayout(pfTags = []) {
    const tags = (pfTags || []).map(tag => String(tag).toUpperCase());
    if (tags.includes('PF_B8G8R8A8') || tags.includes('PF_A8R8G8B8')) {
        // Unreal B8G8R8A8 is stored as B,G,R,A bytes.
        return { layout: 'bgra', swizzleBgra: true };
    }
    if (tags.includes('PF_R8G8B8A8')) {
        return { layout: 'rgba', swizzleBgra: false };
    }
    return null;
}

function swizzleBgraToRgbaInPlace(bytes) {
    for (let i = 0; i + 3 < bytes.length; i += 4) {
        const b = bytes[i];
        const r = bytes[i + 2];
        bytes[i] = r;
        bytes[i + 2] = b;
    }
    return bytes;
}

async function rgbaBytesToPngBlob(rgbaBytes, width, height, { swizzleBgra = false } = {}) {
    const expected = rgbaLevel0Size(width, height);
    if (!rgbaBytes || rgbaBytes.length < expected) {
        throw new Error(`RGBA payload too small (${rgbaBytes?.length ?? 0} < ${expected})`);
    }
    const pixels = rgbaBytes.length === expected
        ? new Uint8ClampedArray(rgbaBytes)
        : new Uint8ClampedArray(rgbaBytes.subarray(0, expected));
    if (swizzleBgra) {
        swizzleBgraToRgbaInPlace(pixels);
    }

    if (typeof OffscreenCanvas === 'function') {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d', { willReadFrequently: false });
        if (!ctx) {
            throw new Error('OffscreenCanvas 2d unavailable');
        }
        ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
        if (typeof canvas.convertToBlob === 'function') {
            return await canvas.convertToBlob({ type: 'image/png' });
        }
    }

    if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: false });
        if (!ctx) {
            throw new Error('Canvas 2d unavailable');
        }
        ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
        return await canvasToPngBlob(canvas);
    }

    throw new Error('No canvas PNG encoder available for RGBA textures');
}

function hash32(bytes) {
    if (!bytes?.length) {
        return 0;
    }
    let h = 2166136261 >>> 0;
    for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

function inferFormatCandidatesFromPfTags(pfTags = []) {
    const tags = new Set((pfTags || []).map(t => String(t).toUpperCase()));
    // A successful GPU upload cannot establish the codec. Honor declared formats.
    if (tags.has('PF_BC7')) {
        return ['bc7'];
    }
    if (tags.has('PF_DXT5') || tags.has('PF_BC3')) {
        return ['bc3'];
    }
    if (tags.has('PF_DXT1') || tags.has('PF_BC1')) {
        return ['bc1'];
    }
    if (tags.has('PF_DXT3')) {
        return ['dxt3'];
    }
    // Unknown: probe common block formats.
    return ['bc7', 'bc3', 'bc1', 'dxt3'];
}

function payloadFingerprint(bytes, start, size) {
    if (!bytes || start < 0 || size <= 0 || start + size > bytes.length) {
        return null;
    }
    const slice = bytes.subarray(start, start + size);
    return {
        start,
        size,
        hash32: hash32(slice).toString(16).padStart(8, '0'),
        headHex: bytesToHex(slice, 32),
        tailHex: bytesToHex(slice.subarray(Math.max(0, slice.length - 32)), 32),
    };
}

function buildDdsBc7(payload, width, height) {
    const ddsSize = 4 + 124 + 20;
    const out = new Uint8Array(ddsSize + payload.length);
    const dv = new DataView(out.buffer);
    let o = 0;
    // Magic "DDS "
    out[o++] = 0x44; out[o++] = 0x44; out[o++] = 0x53; out[o++] = 0x20;
    // DDS_HEADER (124 bytes)
    dv.setUint32(o + 0, 124, true);
    dv.setUint32(o + 4, 0x000a1007, true); // CAPS|HEIGHT|WIDTH|PIXELFORMAT|LINEARSIZE|MIPMAPCOUNT
    dv.setUint32(o + 8, height, true);
    dv.setUint32(o + 12, width, true);
    dv.setUint32(o + 16, payload.length, true); // linear size
    dv.setUint32(o + 20, 0, true); // depth
    dv.setUint32(o + 24, 1, true); // mip count
    // reserved1[11] already 0
    // DDS_PIXELFORMAT at offset 76
    dv.setUint32(o + 72, 32, true); // size
    dv.setUint32(o + 76, 0x00000004, true); // DDPF_FOURCC
    dv.setUint32(o + 80, 0x30315844, true); // "DX10"
    // caps
    dv.setUint32(o + 104, 0x00001000, true); // DDSCAPS_TEXTURE
    // caps2-4 + reserved2 remain 0
    o += 124;
    // DDS_HEADER_DXT10 (20 bytes)
    dv.setUint32(o + 0, 98, true); // DXGI_FORMAT_BC7_UNORM
    dv.setUint32(o + 4, 3, true); // D3D10_RESOURCE_DIMENSION_TEXTURE2D
    dv.setUint32(o + 8, 0, true); // misc flag
    dv.setUint32(o + 12, 1, true); // array size
    dv.setUint32(o + 16, 0, true); // misc flags2
    o += 20;
    out.set(payload, o);
    return out;
}

function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const msg = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader compile failed: ${msg}`);
    }
    return shader;
}

function createProgram(gl, vsSource, fsSource) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const msg = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`Program link failed: ${msg}`);
    }
    return program;
}

function normalizeCompressedFormatId(formatId) {
    const f = (formatId || '').toLowerCase();
    if (f === 'dxt5') {
        return 'bc3';
    }
    if (f === 'dxt1') {
        return 'bc1';
    }
    return f;
}

function getBcBytesPerBlock(formatId) {
    const f = normalizeCompressedFormatId(formatId);
    if (f === 'bc1') {
        return 8;
    }
    if (f === 'bc3' || f === 'bc7' || f === 'dxt3') {
        return 16;
    }
    throw new Error(`Unsupported compressed format: ${formatId}`);
}

function getCompressedPayloadSlice(payload, width, height, formatId) {
    const src = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const blockW = Math.ceil(width / 4);
    const blockH = Math.ceil(height / 4);
    const expectedBytes = blockW * blockH * getBcBytesPerBlock(formatId);
    if (src.length < expectedBytes) {
        throw new Error(`Compressed payload too small for ${formatId}: ${src.length} < ${expectedBytes}`);
    }
    return src.subarray(0, expectedBytes);
}

function resolveWebGlCompressedFormat(gl, formatId) {
    const f = normalizeCompressedFormatId(formatId);
    if (f === 'bc7') {
        const ext
            = gl.getExtension('EXT_texture_compression_bptc')
                || gl.getExtension('WEBKIT_EXT_texture_compression_bptc')
                || gl.getExtension('MOZ_EXT_texture_compression_bptc');
        const internalFormat
            = ext?.COMPRESSED_RGBA_BPTC_UNORM_EXT ?? ext?.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT;
        if (!internalFormat) {
            throw new Error('BC7 WebGL extension unavailable');
        }
        return { internalFormat };
    }

    if (f === 'bc1' || f === 'bc3' || f === 'dxt3') {
        const ext
            = gl.getExtension('WEBGL_compressed_texture_s3tc')
                || gl.getExtension('WEBKIT_WEBGL_compressed_texture_s3tc')
                || gl.getExtension('MOZ_WEBGL_compressed_texture_s3tc');
        if (!ext) {
            throw new Error('S3TC WebGL extension unavailable');
        }
        if (f === 'bc1') {
            return {
                internalFormat:
          ext.COMPRESSED_RGBA_S3TC_DXT1_EXT ?? ext.COMPRESSED_RGB_S3TC_DXT1_EXT,
            };
        }
        if (f === 'dxt3') {
            return { internalFormat: ext.COMPRESSED_RGBA_S3TC_DXT3_EXT };
        }
        return { internalFormat: ext.COMPRESSED_RGBA_S3TC_DXT5_EXT };
    }

    throw new Error(`Unsupported WebGL format: ${formatId}`);
}

async function decodeCompressedToPngBlob(payload, width, height, formatIds = ['bc7']) {
    const attempted = [];
    for (const formatId of formatIds) {
        try {
            const png = await decodeCompressedToPngBlobWebGpu(payload, width, height, formatId);
            if (png) {
                return { blob: png, format: normalizeCompressedFormatId(formatId), backend: 'webgpu' };
            }
        } catch (error) {
            attempted.push(`${formatId}/webgpu: ${error?.message || error}`);
        }
        try {
            const png = await decodeCompressedToPngBlobWebGl(payload, width, height, formatId);
            if (png) {
                return { blob: png, format: normalizeCompressedFormatId(formatId), backend: 'webgl' };
            }
        } catch (error) {
            attempted.push(`${formatId}/webgl: ${error?.message || error}`);
        }
    }
    throw new Error(`No GPU compressed decode path succeeded (${attempted.join(' | ')})`);
}

async function decodeCompressedToPngBlobWebGl(payload, width, height, formatId) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const gl
        = canvas.getContext('webgl2')
            || canvas.getContext('webgl')
            || canvas.getContext('experimental-webgl');
    if (!gl) {
        throw new Error('WebGL unavailable');
    }
    const { internalFormat } = resolveWebGlCompressedFormat(gl, formatId);
    if (!internalFormat) {
        throw new Error(`Internal format unavailable for ${formatId}`);
    }
    const payloadSlice = getCompressedPayloadSlice(payload, width, height, formatId);

    const vsSource = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = vec2((aPos.x + 1.0) * 0.5, 1.0 - ((aPos.y + 1.0) * 0.5));
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;
    const fsSource = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uTex;
    void main() {
      gl_FragColor = texture2D(uTex, vUv);
    }
  `;
    const program = createProgram(gl, vsSource, fsSource);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.compressedTexImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, payloadSlice);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    gl.useProgram(program);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uTex = gl.getUniformLocation(program, 'uTex');
    gl.uniform1i(uTex, 0);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
        throw new Error('Failed to encode PNG blob');
    }
    return blob;
}

async function decodeBc7ToPngBlob(payload, width, height) {
    const decoded = await decodeCompressedToPngBlob(payload, width, height, ['bc7']);
    return decoded.blob;
}

function resolveWebGpuCompressedFormat(formatId) {
    const f = normalizeCompressedFormatId(formatId);
    if (f === 'bc7') {
        return 'bc7-rgba-unorm';
    }
    if (f === 'bc3' || f === 'dxt3') {
        return 'bc3-rgba-unorm';
    }
    if (f === 'bc1') {
        return 'bc1-rgba-unorm';
    }
    throw new Error(`Unsupported WebGPU format: ${formatId}`);
}

async function decodeCompressedToPngBlobWebGpu(payload, width, height, formatId) {
    if (!navigator?.gpu) {
        throw new Error('WebGPU unavailable');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw new Error('WebGPU adapter unavailable');
    }
    if (!adapter.features?.has('texture-compression-bc')) {
        throw new Error('WebGPU BC compression feature unavailable');
    }

    const device = await adapter.requestDevice({
        requiredFeatures: ['texture-compression-bc'],
    });
    const gpuFormat = resolveWebGpuCompressedFormat(formatId);
    const bytesPerBlock = getBcBytesPerBlock(formatId);
    const payloadSlice = getCompressedPayloadSlice(payload, width, height, formatId);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('webgpu');
    if (!context) {
        throw new Error('WebGPU canvas context unavailable');
    }

    const targetFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format: targetFormat,
        alphaMode: 'premultiplied',
    });

    const bcTex = device.createTexture({
        size: { width, height, depthOrArrayLayers: 1 },
        format: gpuFormat,
        mipLevelCount: 1,
        sampleCount: 1,
        dimension: '2d',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    const bytesPerRow = Math.ceil(width / 4) * bytesPerBlock;
    const rowsPerImage = Math.ceil(height / 4);
    device.queue.writeTexture(
        { texture: bcTex, mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
        payloadSlice,
        { offset: 0, bytesPerRow, rowsPerImage },
        { width, height, depthOrArrayLayers: 1 },
    );

    const sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
    });

    const shader = device.createShaderModule({
        code: `
      @group(0) @binding(0) var tex : texture_2d<f32>;
      @group(0) @binding(1) var samp : sampler;

      struct VSOut {
        @builtin(position) pos : vec4<f32>,
        @location(0) uv : vec2<f32>
      };

      @vertex
      fn vs_main(@builtin(vertex_index) vi : u32) -> VSOut {
        var pos = array<vec2<f32>, 3>(
          vec2<f32>(-1.0, -1.0),
          vec2<f32>( 3.0, -1.0),
          vec2<f32>(-1.0,  3.0)
        );
        var uv = array<vec2<f32>, 3>(
          vec2<f32>(0.0, 1.0),
          vec2<f32>(2.0, 1.0),
          vec2<f32>(0.0, -1.0)
        );
        var out : VSOut;
        out.pos = vec4<f32>(pos[vi], 0.0, 1.0);
        out.uv = uv[vi];
        return out;
      }

      @fragment
      fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
        return textureSample(tex, samp, in.uv);
      }
    `,
    });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        ],
    });

    const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: {
            module: shader,
            entryPoint: 'vs_main',
        },
        fragment: {
            module: shader,
            entryPoint: 'fs_main',
            targets: [{ format: targetFormat }],
        },
        primitive: {
            topology: 'triangle-list',
        },
    });

    const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
            { binding: 0, resource: bcTex.createView() },
            { binding: 1, resource: sampler },
        ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view: context.getCurrentTexture().createView(),
                loadOp: 'clear',
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                storeOp: 'store',
            },
        ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();

    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
        throw new Error('Failed to encode PNG blob');
    }
    return blob;
}

function findSignature(bytes, sig) {
    if (!bytes || bytes.length < sig.length) {
        return -1;
    }
    outer: for (let i = 0; i <= bytes.length - sig.length; i++) {
        for (let j = 0; j < sig.length; j++) {
            if (bytes[i + j] !== sig[j]) {
                continue outer;
            }
        }
        return i;
    }
    return -1;
}

function readU32(bytes, offset) {
    if (!bytes || offset < 0 || offset + 4 > bytes.length) {
        return 0;
    }
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
}

function getDdsSlice(bytes) {
    const ddsSig = [0x44, 0x44, 0x53, 0x20];
    const ddsOffset = findSignature(bytes, ddsSig);
    if (ddsOffset < 0) {
        return null;
    }

    // DDS header is 128 bytes including magic.
    if (ddsOffset + 128 > bytes.length) {
        return bytes.subarray(ddsOffset);
    }

    const height = readU32(bytes, ddsOffset + 12);
    const width = readU32(bytes, ddsOffset + 16);
    const mipCount = Math.max(1, readU32(bytes, ddsOffset + 28) || 1);
    const fourCC = readU32(bytes, ddsOffset + 84);
    if (readU32(bytes, ddsOffset + 4) !== 124 || readU32(bytes, ddsOffset + 76) !== 32
        || !width || width > 8192 || !height || height > 8192 || mipCount > 14) {
        return null;
    }

    let headerSize = 128;
    let blockSize = 16;

    // DX10 extended header
    if (fourCC === 0x30315844) {
        if (ddsOffset + 148 <= bytes.length) {
            headerSize += 20;
            const dxgiFormat = readU32(bytes, ddsOffset + 128);
            // BC1/BC4 formats are 8-byte blocks.
            if (dxgiFormat === 71 || dxgiFormat === 72 || dxgiFormat === 80 || dxgiFormat === 81) {
                blockSize = 8;
            }
        }
    } else if (fourCC === 0x31545844 /* DXT1 */) {
        blockSize = 8;
    }

    let w = Math.max(1, width);
    let h = Math.max(1, height);
    let dataSize = 0;
    for (let i = 0; i < mipCount; i++) {
        const bw = Math.max(1, Math.ceil(w / 4));
        const bh = Math.max(1, Math.ceil(h / 4));
        dataSize += bw * bh * blockSize;
        w = Math.max(1, w >> 1);
        h = Math.max(1, h >> 1);
    }

    const estimatedTotal = headerSize + dataSize;
    const end = Math.min(bytes.length, ddsOffset + Math.max(headerSize, estimatedTotal));
    return bytes.subarray(ddsOffset, end);
}

// Only single 2D BC textures are supported; decode the top mip and ignore lower mips.
function getDdsPayloadMeta(bytes) {
    const slice = getDdsSlice(bytes);
    if (!slice || slice.length < 128 || readU32(slice, 4) !== 124 || readU32(slice, 76) !== 32) {
        return null;
    }
    const width = readU32(slice, 16), height = readU32(slice, 12);
    if (!width || width > 8192 || !height || height > 8192) {
        throw new Error('Unsupported DDS texture dimensions');
    }
    const fourCC = readU32(slice, 84);
    let format = ({ 0x31545844: 'bc1', 0x33545844: 'dxt3', 0x35545844: 'bc3' })[fourCC];
    let headerSize = 128;
    if (fourCC === 0x30315844 && slice.length >= 148) {
        headerSize = 148;
        format = ({ 71: 'bc1', 72: 'bc1', 74: 'dxt3', 75: 'dxt3', 77: 'bc3', 78: 'bc3', 98: 'bc7', 99: 'bc7' })[readU32(slice, 128)];
        if (readU32(slice, 132) !== 3 || readU32(slice, 140) !== 1 || (readU32(slice, 136) & 4)) {
            throw new Error('DDS texture arrays, cubes, and volumes are not supported');
        }
    }
    if (readU32(slice, 112) !== 0 || !format) {
        throw new Error('Unsupported DDS texture format; use BC1, BC2, BC3, or BC7');
    }
    const payloadSize = Math.ceil(width / 4) * Math.ceil(height / 4) * getBcBytesPerBlock(format);
    if (headerSize + payloadSize > slice.length) {
        throw new Error('Truncated DDS texture payload');
    }
    return { width, height, format, payload: slice.subarray(headerSize, headerSize + payloadSize) };
}

function getCommonImageSlice(bytes) {
    const png = findSignature(bytes, [0x89, 0x50, 0x4e, 0x47]);
    if (png >= 0) {
        const iend = findSignature(bytes.subarray(png), [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
        if (iend >= 0) {
            const end = png + iend + 8;
            return { type: 'image/png', slice: bytes.subarray(png, end) };
        }
    }
    const jpg = getJpegSlice(bytes);
    if (jpg) {
        return { type: 'image/jpeg', slice: jpg };
    }
    const webp = findSignature(bytes, [0x52, 0x49, 0x46, 0x46]);
    if (webp >= 0 && webp + 12 <= bytes.length) {
        const w = bytes[webp + 8] === 0x57 && bytes[webp + 9] === 0x45 && bytes[webp + 10] === 0x42 && bytes[webp + 11] === 0x50;
        if (w) {
            const riffSize = readU32(bytes, webp + 4);
            const end = webp + 8 + riffSize;
            if (end > webp + 12 && end <= bytes.length) {
                return { type: 'image/webp', slice: bytes.subarray(webp, end) };
            }
        }
    }
    return null;
}

function getJpegSlice(bytes) {
    const soi = findSignature(bytes, [0xff, 0xd8, 0xff]);
    if (soi < 0 || soi + 4 >= bytes.length) {
        return null;
    }

    // Require common APP0/APP1 headers to reduce false positives.
    const appMarker = bytes[soi + 3];
    if (appMarker !== 0xe0 && appMarker !== 0xe1) {
        return null;
    }

    let i = soi + 2;
    let sawSOS = false;
    while (i + 1 < bytes.length) {
        if (bytes[i] !== 0xff) {
            return null;
        }

        // Skip fill bytes.
        while (i < bytes.length && bytes[i] === 0xff) {
            i++;
        }
        if (i >= bytes.length) {
            return null;
        }

        const marker = bytes[i];
        i++;

        if (marker === 0xd9) {
            // EOI.
            return bytes.subarray(soi, i);
        }

        // Standalone markers without length field.
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            continue;
        }

        if (i + 1 >= bytes.length) {
            return null;
        }
        const segLen = (bytes[i] << 8) | bytes[i + 1];
        i += 2;
        if (segLen < 2 || i + (segLen - 2) > bytes.length) {
            return null;
        }

        if (marker === 0xda) {
            // Start of scan: entropy-coded data until EOI.
            sawSOS = true;
            i += segLen - 2;
            while (i + 1 < bytes.length) {
                if (bytes[i] === 0xff) {
                    const n = bytes[i + 1];
                    if (n === 0x00) {
                        i += 2; // byte-stuffed 0xFF in data
                        continue;
                    }
                    if (n === 0xd9) {
                        return bytes.subarray(soi, i + 2);
                    }
                    if (n >= 0xd0 && n <= 0xd7) {
                        i += 2; // restart marker
                        continue;
                    }
                    // Unexpected marker inside scan; continue from marker boundary.
                    i++;
                    continue;
                }
                i++;
            }
            return null;
        }

        i += segLen - 2;
    }

    return sawSOS ? null : null;
}

export class PakImporter {
    constructor(buffer) {
        mapModLogInfo('Initializing importer');
        this.buffer = buffer;
        this.pak = new UnrealPakReader(buffer);
        this.entries = [];
        this.assetPaths = [];
        this.regions = [];
        this.assetsData = [];
        this.fallbackMode = false;
        this.rawText = null;
    }

    scanPaths() {
        mapModLogInfo('Scanning pak for HexMap texture assets...');

        try {
            this.entries = this.pak.listEntries();
            const paths = this.entries
                .map(entry => normalizePath(entry.path))
                .filter(path => path.toLowerCase().includes('/hexmaps/processed/') && path.endsWith('.uasset'))
                .map(path => getAssetStem(path));

            this.assetPaths = [...new Set(paths)];
            this.fallbackMode = false;
            mapModLogInfo('Index mode: found', this.assetPaths.length, 'HexMap texture assets');
            if (this.assetPaths.length) {
                mapModLogInfo('Example assets:', this.assetPaths.slice(0, 5));
            }
            return this.assetPaths;
        } catch (error) {
            mapModLogWarn('Index parse unavailable, using fallback scan:', error?.message || error);
            try {
                const diag = this.pak.diagnose();
                mapModLogInfo('Pak diagnostics:', diag);
                try {
                    const diagJson = JSON.stringify(diag, null, 2);
                    mapModLogInfo(`Pak diagnostics (json):\n${diagJson}`);
                } catch {
                    // Ignore JSON serialization issues, object log above is still useful.
                }
            } catch (diagError) {
                mapModLogWarn('Diagnostics failed:', diagError?.message || diagError);
            }
            this.fallbackMode = true;
        }

        if (!this.rawText) {
            // latin1 keeps 1-byte-to-1-char mapping for reliable byte offsets in indexOf().
            this.rawText = new TextDecoder('latin1').decode(new Uint8Array(this.buffer));
        }
        const matches
            = this.rawText.match(/\/Game\/Textures\/UI\/HexMaps\/Processed\/[A-Za-z0-9_]+/g) || [];
        this.assetPaths = [...new Set(matches)];
        mapModLogInfo('Fallback mode: found', this.assetPaths.length, 'HexMap references');
        if (this.assetPaths.length) {
            mapModLogInfo('Example assets:', this.assetPaths.slice(0, 5));
        }
        return this.assetPaths;
    }

    extractRegion(assetPath) {
        const base = getAssetBaseName(assetPath);
        const match = base.match(/^Map(.+?)(Hex)?$/i);
        return match ? match[1] : null;
    }

    detectRegions() {
        mapModLogInfo('Extracting region names...');
        this.regions = this.assetPaths.map(p => this.extractRegion(p)).filter(Boolean);
        mapModLogInfo('Regions detected:', this.regions.length);
        if (this.regions.length) {
            mapModLogInfo('Example regions:', this.regions.slice(0, 10));
        }
        return this.regions;
    }

    findAssetBlocks() {
        mapModLogInfo('Extracting uasset/uexp/ubulk payloads...');
        if (!this.assetPaths.length) {
            this.scanPaths();
        }

        if (!this.fallbackMode) {
            if (!this.entries.length) {
                this.entries = this.pak.listEntries();
            }

            const entryMap = new Map();
            for (const entry of this.entries) {
                entryMap.set(normalizePath(entry.path).toLowerCase(), entry);
            }

            this.assetsData = this.assetPaths.map(assetPath => {
                const key = normalizePath(assetPath).toLowerCase();
                const uasset = entryMap.get(`${key}.uasset`);
                const uexp = entryMap.get(`${key}.uexp`);
                const ubulk = entryMap.get(`${key}.ubulk`);

                return {
                    assetPath,
                    region: this.extractRegion(assetPath),
                    approximate: false,
                    files: {
                        uasset: uasset ? this.pak.readEntry(uasset) : null,
                        uexp: uexp ? this.pak.readEntry(uexp) : null,
                        ubulk: ubulk ? this.pak.readEntry(ubulk) : null,
                    },
                };
            });
            mapModLogInfo('Index mode extracted', this.assetsData.length, 'texture bundles');
            return this.assetsData;
        }

        // Fallback mode: approximate blocks near matching path references.
        const bytes = new Uint8Array(this.buffer);
        const text = this.rawText || new TextDecoder('latin1').decode(bytes);
        this.assetsData = this.assetPaths.map(assetPath => {
            const pos = text.indexOf(assetPath);
            const start = pos >= 0 ? Math.max(0, pos - 256 * 1024) : 0;
            const end = pos >= 0 ? Math.min(bytes.length, pos + 1024 * 1024) : 0;
            const sample = start < end ? this.buffer.slice(start, end) : null;
            return {
                assetPath,
                region: this.extractRegion(assetPath),
                approximate: true,
                files: {
                    uasset: null,
                    uexp: sample,
                    ubulk: null,
                },
            };
        });
        mapModLogInfo(
            'Fallback mode extracted',
            this.assetsData.length,
            'approximate texture bundles',
        );
        return this.assetsData;
    }

    decodeTexture(assetData) {
        const approximate = !!assetData.approximate;
        const uexpBytes = assetData.files.uexp ? new Uint8Array(assetData.files.uexp) : null;
        const ubulkBytes = assetData.files.ubulk ? new Uint8Array(assetData.files.ubulk) : null;
        const uassetBytes = assetData.files.uasset ? new Uint8Array(assetData.files.uasset) : null;

        // Best-effort decode: if a DDS payload exists in any segment, emit it directly.
        const candidates = [uexpBytes, ubulkBytes, uassetBytes];
        for (const bytes of candidates) {
            if (!bytes) {
                continue;
            }
            if (hasDdsHeader(bytes)) {
                return { blob: new Blob([bytes], { type: 'image/vnd-ms.dds' }), format: 'dds' };
            }
            const ddsSlice = getDdsSlice(bytes);
            if (ddsSlice) {
                return { blob: new Blob([ddsSlice], { type: 'image/vnd-ms.dds' }), format: 'dds-embedded' };
            }
            if (!approximate) {
                const imageSlice = getCommonImageSlice(bytes);
                if (imageSlice) {
                    return { blob: new Blob([imageSlice.slice], { type: imageSlice.type }), format: imageSlice.type };
                }
            }
        }

        // Reverse generator BC7 textures with the dimensions and offsets from their footer.
        const meta = this.extractGeneratorBc7PayloadMeta(assetData);
        if (meta?.source === 'footer' && meta.formatCandidates[0] === 'bc7') {
            const dds = buildDdsBc7(meta.payload, meta.width, meta.height);
            return { blob: new Blob([dds], { type: 'image/vnd-ms.dds' }), format: 'dds-bc7' };
        }

        // Fallback: return the cooked payload so callers can forward to an external UE texture decoder.
        if (assetData.files.ubulk) {
            return {
                blob: new Blob([assetData.files.ubulk], { type: 'application/octet-stream' }),
                format: 'cooked-ubulk',
            };
        }
        if (assetData.files.uexp) {
            return {
                blob: new Blob([assetData.files.uexp], { type: 'application/octet-stream' }),
                format: 'cooked-uexp',
            };
        }
        if (assetData.files.uasset) {
            return {
                blob: new Blob([assetData.files.uasset], { type: 'application/octet-stream' }),
                format: 'cooked-uasset',
            };
        }
        return {
            blob: null,
            format: 'missing',
        };
    }

    extractGeneratorBc7Payload(assetData) {
        const meta = this.extractGeneratorBc7PayloadMeta(assetData);
        return meta ? meta.payload : null;
    }

    extractUncompressedRgbaPayloadMeta(assetData) {
        const rawUassetBytes = assetData?.files?.uasset ? new Uint8Array(assetData.files.uasset) : null;
        if (!rawUassetBytes || rawUassetBytes.length < 1024) {
            return null;
        }
        const headerShift = findUassetHeaderOffset(rawUassetBytes, 65536);
        const uassetBytes = headerShift > 0 ? rawUassetBytes.subarray(headerShift) : rawUassetBytes;
        const pfTags = findAsciiTokens(uassetBytes, /PF_[A-Za-z0-9_]+/g);
        const layout = resolveUncompressedPixelLayout(pfTags);
        if (!layout) {
            return null;
        }

        const footer = findGeneratorFooter(uassetBytes);
        const width = footer?.width ?? FH_BC7_WIDTH;
        const height = footer?.height ?? FH_BC7_HEIGHT;
        const payloadSize = rgbaLevel0Size(width, height);
        if (footer) {
            const start = footer.offset - payloadSize;
            if (start >= 0 && start + payloadSize <= uassetBytes.length) {
                return {
                    payload: uassetBytes.subarray(start, start + payloadSize),
                    start,
                    source: 'footer-rgba',
                    width,
                    height,
                    payloadSize,
                    footerLen: footer.footerLen,
                    footerOffset: footer.offset,
                    headerShift: Math.max(0, headerShift),
                    layout: layout.layout,
                    swizzleBgra: layout.swizzleBgra,
                    pfTags,
                };
            }
        }

        // Fallback: trailing RGBA block when footer parse fails.
        const trailingStart = uassetBytes.length - payloadSize;
        if (trailingStart > 256 && trailingStart < 16384) {
            return {
                payload: uassetBytes.subarray(trailingStart, trailingStart + payloadSize),
                start: trailingStart,
                source: 'trailing-rgba',
                width,
                height,
                payloadSize,
                headerShift: Math.max(0, headerShift),
                layout: layout.layout,
                swizzleBgra: layout.swizzleBgra,
                pfTags,
            };
        }
        return null;
    }

    extractGeneratorBc7PayloadMeta(assetData) {
        const rawUassetBytes = assetData?.files?.uasset ? new Uint8Array(assetData.files.uasset) : null;
        if (!rawUassetBytes || rawUassetBytes.length < 1024) {
            return null;
        }
        const headerShift = findUassetHeaderOffset(rawUassetBytes, 65536);
        const uassetBytes = headerShift > 0 ? rawUassetBytes.subarray(headerShift) : rawUassetBytes;

        const pfTags = findAsciiTokens(uassetBytes, /PF_[A-Za-z0-9_]+/g);
        if (pfTags.some(isUncompressedRgbaPfTag)) {
            return null;
        }
        const formatCandidates = inferFormatCandidatesFromPfTags(pfTags);
        const bytesPerBlock = getBcBytesPerBlock(formatCandidates[0]);
        const footer = findGeneratorFooter(uassetBytes);
        const width = footer?.width ?? FH_BC7_WIDTH;
        const height = footer?.height ?? FH_BC7_HEIGHT;
        const payloadSize = Math.ceil(width / 4) * Math.ceil(height / 4) * bytesPerBlock;
        const hintedPayloadSize = payloadSize;
        const magicAtStart
            = uassetBytes.length >= 4
                && uassetBytes[0] === 0xc1
                && uassetBytes[1] === 0x83
                && uassetBytes[2] === 0x2a
                && uassetBytes[3] === 0x9e;

        // Preferred: per-file footer-derived start. Header length varies across maps.
        if (footer) {
            const start = footer.offset - payloadSize;
            if (start >= 0 && start + payloadSize <= uassetBytes.length) {
                return {
                    payload: uassetBytes.subarray(start, start + payloadSize),
                    start,
                    source: 'footer',
                    width,
                    height,
                    payloadSize,
                    formatCandidates,
                    bytesPerBlock,
                    footerLen: footer.footerLen,
                    footerOffset: footer.offset,
                    headerShift: Math.max(0, headerShift),
                };
            }
        }

        // Fallback: fixed hint for generator-style files when footer parse fails.
        if (
            magicAtStart
            && FH_GENERATOR_PAYLOAD_START_HINT > 0
            && FH_GENERATOR_PAYLOAD_START_HINT + hintedPayloadSize <= uassetBytes.length
        ) {
            return {
                payload: uassetBytes.subarray(
                    FH_GENERATOR_PAYLOAD_START_HINT,
                    FH_GENERATOR_PAYLOAD_START_HINT + hintedPayloadSize,
                ),
                start: FH_GENERATOR_PAYLOAD_START_HINT,
                source: 'hint',
                width: FH_BC7_WIDTH,
                height: FH_BC7_HEIGHT,
                payloadSize: hintedPayloadSize,
                formatCandidates,
                bytesPerBlock,
                headerShift: Math.max(0, headerShift),
            };
        }

        if (!footer) {
            // Fallback: many cooked variants still keep BC7 data as the trailing block.
            // If file is roughly "small header + BC7 payload", use last payload-sized slice.
            const trailingStart = uassetBytes.length - payloadSize;
            if (trailingStart > 512 && trailingStart < 8192) {
                return {
                    payload: uassetBytes.subarray(trailingStart, trailingStart + payloadSize),
                    start: trailingStart,
                    source: 'trailing',
                    width,
                    height,
                    payloadSize,
                    formatCandidates,
                    bytesPerBlock,
                    headerShift: Math.max(0, headerShift),
                };
            }
            return null;
        }
        return null;
    }

    extractGeneratorBc7PayloadCandidates(assetData, maxBlockDelta = 8) {
        const meta = this.extractGeneratorBc7PayloadMeta(assetData);
        const uassetBytes = assetData?.files?.uasset ? new Uint8Array(assetData.files.uasset) : null;
        if (!meta || !uassetBytes) {
            return [];
        }
        const out = [];
        for (let d = -maxBlockDelta; d <= maxBlockDelta; d++) {
            const start = meta.start + d * meta.bytesPerBlock;
            if (start < 0 || start + meta.payloadSize > uassetBytes.length) {
                continue;
            }
            out.push({
                id: `off${d >= 0 ? '+' : ''}${d * meta.bytesPerBlock}`,
                payload: uassetBytes.subarray(start, start + meta.payloadSize),
                start,
            });
        }
        return out;
    }

    getTextureDiagnostics(mapData) {
        const rawUassetBytes = mapData?.raw?.uasset ? new Uint8Array(mapData.raw.uasset) : null;
        const headerShift = rawUassetBytes ? findUassetHeaderOffset(rawUassetBytes, 65536) : -1;
        const uassetBytes = rawUassetBytes && headerShift > 0 ? rawUassetBytes.subarray(headerShift) : rawUassetBytes;
        const uexpBytes = mapData?.raw?.uexp ? new Uint8Array(mapData.raw.uexp) : null;
        const ubulkBytes = mapData?.raw?.ubulk ? new Uint8Array(mapData.raw.ubulk) : null;
        const uassetMagicOk
            = !!uassetBytes
                && uassetBytes.length >= 4
                && uassetBytes[0] === 0xc1
                && uassetBytes[1] === 0x83
                && uassetBytes[2] === 0x2a
                && uassetBytes[3] === 0x9e;
        const footer = uassetBytes ? findGeneratorFooter(uassetBytes) : null;
        const footerLen = footer?.footerLen ?? 0;
        const footerAtEnd = !!footer && (footer.offset + footer.footerLen === uassetBytes.length);
        const payloadMeta = this.extractGeneratorBc7PayloadMeta({ files: mapData?.raw });
        return {
            uassetSize: uassetBytes?.length ?? 0,
            uassetRawSize: rawUassetBytes?.length ?? 0,
            uassetHeaderShift: headerShift >= 0 ? headerShift : null,
            uexpSize: uexpBytes?.length ?? 0,
            ubulkSize: ubulkBytes?.length ?? 0,
            uassetMagicOk,
            uassetHeadHex: bytesToHex(uassetBytes, 32),
            uassetTailHex: bytesToHex(uassetBytes ? uassetBytes.subarray(Math.max(0, uassetBytes.length - 32)) : null, 32),
            footerAtEnd,
            footerLen,
            footerOffset: footer?.offset ?? -1,
            footerWidth: footer?.width ?? null,
            footerHeight: footer?.height ?? null,
            payloadSource: payloadMeta?.source ?? null,
            payloadStart: payloadMeta?.start ?? -1,
            payloadSize: payloadMeta?.payloadSize ?? null,
            uassetPfTags: findAsciiTokens(uassetBytes, /PF_[A-Za-z0-9_]+/g),
            uexpPfTags: findAsciiTokens(uexpBytes, /PF_[A-Za-z0-9_]+/g),
            ubulkPfTags: findAsciiTokens(ubulkBytes, /PF_[A-Za-z0-9_]+/g),
        };
    }

    async mapToPngBlob(mapData) {
        if (!mapData) {
            return null;
        }
        if (mapData.format?.startsWith('image/') && mapData.blob) {
            return mapData.blob;
        }

        // DDS may be embedded in any cooked segment, including external bulk files.
        for (const file of Object.values(mapData.raw || {})) {
            if (!file) {
                continue;
            }
            const meta = getDdsPayloadMeta(new Uint8Array(file));
            if (meta) {
                return (await decodeCompressedToPngBlob(meta.payload, meta.width, meta.height, [meta.format])).blob;
            }
        }

        // Uncompressed cooked textures (common in WG-style map mods): PF_B8G8R8A8 etc.
        const rgbaMeta = this.extractUncompressedRgbaPayloadMeta({ files: mapData.raw });
        if (rgbaMeta?.payload) {
            try {
                const blob = await rgbaBytesToPngBlob(
                    rgbaMeta.payload,
                    rgbaMeta.width,
                    rgbaMeta.height,
                    { swizzleBgra: rgbaMeta.swizzleBgra === true },
                );
                mapModLogInfo(
                    `Decoded ${mapData.assetPath} as ${rgbaMeta.layout} rgba start=${rgbaMeta.start} source=${rgbaMeta.source}`,
                );
                return blob;
            } catch (error) {
                mapModLogWarn(
                    `RGBA decode failed for ${mapData.assetPath}:`,
                    error?.message || error,
                );
                // Fall through to compressed path only if RGBA encoding failed unexpectedly.
            }
        }

        const payloadMeta = this.extractGeneratorBc7PayloadMeta({ files: mapData.raw });
        const payload = payloadMeta?.payload ?? null;
        if (!payload || !payloadMeta) {
            for (const file of Object.values(mapData.raw || {})) {
                const image = file ? getCommonImageSlice(new Uint8Array(file)) : null;
                if (!image) {
                    continue;
                }
                const blob = new Blob([image.slice], { type: image.type });
                if (image.type === 'image/png') {
                    return blob;
                }
                const loaded = await loadImageSource(blob);
                if (!loaded) {
                    return null;
                }
                try {
                    const rgba = await imageSourceToRgbaBytes(loaded);
                    return await rgbaBytesToPngBlob(rgba, loaded.width, loaded.height);
                } finally {
                    loaded.cleanup?.();
                }
            }
            const size = mapData?.raw?.uasset?.byteLength ?? 0;
            mapModLogWarn(`BC7 payload not found for ${mapData.assetPath} (uasset size=${size})`);
            return null;
        }
        const width = payloadMeta.width ?? FH_BC7_WIDTH;
        const height = payloadMeta.height ?? FH_BC7_HEIGHT;
        const uassetBytes = mapData?.raw?.uasset ? new Uint8Array(mapData.raw.uasset) : null;
        const pfTags = findAsciiTokens(uassetBytes, /PF_[A-Za-z0-9_]+/g);
        if (pfTags.some(isUncompressedRgbaPfTag)) {
            mapModLogWarn(
                `Refusing compressed decode for uncompressed tags (${pfTags.join(',')}) on ${mapData.assetPath}`,
            );
            return null;
        }
        const formatCandidates = payloadMeta.formatCandidates;
        try {
            if (FH_FAST_DECODE_MODE) {
                // Fast path: try the extracted payload directly, then one cheap start fallback.
                try {
                    const decodedFast = await decodeCompressedToPngBlob(payload, width, height, formatCandidates);
                    mapModLogInfo(
                        `Decoded ${mapData.assetPath} at start=${payloadMeta.start} fmt=${decodedFast?.format || formatCandidates[0]} source=${payloadMeta.source} mode=fast`,
                    );
                    return decodedFast.blob;
                } catch {
                    // try fallback below
                }

                if (uassetBytes) {
                    const payloadSize = payloadMeta.payloadSize ?? FH_BC7_TEXTURE_SIZE;
                    const fallbackStart = FH_GENERATOR_PAYLOAD_START_HINT;
                    if (
                        fallbackStart !== payloadMeta.start
                        && fallbackStart >= 0
                        && fallbackStart + payloadSize <= uassetBytes.length
                    ) {
                        const candidatePayload = uassetBytes.subarray(fallbackStart, fallbackStart + payloadSize);
                        const decodedFallback = await decodeCompressedToPngBlob(candidatePayload, width, height, formatCandidates);
                        mapModLogInfo(
                            `Decoded ${mapData.assetPath} at start=${fallbackStart} fmt=${decodedFallback?.format || formatCandidates[0]} source=fast-fallback`,
                        );
                        return decodedFallback.blob;
                    }
                }
            }

            // Robust per-map start search: different files may place payload at slightly different offsets.
            if (uassetBytes) {
                const payloadSize = payloadMeta.payloadSize ?? FH_BC7_TEXTURE_SIZE;
                const starts = [payloadMeta.start, FH_GENERATOR_PAYLOAD_START_HINT];
                const minStart = Math.max(256, Math.min(4096, uassetBytes.length - payloadSize));
                const maxStart = Math.min(4096, uassetBytes.length - payloadSize);
                for (let s = minStart; s <= maxStart; s += payloadMeta.bytesPerBlock) {
                    starts.push(s);
                }
                let bestBlob = null;
                let bestStart = payloadMeta.start ?? FH_GENERATOR_PAYLOAD_START_HINT;
                let bestScore = Number.POSITIVE_INFINITY;
                let bestFormat = formatCandidates[0];
                const candidateResults = [];
                const tried = new Set();
                for (const start of starts) {
                    if (tried.has(start)) {
                        continue;
                    }
                    tried.add(start);
                    if (start < 0 || start + payloadSize > uassetBytes.length) {
                        continue;
                    }
                    const candidatePayload = uassetBytes.subarray(start, start + payloadSize);
                    for (const fmt of formatCandidates) {
                        try {
                            const decoded = await decodeCompressedToPngBlob(candidatePayload, width, height, [fmt]);

                            const rgba = await pngBlobToRgbaBytes(decoded.blob, width, height);
                            const score = estimateSpatialNoiseScore(rgba, width, height);
                            candidateResults.push({ start, format: fmt, score: Number(score.toFixed(4)) });
                            if (score < bestScore) {
                                bestScore = score;
                                bestBlob = decoded.blob;
                                bestStart = start;
                                bestFormat = fmt;
                            }
                        } catch {
                            // try next format/start
                        }
                    }
                }
                if (bestBlob) {
                    const roundedBest = Number(bestScore.toFixed(4));
                    mapModLogInfo(
                        `Decoded ${mapData.assetPath} at start=${bestStart} fmt=${bestFormat} source=searched (base=${payloadMeta.start}, score=${roundedBest.toFixed(2)})`,
                    );
                    if (roundedBest >= FH_NOISE_DIAG_SCORE_THRESHOLD) {
                        const sorted = candidateResults
                            .slice()
                            .sort((a, b) => a.score - b.score);
                        const top = sorted.slice(0, 12);
                        const diag = {
                            assetPath: mapData.assetPath,
                            region: mapData.region,
                            bestStart,
                            bestScore: roundedBest,
                            baseStart: payloadMeta.start,
                            width,
                            height,
                            payloadSize,
                            payloadSource: payloadMeta.source,
                            pfTags,
                            formatCandidates,
                            bestFormat,
                            textureDiagnostics: this.getTextureDiagnostics(mapData),
                            topCandidates: top,
                            bestPayload: payloadFingerprint(uassetBytes, bestStart, payloadSize),
                            basePayload: payloadFingerprint(uassetBytes, payloadMeta.start ?? bestStart, payloadSize),
                        };
                        mapModLogWarn('High-noise map diagnostics:', diag);
                        try {
                            mapModLogWarn(`High-noise map diagnostics (json):\n${JSON.stringify(diag, null, 2)}`);
                        } catch {
                            // object log above is enough
                        }
                    }
                    return bestBlob;
                }
            }

            const decoded = await decodeCompressedToPngBlob(payload, width, height, formatCandidates);
            mapModLogInfo(
                `Decoded ${mapData.assetPath} at start=${payloadMeta.start} fmt=${decoded?.format || formatCandidates[0]} source=${payloadMeta.source}`,
            );
            return decoded.blob;
        } catch (error) {
            mapModLogWarn('Compressed texture -> PNG decode failed:', mapData.assetPath, error);
            return null;
        }
    }

    async mapToPngVariantBlobs(mapData) {
        const assetData = { files: mapData?.raw };
        const candidates = this.extractGeneratorBc7PayloadCandidates(assetData, 0);
        if (!candidates.length) {
            return [];
        }
        mapModLogInfo('Texture diagnostics:', this.getTextureDiagnostics(mapData));
        mapModLogInfo(
            `Variant mode payload candidates: ${candidates.length} around base slice for ${mapData?.assetPath}`,
        );
        const out = [];
        const formatCandidates = ['bc7', 'bc3', 'dxt3', 'bc1'];
        for (const candidate of candidates) {
            for (const formatId of formatCandidates) {
                try {
                    const decoded = await decodeCompressedToPngBlob(
                        candidate.payload,
                        FH_BC7_WIDTH,
                        FH_BC7_HEIGHT,
                        [formatId],
                    );
                    if (decoded?.blob) {
                        out.push({ id: `${formatId}_${candidate.id}`, blob: decoded.blob });
                    }
                } catch (error) {
                    mapModLogWarn(
                        `Variant candidate decode failed (${formatId}, ${candidate.id}, start=${candidate.start}):`,
                        mapData?.assetPath,
                        error?.message || error,
                    );
                }
            }
        }
        return out;
    }

    async blobToDataUrl(blob) {
        return await new Promise(resolve => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = () => resolve(null);
            fr.readAsDataURL(blob);
        });
    }

    async runLimited(jobs, limit = 3, shouldCancel = null) {
        const results = new Array(jobs.length);
        let cursor = 0;
        const worker = async () => {
            while (cursor < jobs.length) {
                if (typeof shouldCancel === 'function' && shouldCancel()) {
                    break;
                }
                const idx = cursor++;
                try {
                    results[idx] = await jobs[idx]();
                } catch {
                    results[idx] = false;
                }
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        };
        const workers = [];
        const workerCount = Math.min(Math.max(1, limit), jobs.length || 1);
        for (let i = 0; i < workerCount; i++) {
            workers.push(worker());
        }
        await Promise.all(workers);
        return results;
    }

    async importHexMaps({
        game,
        fileName = 'mod.pak',
        baseDir = 'mods/Textures/UI/',
        concurrency = Math.max(2, Math.min(6, Math.floor((globalThis.navigator?.hardwareConcurrency || 6) / 2))),
        maxMapCount = Infinity,
        onProgress = null,
    } = {}) {
        if (!game?.foxholeMap?.mapModStorage) {
            throw new Error('importHexMaps requires game.foxholeMap.mapModStorage');
        }
        const emitProgress = payload => {
            if (typeof onProgress === 'function') {
                onProgress(payload);
            }
        };

        const maps = this.exportHexMaps({ skipDecode: true });
        const pakName = fileName.split('/').pop()?.replace(/\.pak$/i, '') ?? 'mod';
        const mapDir = 'mods/Textures/UI/HexMaps/Processed/';

        const mapsToProcess = Number.isFinite(maxMapCount)
            ? maps.slice(0, Math.max(0, maxMapCount))
            : maps;
        const pngJobs = [];
        const imagesByPath = {};
        let processedCount = 0;

        emitProgress({
            active: true,
            fileName,
            currentFile: '',
            processed: 0,
            total: mapsToProcess.length,
            percent: mapsToProcess.length ? 0 : 100,
        });

        const regionTextureKeys = {};
        for (const region of Object.values(game.data.foxhole.maps)) {
            if (!region.textureKey) {
                continue;
            }
            regionTextureKeys[region.key.toLowerCase()] = region.textureKey;
        }

        for (const map of mapsToProcess) {
            const mapKey = map.assetPath.split('/').pop() ?? 'Map';
            const lcMapKey = mapKey.toLowerCase();
            let textureKey;
            for (const [regionKey, regionTextureKey] of Object.entries(regionTextureKeys)) {
                if (lcMapKey.includes(regionKey)) {
                    textureKey = regionTextureKey;
                    break;
                }
            }
            if (!textureKey) {
                textureKey = mapKey;
                mapModLogInfo(`Unknown map '${mapKey}'.`);
            } else if (textureKey !== mapKey) {
                mapModLogInfo(`Corrected map path: '${mapKey}' -> '${textureKey}'`);
            }
            pngJobs.push(async () => {
                if (game.foxholeMap?.isImportCancelRequested?.()) {
                    return false;
                }
                const out = `${mapDir}${textureKey}.png`;
                emitProgress({
                    active: true,
                    fileName,
                    currentFile: out,
                    processed: processedCount,
                    total: mapsToProcess.length,
                    percent: mapsToProcess.length ? Math.min(100, Math.round((processedCount / mapsToProcess.length) * 100)) : 100,
                });
                const blob = await this.mapToPngBlob(map);
                let success = false;
                if (blob) {
                    imagesByPath[out] = blob;
                    success = true;
                }
                processedCount++;
                emitProgress({
                    active: true,
                    fileName,
                    currentFile: out,
                    processed: processedCount,
                    total: mapsToProcess.length,
                    percent: mapsToProcess.length ? Math.min(100, Math.round((processedCount / mapsToProcess.length) * 100)) : 100,
                });
                return success;
            });
        }

        mapModLogInfo(`Extracted ${maps.length} maps (0 raw files)`);
        if (maps.length) {
            mapModLogInfo(`Found ${maps.length} map textures in ${pakName}.pak`);
        }

        const results = await this.runLimited(
            pngJobs,
            concurrency,
            () => game.foxholeMap?.isImportCancelRequested?.() === true,
        );
        const cancelled = game.foxholeMap?.isImportCancelRequested?.() === true;
        const pngCount = results.filter(v => v === true).length;
        mapModLogInfo(`PNG extracted: ${pngCount}/${mapsToProcess.length}`);
        if (cancelled) {
            mapModLogWarn('Map mod import cancelled before cache save.');
            emitProgress({
                active: false,
                fileName,
                currentFile: '',
                processed: processedCount,
                total: mapsToProcess.length,
                percent: mapsToProcess.length ? Math.min(100, Math.round((processedCount / mapsToProcess.length) * 100)) : 100,
                error: 'cancelled',
            });
            return {
                pakName,
                mapCount: maps.length,
                processedCount: mapsToProcess.length,
                pngCount: 0,
                outputDir: mapDir,
                cancelled: true,
            };
        }
        if (!pngCount) {
            const message = mapsToProcess.length
                ? 'No map textures could be decoded. The texture format may be unsupported or your browser may lack BC texture support.'
                : 'No supported map textures were found in this pak. Select a map mod with HexMaps/Processed textures.';
            emitProgress({ active: false, fileName, currentFile: '', processed: processedCount,
                total: mapsToProcess.length, percent: 100, error: message });
            throw new Error(message);
        }
        if (pngCount > 0) {
            const manifest = {
                version: 1,
                importedAt: new Date().toISOString(),
                sourcePakName: fileName,
                sourcePakBaseDir: baseDir,
                imagesByPath,
            };

            try {
                await game.foxholeMap.saveMapModCache(manifest);
            } catch (error) {
                mapModLogWarn(
                    'Blob map cache save failed, retrying as data URLs:',
                    error?.message || error,
                );
                const fallbackImagesByPath = {};
                for (const [path, value] of Object.entries(imagesByPath)) {
                    if (typeof Blob !== 'undefined' && value instanceof Blob) {
                        const dataUrl = await this.blobToDataUrl(value);
                        if (dataUrl) {
                            fallbackImagesByPath[path] = dataUrl;
                        }
                    } else if (typeof value === 'string') {
                        fallbackImagesByPath[path] = value;
                    }
                }
                if (Object.keys(fallbackImagesByPath).length !== Object.keys(imagesByPath).length) {
                    throw new Error('Could not encode the map cache for storage. The previous mod was kept.');
                }
                await game.foxholeMap.saveMapModCache({
                    ...manifest,
                    imagesByPath: fallbackImagesByPath,
                });
            }

            await game.foxholeMap.refreshMapModCache();
            mapModLogInfo(`Extracted ${pngCount} PNG textures from ${pakName}.pak`);
        }
        game.constructionMenuComponent?.refresh();
        emitProgress({
            active: false,
            fileName,
            currentFile: '',
            processed: mapsToProcess.length,
            total: mapsToProcess.length,
            percent: 100,
        });

        return {
            pakName,
            mapCount: maps.length,
            processedCount: mapsToProcess.length,
            pngCount,
            outputDir: mapDir,
        };
    }

    exportHexMaps({ skipDecode = false } = {}) {
        mapModLogInfo('Starting export process');
        if (!this.assetPaths.length) {
            this.scanPaths();
        }
        if (!this.regions.length) {
            this.detectRegions();
        }
        if (!this.assetsData.length) {
            this.findAssetBlocks();
        }

        if (!this.assetsData.length) {
            mapModLogWarn('No texture bundles found.');
            return [];
        }

        const results = this.assetsData.map(assetData => {
            const decoded = skipDecode
                ? { format: 'raw', blob: null }
                : this.decodeTexture(assetData);
            return {
                region: assetData.region,
                assetPath: assetData.assetPath,
                format: decoded.format,
                blob: decoded.blob,
                raw: assetData.files,
            };
        });

        mapModLogInfo(
            'Export complete. Regions:',
            results.map(r => r.region).filter(Boolean),
        );
        return results;
    }
}

function buildRegionTextureKeyMap(game) {
    const regionTextureKeys = {};
    if (!game?.data?.foxhole?.maps) {
        return regionTextureKeys;
    }
    for (const region of Object.values(game.data.foxhole.maps)) {
        if (!region?.textureKey || !region?.key) {
            continue;
        }
        regionTextureKeys[String(region.key).toLowerCase()] = region.textureKey;
    }
    return regionTextureKeys;
}

function resolveTextureKeyForPng(mapKey, regionTextureKeys) {
    const lcMapKey = String(mapKey || '').toLowerCase();
    let textureKey = null;
    for (const [regionKey, regionTextureKey] of Object.entries(regionTextureKeys || {})) {
        if (lcMapKey.includes(regionKey)) {
            textureKey = regionTextureKey;
            break;
        }
    }
    if (!textureKey) {
        mapModLogInfo(`Unknown map '${mapKey}'.`);
        return mapKey;
    }
    if (textureKey !== mapKey) {
        mapModLogInfo(`Corrected map path: '${mapKey}' -> '${textureKey}'`);
    }
    return textureKey;
}

function buildFlatHexPath(ctx, width, height) {
    const hw = width / 2;
    const hh = height / 2;

    const points = [
        [width * 0.25, 0], // top-left
        [width * 0.75, 0], // top-right
        [width, hh], // right
        [width * 0.75, height], // bottom-right
        [width * 0.25, height], // bottom-left
        [0, hh], // left
    ];

    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.closePath();
}

function getCenteredAspectCrop(sourceWidth, sourceHeight, targetRatio) {
    let sw = sourceWidth;
    let sh = sourceHeight;
    let sx = 0;
    let sy = 0;
    const sourceRatio = sourceWidth / sourceHeight;
    if (sourceRatio > targetRatio) {
        sw = Math.round(sourceHeight * targetRatio);
        sx = Math.round((sourceWidth - sw) / 2);
    } else if (sourceRatio < targetRatio) {
        sh = Math.round(sourceWidth / targetRatio);
        sy = Math.round((sourceHeight - sh) / 2);
    }
    return { sx, sy, sw, sh };
}

async function imageSourceToRgbaBytes(loaded, width = loaded.width, height = loaded.height) {
    const canvas = typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height)
        : document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
        throw new Error('Canvas 2d unavailable for texture scoring');
    }
    ctx.drawImage(loaded.source, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height).data;
}

async function pngBlobToRgbaBytes(blob, width, height) {
    const loaded = await loadImageSource(blob);
    if (!loaded) {
        throw new Error('Failed to read decoded texture pixels');
    }
    try {
        return await imageSourceToRgbaBytes(loaded, width, height);
    } finally {
        loaded.cleanup?.();
    }
}

function estimateSpatialNoiseScore(rgba, width, height) {
    const stride = Math.max(1, Math.floor(Math.sqrt(width * height / 16384)));
    let difference = 0, samples = 0;
    for (let y = 0; y < height - 1; y += stride) {
        for (let x = 0; x < width - 1; x += stride) {
            const i = (y * width + x) * 4;
            for (const next of [i + 4, i + width * 4]) {
                // Transparent hex margins must not hide noise in the visible texture.
                if (!rgba[i + 3] || !rgba[next + 3]) {
                    continue;
                }
                for (let channel = 0; channel < 3; channel++) {
                    difference += Math.abs(rgba[i + channel] - rgba[next + channel]);
                    samples++;
                }
            }
        }
    }
    return samples ? difference / samples : Number.POSITIVE_INFINITY;
}

async function loadImageSource(blob) {
    if (typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(blob);
            return {
                source: bitmap,
                width: bitmap.width,
                height: bitmap.height,
                cleanup: () => bitmap.close(),
            };
        } catch (error) {
            mapModLogWarn('createImageBitmap failed, falling back to Image decode:', error);
        }
    }
    return await new Promise(resolve => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(blob);
        img.onload = function() {
            resolve({
                source: img,
                width: img.width,
                height: img.height,
                cleanup: () => URL.revokeObjectURL(objectUrl),
            });
        };
        img.onerror = function() {
            URL.revokeObjectURL(objectUrl);
            resolve(null);
        };
        img.src = objectUrl;
    });
}

function canvasToPngBlob(canvas) {
    return new Promise(resolve => {
        canvas.toBlob(result => resolve(result), 'image/png');
    });
}

async function transformPngToHexTexture(blob, {
    targetRatio,
} = {}) {
    const loaded = await loadImageSource(blob);
    if (!loaded) {
        throw new Error('The selected PNG could not be decoded. Check that it is a valid image.');
    }
    const { source, width: sourceWidth, height: sourceHeight, cleanup } = loaded;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = sourceWidth;
        canvas.height = sourceHeight;
        const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
        if (!ctx) {
            return blob;
        }
        const hasTargetRatio = typeof targetRatio === 'number' && Number.isFinite(targetRatio) && targetRatio > 0;
        const { sx, sy, sw, sh } = hasTargetRatio
            ? getCenteredAspectCrop(sourceWidth, sourceHeight, targetRatio)
            : { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight };
        ctx.save();
        buildFlatHexPath(ctx, sourceWidth, sourceHeight);
        ctx.clip();
        ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sourceWidth, sourceHeight);
        ctx.restore();
        const result = await canvasToPngBlob(canvas);
        return result || blob;
    } catch (error) {
        mapModLogWarn('Failed to transform PNG texture:', error);
        return blob;
    } finally {
        if (typeof cleanup === 'function') {
            cleanup();
        }
    }
}

export class ModImporter {
    static async importPak({
        game,
        contents,
        fileName = 'mod.pak',
        onProgress = null,
    } = {}) {
        let buffer = contents;
        if (buffer instanceof Blob) {
            buffer = await buffer.arrayBuffer();
        }
        const importer = new PakImporter(buffer);
        return await importer.importHexMaps({
            game,
            fileName,
            onProgress,
        });
    }

    static async importPngFiles({
        game,
        files,
        onProgress = null,
    } = {}) {
        if (!game?.foxholeMap) {
            throw new Error('importPngFiles requires game.foxholeMap');
        }
        const pngFiles = (files || []).filter(f => f?.file?.type === 'image/png' || /\.png$/i.test(f?.file?.name || ''));
        if (!pngFiles.length) {
            throw new Error('No PNG files were selected.');
        }

        const mapDir = 'mods/Textures/UI/HexMaps/Processed/';
        const imagesByPath = {};
        const importFileName = 'PNG Files';
        const total = pngFiles.length;
        let processed = 0;

        const emitProgress = payload => {
            if (typeof onProgress === 'function') {
                onProgress(payload);
            }
        };

        emitProgress({
            active: true,
            fileName: importFileName,
            currentFile: '',
            processed,
            total,
            percent: total ? 0 : 100,
            error: null,
        });

        const TARGET_WIDTH = 2048;
        const TARGET_HEIGHT = 1776;
        const TARGET_RATIO = TARGET_WIDTH / TARGET_HEIGHT;
        const regionTextureKeys = buildRegionTextureKeyMap(game);
        const maxParallel = Math.min(
            4,
            Math.max(
                1,
                typeof navigator !== 'undefined' && navigator.hardwareConcurrency
                    ? Math.ceil(navigator.hardwareConcurrency / 2)
                    : 2,
            ),
        );
        let nextStatusUpdate = 0;

        const updateProgress = (currentFile = '') => {
            const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
            if (currentFile && processed < total && now < nextStatusUpdate) {
                return;
            }
            nextStatusUpdate = now + 100;
            emitProgress({
                active: true,
                fileName: importFileName,
                currentFile,
                processed,
                total,
                percent: total ? Math.min(100, Math.round((processed / total) * 100)) : 100,
                error: null,
            });
        };

        try {
            updateProgress('');
            const processFile = async file => {
                if (game.foxholeMap?.isImportCancelRequested?.()) {
                    return;
                }
                const originalName = file.file.name;
                const mapKey = originalName.replace(/\.png$/i, '');
                const textureKey = resolveTextureKeyForPng(mapKey, regionTextureKeys);
                const outPath = `${mapDir}${textureKey}.png`;
                updateProgress(outPath);
                const transformed = await transformPngToHexTexture(file.data, {
                    targetRatio: TARGET_RATIO,
                });
                imagesByPath[outPath] = transformed;
                processed += 1;
                updateProgress(outPath);
            };

            const workers = Array.from(
                { length: Math.min(maxParallel, total) },
                async (_, workerIndex) => {
                    for (let index = workerIndex; index < total; index += maxParallel) {
                        if (game.foxholeMap?.isImportCancelRequested?.()) {
                            break;
                        }
                        await processFile(pngFiles[index]);
                    }
                },
            );
            const workerResults = await Promise.allSettled(workers);
            const failedWorker = workerResults.find(result => result.status === 'rejected');
            if (failedWorker) {
                throw failedWorker.reason;
            }

            if (game.foxholeMap?.isImportCancelRequested?.()) {
                emitProgress({
                    active: false,
                    fileName: importFileName,
                    currentFile: '',
                    processed,
                    total,
                    percent: total ? Math.min(100, Math.round((processed / total) * 100)) : 100,
                    error: 'cancelled',
                });
                return {
                    pngCount: 0,
                    processedCount: processed,
                    total,
                    mapDir,
                    cancelled: true,
                };
            }

            const manifest = {
                version: 1,
                importedAt: new Date().toISOString(),
                sourceType: 'png',
                imagesByPath,
            };
            await game.foxholeMap.saveMapModCache(manifest);
            await game.foxholeMap.refreshMapModCache();

            const pngCount = Object.keys(imagesByPath).length;
            emitProgress({
                active: false,
                fileName: importFileName,
                currentFile: '',
                processed,
                total,
                percent: 100,
                error: null,
            });

            return {
                pngCount,
                processedCount: processed,
                total,
                mapDir,
            };
        } catch (error) {
            emitProgress({
                active: false,
                fileName: importFileName,
                currentFile: '',
                processed,
                total,
                percent: total ? Math.min(100, Math.round((processed / total) * 100)) : 100,
                error: error?.message || String(error),
            });
            throw error;
        }
    }
}

/**
 * Node-friendly diagnostics for a map-mod .pak (no GPU decode required).
 * Writes enough metadata to spot wrong BC7 payload offsets / format guesses.
 */
export function diagnoseMapModPak(buffer, {
    limit = Infinity,
    includeFingerprints = true,
} = {}) {
    const importer = new PakImporter(buffer);
    const maps = importer.exportHexMaps({ skipDecode: true });
    const limited = Number.isFinite(limit) ? maps.slice(0, Math.max(0, limit)) : maps;

    const entries = limited.map(map => {
        const rgbaMeta = importer.extractUncompressedRgbaPayloadMeta({ files: map.raw });
        const payloadMeta = importer.extractGeneratorBc7PayloadMeta({ files: map.raw });
        const diagnostics = importer.getTextureDiagnostics(map);
        const pfTags = diagnostics.uassetPfTags || [];
        const recommendedDecode = rgbaMeta
            ? 'rgba8'
            : (pfTags.some(isUncompressedRgbaPfTag) ? 'rgba8-missing-payload' : (payloadMeta?.formatCandidates[0] ?? 'unknown'));
        const candidates = importer.extractGeneratorBc7PayloadCandidates({ files: map.raw }, 2)
            .map(candidate => ({
                id: candidate.id,
                start: candidate.start,
                fingerprint: includeFingerprints
                    ? payloadFingerprint(
                        map.raw?.uasset ? new Uint8Array(map.raw.uasset) : null,
                        candidate.start,
                        payloadMeta?.payloadSize ?? FH_BC7_TEXTURE_SIZE,
                    )
                    : null,
            }));

        return {
            region: map.region,
            assetPath: map.assetPath,
            format: map.format,
            recommendedDecode,
            rgba: rgbaMeta
                ? {
                    source: rgbaMeta.source,
                    start: rgbaMeta.start,
                    width: rgbaMeta.width,
                    height: rgbaMeta.height,
                    payloadSize: rgbaMeta.payloadSize,
                    layout: rgbaMeta.layout,
                    swizzleBgra: rgbaMeta.swizzleBgra,
                    pfTags: rgbaMeta.pfTags,
                    fingerprint: includeFingerprints && map.raw?.uasset
                        ? payloadFingerprint(
                            new Uint8Array(map.raw.uasset),
                            rgbaMeta.start,
                            rgbaMeta.payloadSize,
                        )
                        : null,
                }
                : null,
            payload: payloadMeta
                ? {
                    source: payloadMeta.source,
                    start: payloadMeta.start,
                    width: payloadMeta.width,
                    height: payloadMeta.height,
                    payloadSize: payloadMeta.payloadSize,
                    footerLen: payloadMeta.footerLen ?? null,
                    footerOffset: payloadMeta.footerOffset ?? null,
                    headerShift: payloadMeta.headerShift ?? null,
                    fingerprint: includeFingerprints && map.raw?.uasset
                        ? payloadFingerprint(
                            new Uint8Array(map.raw.uasset),
                            payloadMeta.start,
                            payloadMeta.payloadSize ?? FH_BC7_TEXTURE_SIZE,
                        )
                        : null,
                }
                : null,
            diagnostics,
            candidates,
            ddsPreviewAvailable: Boolean(payloadMeta?.payload) && recommendedDecode === 'bc7',
        };
    });

    const startHistogram = {};
    for (const entry of entries) {
        const start = entry.recommendedDecode === 'rgba8'
            ? entry.rgba?.start
            : entry.payload?.start;
        if (typeof start !== 'number') {
            continue;
        }
        const key = String(start);
        startHistogram[key] = (startHistogram[key] || 0) + 1;
    }

    return {
        version: 1,
        fastDecodeMode: FH_FAST_DECODE_MODE,
        generatorPayloadStartHint: FH_GENERATOR_PAYLOAD_START_HINT,
        bc7: {
            width: FH_BC7_WIDTH,
            height: FH_BC7_HEIGHT,
            textureSize: FH_BC7_TEXTURE_SIZE,
        },
        mapCount: maps.length,
        diagnosedCount: entries.length,
        startHistogram,
        entries,
        buildDdsForEntry(index = 0) {
            const map = limited[index];
            if (!map) {
                return null;
            }
            const payloadMeta = importer.extractGeneratorBc7PayloadMeta({ files: map.raw });
            if (!payloadMeta?.payload || payloadMeta.formatCandidates[0] !== 'bc7') {
                return null;
            }
            return {
                region: map.region,
                assetPath: map.assetPath,
                width: payloadMeta.width ?? FH_BC7_WIDTH,
                height: payloadMeta.height ?? FH_BC7_HEIGHT,
                start: payloadMeta.start,
                source: payloadMeta.source,
                dds: buildDdsBc7(
                    payloadMeta.payload,
                    payloadMeta.width ?? FH_BC7_WIDTH,
                    payloadMeta.height ?? FH_BC7_HEIGHT,
                ),
            };
        },
        importer,
        maps: limited,
    };
}
