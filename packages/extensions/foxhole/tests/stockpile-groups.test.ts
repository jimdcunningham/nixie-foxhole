import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeStructureCatalog, getFoxholeItemCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { resolveFoxholeStockpileSelectionGroups, resolveFoxholeStockpileGroupSelection, resolveFoxholeGroupedCargoCodenames, resolveFoxholeStockpileOptions, formatFoxholeStockpileLimits } from '../app/plugins/foxhole/nixie/stockpile-groups.ts';
import type { FoxholeItemAsset, FoxholeStructureAsset } from '../app/plugins/foxhole/nixie/catalog.ts';
import { foxholeStockpileGroupSchema } from '../app/plugins/foxhole/nixie/stockpile-groups-schema.ts';
import { normalizeFoxholeStructureState } from '../app/plugins/foxhole/nixie/structure-state.ts';
import { DEFAULT_FOXHOLE_STRUCTURE_STATE } from '../app/plugins/foxhole/nixie/structure-state.ts';

const structures = getFoxholeStructureCatalog('/foxhole/assets/');
const items = getFoxholeItemCatalog('/foxhole/assets/');
const ship = structures.structureByKey.largeshipresourceship!;

test('published Bowhead retains three native stores and five typed groups without changing the legacy projection', () => {
    assert.equal(ship.stockpiles?.length, 3);
    const groups = resolveFoxholeStockpileSelectionGroups(ship.stockpiles);
    assert.deepEqual(groups.map(group => [group.key, group.entryType, group.quantityLimit, group.totalQuantityLimit]), [
        ['GenericStockpileComponent:0', 'Vehicles', 10, 0],
        ['GenericStockpileComponent:1', 'Structures', 20, 0],
        ['GenericStockpileComponent:2', 'Items', 30000, 30000],
        ['GenericStockpileComponent1:0', 'Items', 32500, 32500],
        ['GenericStockpileComponent2:0', 'Items', 32500, 32500],
    ]);
    assert.deepEqual(groups.map(group => group.allowed.length), [1, 3, 10, 10, 10]);
    assert.deepEqual(ship.holdProfile?.allowedItems, ['Harvester']);
    assert.equal(ship.holdProfile?.capacity, 0);
    assert.equal(formatFoxholeStockpileLimits(groups[0]!), 'Entry limit: 10; total limit: 0.');
    assert.ok(groups.every(group => !formatFoxholeStockpileLimits(group).includes('95,000')));
});

test('old markers appear in their matching group; explicit empty selections remain empty', () => {
    const groups = resolveFoxholeStockpileSelectionGroups(ship.stockpiles);
    assert.equal(groups.length, 5);
    assert.deepEqual(resolveFoxholeStockpileGroupSelection(groups[0]!, undefined, ['Harvester']), ['Harvester']);
    const selected = { [groups[0]!.key]: [], [groups[3]!.key]: ['coal', 'Coal', 'Harvester', 'Unknown'] };
    assert.deepEqual(resolveFoxholeStockpileGroupSelection(groups[0]!, selected, ['Harvester']), []);
    assert.deepEqual(resolveFoxholeStockpileGroupSelection(groups[3]!, selected, []), ['Coal']);
    assert.deepEqual(resolveFoxholeGroupedCargoCodenames(ship.stockpiles, selected, ['Harvester']), ['Coal']);
    assert.equal(resolveFoxholeGroupedCargoCodenames(undefined, selected, ['Harvester']), null);
    assert.equal(Object.hasOwn(normalizeFoxholeStructureState({ ...DEFAULT_FOXHOLE_STRUCTURE_STATE }), 'markedStockpileItems'), false, 'reading an old scene does not add storage state');
});

test('choices resolve exact native identities in their own entry domain', () => {
    const groups = resolveFoxholeStockpileSelectionGroups(ship.stockpiles);
    assert.equal(groups.length, 5);
    const vehicle = resolveFoxholeStockpileOptions(groups[0]!, items.assets, structures.assets, asset => asset.name);
    assert.equal(vehicle[0]?.structure?.foxholeKey, 'harvester');
    assert.equal(vehicle[0]?.item, null);
    const storedStructures = resolveFoxholeStockpileOptions(groups[1]!, items.assets, structures.assets, asset => asset.name);
    assert.deepEqual(storedStructures.map(option => option.structure?.foxholeKey), ['resourcecontainer', 'constructionequipment', 'concretemixer']);
    assert.ok(resolveFoxholeStockpileOptions(groups[2]!, items.assets, structures.assets, asset => asset.name).every(option => option.item && !option.structure));
    const item = { codeName: 'Same', name: 'Item' } as FoxholeItemAsset;
    const structure = { codeName: 'Same', name: 'Structure', isVehicle: false } as FoxholeStructureAsset;
    const v = { ...structure, name: 'Vehicle', isVehicle: true };
    for (const [entryType, expected] of [['Items','Item'], ['Structures','Structure'], ['Vehicles','Vehicle']]) {
        assert.equal(resolveFoxholeStockpileOptions({ ...groups[0]!, allowed: ['Same'], entryType: entryType! }, [item], [structure,v], asset => asset.name)[0]?.label, expected);
    }
});

test('schema keeps zero limits and distinct native override records', () => {
    const parsed = foxholeStockpileGroupSchema.parse({ componentName: 'Store', stockpileIndex: 0, configs: [{ entryType: 'Items', quantityLimit: 10, totalQuantityLimit: 0,
        quantityOverrides: [{ Key: 'Coal', Value: 7 }], totalQuantityOverrides: [{ Key: 'Coal', Value: 11 }], validEntriesOverride: [] }] });
    assert.equal(parsed.configs[0]?.totalQuantityLimit, 0);
    assert.deepEqual(parsed.configs[0]?.quantityOverrides, [{ Key: 'Coal', Value: 7 }]);
    assert.deepEqual(parsed.configs[0]?.totalQuantityOverrides, [{ Key: 'Coal', Value: 11 }]);
    assert.deepEqual(parsed.configs[0]?.validEntriesOverride, []);
});
