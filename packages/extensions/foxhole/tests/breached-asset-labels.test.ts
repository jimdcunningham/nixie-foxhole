import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { matchesFoxholeDestroyedFilter } from '../app/plugins/foxhole/nixie/assets-browser.ts';
import type { NixieAssetBrowserContext, NixieResolvedAssetEntry } from '#nixie/plugins/nixie/registry/types.ts';

const catalog = getFoxholeStructureCatalog('/foxhole/assets/');

test('every published breached variant has a breached label and classification', () => {
    const variants = catalog.assets.filter(asset => /Breached(?:T\d+)?$/i.test(asset.codeName));
    assert.ok(variants.some(asset => asset.foxholeKey === 'fortcornerbreachedt3'));
    for (const asset of variants) {
        assert.equal(asset.isBreached, true, asset.foxholeKey);
        assert.match(asset.name, /^Breached /, asset.foxholeKey);
        assert.doesNotMatch(asset.name, /Destroyed/, asset.foxholeKey);
    }
});

test('the breached corner follows the breached filter while the destroyed corner remains distinct', () => {
    const entry = (id: string) => ({ asset: { id, metadata: catalog.assetByKey[id] } }) as unknown as NixieResolvedAssetEntry;
    const context = (showBreached: boolean) => ({
        getSetting: (id: string) => id === 'foxhole.assets.filter.breached' && showBreached,
    }) as unknown as NixieAssetBrowserContext;

    assert.equal(matchesFoxholeDestroyedFilter(entry('fortcornerbreachedt3'), false, context(true)), true);
    assert.equal(matchesFoxholeDestroyedFilter(entry('fortcornerbreachedt3'), false, context(false)), false);
    assert.equal(matchesFoxholeDestroyedFilter(entry('fortcornerdestroyedt3'), false, context(true)), false);
    assert.equal(catalog.assetByKey.fortcornerdestroyedt3.isBreached, false);
    assert.equal(catalog.assetByKey.fortcornerdestroyedt3.name, 'Destroyed Bunker Corner (Tier 3)');
});

test('all published locales distinguish breached and destroyed bunker corners', () => {
    const root = new URL('../public/foxhole/assets/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('manifest.v1.json', root), 'utf8'));
    const bundles = [
        ...manifest.localizations.map((bundle: { locale: string; strings: Record<string, string>; }) => [bundle.locale, bundle.strings]),
        ...Object.entries(manifest.localizationIndex.files).map(([locale, file]) => [
            locale, JSON.parse(readFileSync(new URL(String(file), root), 'utf8')),
        ]),
    ];
    for (const [locale, strings] of bundles) {
        const breached = strings['asset:fortcornerbreachedt3:name'];
        const destroyed = strings['asset:fortcornerdestroyedt3:name'];
        assert.ok(breached, locale);
        assert.ok(destroyed, locale);
        assert.notEqual(breached, destroyed, locale);
    }
});
