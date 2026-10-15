import assert from 'node:assert/strict';
import test from 'node:test';
import {
    getFoxholeItemCatalog,
    getFoxholeStructureCatalog,
} from '../app/plugins/foxhole/nixie/catalog.ts';
import {
    resolveFoxholeCatalogCanonicalKeyFromAlias,
    resolveFoxholeCatalogSearchAliases,
} from '../app/plugins/foxhole/nixie/catalog-search-aliases.ts';
import { getFoxholeProductionIndex } from '../app/plugins/foxhole/nixie/production/index.ts';
import {
    resolveFoxholeProductionOutputRef,
    searchFoxholeProductionOutputs,
} from '../app/plugins/foxhole/nixie/production/itinerary.ts';

const BASE_ASSETS_URL = '/foxhole/assets/';

test('resolveFoxholeCatalogSearchAliases returns authored mats and vehicle aliases', () => {
    assert.deepEqual(
        resolveFoxholeCatalogSearchAliases('cloth').sort(),
        ['basic mats', 'bmat', 'bmats'].sort(),
    );
    assert.ok(resolveFoxholeCatalogSearchAliases('explosive').includes('emats'));
    assert.ok(resolveFoxholeCatalogSearchAliases('explosive').includes('explosive materials'));
    assert.deepEqual(resolveFoxholeCatalogSearchAliases('construction'), ['cv']);
    assert.equal(resolveFoxholeCatalogCanonicalKeyFromAlias('bmats'), 'cloth');
    assert.equal(resolveFoxholeCatalogCanonicalKeyFromAlias('emats'), 'explosive');
    assert.equal(resolveFoxholeCatalogCanonicalKeyFromAlias('cv'), 'construction');
    assert.equal(resolveFoxholeCatalogCanonicalKeyFromAlias('las'), 'facilityvehiclefactory2');
    assert.equal(resolveFoxholeCatalogCanonicalKeyFromAlias('LAS'), 'facilityvehiclefactory2');
    assert.equal(resolveFoxholeCatalogCanonicalKeyFromAlias('mpf'), 'massproduction');
    assert.equal(resolveFoxholeCatalogCanonicalKeyFromAlias('sas'), 'facilityvehiclefactory1');
});

test('item catalog folds bmats into cloth aliases and searchText', () => {
    const catalog = getFoxholeItemCatalog(BASE_ASSETS_URL);
    const cloth = catalog.assetByKey.cloth
        ?? catalog.assets.find(asset => asset.codeName === 'Cloth' || asset.foxholeKey === 'cloth');
    assert.ok(cloth);
    assert.ok(cloth!.aliases.includes('bmats'));
    assert.ok(cloth!.searchText.includes('bmats'));

    const explosive = catalog.assetByKey.explosive
        ?? catalog.assets.find(asset => asset.codeName === 'Explosive' || asset.foxholeKey === 'explosive');
    assert.ok(explosive);
    assert.ok(explosive!.aliases.includes('emats'));
    assert.ok(explosive!.searchText.includes('explosive materials'));
});

test('structure catalog folds cv into construction aliases and searchText', () => {
    const catalog = getFoxholeStructureCatalog(BASE_ASSETS_URL);
    const construction = catalog.assetByKey.construction
        ?? catalog.assets.find(asset => asset.codeName === 'Construction');
    assert.ok(construction);
    assert.ok(construction!.aliases.includes('cv'));
    assert.ok(construction!.searchText.includes('cv'));

    const las = catalog.assetByKey.facilityvehiclefactory2;
    assert.ok(las);
    assert.ok(las!.aliases.includes('las'));
    assert.ok(las!.searchText.includes('las'));

    const mpf = catalog.assetByKey.massproduction;
    assert.ok(mpf);
    assert.ok(mpf!.aliases.includes('mpf'));

    const catwalkPlatform = catalog.assetByKey.facilitycatwalkplatform;
    assert.ok(catwalkPlatform);
    assert.ok(catwalkPlatform!.searchText.includes('facilitycatwalkplatform'));
});

test('production resolve maps community aliases to outputs', () => {
    const index = getFoxholeProductionIndex(BASE_ASSETS_URL);
    const itemCatalog = getFoxholeItemCatalog(BASE_ASSETS_URL);
    const structureCatalog = getFoxholeStructureCatalog(BASE_ASSETS_URL);
    const catalogs = { itemCatalog, structureCatalog };

    const bmats = resolveFoxholeProductionOutputRef('bmats', index, catalogs);
    assert.equal(bmats?.commodityKey, 'item:Cloth');

    const emats = resolveFoxholeProductionOutputRef('emats', index, catalogs);
    assert.equal(emats?.commodityKey, 'item:Explosive');

    const explosiveMaterials = resolveFoxholeProductionOutputRef('explosive materials', index, catalogs);
    assert.equal(explosiveMaterials?.commodityKey, 'item:Explosive');

    const ematsHits = searchFoxholeProductionOutputs('emats', index, catalogs, 5);
    assert.ok(ematsHits.some(entry => entry.commodityKey === 'item:Explosive'));
    assert.equal(ematsHits[0]?.commodityKey, 'item:Explosive');

    const heavyBomber = searchFoxholeProductionOutputs('heavy bomber', index, catalogs, 8);
    assert.ok(
        heavyBomber.some(entry => /aircraftbomber/i.test(entry.resourceId)),
        'heavy bomber should prefer bomber vehicles over Aircraft Crate',
    );
    assert.ok(
        heavyBomber[0] && /aircraftbomber/i.test(heavyBomber[0].resourceId),
        `top hit should be a bomber vehicle, got ${heavyBomber[0]?.commodityKey}`,
    );
    assert.ok(!/AircraftCrate/i.test(heavyBomber[0]?.commodityKey ?? ''));

    assert.equal(resolveFoxholeCatalogCanonicalKeyFromAlias('uranium'), null);
    assert.equal(resolveFoxholeProductionOutputRef('uranium', index, catalogs), null);
    assert.equal(resolveFoxholeCatalogCanonicalKeyFromAlias('jet'), null);
});

test('searchFoxholeProductionOutputs does not treat LAS as a blast-furnace substring', () => {
    const index = getFoxholeProductionIndex(BASE_ASSETS_URL);
    const itemCatalog = getFoxholeItemCatalog(BASE_ASSETS_URL);
    const structureCatalog = getFoxholeStructureCatalog(BASE_ASSETS_URL);
    const catalogs = { itemCatalog, structureCatalog };

    const lasHits = searchFoxholeProductionOutputs('LAS', index, catalogs, 15);
    assert.ok(
        lasHits.some(entry => entry.commodityKey === 'build:structure:facilityvehiclefactory2'),
        'LAS acronym should resolve to Large Assembly Station',
    );
    assert.ok(
        !lasHits.some(entry => /FacilityMaterials|blastfurnace|BloodPlasma|ATGrenadeW/i.test(entry.commodityKey)),
        'LAS must not substring-match blast furnace / flask / plasma outputs',
    );
    assert.ok(
        !lasHits.some(entry => /upgrade:/i.test(entry.commodityKey)),
        'LAS alias should not attach every LAS upgrade build row',
    );

    const mpfHits = searchFoxholeProductionOutputs('MPF', index, catalogs, 10);
    assert.ok(
        mpfHits.some(entry => entry.commodityKey === 'build:structure:massproduction'),
        'MPF acronym should resolve to Mass Production Factory',
    );
    assert.ok(
        !mpfHits.some(entry => /facilityvehiclefactory1/i.test(entry.commodityKey)),
        'MPF must not return Small Assembly Station',
    );
});
