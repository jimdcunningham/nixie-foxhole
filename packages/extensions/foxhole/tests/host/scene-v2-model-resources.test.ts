import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { nixieSceneV2ModelPosition, prepareNixieSceneV2ModelGlb, registerNixieSceneV2ModelAnchor } from '../../../../nixie/app/plugins/nixie/scene-v2/spatial-model-resource.ts';
import { readNixieSceneV2Model } from '../../../../nixie/desktop-extensions/scene-v2-spatial.ts';
import { parseNixieExperimentalResourceV1 } from '@nixiejs/extension-sdk';
import { registerNixieSceneV2ModelAssembly, resolveNixieSceneV2ModelParts } from '../../../../nixie/app/plugins/nixie/scene-v2/spatial-model-assembly.ts';

const assetsRoot = hostSourceUrl('../../public/foxhole/assets/', import.meta.url);
const modelBundle = JSON.parse(readFileSync(new URL('models/manifest.v1.json', assetsRoot), 'utf8'));
const readGeneratedModel = (id: string): Buffer => readFileSync(new URL(modelBundle.assets[id].path, assetsRoot));

test('the saved station preview identity resolves the canonical asset-repository model', () => {
    const plugin = readFileSync(new URL('../../app/plugins/foxhole-host-adapters.client.ts', import.meta.url), 'utf8');
    const registration = /registerNixieInternalModelResource\('nixie\.core\/resource-transfer-station-preview', assetDelivery\.resolve\('([^']+)'\)\)/.exec(plugin);
    assert.ok(registration, 'old development documents retain their preview identity');
    assert.equal(registration[1], modelBundle.assets.facilitytransferresource.path);
    assert.equal(readGeneratedModel('facilitytransferresource').readUInt32LE(0), 0x46546c67);
});

test('a neutral architectural model uses owner-local identity and a declared GLB resource', () => {
    const resource = parseNixieExperimentalResourceV1({ contractVersion: 1, id: 'furniture.table', kind: 'model', path: 'models/table.glb' });
    assert.equal(resource.kind, 'model');
    assert.throws(() => parseNixieExperimentalResourceV1({ ...resource, path: '../../../../nixie/tests/table.glb' }));
    assert.throws(() => parseNixieExperimentalResourceV1({ ...resource, path: 'models/table.gltf' }));
    const entity = { entityId: 'table', revision: 1, components: [{ ownerId: 'example.architecture', componentId: 'model', version: 1,
        definitionAvailable: true, data: { resourceId: 'furniture.table', width: 160, height: 80, depth: 90, offsetX: 2, offsetY: 0 } }] };
    assert.equal(readNixieSceneV2Model(entity)?.ownerId, 'example.architecture');
    assert.equal(readNixieSceneV2Model({ ...entity, components: [{ ...entity.components[0]!, definitionAvailable: false }] }), null);
    assert.equal(readNixieSceneV2Model({ ...entity, components: [{ ...entity.components[0]!, data: { ...entity.components[0]!.data, width: 1e100 } }] }), null);
    const fixture = readFileSync(hostSourceUrl('../../../../nixie/app/assets/scene-v2/spatial-block.glb', import.meta.url));
    assert.ok(prepareNixieSceneV2ModelGlb(fixture).length > 28);
});

