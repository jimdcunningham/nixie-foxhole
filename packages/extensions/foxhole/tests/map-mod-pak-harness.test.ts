import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { diagnoseMapModPak, PakImporter } from '../app/plugins/foxhole/nixie/map/mod-pak.js';

const DEFAULT_PAK = process.env.FOXHOLE_MAP_MOD_PAK
    || 'C:\\Users\\james\\Downloads\\War-WindowsNoEditor_Map_01B_Style01_2K_WG_Ver.3.0c\\War-WindowsNoEditor_Map_01B_Style01_2K_WG_Ver.3.0c.pak';

test('WG map mod pak is diagnosed as uncompressed RGBA8, not BC7', async t => {
    let file;
    try {
        file = await readFile(DEFAULT_PAK);
    } catch {
        t.skip(`pak not found at ${DEFAULT_PAK}`);
        return;
    }

    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const report = diagnoseMapModPak(buffer, { limit: 3, includeFingerprints: false });

    assert.equal(report.mapCount, 55);
    assert.ok(report.diagnosedCount >= 1);

    for (const entry of report.entries) {
        assert.equal(entry.recommendedDecode, 'rgba8', entry.assetPath);
        assert.ok(entry.rgba, entry.assetPath);
        assert.equal(entry.rgba.width, 2048);
        assert.equal(entry.rgba.height, 1776);
        assert.equal(entry.rgba.payloadSize, 2048 * 1776 * 4);
        assert.ok(entry.rgba.start < 4096, `rgba start should be near header, got ${entry.rgba.start}`);
        assert.ok(
            (entry.diagnostics.uassetPfTags || []).includes('PF_B8G8R8A8'),
            entry.assetPath,
        );
    }
});

test('PakImporter extracts RGBA payload for WG-style uassets', async t => {
    let file;
    try {
        file = await readFile(DEFAULT_PAK);
    } catch {
        t.skip(`pak not found at ${DEFAULT_PAK}`);
        return;
    }

    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const importer = new PakImporter(buffer);
    const maps = importer.exportHexMaps({ skipDecode: true });
    assert.ok(maps.length > 0);

    const rgbaMeta = importer.extractUncompressedRgbaPayloadMeta({ files: maps[0].raw });
    assert.ok(rgbaMeta);
    assert.equal(rgbaMeta.payload.length, 2048 * 1776 * 4);
    assert.equal(rgbaMeta.layout, 'bgra');
});
