import assert from 'node:assert/strict';
import test from 'node:test';
import {buildRuntimeCatalog} from './runtime-catalog.mjs';
import {createFoxholeCatalogLibrary} from '../src/catalog-library.mjs';

test('derives a startup catalog and loadable locale modules from the pinned source', async () => {
    const source = Buffer.from(JSON.stringify({products: [{id: 'refinery', data: {a: 'Refinery'}}],
        data: {catalogLocalizations: {en: {a: 'Refinery'}, fr: {a: 'Raffinerie'}, de: {a: 'Raffinerie (DE)'}},
            compactKeys: {version: 1, dictionary: {a: 'refineryName'}}}}));
    const {bytes, localeModules} = buildRuntimeCatalog(source);
    assert.deepEqual(JSON.parse(bytes).products, JSON.parse(source).products);
    assert.deepEqual(JSON.parse(bytes).data.catalogLocalizations, {en: {a: 'Refinery'}});
    assert.deepEqual([...localeModules.keys()], ['assets/catalog-locales/fr.js', 'assets/catalog-locales/de.js']);
    const french = localeModules.get('assets/catalog-locales/fr.js');
    const module = await import('data:text/javascript;base64,' + french.toString('base64'));
    assert.deepEqual(module.default, {refineryName: 'Raffinerie'});
});

test('the packaged catalog can open the manifest and map data through the Studio library', () => {
    const names = ['manifest.v1.json', 'maps/map-data.v1.json'];
    const sharedResources = names.map((name, index) => ({id: `p.${index}`, path: `foxhole-planner/${name}`,
        mediaType: 'application/json', byteLength: 12, sha256: String(index + 1).repeat(64)}));
    const privateFiles = Object.fromEntries(names.map((name, index) => [name, sharedResources[index].path]));
    const source = Buffer.from(JSON.stringify({catalogSchemaVersion: 1,
        resourceDefaults: {icon: {pathTemplate: 'foxhole-planner/icons/{id}.webp', variant: 'default', mediaType: 'image/webp'}},
        products: [{id: 'sample', assetGroup: 'test', resources: {icon: [{sha256: 'a'.repeat(64), byteLength: 10}]}}],
        sharedResources, data: {privateFiles, catalogLocalizations: {fr: {name: 'Exemple'}}}}));
    const {bytes} = buildRuntimeCatalog(source);
    const library = createFoxholeCatalogLibrary('https://assets.nixiejs.com/', JSON.parse(bytes));
    for (const [index, name] of names.entries()) {
        assert.equal(library.files.get(name)?.entry.sha256, sharedResources[index].sha256);
        assert.equal(library.resolve(name), `https://assets.nixiejs.com/foxhole-planner/${name}`);
    }
});