test('the real station WebP GLB keeps binary geometry intact and resolves every embedded image', () => {
    const input = readGeneratedModel('facilitytransferresource');
    const output = prepareNixieSceneV2ModelGlb(input);
    const jsonLength = new DataView(output.buffer).getUint32(12, true);
    const document = JSON.parse(new TextDecoder().decode(output.subarray(20, 20 + jsonLength)));
    assert.equal(document.images.length, 9);
    assert.ok(document.images.every((image: { mimeType: string; uri?: string; }) => image.mimeType === 'image/webp' && !image.uri));
    assert.deepEqual(document.textures.map((texture: { source: number; }) => texture.source), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(output.subarray(20 + jsonLength), new Uint8Array(input.subarray(20 + input.readUInt32LE(12))));
    assert.ok(input.length < 2_200_000);
    assert.throws(() => prepareNixieSceneV2ModelGlb(new Uint8Array(28)), /valid self-contained GLB/);
});

function anchoredFixture(anchor: unknown): Uint8Array {
    const original = readFileSync(hostSourceUrl('../../../../nixie/app/assets/scene-v2/spatial-block.glb', import.meta.url));
    const oldLength = original.readUInt32LE(12);
    const document = JSON.parse(original.subarray(20, 20 + oldLength).toString());
    document.asset.extras = { nixieModelAnchor: anchor };
    const json = Buffer.from(JSON.stringify(document));
    const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
    const output = Buffer.concat([original.subarray(0, 20), padded, original.subarray(20 + oldLength)]);
    output.writeUInt32LE(output.length, 8);
    output.writeUInt32LE(padded.length, 12);
    return prepareNixieSceneV2ModelGlb(output);
}

test('an architectural footing resource retains its XYZ anchor on old instances and resized models', () => {
    const source = {};
    const anchor = { version: 1, width: 160, height: 80, depth: 90, offsetX: 12, offsetY: -8, offsetZ: 28 };
    registerNixieSceneV2ModelAnchor(source, anchoredFixture(anchor));
    const model = { resourceId: 'furniture.table', width: 160, height: 80, depth: 90, offsetX: 999, offsetY: 999 };
    assert.deepEqual(nixieSceneV2ModelPosition(model, source), { x: 12, y: 8, z: 28 });
    assert.equal(nixieSceneV2ModelPosition(model, source).z - model.height / 2, -12, 'buried footing stays below the entity origin');
    assert.deepEqual(nixieSceneV2ModelPosition({ ...model, width: 320, height: 160, depth: 180 }, source), { x: 24, y: 16, z: 56 });
    assert.deepEqual(nixieSceneV2ModelPosition(model, {}), { x: 999, y: -999, z: 40 }, 'legacy resources retain their old placement');
    assert.equal(nixieSceneV2ModelPosition({ ...model, offsetZ: 0 }).z, 0, 'an explicit zero Z is preserved');
    assert.throws(() => registerNixieSceneV2ModelAnchor({}, anchoredFixture({ ...anchor, offsetZ: null })), /invalid authored anchor/);
    assert.throws(() => registerNixieSceneV2ModelAnchor({}, anchoredFixture({ ...anchor, offsetZ: 1e10 })), /invalid authored anchor/);
});

test('the station resource corrects old component offsets without changing the saved elevation', () => {
    const source = {};
    const bytes = readGeneratedModel('facilitytransferresource');
    registerNixieSceneV2ModelAnchor(source, prepareNixieSceneV2ModelGlb(bytes));
    const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    const anchor = document.asset.extras.nixieModelAnchor;
    const model = { resourceId: 'foxhole.model.facilitytransferresource', width: anchor.width, height: anchor.height,
        depth: anchor.depth, offsetX: -1.796, offsetY: 0 };
    const saved = JSON.stringify(model);
    const position = nixieSceneV2ModelPosition(model, source);
    assert.ok(position.z < model.height / 2);
    assert.equal(JSON.stringify(model), saved);
});

test('neutral architecture assemblies select roof modules only from the owning extension and restore defaults', () => {
    const source = {};
    const flat = { resourceId: 'roof.flat', width: 100, height: 10, depth: 80, offsetX: 0, offsetY: 0, offsetZ: 90 };
    const gable = { ...flat, resourceId: 'roof.gable', height: 40 };
    registerNixieSceneV2ModelAssembly(source, { version: 1, scale: 1, slots: [{ id: 'roof', componentId: 'options', field: 'selected',
        default: flat, options: [{ match: { module: 'roof', style: 'gable' }, part: gable }] }] });
    const entity = { entityId: 'house', revision: 1, components: [{ ownerId: 'example.architecture', componentId: 'options', version: 1,
        definitionAvailable: true, data: { selected: [{ module: 'roof', style: 'gable' }] } }] };
    assert.equal(resolveNixieSceneV2ModelParts(source, 'example.architecture', entity)[0]!.part.resourceId, 'roof.gable');
    assert.equal(resolveNixieSceneV2ModelParts(source, 'another.extension', entity)[0]!.part.resourceId, 'roof.flat');
    assert.equal(resolveNixieSceneV2ModelParts(source, 'example.architecture', { ...entity, components: [] })[0]!.part.resourceId, 'roof.flat');
    assert.equal(resolveNixieSceneV2ModelParts(source, 'example.architecture', { ...entity,
        components: [{ ...entity.components[0]!, definitionAvailable: false }] })[0]!.part.resourceId, 'roof.flat');
    assert.throws(() => registerNixieSceneV2ModelAssembly({}, { version: 1, scale: 1, slots: [{ id: 'roof', componentId: 'options', field: 'selected',
        options: [{ match: { style: 'gable' }, part: { ...gable, resourceId: 'https://example.com/model.glb' } }] }] }), /invalid assembly/);
});

test('compressed resources remain bounded and cannot introduce external buffers or oversized decoded geometry', () => {
    const bytes = readGeneratedModel('truckc');
    assert.ok(prepareNixieSceneV2ModelGlb(bytes).length > 28);
    const length = bytes.readUInt32LE(12);
    const document = JSON.parse(bytes.subarray(20, 20 + length).toString());
    const repack = () => {
        const json = Buffer.from(JSON.stringify(document));
        const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
        const result = Buffer.concat([bytes.subarray(0, 20), padded, bytes.subarray(20 + length)]);
        result.writeUInt32LE(result.length, 8);
        result.writeUInt32LE(padded.length, 12);
        return result;
    };
    document.buffers[1].uri = 'https://example.com/external.bin';
    assert.throws(() => prepareNixieSceneV2ModelGlb(repack()), /embedded/);
    delete document.buffers[1].uri;
    document.buffers[1].byteLength = 129 * 1024 * 1024;
    assert.throws(() => prepareNixieSceneV2ModelGlb(repack()), /embedded/);
});
