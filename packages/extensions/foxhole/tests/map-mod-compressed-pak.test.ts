import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateSync, gzipSync } from 'node:zlib';
import { PakImporter, diagnoseMapModPak } from '../app/plugins/foxhole/nixie/map/mod-pak.js';

function u32(value: number) {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(value);
    return bytes;
}

function u64(value: number) {
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64LE(BigInt(value));
    return bytes;
}

function fstring(value: string) {
    const bytes = Buffer.from(`${value}\0`);
    return Buffer.concat([u32(bytes.length), bytes]);
}

// FPakEntry v3 uses absolute block offsets; v5 makes them entry-relative.
// Inline headers store offset 0, even when the index entry has a nonzero offset.
function makePak(version = 3, options: {
    encrypted?: boolean;
    invalidBlock?: boolean;
    sizeDelta?: number;
    invalidZlib?: boolean;
    method?: number;
    mixed?: boolean;
    rootEntry?: boolean;
    codec?: 'Zlib' | 'Gzip';
    compressionNames?: string[];
    footerSlots?: number;
    indexEncrypted?: boolean;
    fileCount?: number;
    uncompressed?: boolean;
    uncompressedFirst?: boolean;
    extension?: '.uasset' | '.uexp' | '.ubulk';
} = {}) {
    const blockSize = 128;
    const payloads = [Buffer.alloc(300, 0x41), Buffer.alloc(257, 0x42)].slice(0, options.fileCount ?? 2);
    const records: Buffer[] = [];
    const files: Buffer[] = [];
    let offset = 0;
    for (const [i, payload] of payloads.entries()) {
        const compressed = !options.uncompressed && (!options.mixed || i === (options.uncompressedFirst ? 1 : 0));
        if (!options.extension || options.extension === '.uasset') {
            payload.writeUInt32LE(0x9e2a83c1, 0);
            payload.writeInt32LE(-7, 4);
            payload.writeUInt32LE(0, 8);
            payload.writeUInt32LE(64, 24);
        }
        const blocks = [];
        if (compressed) {
            for (let start = 0; start < payload.length; start += blockSize) {
                const compress = options.codec === 'Gzip' ? gzipSync : deflateSync;
                blocks.push(compress(payload.subarray(start, start + blockSize)));
            }
        } else {
            blocks.push(payload);
        }
        if (options.invalidZlib && i === 0) {
            blocks[0]!.fill(0);
        }
        const headerSize = compressed ? 57 + blocks.length * 16 : 53;
        let blockOffset = headerSize + (version >= 5 ? 0 : offset);
        const ranges = compressed
            ? blocks.map((block, j) => {
                const start = blockOffset;
                blockOffset += block.length;
                return Buffer.concat([
                    u64(start),
                    u64(options.invalidBlock && i === 0 && j === 0 ? 999999 : blockOffset),
                ]);
            })
            : [];
        const size = blocks.reduce((sum, block) => sum + block.length, 0);
        const metadata = Buffer.concat([
            u64(size), u64(payload.length + (options.sizeDelta ?? 0)),
            u32(compressed ? options.method ?? 1 : 0), Buffer.alloc(20),
            ...(compressed ? [u32(blocks.length), ...ranges] : []),
            Buffer.from([options.encrypted ? 1 : 0]), u32(compressed ? blockSize : 0),
        ]);
        const path = options.rootEntry && i === 1
            ? 'Readme.txt'
            : `War/Content/Textures/UI/HexMaps/Processed/MapFixture${i}Hex${options.extension ?? '.uasset'}`;
        records.push(Buffer.concat([fstring(path), u64(offset), metadata]));
        const file = Buffer.concat([u64(0), metadata, ...blocks]);
        files.push(file);
        offset += file.length;
    }
    const index = Buffer.concat([fstring('../../../'), u32(records.length), ...records]);
    // UE4.23/4.24 v8B: GUID, encryption flag, standard footer, then five
    // 32-byte codec names. IDs are one-based table slots, not codec constants.
    // Layout reference: trumank/repak's UnrealPak-generated v8B test archives.
    const names = options.compressionNames ?? [options.codec ?? 'Zlib'];
    const footer = Buffer.concat([
        ...(version >= 7 ? [Buffer.alloc(16)] : []),
        ...(version >= 4 ? [Buffer.from([options.indexEncrypted ? 1 : 0])] : []),
        u32(0x5a6f12e1), u32(version), u64(offset), u64(index.length), Buffer.alloc(20),
        ...(version === 8
            ? Array.from({ length: options.footerSlots ?? 5 }, (_, i) => {
                const name = Buffer.alloc(32);
                name.write(names[i] ?? '');
                return name;
            })
            : []),
    ]);
    const pak = Buffer.concat([...files, index, footer]);
    return { buffer: pak.buffer.slice(pak.byteOffset, pak.byteOffset + pak.byteLength), payloads };
}

