import { checkLegacyBlueprintSave } from '#foxhole/utils/legacy-blueprint-save.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { LegacyPlanArchiveReader } from '../../app/plugins/foxhole/legacy/plan-archive.ts';
import { compressLegacyLzma, decompressLegacyLzma } from '../../app/plugins/foxhole/legacy/plan-lzma.ts';
import { checkLegacyBlueprintZip, LEGACY_BLUEPRINT_LIMITS } from '#nixie/utils/legacy-blueprint-archive-bounds.ts';

async function zip(extra?: string, payload?: Uint8Array): Promise<Uint8Array> {
    const archive = new JSZip();
    archive.file(payload ? 'project.lzma' : 'project.json', payload ?? JSON.stringify({ version: '1.0.5', entities: [{ id: 1, type: 'rectangle' }] }));
    if (extra) {
        archive.file(extra, 'x');
    }
    return archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
test('bounded bridge reader handles JSON and LZMA fixture payloads', async () => {
    const reader = new LegacyPlanArchiveReader(true);
    assert.equal((await reader.read(await zip())).projectJson.entities?.length, 1);
    const bytes = compressLegacyLzma(JSON.stringify({ entities: [{ id: 1 }], version: '1.0.5' }));
    assert.equal((await reader.read(await zip(undefined, bytes))).projectJson.entities?.length, 1);
});
test('rejects traversal before JSZip sanitizes paths', async () => {
    assert.throws(() => checkLegacyBlueprintZip(awaitBytes), /directory/);
    await assert.rejects(new LegacyPlanArchiveReader(true).read(await zip('../unsafe.png')), /path/);
});
const awaitBytes = new Uint8Array(30);
test('rejects unsupported SVG and arbitrary files', async () => {
    await assert.rejects(new LegacyPlanArchiveReader(true).read(await zip('assets/image.svg')), /media/);
    await assert.rejects(new LegacyPlanArchiveReader(true).read(await zip('readme.txt')), /media/);
});
test('rejects forged expansion sizes and oversized LZMA dictionary before allocation', async () => {
    const archive = await zip();
    const modified = new Uint8Array(archive);
    const view = new DataView(modified.buffer);
    for (let offset = 0; offset < modified.length - 46; offset++) {
        if (view.getUint32(offset, true) === 0x02014b50) {
            view.setUint32(offset + 24, LEGACY_BLUEPRINT_LIMITS.projectBytes + 1, true);
            break;
        }
    }
    assert.throws(() => checkLegacyBlueprintZip(modified), /expansion/);
    const lzma = compressLegacyLzma('{}');
    new DataView(lzma.buffer, lzma.byteOffset).setUint32(1, 0x7fffffff, true);
    assert.throws(() => decompressLegacyLzma(lzma, true), /allocation/);
});
test('LZMA actual output guard handles lying declared length', () => {
    const lzma = compressLegacyLzma('x'.repeat(LEGACY_BLUEPRINT_LIMITS.projectBytes + 1), 1);
    new DataView(lzma.buffer, lzma.byteOffset).setBigUint64(5, 0xffffffffffffffffn, true);
    assert.throws(() => decompressLegacyLzma(lzma, true), /limit/);
});
test('rejects duplicate IDs, external images and entity count limits', () => {
    assert.throws(() => checkLegacyBlueprintSave({ entities: [{ id: 1 }, { id: 1 }] }), /identity/);
    assert.throws(() => checkLegacyBlueprintSave({ entities: [{ id: 1, type: 'image', textureFile: 'https://example.com/image.png' }] }), /External/);
    assert.throws(() => checkLegacyBlueprintSave({ entities: Array(20001).fill({ id: 1 }) }), /many entities/);
});
