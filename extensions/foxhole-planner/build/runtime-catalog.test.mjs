import assert from 'node:assert/strict';
import test from 'node:test';
import {buildRuntimeCatalog} from './runtime-catalog.mjs';

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

test('keeps resource receipts available with the generated-path aliases omitted', () => {
    const sharedResources = [{id: 'p.0', path: 'foxhole-planner/objects/foundation.webp'}];
    const privateFiles = {'icons/iconfilterfoundation.webp': sharedResources[0].path};
    const source = Buffer.from(JSON.stringify({products: [], sharedResources, data: {privateFiles, maps: {}}}));
    const {bytes} = buildRuntimeCatalog(source);
    assert.deepEqual(JSON.parse(bytes), {products: [], sharedResources, data: {maps: {}}});
    assert.deepEqual(JSON.parse(source).data.privateFiles, privateFiles);
});
