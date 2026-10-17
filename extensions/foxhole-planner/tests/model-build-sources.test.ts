import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSceneV2ModelSources } from '../vite.config.ts';
import { createResourceBuildSnapshot } from '../build/resource-build-snapshot.ts';

test('watched builds refresh model binding, selection and package paths from one helper revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'foxhole-model-build-'));
    const path = join(root, 'models.mjs'), moduleUrl = pathToFileURL(path);
    const input = { schemaVersion: 1, assets: {} };
    const source = (revision: number) => `
        export const bindFoxholeSceneV2Models = () => [
            { id: 'host', assetId: 'host', path: 'host.glb' },
            { id: 'shared.' + '${revision}', assetId: '', path: 'shared.glb', sharedPart: true },
        ];
        export const selectFoxholeSceneV2ModelBuild = (_assets, models) => models.filter(model => ${revision} > 1 || !model.sharedPart);
        export const getFoxholeSceneV2PackagedModelPath = model => 'revision-${revision}/' + model.path;
    `;
    try {
        await writeFile(path, source(1));
        const snapshot = createResourceBuildSnapshot(() => readSceneV2ModelSources({}, input, undefined, moduleUrl));
        const first = await snapshot.begin();
        assert.deepEqual(first.map(model => [model.id, model.packagedPath]), [['host', 'revision-1/host.glb']]);
        await writeFile(path, source(2));
        assert.equal(await snapshot.read(), first, 'in-flight declaration and copy retain the same helper-derived snapshot');
        const second = await snapshot.begin();
        assert.deepEqual(second.map(model => [model.id, model.packagedPath]), [
            ['host', 'revision-2/host.glb'], ['shared.2', 'revision-2/shared.glb'],
        ]);
        assert.equal(await snapshot.read(), second);
        assert.deepEqual(await readSceneV2ModelSources({}, input, undefined, moduleUrl), second,
            'unchanged helper source remains stable on subsequent loads');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