test('reads a mix of compressed and uncompressed entries from one index', () => {
    const { buffer, payloads } = makePak(3, { mixed: true });
    const importer = new PakImporter(buffer);
    const entries = importer.pak.listEntries();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].compressionMethod, 1);
    assert.equal(entries[1].compressionMethod, 0);
    for (const [i, entry] of entries.entries()) {
        assert.deepEqual(Buffer.from(importer.pak.readEntry(entry)), payloads[i]);
    }
});

for (const version of [3, 8]) {
    test(`reads a v${version} pak with an uncompressed entry before compressed entries`, () => {
        const { buffer, payloads } = makePak(version, { mixed: true, uncompressedFirst: true });
        const importer = new PakImporter(buffer);
        for (const [i, entry] of importer.pak.listEntries().entries()) {
            assert.deepEqual(Buffer.from(importer.pak.readEntry(entry)), payloads[i]);
        }
    });

    test(`strips the complete inline header from a single uncompressed v${version} entry`, () => {
        const { buffer, payloads } = makePak(version, { fileCount: 1, uncompressed: true, extension: '.ubulk' });
        const importer = new PakImporter(buffer);
        const entry = importer.pak.listEntries()[0];
        assert.equal(entry.inlineHeaderSize, 53);
        assert.deepEqual(Buffer.from(importer.pak.readEntry(entry)), payloads[0]);
    });
}

test('reads an index containing a root-level readme beside map assets', () => {
    const { buffer, payloads } = makePak(3, { rootEntry: true });
    const importer = new PakImporter(buffer);
    const entries = importer.pak.listEntries();
    assert.equal(entries[1].path, 'Readme.txt');
    for (const [i, entry] of entries.entries()) {
        assert.deepEqual(Buffer.from(importer.pak.readEntry(entry)), payloads[i]);
    }
});

for (const [codec, method, compressionNames] of [
    ['Zlib', 2, ['Gzip', 'Zlib']],
    ['Zlib', 5, ['', '', '', '', 'Zlib']],
    ['Gzip', 1, ['Gzip', 'Zlib']],
    ['Zlib', 1, ['zLiB']],
] as const) {
    test(`extracts v8B ${codec} blocks using footer slot ${method}`, () => {
        const { buffer, payloads } = makePak(8, { codec, method, compressionNames: [...compressionNames] });
        const importer = new PakImporter(buffer);
        for (const [i, entry] of importer.pak.listEntries().entries()) {
            assert.deepEqual(Buffer.from(importer.pak.readEntry(entry)), payloads[i]);
        }
    });
}

test('reads compressed and uncompressed split entries in a v8B pak', () => {
    const { buffer, payloads } = makePak(8, { mixed: true, extension: '.ubulk' });
    const importer = new PakImporter(buffer);
    for (const [i, entry] of importer.pak.listEntries().entries()) {
        assert.deepEqual(Buffer.from(importer.pak.readEntry(entry)), payloads[i]);
    }
});

test('extracts legacy Gzip blocks using compression method 2', () => {
    const { buffer, payloads } = makePak(5, { codec: 'Gzip', method: 2 });
    const importer = new PakImporter(buffer);
    for (const [i, entry] of importer.pak.listEntries().entries()) {
        assert.deepEqual(Buffer.from(importer.pak.readEntry(entry)), payloads[i]);
    }
});

