import { hostSourceUrl } from "../host-source-url.mjs";
import { registerNixieInternalBlueprintServices } from '../../../../nixie/server/utils/internal-blueprint-services.ts';
import { readFoxholeLegacyUploads } from '../../server/utils/legacy-discovery-uploads.ts';
registerNixieInternalBlueprintServices({ requireFeature() {}, get: async () => { throw new Error('No listing expected'); }, search: async () => { throw new Error('No search expected'); }, subscriptions: () => { throw new Error('No subscription expected'); }, uploads: readFoxholeLegacyUploads });
import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../../nixie/types/database.types.ts';
import { readDiscoveryUploads } from '../../../../nixie/server/utils/discovery-uploads.ts';
import { decodeDiscoveryCursor } from '../../../../nixie/server/utils/discovery-cursor.ts';

const actor = '00000000-0000-0000-0000-000000000001';
const date = '2026-10-04T10:00:00Z';
function fixture(fail = false) {
    const requests: URL[] = [];
    const client = createClient<Database>('https://fixture.invalid', 'fixture-key', {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: async input => {
            const url = hostSourceUrl(String(input));
            requests.push(url);
            const table = url.pathname.split('/').at(-1);
            if (fail) {
                return new Response(JSON.stringify({ message: 'fixture unavailable' }), { status: 503 });
            }
            let data: unknown;
            if (table === 'blueprints') {
                assert.equal(url.searchParams.get('user_id'), `eq.${actor}`, 'every legacy page is scoped to its owner');
                assert.equal(url.searchParams.get('game'), 'eq.foxhole');
                assert.equal(url.searchParams.get('deleted_at'), 'is.null');
                assert.equal(url.searchParams.has('approved'), false, 'owners can see pending uploads');
                data = [{ id: actor, name: 'Private Upload', privacy: 'private', approved: null, version: null, description: null, created_at: date, updated_at: date }];
            } else if (table === 'nixie_registry_listings') {
                assert.equal(url.searchParams.get('publisher_user_id'), `eq.${actor}`, 'every native page is scoped to its publisher');
                assert.equal(url.searchParams.get('type'), 'eq.project');
                assert.equal(url.searchParams.get('limit'), '25');
                assert.equal(url.searchParams.has('visibility'), false, 'owners can see unlisted uploads');
                data = Array.from({ length: 25 }, (_, index) => ({
                    public_id: `Upload${String(index).padStart(6, '0')}`, title: `Upload ${index}`, description: '',
                    visibility: 'unlisted', status: 'published', default_release_id: index === 0 ? null : actor,
                    source_project_id: null, created_at: date, updated_at: date,
                }));
            } else {
                throw new Error(`Unexpected query: ${table}`);
            }
            return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } },
    });
    return { client, requests };
}

test('native uploads preserve ownership on first and continuation pages', async () => {
    const { client, requests } = fixture();
    const page = await readDiscoveryUploads(client, actor, 'native');
    assert.equal(page.items.length, 24);
    assert.equal(page.items[0]!.canView, false, 'a missing release cannot be opened');
    assert.equal(page.items[1]!.canView, true);
    assert.deepEqual(decodeDiscoveryCursor(page.nextCursor), { updatedAt: date, id: 'Upload000023' });
    await readDiscoveryUploads(client, actor, 'native', page.nextCursor);
    assert.match(requests[1]!.searchParams.get('or')!, /public_id.lt.Upload000023/);
});

test('legacy uploads include private pending entries without exposing a public link', async () => {
    const { client } = fixture();
    const page = await readDiscoveryUploads(client, actor, 'legacy');
    assert.equal(page.items[0]!.id, `foxhole-blueprint-${actor}`);
    assert.equal(page.items[0]!.status, 'Pending Review');
    assert.equal(page.items[0]!.canView, false);
    assert.equal(page.nextCursor, null);
});

test('missing actors and malformed cursors fail before querying; database failures remain errors', async () => {
    const { client, requests } = fixture();
    await assert.rejects(readDiscoveryUploads(client, '', 'native'), { statusCode: 401 });
    await assert.rejects(readDiscoveryUploads(client, actor, 'native', 'invalid'), { statusCode: 400 });
    assert.equal(requests.length, 0);
    await assert.rejects(readDiscoveryUploads(fixture(true).client, actor, 'native'), { statusCode: 503 });
});
