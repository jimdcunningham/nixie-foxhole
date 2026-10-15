import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { readBoundedBlueprintResponse, resolveLegacyBlueprintArchive } from '../../server/utils/legacy-blueprint-resolver.ts';
import { toLegacyBlueprintListing } from '../../server/utils/legacy-blueprint-source.ts';

const id = '00000000-0000-0000-0000-000000000001';
const version = '00000000-0000-0000-0000-000000000002';
const listing = toLegacyBlueprintListing({ id, name: 'Test', description: null, authors: 'Credits', game: 'foxhole', privacy: 'public', approved: true, deleted_at: null, version, updated_at: 'today' }, { id: version, blueprint_id: id, version: 'label' });
async function archive(): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify({ version: '1.0.5', entities: [] }));
    return zip.generateAsync({ type: 'uint8array' });
}
test('resolver waits for pointer-before-upload race then returns a pinned digest', async () => {
    const bytes = await archive();
    let attempts = 0;
    const delays: number[] = [];
    const result = await resolveLegacyBlueprintArchive({ lookup: async () => listing, download: async () => ++attempts < 3 ? new Response(null, { status: 404 }) : new Response(bytes), wait: async ms => {
        delays.push(ms);
    } });
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [250, 500]);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
});
test('missing uploads stop after bounded retries', async () => {
    let attempts = 0;
    await assert.rejects(resolveLegacyBlueprintArchive({ lookup: async () => listing, download: async () => {
        attempts++;
        return new Response(null, { status: 404 });
    }, wait: async () => {} }), /pending/);
    assert.equal(attempts, 3);
});
test('revocation before delivery fails closed without returning bytes', async () => {
    const bytes = await archive();
    let lookups = 0;
    await assert.rejects(resolveLegacyBlueprintArchive({ lookup: async () => {
        if (++lookups === 3) {
            throw new Error('unlisted');
        }
        return listing;
    }, download: async () => new Response(bytes) }), /unlisted/);
});
test('new version during delivery requires refresh', async () => {
    const bytes = await archive();
    let lookups = 0;
    await assert.rejects(resolveLegacyBlueprintArchive({ lookup: async () => ++lookups === 3 ? { ...listing, version: { id, label: 'new' } } : listing, download: async () => new Response(bytes) }), /changed/);
});
test('response bytes are bounded even without content-length', async () => {
    await assert.rejects(readBoundedBlueprintResponse(new Response(new Uint8Array(100)), 50), /size limit/);
});
test('malformed archive is isolated', async () => {
    await assert.rejects(resolveLegacyBlueprintArchive({ lookup: async () => listing, download: async () => new Response('not a zip') }), /invalid/);
});