for (const [name, options, error] of [
    ['an undeclared codec slot', { compressionNames: [''] }, /Unsupported pak compression method 1/],
    ['a codec outside the table', { method: 6 }, /Unsupported pak compression method 6/],
    ['an unknown named codec', { compressionNames: ['UnknownCodec'] }, /Unsupported pak compression.*UnknownCodec/],
    ['oversized Gzip blocks', { codec: 'Gzip', sizeDelta: -1 }, /Decompressed block size mismatch/],
    ['undersized Gzip blocks', { codec: 'Gzip', sizeDelta: 1 }, /Decompressed block size mismatch/],
    ['invalid Gzip blocks', { codec: 'Gzip', invalidZlib: true }, /Failed to decompress Gzip/],
] as const) {
    test(`rejects v8B ${name} with a useful error`, () => {
        const { buffer } = makePak(8, options);
        const importer = new PakImporter(buffer);
        assert.throws(() => importer.pak.readEntry(importer.pak.listEntries()[0]), error);
    });
}

test('rejects an incomplete v8B compression table', () => {
    const { buffer } = makePak(8, { footerSlots: 4 });
    const importer = new PakImporter(buffer);
    assert.throws(() => importer.pak.listEntries(), /Unsupported or invalid pak v8 footer/);
});

test('rejects an unterminated v8B codec name', () => {
    const { buffer } = makePak(8, { compressionNames: ['X'.repeat(32)] });
    const importer = new PakImporter(buffer);
    assert.throws(() => importer.pak.listEntries(), /Invalid pak v8 compression name table/);
});

test('rejects a v8B encrypted index before attempting to parse it', () => {
    const { buffer } = makePak(8, { indexEncrypted: true });
    const importer = new PakImporter(buffer);
    assert.throws(() => importer.pak.listEntries(), /Encrypted pak indexes/);
});

for (const extension of ['.uexp', '.ubulk'] as const) {
    test(`strips inline headers from uncompressed ${extension} entries at nonzero offsets`, () => {
        const { buffer, payloads } = makePak(3, { mixed: true, extension });
        const importer = new PakImporter(buffer);
        const entries = importer.pak.listEntries();
        assert.ok(entries[1].offset > 0);
        assert.equal(entries[1].compressionMethod, 0);
        assert.deepEqual(Buffer.from(importer.pak.readEntry(entries[1])), payloads[1]);
    });
}

for (const version of [3, 5]) {
    test(`extracts all Zlib blocks from v${version} pak entries, including a short final block`, () => {
        const { buffer, payloads } = makePak(version);
        const importer = new PakImporter(buffer);
        const entries = importer.pak.listEntries();
        assert.equal(entries.length, 2);
        for (const [i, entry] of entries.entries()) {
            assert.deepEqual(Buffer.from(importer.pak.readEntry(entry)), payloads[i]);
        }
    });
}

for (const [name, options, error] of [
    ['encrypted entries', { encrypted: true }, /Encrypted pak entries/],
    ['out-of-bounds blocks', { invalidBlock: true }, /Invalid compressed block/],
    ['undersized decoded blocks', { sizeDelta: 1 }, /Decompressed block size mismatch/],
    ['oversized decoded blocks', { sizeDelta: -1 }, /Decompressed block size mismatch/],
    ['invalid Zlib data', { invalidZlib: true }, /Failed to decompress/],
    ['unsupported codecs', { method: 3 }, /Unsupported pak compression/],
] as const) {
    test(`rejects ${name} with a useful error`, () => {
        const { buffer } = makePak(3, options);
        const importer = new PakImporter(buffer);
        const entry = importer.pak.listEntries()[0];
        assert.throws(() => importer.pak.readEntry(entry), error);
    });
}

test('Knights map mod exposes all 55 BC7 map textures after pak decompression', async t => {
    const pakPath = process.env.FOXHOLE_KNIGHTS_MAP_MOD_PAK
        || 'C:/Users/james/Downloads/War-WindowsNoEditor_Knights_MapModOfScience_v1_3_NoStyles_DarkRdz.pak';
    let file;
    try {
        file = await readFile(pakPath);
    } catch {
        t.skip(`pak not found at ${pakPath}`);
        return;
    }
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const report = diagnoseMapModPak(buffer, { includeFingerprints: false });
    assert.equal(report.mapCount, 55);
    assert.equal(report.diagnosedCount, 55);
    for (const entry of report.entries) {
        assert.equal(entry.recommendedDecode, 'bc7', entry.assetPath);
        assert.ok(entry.payload, entry.assetPath);
        assert.equal(entry.payload.width, 2048);
        assert.equal(entry.payload.height, 1776);
        assert.equal(entry.ddsPreviewAvailable, true, entry.assetPath);
    }
});
