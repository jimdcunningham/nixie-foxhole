import assert from 'node:assert/strict';
import test from 'node:test';
import {createFoxholeAssetGenerationSelector} from '../app/utils/asset-generation.ts';
const generation = (generationHash: string) => ({generationHash, readProductCatalog: async () => ({baseUrl: 'https://assets.example/', sha256: generationHash, text: '{}'})});
test('selected generation stages immutable data, reuses prepared versions, and clears on disable', async () => {
    const prepared: string[] = [], installed: (string | null)[] = [];
    const select = createFoxholeAssetGenerationSelector(async value => {prepared.push(value.generationHash); return value.generationHash;},
        value => {installed.push(value);});
    const a = await select(generation('a'));
    assert.deepEqual(installed, []); a();
    (await select(generation('a')))();
    (await select(generation('b')))();
    (await select(generation('c')))();
    (await select(generation('a')))();
    (await select(null))();
    assert.deepEqual(prepared, ['a', 'b', 'c']);
    assert.deepEqual(installed, ['a', 'b', 'c', 'a', null]);
});
test('a failed generation can retry without changing the installed version', async () => {
    let attempts = 0, installed: string | null = null;
    const select = createFoxholeAssetGenerationSelector(async value => {
        if (++attempts === 1) throw new Error('catalog integrity');
        return value.generationHash;
    }, value => {installed = value;});
    await assert.rejects(select(generation('broken')), /catalog integrity/);
    assert.equal(installed, null);
    (await select(generation('broken')))();
    assert.equal(installed, 'broken'); assert.equal(attempts, 2);
});
