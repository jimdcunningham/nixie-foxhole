import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { createError } from 'h3';
import type { Database } from '../../../../nixie/types/database.types.ts';
import { foxholeBlueprintSubscriptionStore } from '../../server/utils/blueprint-subscription-store.ts';
import { changeBlueprintSubscription, readBlueprintLibrary } from '../../../../nixie/server/utils/blueprint-subscription-store.ts';
import { toLegacyBlueprintListing } from '../../server/utils/legacy-blueprint-source.ts';

const alice = '00000000-0000-0000-0000-000000000011';
const bob = '00000000-0000-0000-0000-000000000012';
const source = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const version = '00000000-0000-0000-0000-000000000003';
const listingId = `foxhole-blueprint-${source}`;
const listing = toLegacyBlueprintListing({ id: source, name: 'A public plan', description: '', authors: 'Credits', game: 'foxhole', privacy: 'public', approved: true, deleted_at: null, version, updated_at: '2026-09-30' }, { id: version, blueprint_id: source, version: 'v1' });

/** Exercise the real Supabase query builder against a local in-memory HTTP fixture. No DB/RLS claim. */
function fixture() {
    const rows = new Map<string, { user_id: string; blueprint_id: string; created_at?: string; }>();
    const requests: Array<{ method: string; url: URL; body: unknown; }> = [];
    let failure = false;
    function store(actor: string) {
        const client = createClient<Database>('https://fixture.invalid', 'fixture-public-key', { auth: { persistSession: false, autoRefreshToken: false }, global: {
            fetch: async (input, init) => {
                const url = hostSourceUrl(String(input));
                const method = init?.method ?? 'GET';
                const body = init?.body ? JSON.parse(String(init.body)) : null;
                requests.push({ method, url, body });
                assert.equal(url.pathname, '/rest/v1/bp_subscriptions');
                if (failure) {
                    return new Response(JSON.stringify({ code: '42501', message: 'fixture failure' }), { status: 403 });
                }
                if (method === 'POST') {
                    assert.match(new Headers(init?.headers).get('prefer') ?? '', /resolution=ignore-duplicates/);
                    assert.equal(url.searchParams.get('on_conflict'), 'user_id,blueprint_id');
                    assert.equal(body.user_id, actor);
                    // The migration's unique pair is represented by this keyed fixture.
                    rows.set(`${body.user_id}/${body.blueprint_id}`, body);
                    return new Response(null, { status: 201 });
                }
                assert.equal(url.searchParams.get('user_id'), `eq.${actor}`);
                const id = url.searchParams.get('blueprint_id');
                let selected = [...rows.values()].filter(row => row.user_id === actor && (!id || (id.startsWith('eq.') ? row.blueprint_id === id.slice(3) : row.blueprint_id > id.slice(3))));
                selected = selected.sort((a, b) => a.blueprint_id.localeCompare(b.blueprint_id));
                if (method === 'DELETE') {
                    assert.ok(id?.startsWith('eq.'));
                    for (const row of selected) {
                        rows.delete(`${row.user_id}/${row.blueprint_id}`);
                    }
                    return new Response(null, { status: 204 });
                }
                selected = selected.slice(0, Number(url.searchParams.get('limit')) || selected.length);
                return new Response(JSON.stringify(selected.map(row => ({ blueprint_id: row.blueprint_id, created_at: row.created_at }))), { headers: { 'Content-Type': 'application/json' } });
            },
        } });
        return foxholeBlueprintSubscriptionStore(client, actor);
    }
    return { rows, requests, store, fail: () => {
        failure = true;
    } };
}

