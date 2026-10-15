import test from 'node:test';
import assert from 'node:assert/strict';
import { PakImporter, ModImporter } from '../app/plugins/foxhole/nixie/map/mod-pak.js';

function importer() {
    return Object.assign(Object.create(PakImporter.prototype), {
        assetPaths: [], regions: [], assetsData: [],
    });
}

function texture(tag: string, width: number, height: number, bytesPerBlock: number) {
    const size = tag.includes('8G8') ? width * height * 4 : Math.ceil(width / 4) * Math.ceil(height / 4) * bytesPerBlock;
    const bytes = Buffer.alloc(1085 + size + 28);
    bytes.writeUInt32LE(0x9e2a83c1, 0);
    bytes.writeInt32LE(-7, 4);
    bytes.write(tag, 64);
    bytes.fill(0x42, 1085, 1085 + size);
    bytes.writeUInt32LE(width, bytes.length - 28);
    bytes.writeUInt32LE(height, bytes.length - 24);
    bytes.writeUInt32LE(1, bytes.length - 20);
    bytes.writeUInt32LE(15, bytes.length - 12);
    bytes.writeUInt32LE(0x9e2a83c1, bytes.length - 4);
    return bytes;
}

for (const [tag, blockSize] of [['PF_DXT1', 8], ['PF_BC7', 16]] as const) {
    test(`extracts ${tag} at its declared dimensions and block size`, () => {
        const bytes = texture(tag, 4096, 3552, blockSize);
        const meta = importer().extractGeneratorBc7PayloadMeta({ files: { uasset: bytes } });
        assert.ok(meta);
        assert.equal(meta.width, 4096);
        assert.equal(meta.height, 3552);
        assert.equal(meta.start, 1085);
        assert.equal(meta.payloadSize, 1024 * 888 * blockSize);
        assert.equal(meta.payload[0], 0x42);
        assert.equal(meta.payload.at(-1), 0x42);
    });
}

test('extracts higher-resolution RGBA without falling back to BC decoding', () => {
    const bytes = texture('PF_B8G8R8A8', 4096, 3552, 0);
    const instance = importer();
    const meta = instance.extractUncompressedRgbaPayloadMeta({ files: { uasset: bytes } });
    assert.ok(meta);
    assert.equal(meta.start, 1085);
    assert.equal(meta.width, 4096);
    assert.equal(meta.height, 3552);
    assert.equal(meta.payloadSize, 4096 * 3552 * 4);
    assert.equal(instance.extractGeneratorBc7PayloadMeta({ files: { uasset: bytes } }), null);
});

test('exports BC7 DDS with standard header offsets and the declared dimensions', async () => {
    const raw = texture('PF_BC7', 8, 8, 16);
    const decoded = importer().decodeTexture({ files: { uasset: raw } });
    assert.equal(decoded.format, 'dds-bc7');
    const dds = Buffer.from(await decoded.blob.arrayBuffer());
    assert.equal(dds.readUInt32LE(76), 32);
    assert.equal(dds.toString('ascii', 84, 88), 'DX10');
    assert.equal(dds.readUInt32LE(16), 8);
    assert.equal(dds.readUInt32LE(12), 8);
    assert.equal(dds.readUInt32LE(108), 0x1000);
    assert.equal(dds.readUInt32LE(128), 98);
    assert.deepEqual(dds.subarray(148), raw.subarray(1085, -28));
});

test('rejects an unsupported DDS codec instead of trying a different decoder', async () => {
    const bytes = Buffer.alloc(148 + 16);
    bytes.write('DDS ');
    bytes.writeUInt32LE(124, 4);
    bytes.writeUInt32LE(4, 12);
    bytes.writeUInt32LE(4, 16);
    bytes.writeUInt32LE(32, 76);
    bytes.write('DX10', 84);
    bytes.writeUInt32LE(80, 128); // BC4 is not one of the supported color formats.
    bytes.writeUInt32LE(3, 132);
    bytes.writeUInt32LE(1, 140);
    await assert.rejects(importer().mapToPngBlob({ raw: { ubulk: bytes } }), /Unsupported DDS texture format/);
});

test('imports an embedded PNG even when export skipped texture sniffing', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const embedded = Buffer.concat([Buffer.alloc(32), png, Buffer.alloc(16)]);
    const blob = await importer().mapToPngBlob({ format: 'raw', raw: { uexp: embedded } });
    assert.equal(blob.type, 'image/png');
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), png);
});

function gameWithCache() {
    const saved: unknown[] = [];
    const game = {
        data: { foxhole: { maps: {} } },
        foxholeMap: {
            mapModStorage: {},
            saveMapModCache: async (manifest: unknown) => { saved.push(manifest); },
            refreshMapModCache: async () => {},
        },
    };
    return { game, saved };
}

for (const count of [0, 2]) {
    test(`rejects an import with ${count} textures and no decoded PNGs without replacing the cache`, async () => {
        const instance = importer();
        instance.exportHexMaps = () => Array.from({ length: count }, (_, i) => ({ assetPath: `MapFixture${i}Hex` }));
        instance.mapToPngBlob = async () => null;
        const { game, saved } = gameWithCache();
        const progress: any[] = [];
        await assert.rejects(instance.importHexMaps({ game, onProgress: (update: any) => progress.push(update) }),
            count ? /No map textures could be decoded/ : /No supported map textures were found/);
        assert.equal(saved.length, 0);
        assert.equal(progress.at(-1).active, false);
        assert.ok(progress.at(-1).error);
    });
}

test('partial decode reports the actual count and saves only decoded maps', async () => {
    const instance = importer();
    instance.exportHexMaps = () => [{ assetPath: 'MapGoodHex' }, { assetPath: 'MapBadHex' }];
    instance.mapToPngBlob = async (map: any) => map.assetPath === 'MapGoodHex' ? new Blob(['png']) : null;
    const { game, saved } = gameWithCache();
    const result = await instance.importHexMaps({ game });
    assert.equal(result.pngCount, 1);
    assert.equal(result.processedCount, 2);
    assert.equal(Object.keys((saved[0] as any).imagesByPath).length, 1);
});

test('failed blob-to-data-URL fallback does not write an empty replacement cache', async () => {
    const instance = importer();
    instance.exportHexMaps = () => [{ assetPath: 'MapGoodHex' }];
    instance.mapToPngBlob = async () => new Blob(['png']);
    instance.blobToDataUrl = async () => null;
    const { game } = gameWithCache();
    let saveAttempts = 0;
    game.foxholeMap.saveMapModCache = async () => {
        saveAttempts++;
        throw new Error('Blob storage unavailable');
    };
    await assert.rejects(instance.importHexMaps({ game }), /Could not encode the map cache/);
    assert.equal(saveAttempts, 1);
});

test('rejects a PNG import with no PNG candidates without replacing the cache', async () => {
    const { game, saved } = gameWithCache();
    await assert.rejects(ModImporter.importPngFiles({ game, files: [] }), /No PNG files were selected/);
    assert.equal(saved.length, 0);
});
