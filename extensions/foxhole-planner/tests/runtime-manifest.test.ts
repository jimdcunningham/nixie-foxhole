import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseNixieExtensionManifestV1 } from '@nixie/extension-sdk';
import { createFoxholeRuntimeManifest } from '../build/runtime-manifest.ts';

test('switching local and remote modes derives fresh manifests without mutating authored input', async () => {
    const original = await readFile(new URL('../nixie.extension.json', import.meta.url), 'utf8');
    const authored = parseNixieExtensionManifestV1(JSON.parse(original));
    const before = JSON.stringify(authored);
    const pack = { contractVersion: 1 as const, id: 'foxhole.runtime',
        manifest: { url: 'https://assets.example.test/resources.json', sha256: 'a'.repeat(64), byteLength: 100 } };
    const models = [{ id: 'powerpole', packagedPath: 'assets/powerpole/powerpole.glb' }];
    for (const mode of [null, pack, null, pack]) {
        const built = parseNixieExtensionManifestV1(createFoxholeRuntimeManifest(authored, models, mode));
        const resource = built.contributes.experimentalResources!.find(row => row.id === 'foxhole.model.powerpole')!;
        assert.equal(resource.assetPack, mode?.id);
        assert.equal(built.contributes.experimentalAssetPacks?.length ?? 0, mode ? 1 : 0);
        assert.ok(built.contributes.experimentalResourceTemplates!.every(row => row.assetPack === mode?.id));
        assert.equal(JSON.stringify(authored), before);
    }
    assert.equal(await readFile(new URL('../nixie.extension.json', import.meta.url), 'utf8'), original);
});
