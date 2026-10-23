import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prepareStandalone, verifyStandalone, verifyStandaloneManifest } from './standalone-verification.mjs';

test('standalone hooks detach catalog input and verify exact map payload bytes', async () => {
    const taskRoot = await fs.mkdtemp(join(tmpdir(), 'foxhole-standalone-hooks-'));
    const oldAssetsRoot = process.env.NIXIE_FOXHOLE_ASSETS_ROOT;
    try {
        const fixtureRoot = join(taskRoot, 'fixture');
        const assets = join(taskRoot, 'packages/extensions/foxhole/public/foxhole/assets');
        for (const path of [join(fixtureRoot, 'src'), join(fixtureRoot, 'tests'), join(assets, 'models'), join(assets, 'maps'), join(assets, 'localizations'), join(fixtureRoot, 'dist/assets/maps')]) await fs.mkdir(path, { recursive: true });
        await fs.writeFile(join(assets, 'manifest.v1.json'), '{"assets":[]}');
        await fs.writeFile(join(assets, 'models/manifest.v1.json'), '{"assets":{},"resources":{}}');
        await fs.writeFile(join(assets, 'maps/map-data.v1.json'), '{}');
        for (const locale of ['de', 'fr', 'pt', 'ru', 'zh']) await fs.writeFile(join(assets, `localizations/${locale}.json`), '{}');
        await fs.copyFile(new URL('../src/scene-v2-models.ts', import.meta.url), join(fixtureRoot, 'src/scene-v2-models.ts'));
        await fs.copyFile(new URL('../src/scene-v2-model-policy.json', import.meta.url), join(fixtureRoot, 'src/scene-v2-model-policy.json'));
        await fs.writeFile(join(fixtureRoot, 'nixie.extension.json'), JSON.stringify({ contributes: { experimentalResources: [] } }));
        await fs.writeFile(join(fixtureRoot, 'src/scene-v2-assets-node.ts'), "export default '../../../packages/extensions/foxhole/public/foxhole/assets/manifest.v1.json';");
        const metadata = { regions: [{ labels: [], staticIcons: [] }] };
        await fs.writeFile(join(fixtureRoot, 'src/scene-v2-map-data-node.ts'), 'export default ' + JSON.stringify(metadata) + '; export const foxholeMapResources = [{ id: "map", sourcePath: "maps/source.bin", path: "dist/assets/maps/tile.bin" }];');
        await fs.writeFile(join(fixtureRoot, 'tests/catalog.test.ts'), "const path = '../../../packages/extensions/foxhole/public/foxhole/assets/manifest.v1.json';");
        await fs.writeFile(join(fixtureRoot, 'tests/generated-models.ts'), "const path = '../../../packages/extensions/foxhole/public/foxhole/assets/models/manifest.v1.json';");
        await prepareStandalone({ extensionSource: fileURLToPath(new URL('..', import.meta.url)), fixtureRoot, foxholeAssetsRoot: assets });
        assert.match(await fs.readFile(join(fixtureRoot, 'src/scene-v2-assets-node.ts'), 'utf8'), /.nixie-build-input/);
        assert.match(await fs.readFile(join(fixtureRoot, 'tests/catalog.test.ts'), 'utf8'), /.nixie-build-input/);
        assert.match(await fs.readFile(join(fixtureRoot, 'tests/generated-models.ts'), 'utf8'), /.nixie-build-input\/models.v1.json/);
        const bytes = Buffer.from('map bytes');
        await fs.writeFile(join(assets, 'maps/source.bin'), bytes);
        await fs.writeFile(join(fixtureRoot, 'dist/assets/maps/tile.bin'), bytes);
        await fs.writeFile(join(fixtureRoot, 'dist/assets/maps/metadata.json'), JSON.stringify(metadata));
        const packageVerification = { metadata: { files: [{ path: 'dist/assets/maps/tile.bin', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }] } };
        const result = await verifyStandalone({ fixtureRoot, packageVerification });
        assert.deepEqual(result.mapResourceVerification, { regions: 1, resources: 1, bytes: bytes.length, labels: 0, staticIcons: 0 });
        await fs.writeFile(join(fixtureRoot, 'dist/assets/maps/tile.bin'), 'changed');
        await assert.rejects(verifyStandalone({ fixtureRoot, packageVerification }), /differs from its source/);
        const receipt = { url: 'https://assets.example.test/index.json', sha256: 'a'.repeat(64), byteLength: 100 };
        await fs.writeFile(join(fixtureRoot, 'nixie.extension.json'), JSON.stringify({ contributes: {
            experimentalAssetPacks: [{ contractVersion: 1, id: 'foxhole.runtime', manifest: receipt }],
        } }));
        const readAssetIndex = async requested => {
            assert.deepEqual(requested, receipt);
            return { contractVersion: 1, assets: [{ path: 'dist/assets/maps/tile.bin', sourcePath: 'objects/map.bin',
                sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, mediaType: 'application/octet-stream' }] };
        };
        const remotePackage = { metadata: { files: [] } };
        assert.deepEqual((await verifyStandalone({ fixtureRoot, packageVerification: remotePackage, readAssetIndex })).mapResourceVerification,
            result.mapResourceVerification);
        await assert.rejects(verifyStandalone({ fixtureRoot, packageVerification, readAssetIndex }), /remote map/);
        await fs.writeFile(join(assets, 'maps/source.bin'), 'new map bytes');
        await assert.rejects(verifyStandalone({ fixtureRoot, packageVerification: remotePackage, readAssetIndex }), /remote map/);
    } finally {
        if (oldAssetsRoot === undefined) delete process.env.NIXIE_FOXHOLE_ASSETS_ROOT; else process.env.NIXIE_FOXHOLE_ASSETS_ROOT = oldAssetsRoot;
        assert.ok(resolve(taskRoot).startsWith(resolve(tmpdir())));
        await fs.rm(taskRoot, { recursive: true, force: true });
    }
});
test('Planner contribution requirements stay extension-owned', async () => {
    const manifest = JSON.parse(await fs.readFile(new URL('../nixie.extension.json', import.meta.url)));
    verifyStandaloneManifest(manifest);
    assert.throws(() => verifyStandaloneManifest({ contributes: {} }), /migrated contributions/);
});
