import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { getFoxholeItemCatalog, getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { resolveFoxholeHoldProfileItemOptions } from '../app/plugins/foxhole/nixie/hold-profile.ts';
import * as hover from '../app/plugins/foxhole/nixie/inspector-hover-entry.ts';

const structures = getFoxholeStructureCatalog('/foxhole/assets/');
const items = getFoxholeItemCatalog('/foxhole/assets/');
const hold = structures.structureByKey.largeshipresourceship!.holdProfile!;
const options = resolveFoxholeHoldProfileItemOptions(hold, items, (item, code) => item?.name ?? code);

// Execute the actual SFC getters without mounting unrelated inspector/runtime controls.
const component = readFileSync(process.env.FOXHOLE_CARGO_TEST_SOURCE ?? new URL(
    '../app/components/nixie/foxhole/FoxholeStructureCargoInspectorCard.vue', import.meta.url,
), 'utf8');
const script = component.slice(component.indexOf('>', component.indexOf('<script')) + 1, component.indexOf('</script>'));
const source = ts.createSourceFile('cargo-inspector.ts', script, ts.ScriptTarget.Latest, true);
const functionNames = ['createSelectedItemHoverEntry', 'getSelectedItemIconUrl', 'resolveItemLabel', 'resolveItemDescription', 'resolveItemCategory'];
const functions = source.statements.filter(statement => ts.isFunctionDeclaration(statement)
    && functionNames.includes(statement.name?.text ?? '')).map(statement => statement.getText(source)).join('\n');
const entries = { value: new Map(options.map(option => [option.codename, option])) };
const bindings = { ...hover, itemOptionByCodename: entries, structureCatalog: { value: structures },
    t: (_id: string, fallback: string) => fallback };
const code = ts.transpileModule(`${functions}\nreturn { createSelectedItemHoverEntry, getSelectedItemIconUrl };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const inspector = new Function(...Object.keys(bindings), code)(...Object.values(bindings));

test('native Harvester stockpile selection uses its exact vehicle icon and hover identity', () => {
    assert.deepEqual(options.map(option => [option.codename, option.label, option.item]), [['Harvester', 'Harvester', null]]);
    assert.equal(inspector.getSelectedItemIconUrl('Harvester'), '/foxhole/assets/types/vehicles/harvester/harvester.icon.default.webp');
    const entry = inspector.createSelectedItemHoverEntry('Harvester');
    assert.equal(entry.iconUrl, structures.assetByKey.harvester!.iconUrl);
    assert.equal(entry.displayName, 'Harvester', 'existing storage label remains unchanged');
    assert.equal(entry.asset.metadata.foxholeKey, 'harvester');
    assert.equal(entry.asset.metadata.codeName, 'Harvester');
    assert.equal(entry.asset.metadata.isItem, false, 'a native vehicle must not be represented as a missing inventory item');
    assert.equal(entry.description, structures.assetByKey.harvester!.description);
});

test('exact structure lookup is case-insensitive and never guesses an unresolved category or variant', () => {
    const before = JSON.stringify(options);
    for (const key of ['Harvester', 'harvester', ' HARVESTER ']) {
        assert.equal(hover.resolveFoxholeStoredStructureAsset(key, null, structures), structures.assetByKey.harvester);
    }
    assert.equal(hover.resolveFoxholeStoredStructureAsset('ResourceContainer', null, structures), structures.assetByKey.resourcecontainer);
    for (const key of ['', 'Harvesters', 'HarvesterVariant', 'UnknownVehicle']) {
        assert.equal(hover.resolveFoxholeStoredStructureAsset(key, null, structures), null);
    }
    assert.equal(JSON.stringify(options), before, 'resolving visuals does not rewrite cargo keys/labels or allowed choices');
    assert.equal(inspector.getSelectedItemIconUrl('ResourceContainer'), '', 'catalog identity does not admit an unlisted storage option');
    assert.equal(inspector.createSelectedItemHoverEntry('ResourceContainer'), null);
});

test('ordinary inventory items retain icon/hover priority, including missing item icons', () => {
    const coal = items.assetByKey.coal!;
    assert(coal);
    const option = { codename: 'Coal', label: 'Coal', item: coal };
    entries.value.set('Coal', option);
    assert.equal(inspector.getSelectedItemIconUrl('Coal'), hover.resolveFoxholeItemDefaultIconUrl(coal));
    assert.equal(inspector.createSelectedItemHoverEntry('Coal').asset.metadata.isItem, true);
    assert.equal(hover.resolveFoxholeStoredStructureAsset('Coal', coal, {
        assetByKey: { Coal: structures.assetByKey.harvester! },
    }), null, 'an exact item wins a cross-domain key collision');
    entries.value.set('Coal', { ...option, item: { ...coal, iconUrl: null } });
    assert.equal(inspector.getSelectedItemIconUrl('Coal'), '', 'do not replace a known item with an unrelated structure when its icon is absent');
    entries.value.delete('Coal');
});

test('unknown allowed tokens retain the existing fallback with no persisted-state mutation', () => {
    const option = { codename: 'UnresolvedNativeEntry', label: 'UnresolvedNativeEntry', item: null };
    entries.value.set(option.codename, option);
    const before = JSON.stringify(option);
    assert.equal(inspector.getSelectedItemIconUrl(option.codename), '');
    const entry = inspector.createSelectedItemHoverEntry(option.codename);
    assert.equal(entry.icon, hover.FOXHOLE_ITEM_FALLBACK_ICON);
    assert.equal(entry.displayName, option.label);
    assert.equal(JSON.stringify(option), before);
    entries.value.delete(option.codename);
});
