import assert from 'node:assert/strict';
import test from 'node:test';
import { createFoxholeObserverMapStorage, isFoxholeObserverDocument, mergeFoxholeMapServerEntry, selectFoxholeObserverWarData, shouldUseFoxholeLocalAssetDelivery } from '../app/plugins/foxhole/nixie/map/memory-storage.mjs';

test('observer map stores are isolated across generations and ordinary clients', async () => {
    const editor = createFoxholeObserverMapStorage();
    const observer = createFoxholeObserverMapStorage();
    const replacement = createFoxholeObserverMapStorage();
    await editor.setItem('region', { labels: ['editor'] });
    await observer.setItem('region', { labels: ['observer'] });
    assert.deepEqual(await editor.getItem('region'), { labels: ['editor'] });
    assert.deepEqual(await observer.getItem('region'), { labels: ['observer'] });
    assert.equal(await replacement.getItem('region'), null);
    await observer.removeItem('region');
    assert.deepEqual(await editor.getItem('region'), { labels: ['editor'] });
});

test('observer storage detaches values and supports localforage iteration', async () => {
    const store = createFoxholeObserverMapStorage();
    const data = { labels: ['a'] };
    await store.setItem('a', data);
    data.labels.push('b');
    const loaded = await store.getItem('a');
    loaded.labels.push('c');
    assert.deepEqual(await store.getItem('a'), { labels: ['a'] });
    await store.setItem('b', 2);
    const visits = [];
    assert.equal(await store.iterate((value, key, index) => {
        visits.push([key, index]);
        if (key === 'b') return value;
    }), 2);
    assert.deepEqual(visits, [['a', 1], ['b', 2]]);
});

test('only an embedded observer route uses disposable storage', () => {
    const frame = { location: { pathname: '/app/_scene-v2-observer/' }, parent: {} };
    assert.equal(isFoxholeObserverDocument(frame), true);
    assert.equal(shouldUseFoxholeLocalAssetDelivery(true, 'local', frame), false, 'the observer must honor its selected package generation');
    assert.equal(isFoxholeObserverDocument({ ...frame, location: { pathname: '/project/1' } }), false);
    frame.parent = frame;
    assert.equal(isFoxholeObserverDocument(frame), false);
    assert.equal(shouldUseFoxholeLocalAssetDelivery(true, 'local', frame), true, 'the normal editor can still use local assets');
    assert.equal(shouldUseFoxholeLocalAssetDelivery(false, 'local', frame), false);
    assert.equal(isFoxholeObserverDocument(undefined), false);
});

test('observer seeds war state and live icons without importing generation-specific fallback labels', async () => {
    const shared = createFoxholeObserverMapStorage();
    await shared.setItem('war', { warNumber: 10 });
    await shared.setItem('region', { labels: { items: ['local generation'] }, icons: { items: ['live'] }, reports: { version: 3 } });
    await shared.setItem('fallback-only', { labels: { items: ['wrong generation'] } });
    const observer = createFoxholeObserverMapStorage(shared, selectFoxholeObserverWarData);
    const seeded = {};
    await observer.iterate((value, key) => { seeded[key] = value; });
    assert.deepEqual(seeded, { war: { warNumber: 10 }, region: { icons: { items: ['live'] }, reports: { version: 3 } } });
    await observer.setItem('region', { labels: { items: ['observer generation'] } });
    assert.deepEqual(await shared.getItem('region'), { labels: { items: ['local generation'] }, icons: { items: ['live'] }, reports: { version: 3 } });
});

test('playback reads through without writing to the shared store or resurrecting local removals', async () => {
    const shared = createFoxholeObserverMapStorage();
    await shared.setItem('frame', { id: 'one', payload: { labels: ['live'] } });
    const observer = createFoxholeObserverMapStorage(shared);
    assert.deepEqual(await observer.getItem('frame'), { id: 'one', payload: { labels: ['live'] } });
    await observer.removeItem('frame');
    assert.equal(await observer.getItem('frame'), null);
    await observer.iterate(() => assert.fail('a removed entry must not be re-seeded'));
    assert.deepEqual(await shared.getItem('frame'), { id: 'one', payload: { labels: ['live'] } });
});

test('only server-delivered labels survive an observer generation change', async () => {
    const shared = createFoxholeObserverMapStorage();
    const fallback = { labels: { version: 1, items: ['old generation fallback'] } };
    await shared.setItem('old', mergeFoxholeMapServerEntry(fallback, { icons: { items: ['icon'] } }));
    await shared.setItem('live', mergeFoxholeMapServerEntry(fallback, { labels: { version: 2, items: ['server label'] } }));
    const observer = createFoxholeObserverMapStorage(shared, selectFoxholeObserverWarData);
    const replacementFallback = { version: 3, items: ['new generation fallback'] };
    const old = await observer.getItem('old');
    assert.deepEqual(old, { icons: { items: ['icon'] } });
    assert.deepEqual({ labels: replacementFallback, ...old }.labels, replacementFallback);
    assert.deepEqual((await observer.getItem('live')).labels, { version: 2, items: ['server label'] });
    const cleared = mergeFoxholeMapServerEntry(await shared.getItem('live'), { labels: null });
    assert.equal(cleared.__nixieLiveLabels, undefined);
    assert.equal(selectFoxholeObserverWarData(cleared, 'live'), undefined);
});
