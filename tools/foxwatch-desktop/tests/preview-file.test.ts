import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { brotliCompressSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { readAssetPreview, prepareGlb } from '../electron/preview-file.ts';
// @ts-ignore Synthetic fixture generation is shared with the Electron smoke test.
import { triangleGlb, whitePng } from './preview-fixtures.mjs';

async function fixture(t: test.TestContext, bytes: Uint8Array | string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'foxwatch-preview-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'asset');
  await writeFile(file, bytes);
  return file;
}
test('identifies image content independently of the stored extension', async (t) => {
  const file = await fixture(t, whitePng());
  const preview = await readAssetPreview(file, 'image.webp');
  assert.equal(preview.type, 'image');
  if (preview.type === 'image') assert.equal(preview.mime, 'image/png');
});
test('returns JSON as text and bounds large text previews', async (t) => {
  const file = await fixture(t, '{"hello":"world"}');
  assert.deepEqual(await readAssetPreview(file, 'manifest.json'), {
    type: 'text',
    text: '{"hello":"world"}',
    truncated: false,
    json: true,
  });
  await writeFile(file, 'x'.repeat(1024 * 1024 + 100));
  const preview = await readAssetPreview(file, 'large.txt');
  assert.equal(preview.type, 'text');
  if (preview.type === 'text') {
    assert.equal(preview.text.length, 1024 * 1024);
    assert.equal(preview.truncated, true);
  }
});
test('decodes Brotli world metadata without modifying the file', async (t) => {
  const file = await fixture(
    t,
    brotliCompressSync(Buffer.from('{"region":"Deadlands"}')),
  );
  const preview = await readAssetPreview(
    file,
    'world/content/br/hash/asset.json',
  );
  assert.equal(preview.type, 'text');
  if (preview.type === 'text')
    assert.equal(preview.text, '{"region":"Deadlands"}');
});
test('accepts self-contained GLB files and rejects external buffer or image requests', async (t) => {
  const file = await fixture(t, triangleGlb());
  assert.equal((await readAssetPreview(file, 'hospital.glb')).type, 'model');
  assert.throws(
    () =>
      prepareGlb(
        triangleGlb({
          buffers: [{ uri: 'https://example.com/private.bin', byteLength: 36 }],
        }),
      ),
    /embedded/,
  );
  assert.throws(
    () =>
      prepareGlb(triangleGlb({ images: [{ uri: 'file:///C:/private.png' }] })),
    /embedded/,
  );
  assert.throws(
    () =>
      prepareGlb(
        triangleGlb({ extensionsRequired: ['KHR_draco_mesh_compression'] }),
      ),
    /embedded/,
  );
});
test('rejects malformed GLB headers and oversized geometry declarations', () => {
  const corrupt = triangleGlb();
  corrupt.writeUInt32LE(1, 8);
  assert.throws(() => prepareGlb(corrupt), /complete GLB/);
  assert.throws(
    () => prepareGlb(triangleGlb({ buffers: [{ byteLength: 2 ** 30 }] })),
    /oversized/,
  );
});
test('maps the WebP texture extension to the loader source', () => {
  const prepared = prepareGlb(
    triangleGlb({
      images: [{ bufferView: 0, mimeType: 'image/webp' }],
      textures: [{ extensions: { EXT_texture_webp: { source: 0 } } }],
    }),
  );
  const length = new DataView(prepared.buffer).getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(prepared.subarray(20, 20 + length)),
  );
  assert.equal(json.textures[0].source, 0);
});
test('unsupported files do not become executable or HTML previews', async (t) => {
  const file = await fixture(t, '<script>alert(1)</script>');
  assert.equal((await readAssetPreview(file, 'page.html')).type, 'unsupported');
  await writeFile(file, Buffer.from([1, 0, 2]));
  assert.equal(
    (await readAssetPreview(file, 'binary.json')).type,
    'unsupported',
  );
});
