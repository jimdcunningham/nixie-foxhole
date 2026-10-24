import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { listFoxholeSceneV2Products } from '../src/scene-v2-products.ts';
import { resolveFoxholeCatalogLocale } from '../src/catalog-presentation.ts';
import { parseNixieExperimentalProductResultV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';

const find = (settings: Record<string, string | boolean>, query = 'facilityrefinery1') =>
    parseNixieExperimentalProductResultV1(listFoxholeSceneV2Products({ contractVersion: 1, query, offset: 0, limit: 100,
        settings: { 'foxhole.assets.filter.showPreviousTiers': true, ...settings } }));

test('catalog language choices translate names and descriptions while preserving SDK product components and IDs', () => {
    const base = find({ 'foxhole.locale': 'en' }).items.find(item => item.product.id === 'asset.facilityrefinery1')!;
    const french = find({ 'foxhole.locale': 'fr' }).items.find(item => item.product.id === base.product.id)!;
    const strings = JSON.parse(readFileSync(new URL('../../../packages/extensions/foxhole/public/foxhole/assets/localizations/fr.json', import.meta.url), 'utf8'));
    assert.ok(Object.values(strings).includes(french.label));
    assert.notEqual(french.label, base.label);
    assert.notEqual(french.presentation?.description, base.presentation?.description);
    assert.deepEqual(french.product.components, base.product.components);
    assert.equal(resolveFoxholeCatalogLocale('auto', 'pt-BR'), 'pt');
    assert.equal(resolveFoxholeCatalogLocale('unknown'), 'en');
});

test('rendered catalog icons change only presentation and community aliases reach canonical SDK products', () => {
    const base = find({}, 'cloth').items.find(item => item.product.id === 'asset.cloth')!;
    const rendered = find({ 'foxhole.assets.browser.iconSet': 'rendered' }, 'cloth').items.find(item => item.product.id === base.product.id)!;
    assert.notDeepEqual(rendered.presentation?.icon, base.presentation?.icon);
    assert.deepEqual(rendered.product, base.product);
    const bmats = find({}, 'bmats');
    assert.ok(bmats.items.some(item => item.product.id === 'asset.cloth'));
    assert.ok(find({}, 'mpf').items.some(item => item.product.id === 'asset.massproduction'));
});
