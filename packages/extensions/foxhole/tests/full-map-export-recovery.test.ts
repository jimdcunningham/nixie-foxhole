import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../app/plugins/foxhole/nixie/map/full-map-export.ts', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '')
    .replace('export async function', 'async function');

test('full map export recovers only completed tiles with matching inputs', async () => {
    const tiles = new Map<string, Response>();
    const cache = {
        match: async (key: string) => tiles.get(key)?.clone(),
        put: async (key: string, response: Response) => { tiles.set(key, response); },
    };
    let encoded = 0;
    let blank = false;
    const exportMap = runInNewContext(stripTypeScriptTypes(source) + '\nexportFoxholeFullMap;', {
        caches: { open: async () => cache }, crypto, TextEncoder, Uint8Array, Blob, Response, URL, performance, setTimeout,
        location: { href: 'https://studio.example/' },
        document: { createElement: () => ({ getContext: () => ({
            clearRect() {}, drawImage() {},
            getImageData: () => ({ data: Uint8Array.of(10, 20, 30, blank ? 0 : 255) }),
        }) }) },
        createImageBitmap: async () => ({ width: 2048, height: 1776, close() {} }),
        encodeBc7: () => { encoded++; return new Uint8Array(2048 * 1776); },
        PakImporter: class {
            exportHexMaps() {
                return ['a', 'b'].map(assetPath => ({ assetPath, raw: { uasset: new ArrayBuffer(2048 * 1776 + 28) } }));
            }
            extractGeneratorBc7PayloadMeta() {
                return { width: 2048, height: 1776, payloadSize: 2048 * 1776, start: 0, footerLen: 28, formatCandidates: ['bc7'] };
            }
        },
        buildMapPak: async () => new Blob(),
        zipSync: () => new Uint8Array(),
        strToU8: (value: string) => new TextEncoder().encode(value),
    });
    const regions = ['a', 'b'].map(key => ({ key, name: key, textureKey: key }));
    const png = new Blob([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 1)]);
    const baked: string[] = [];
    const run = (bake: (key: string) => Promise<{ png: Blob }>, signature = 'same settings') =>
        exportMap(new Blob(), regions, bake, new AbortController().signal, () => {}, () => signature, 'same catalog');
    const bake = async (key: string) => { baked.push(key); return { png }; };
    await assert.rejects(run(async key => {
        if (key === 'b') throw new Error('interrupted');
        return bake(key);
    }), /interrupted/);
    assert.equal(tiles.size, 1);
    await run(bake);
    assert.deepEqual(baked, ['a', 'b']);
    assert.equal(encoded, 2);
    await run(bake);
    assert.equal(encoded, 2);

    blank = true;
    await assert.rejects(run(bake, 'changed settings'), /Empty region bake/);
    assert.equal(encoded, 2);
    blank = false;
    await run(bake, 'changed settings');
    assert.equal(encoded, 4);
});