test('subscribes use the legacy table, actor ID and conflict-safe insert, including concurrent retries', async () => {
    const f = fixture();
    const store = f.store(alice);
    await Promise.all(Array.from({ length: 5 }, () => changeBlueprintSubscription(store, async () => listing, listingId, true)));
    assert.equal(f.rows.size, 1);
    assert.equal(await store.has(source), true);
    assert.equal(await f.store(bob).has(source), false);
    await f.store(bob).subscribe(source);
    await changeBlueprintSubscription(store, async () => {
        throw new Error('unsubscribe must not read source');
    }, listingId, false);
    assert.equal(await store.has(source), false);
    assert.equal(await f.store(bob).has(source), true);
    await store.unsubscribe(source);
    assert.equal(f.rows.size, 1);
});
test('Planner rows are read directly and library refresh follows current source revisions', async () => {
    const f = fixture();
    f.rows.set(`${alice}/${source}`, { user_id: alice, blueprint_id: source });
    f.rows.set(`${bob}/${other}`, { user_id: bob, blueprint_id: other });
    let latest = listing;
    const lookup = async () => latest;
    const first = await readBlueprintLibrary(f.store(alice), lookup, null, 24);
    assert.deepEqual(first.items.map(item => item.id), [listingId]);
    latest = { ...listing, title: 'Edited title', version: { id: other, label: 'v2' } };
    const second = await readBlueprintLibrary(f.store(alice), lookup, null, 24);
    assert.equal(second.items[0]!.blueprint!.version.id, other);
    assert.equal(first.items[0]!.blueprint!.version.id, version);
    f.rows.delete(`${alice}/${source}`); // The other app unsubscribes from the same record.
    assert.deepEqual((await readBlueprintLibrary(f.store(alice), lookup, null, 24)).items, []);
});
test('legacy library exposes subscription date and version creation date independently of metadata edits', async () => {
    const f = fixture();
    f.rows.set(`${alice}/${source}`, { user_id: alice, blueprint_id: source, created_at: '2026-09-20T00:00:00Z' });
    const dated = toLegacyBlueprintListing({ id: source, name: 'Plan', description: '', authors: '', game: 'foxhole', privacy: 'public', approved: true,
        deleted_at: null, version, updated_at: '2026-10-04T00:00:00Z' }, { id: version, blueprint_id: source, version: '2', created_at: '2026-09-21T00:00:00Z' });
    const page = await readBlueprintLibrary(f.store(alice), async () => dated, null, 24);
    assert.equal(page.items[0]!.subscribedAt, '2026-09-20T00:00:00Z');
    assert.equal(page.items[0]!.blueprint!.version.publishedAt, '2026-09-21T00:00:00Z');
});
test('withdrawal hides all source metadata; lookup failure rejects the library', async () => {
    const f = fixture();
    await f.store(alice).subscribe(source);
    const result = await readBlueprintLibrary(f.store(alice), async () => {
        throw createError({ statusCode: 404 });
    }, null, 24);
    assert.deepEqual(result.items, [{ sourceKind: 'legacy-foxhole-blueprint', id: listingId, blueprint: null, unavailable: true }]);
    await assert.rejects(readBlueprintLibrary(f.store(alice), async () => {
        throw createError({ statusCode: 503 });
    }, null, 24), { statusCode: 503 });
});
test('ineligible sources cannot be subscribed and a post-write withdrawal does not return success', async () => {
    const f = fixture();
    const store = f.store(alice);
    await assert.rejects(changeBlueprintSubscription(store, async () => {
        throw createError({ statusCode: 404 });
    }, listingId, true), { statusCode: 404 });
    assert.equal(f.rows.size, 0);
    let checks = 0;
    await assert.rejects(changeBlueprintSubscription(store, async () => {
        if (++checks === 2) {
            throw createError({ statusCode: 404 });
        }
        return listing;
    }, listingId, true), { statusCode: 404 });
    assert.equal(checks, 2);
});
test('pagination stays scoped to the actor and storage/grant failures fail closed', async () => {
    const f = fixture();
    const store = f.store(alice);
    await store.subscribe(source);
    await store.subscribe(other);
    await f.store(bob).subscribe(version);
    assert.deepEqual(await store.page(null, 1), { ids: [source], nextCursor: source, subscribedAt: {} });
    assert.deepEqual(await store.page(source, 1), { ids: [other], nextCursor: null, subscribedAt: {} });
    f.fail();
    await assert.rejects(store.has(source), { statusCode: 503 });
    await assert.rejects(store.subscribe(source), { statusCode: 503 });
    await assert.rejects(store.unsubscribe(source), { statusCode: 503 });
    await assert.rejects(store.page(null, 24), { statusCode: 503 });
});
