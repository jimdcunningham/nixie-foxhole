import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compressLegacyLzma } from '../../app/plugins/foxhole/legacy/plan-lzma.ts';
import JSZip from 'jszip';
import {
    isLegacyPlanArchiveBytes,
    LegacyPlanArchiveReader,
} from '../../app/plugins/foxhole/legacy/plan-archive.ts';
import type { LegacyPlanSave } from '../../app/plugins/foxhole/legacy/plan-types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplePath = join(__dirname, '../fixtures/legacy-plans/sample-project.json');

async function buildZip(options: { json?: boolean; lzma?: boolean; project: LegacyPlanSave; }): Promise<Uint8Array> {
    const zip = new JSZip();
    const text = JSON.stringify(options.project);
    if (options.lzma) {
        zip.file('project.lzma', compressLegacyLzma(text, 1));
    }
    if (options.json || !options.lzma) {
        zip.file('project.json', text);
    }
    return zip.generateAsync({ type: 'uint8array' });
}

test('LegacyPlanArchiveReader reads project.json archives', async () => {
    const project = JSON.parse(readFileSync(samplePath, 'utf8')) as LegacyPlanSave;
    const bytes = await buildZip({ project, json: true });
    const reader = new LegacyPlanArchiveReader();
    const contents = await reader.read(bytes);

    assert.equal(contents.compressed, false);
    assert.equal(contents.projectJson.name, 'Sample Legacy Plan');
    assert.equal(contents.projectJson.entities?.length, 2);
    assert.notEqual(contents.rawZipBytes.byteLength, 0);

    // Non-destructive: mutating returned JSON must not affect a re-read.
    contents.projectJson.name = 'mutated';
    const again = await reader.read(bytes);
    assert.equal(again.projectJson.name, 'Sample Legacy Plan');
});

test('LegacyPlanArchiveReader reads project.lzma archives', async () => {
    const project = JSON.parse(readFileSync(samplePath, 'utf8')) as LegacyPlanSave;
    const bytes = await buildZip({ project, lzma: true });
    const reader = new LegacyPlanArchiveReader();
    const contents = await reader.read(bytes);

    assert.equal(contents.compressed, true);
    assert.equal(contents.projectJson.version, '1.0.5');
    assert.equal(contents.projectJson.entities?.[0]?.key, 'fortt1');
});

test('LegacyPlanArchiveReader rejects archives without a project payload', async () => {
    const zip = new JSZip();
    zip.file('readme.txt', 'nope');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const reader = new LegacyPlanArchiveReader();
    await assert.rejects(() => reader.read(bytes), /missing project\.lzma and project\.json/i);
});

test('LegacyPlanArchiveReader reads bare JSON saves', async () => {
    const project = JSON.parse(readFileSync(samplePath, 'utf8')) as LegacyPlanSave;
    const bytes = new TextEncoder().encode(JSON.stringify(project));
    const reader = new LegacyPlanArchiveReader();
    const contents = await reader.read(bytes);

    assert.equal(contents.compressed, false);
    assert.equal(contents.rawZipBytes.byteLength, 0);
    assert.equal(contents.projectJson.name, 'Sample Legacy Plan');
    assert.equal(contents.projectJson.entities?.length, 2);
});

test('isLegacyPlanArchiveBytes detects legacy JSON and rejects Nixie documents', async () => {
    const project = JSON.parse(readFileSync(samplePath, 'utf8')) as LegacyPlanSave;
    const legacyBytes = new TextEncoder().encode(JSON.stringify(project));
    assert.equal(await isLegacyPlanArchiveBytes(legacyBytes), true);

    const nixieBytes = new TextEncoder().encode(JSON.stringify({
        settings: { name: 'Nixie Project' },
        roots: [],
    }));
    assert.equal(await isLegacyPlanArchiveBytes(nixieBytes), false);
});
