import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildFoxholeStructureCatalog,
    compareFoxholeStructureCatalogAssets,
    resolveFoxholeStructureCatalogSortOrder,
} from '../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import { sortAssetEntries } from '../../../nixie/app/plugins/nixie/assets-browser.ts';

const DEFENSE_DEFAULT_BUILD_MENU_ORDER = [
    'sandbaghalfspline',
    'tankstopsplinet3',
    'barbedwirespline',
    'minespline',
    'surfacewaterminespline',
    'waterminespline',
    'waterwallsplinet1',
    'barbedwirewallspline',
    'wallsplinet1',
    'gatet1',
    'watchtower',
    'riflepillbox',
    'mgpillbox',
    'atpillbox',
    'isgpillbox',
    'tankstop',
] as const;

function sortDefenseCatalogAssets(
    catalog: ReturnType<typeof buildFoxholeStructureCatalog>,
) {
    return catalog.assets
        .filter(asset => asset.categoryKey === 'defense' && !asset.hideInList)
        .sort((left, right) => compareFoxholeStructureCatalogAssets(catalog, left, right));
}

test('defense category keeps canonical default build-menu order', () => {
    const catalog = buildFoxholeStructureCatalog(getFoxholeManifest('/foxhole/assets/'));
    const sortedDefenseAssets = sortDefenseCatalogAssets(catalog);
    const sortedCanonicalIds = sortedDefenseAssets
        .map(asset => asset.foxholeKey)
        .filter((structureId): structureId is typeof DEFENSE_DEFAULT_BUILD_MENU_ORDER[number] => (
            DEFENSE_DEFAULT_BUILD_MENU_ORDER.includes(structureId as typeof DEFENSE_DEFAULT_BUILD_MENU_ORDER[number])
        ));

    assert.deepEqual(
        sortedCanonicalIds,
        [...DEFENSE_DEFAULT_BUILD_MENU_ORDER],
        'canonical defense structures must stay in the in-game default order',
    );
});

test('defense canonical order ids exist in the foxhole manifest', () => {
    const manifest = getFoxholeManifest('/foxhole/assets/');
    const manifestStructureIds = new Set(
        manifest.assets
            .filter(asset => asset.isItem !== true)
            .map(asset => asset.id),
    );

    for (const structureId of DEFENSE_DEFAULT_BUILD_MENU_ORDER) {
        assert.equal(
            manifestStructureIds.has(structureId),
            true,
            `expected manifest structure ${structureId}`,
        );
    }
});

test('tiered defense upgrades inherit the base build-order bucket', () => {
    const catalog = buildFoxholeStructureCatalog(getFoxholeManifest('/foxhole/assets/'));
    const wallTier1 = catalog.assetByKey.wallsplinet1;
    const wallTier2 = catalog.assetByKey.wallsplinet2;
    const gateTier1 = catalog.assetByKey.gatet1;
    const gateTier2 = catalog.assetByKey.gatet2;

    assert.ok(wallTier1);
    assert.ok(wallTier2);
    assert.ok(gateTier1);
    assert.ok(gateTier2);

    assert.equal(
        resolveFoxholeStructureCatalogSortOrder(catalog, wallTier1),
        resolveFoxholeStructureCatalogSortOrder(catalog, wallTier2),
    );
    assert.equal(
        resolveFoxholeStructureCatalogSortOrder(catalog, gateTier1),
        resolveFoxholeStructureCatalogSortOrder(catalog, gateTier2),
    );
    assert.ok(
        compareFoxholeStructureCatalogAssets(catalog, wallTier1, gateTier1) < 0,
        'walls should sort before gates',
    );
});

test('asset browser sticky sort tie-breaks by localized display name', () => {
    const sorted = sortAssetEntries([
        {
            sourceId: 'foxhole',
            sourceName: 'Foxhole',
            categoryName: 'Defenses',
            displayName: 'Prepared Minefield',
            iconUrl: '',
            previewUrl: '',
            asset: {
                id: 'minespline',
                order: 1,
                metadata: {
                    codeName: 'MineSpline',
                    stickySortAnchorId: 'minespline',
                    stickySortVariantRank: 0,
                },
            },
        },
        {
            sourceId: 'foxhole',
            sourceName: 'Foxhole',
            categoryName: 'Defenses',
            displayName: 'Barbed Wire',
            iconUrl: '',
            previewUrl: '',
            asset: {
                id: 'barbedwirespline',
                order: 1,
                metadata: {
                    codeName: 'BarbedWireSpline',
                    stickySortAnchorId: 'barbedwirespline',
                    stickySortVariantRank: 0,
                },
            },
        },
    ]);

    assert.deepEqual(
        sorted.map(entry => entry.asset.id),
        ['barbedwirespline', 'minespline'],
    );
});

test('tank mine is a placeable defense asset at its legacy order', () => {
    const manifest = getFoxholeManifest('/foxhole/assets/');
    const tankMine = manifest.assets.find(asset => asset.id === 'tankmine');
    const catalog = buildFoxholeStructureCatalog(manifest);

    assert.ok(tankMine);
    assert.equal(tankMine.categoryId, 'defense');
    assert.equal(tankMine.buildOrder, 10);
    assert.notEqual(tankMine.isItem, true);
    assert.notEqual(tankMine.isBunker, true);
    assert.notEqual(tankMine.isFacility, true);
    assert.equal(tankMine.variants?.default?.textureUrl, '/foxhole/assets/types/structures/tankmine/tankmine.texture.webp');
    assert.equal(catalog.assetByKey.tankmine?.categoryKey, 'defense');
});
