import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {prepareStandalone, verifyStandalone} from './standalone-verification.mjs';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'foxhole-standalone-hooks-'));
    const previous = {catalog: process.env.NIXIE_FOXHOLE_CATALOG_FILE, assets: process.env.NIXIE_FOXHOLE_ASSETS_ROOT};
    t.after(async () => {
        for (const [key, value] of [['NIXIE_FOXHOLE_CATALOG_FILE', previous.catalog], ['NIXIE_FOXHOLE_ASSETS_ROOT', previous.assets]]) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
        await fs.rm(root, {recursive: true, force: true});
    });
    const fixtureRoot = path.join(root, 'fixture'), assets = path.join(root, 'assets');
    const write = async (name, bytes) => {await fs.mkdir(path.dirname(name), {recursive: true}); await fs.writeFile(name, bytes);};
    await fs.mkdir(path.join(fixtureRoot, 'src'), {recursive: true});
    await write(path.join(fixtureRoot, 'tests/catalog.test.ts'), "const source = '../../../packages/extensions/foxhole/public/foxhole/assets/models/manifest.v1.json';");
    const modelManifest = {schemaVersion: 1, assets: {hospital: {path: 'types/structures/hospital/hospital.glb'}},
        resources: {variant: {path: 'types/structures/hospital/hospital.destroyed.glb'}}, sharedParts: {part: {path: 'shared/models/part.glb'}}};
    for (const name of ['manifest.v1.json', 'maps/map-data.v1.json', ...['de', 'fr', 'pt', 'ru', 'zh'].map(locale => 'localizations/' + locale + '.json')]) await write(path.join(assets, name), '{}');
    await write(path.join(assets, 'models/manifest.v1.json'), JSON.stringify(modelManifest));
    for (const model of [...Object.values(modelManifest.assets), ...Object.values(modelManifest.resources), ...Object.values(modelManifest.sharedParts)]) await write(path.join(assets, model.path), 'model: ' + model.path);
    const catalogFile = path.join(root, 'published-catalog.json');
    await write(catalogFile, '{"catalogSchemaVersion":1,"products":[]}');
    process.env.NIXIE_FOXHOLE_CATALOG_FILE = catalogFile;
    return {root, fixtureRoot, assets, modelManifest, catalogFile, write};
}

test('standalone preparation detaches the selected catalog, model dependencies and metadata from the checkout', async t => {
    const {fixtureRoot, assets, modelManifest, catalogFile} = await fixture(t);
    await prepareStandalone({extensionSource: fileURLToPath(new URL('..', import.meta.url)), fixtureRoot, foxholeAssetsRoot: assets});
    const input = path.join(fixtureRoot, 'src/.nixie-build-input');
    assert.equal(process.env.NIXIE_FOXHOLE_CATALOG_FILE, path.join(input, 'catalog.v1.json'));
    assert.equal(process.env.NIXIE_FOXHOLE_ASSETS_ROOT, input);
    assert.deepEqual(await fs.readFile(path.join(input, 'catalog.v1.json')), await fs.readFile(catalogFile));
    for (const model of [...Object.values(modelManifest.assets), ...Object.values(modelManifest.resources), ...Object.values(modelManifest.sharedParts)]) assert.deepEqual(await fs.readFile(path.join(input, model.path)), await fs.readFile(path.join(assets, model.path)));
    assert.match(await fs.readFile(path.join(fixtureRoot, 'tests/catalog.test.ts'), 'utf8'), /\.\.\/src\/\.nixie-build-input\/models\/manifest\.v1\.json/);
    assert.match(await fs.readFile(path.join(fixtureRoot, 'src/scene-v2-asset-metadata.ts'), 'utf8'), /\.nixie-authoring/);
    await fs.rm(assets, {recursive: true});
    assert.ok((await fs.readFile(path.join(input, 'models/manifest.v1.json'))).length > 0);
});

test('standalone preparation rejects model paths outside the detached input directory', async t => {
    const {root, fixtureRoot, assets} = await fixture(t);
    await fs.writeFile(path.join(assets, 'models/manifest.v1.json'), JSON.stringify({assets: {escape: {path: '../outside.glb'}}}));
    await assert.rejects(prepareStandalone({extensionSource: fileURLToPath(new URL('..', import.meta.url)), fixtureRoot, foxholeAssetsRoot: assets}), /Unsafe standalone model input/);
    await assert.rejects(fs.access(path.join(root, 'outside.glb')), {code: 'ENOENT'});
});

test('standalone verification delegates archive checks and rejects changed or duplicated catalog bytes', async t => {
    const {fixtureRoot, catalogFile, write} = await fixture(t);
    // Archive integrity is exercised by verify-publication-package and the real packed-consumer gate.
    // This fixture isolates the hook's additional byte-identity and runtime-module requirements.
    await write(path.join(fixtureRoot, 'build/verify-publication-package.mjs'), 'export async function verifyRemotePublicationPackage(file) { if (!file.endsWith(".nxext")) throw Error("invalid archive"); return {verified:true}; }');
    const builtCatalog = path.join(fixtureRoot, 'dist/catalog.v1.json'), runtime = path.join(fixtureRoot, 'dist/assets/index.js');
    await write(builtCatalog, await fs.readFile(catalogFile));
    const validRuntime = 'import catalog from "../catalog.v1.json" with {type:"json"}; export default catalog;';
    await write(runtime, validRuntime);
    const args = {fixtureRoot, packageVerification: {packagePath: path.join(fixtureRoot, 'extension.nxext')}};
    await verifyStandalone(args);
    await assert.rejects(verifyStandalone({...args, packageVerification: {packagePath: 'wrong.zip'}}), /invalid archive/);
    await fs.appendFile(builtCatalog, ' ');
    await assert.rejects(verifyStandalone(args), /changed FoxWatch catalog bytes/);
    await fs.writeFile(builtCatalog, await fs.readFile(catalogFile));
    await fs.writeFile(runtime, 'export default {};');
    await assert.rejects(verifyStandalone(args), /single packaged JSON module/);
    await fs.writeFile(runtime, validRuntime + 'const duplicated = {catalogSchemaVersion:1};');
    await assert.rejects(verifyStandalone(args), /duplicates its catalog/);
});
