import assert from 'node:assert/strict';
import test from 'node:test';
import { FoxholeMapTexturePool } from '../app/plugins/foxhole/nixie/map/texture-leases.ts';

test('switching canvases cannot unload textures still drawn by the other engine', async () => {
    let loads = 0, unloads = 0;
    const pool = new FoxholeMapTexturePool(async () => ({ id: ++loads, destroyed: false }), async () => { unloads++; });
    const native = pool.createOwner(), ecs = pool.createOwner();
    const first = await native.load('map.webp');
    assert.equal(await ecs.load('map.webp'), first);
    assert.equal(await native.load('map.webp'), first);
    await ecs.releaseAll();
    assert.equal(unloads, 0);
    assert.equal(await native.load('map.webp'), first);
    await native.releaseAll();
    assert.equal(unloads, 1);
    assert.notEqual(await ecs.load('map.webp'), first);
    assert.equal(loads, 2);
    await ecs.releaseAll();
});

test('reopening a map waits for the previous unload instead of returning dying bytes', async () => {
    let loads = 0, finish: () => void = () => {};
    const unloading = new Promise<void>(resolve => { finish = resolve; });
    const pool = new FoxholeMapTexturePool(async () => ++loads, () => unloading);
    const old = pool.createOwner(), next = pool.createOwner();
    assert.equal(await old.load('map.webp'), 1);
    const release = old.releaseAll();
    const pending = next.load('map.webp');
    await Promise.resolve();
    assert.equal(loads, 1);
    finish();
    await release;
    assert.equal(await pending, 2);
    await next.releaseAll();
});

test('a retired pending load releases its result and failures remain retryable', async () => {
    let finish: (value: number) => void = () => {}, unloads = 0, fail = true;
    const pending = new Promise<number>(resolve => { finish = resolve; });
    const pool = new FoxholeMapTexturePool(() => pending, async () => { unloads++; });
    const owner = pool.createOwner();
    const loading = owner.load('pending.webp');
    const retired = owner.releaseAll();
    finish(10);
    await loading;
    await retired;
    assert.equal(unloads, 1);
    const retryPool = new FoxholeMapTexturePool(async () => { if (fail) throw new Error('Offline'); return 12; }, async () => {});
    const retry = retryPool.createOwner();
    await assert.rejects(retry.load('map.webp'), /Offline/);
    fail = false;
    assert.equal(await retry.load('map.webp'), 12);
    await retry.releaseAll();
});
