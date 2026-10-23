import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalFoxholeAssetDelivery } from '../app/utils/local-asset-delivery.ts';

test('local models and world assets use the checkout URL without a persistent cache', async () => {
    const requests: Array<{ url: string; cache?: RequestCache; }> = [];
    const fetcher: typeof fetch = async (input, options) => {
        requests.push({ url: String(input), cache: options?.cache });
        return Response.json({ version: 1 });
    };
    const delivery = createLocalFoxholeAssetDelivery('http://localhost:3000/foxhole/assets/', fetcher);
    assert.equal(delivery.resolve('types/structures/powerpole/powerpole.glb'), 'http://localhost:3000/foxhole/assets/types/structures/powerpole/powerpole.glb');
    assert.equal(delivery.world.baseUrl, 'http://localhost:3000/foxhole/assets/world/');
    assert.deepEqual(await delivery.world.loadIndex(), { version: 1 });
    assert.deepEqual(requests, [{ url: 'http://localhost:3000/foxhole/assets/world/index.json', cache: 'no-store' }]);
    await delivery.fetch(delivery.resolve('world/model.glb'), { cache: 'force-cache' });
    assert.equal(requests[1]?.cache, 'no-store');
});

test('missing local world data surfaces the HTTP failure', async () => {
    const delivery = createLocalFoxholeAssetDelivery('http://localhost:3000/foxhole/assets/', async () => new Response(null, { status: 404 }));
    await assert.rejects(delivery.world.loadIndex(), /Local world index is unavailable \(404\)/);
});
