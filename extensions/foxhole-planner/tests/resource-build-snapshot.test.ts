import assert from 'node:assert/strict';
import test from 'node:test';
import { createResourceBuildSnapshot } from '../build/resource-build-snapshot.ts';

test('watched builds declare and package the same fresh model snapshot', async () => {
    let available = ['factory'], loads = 0;
    const snapshot = createResourceBuildSnapshot(async () => { loads++; return [...available]; });
    const firstDeclarations = await snapshot.begin();
    assert.deepEqual(await snapshot.read(), firstDeclarations);
    available = ['factory', 'wall'];
    assert.deepEqual(await snapshot.read(), firstDeclarations, 'inputs remain coherent until the next build begins');
    const nextDeclarations = await snapshot.begin();
    assert.deepEqual(nextDeclarations, ['factory', 'wall']);
    assert.deepEqual(await snapshot.read(), nextDeclarations, 'new resources must be declared in this build');
    assert.equal(loads, 2);
});

test('concurrent resource reads share the in-flight snapshot promise', async () => {
    let loads = 0, finish!: (models: string[]) => void;
    const snapshot = createResourceBuildSnapshot(() => { loads++; return new Promise<string[]>(resolve => finish = resolve); });
    const declarations = snapshot.begin(), resources = snapshot.read();
    assert.equal(declarations, resources);
    finish(['model']);
    assert.deepEqual(await resources, ['model']);
    assert.equal(loads, 1);
});
