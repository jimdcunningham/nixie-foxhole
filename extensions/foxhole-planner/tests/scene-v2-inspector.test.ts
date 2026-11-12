import { foxholeColorLabel } from '../src/color-label.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseNixieExtensionManifestV1 } from '@nixiejs/extension-sdk';
import { projectNixieInspectorSubjectV1, validateNixieInspectorResultV1 } from '@nixiejs/extension-sdk/scene-v2';
import { inspectFoxholeSceneV2Structure, inspectFoxholeSceneV2SplineConnector } from '../src/scene-v2-inspector.ts';
import { listFoxholeSceneV2Products } from '../src/scene-v2-products.ts';
import assets from '#foxhole-scene-v2-assets';

const manifest = parseNixieExtensionManifestV1(JSON.parse(await readFile(new URL('../nixie.extension.json', import.meta.url), 'utf8')));
const provider = manifest.contributes.inspectorProviders![0]!;
function inspect(assetId: string, overrides: Record<string, Record<string, unknown>> = {}, faction?: string, locale?: string) {
    const data = { 'asset': { catalogId: 'foxhole.structures', assetId }, 'appearance': {}, 'modification': { selections: [] },
        'cargo': { items: [] }, 'production-order': { orders: [] }, 'socket-attachments': { attachments: [] }, ...overrides };
    const subject = { entityId: 'fixture', revision: 1, components: Object.entries(data).map(([componentId, value]) => ({
        ownerId: manifest.id, componentId, version: 1, definitionAvailable: true, data: value,
    })) };
    const request = projectNixieInspectorSubjectV1(subject as Parameters<typeof projectNixieInspectorSubjectV1>[0], manifest.id, provider);
    if (locale) request.locale = locale;
    if (faction) request.settings = { 'foxhole.assets.filter.faction': faction };
    const result = inspectFoxholeSceneV2Structure(request);
    validateNixieInspectorResultV1(result, provider, manifest.contributes.components!.components, request);
    return result;
}

test('all published assets return bounded Inspector choices validated against their real schemas', () => {
    for (const assetId of Object.keys(assets)) {
        assert.doesNotThrow(() => inspect(assetId), assetId);
        const states = inspect(assetId).components.find(component => component.componentId === 'appearance')
            ?.fields.find(field => field.path.length === 0)?.choices?.options ?? [];
        for (const option of states) {
            const value = option.value as Record<string, unknown>;
            assert.ok([value.destroyed, value.packaged, value.blueprint].filter(flag => flag === true).length <= 1, `${assetId}: ${option.label}`);
            if (assets[assetId]!.isDestroyed) {
                assert.notEqual(value.blueprint, true, assetId);
            }
        }
    }
});

test('firing ports and infrastructure exclude only their own wall in either selection order', () => {
    for (const assetId of ['fortt2', 'fortt3', 'fortcornert2', 'fortcornert3']) {
        const asset = assets[assetId]!;
        const choices = (slotId: string, variantId: string) => inspect(assetId, {
            modification: { selections: [{ slotId, variantId }] },
        }).components.find(component => component.componentId === 'modification')!.fields[0]!.choices!.options;
        const includes = (options: ReturnType<typeof choices>, slotId: string, variantId: string) => options.some(option =>
            option.value !== null && typeof option.value === 'object' && !Array.isArray(option.value)
            && option.value.slotId === slotId && option.value.variantId === variantId);
        for (const [infraId, infra] of Object.entries(asset.modifications).filter(([, slot]) => slot.componentType === 'BPFortInfraModSlot_C')) {
            for (const [wallId, wall] of Object.entries(asset.modifications).filter(([, slot]) => slot.componentType === 'BPFortWallModSlot_C')) {
                const sameWall = infra.linkedSocketNames!.some(name => wall.linkedSocketNames!.includes(name));
                assert.equal(includes(choices(wallId, 'firingport'), infraId, 'kitchen'), !sameWall);
                assert.equal(includes(choices(infraId, 'kitchen'), wallId, 'firingport'), !sameWall);
                const baseline = inspect(assetId).components.find(component => component.componentId === 'modification')!.fields[0]!.choices!.options;
                assert.equal(includes(choices(infraId, 'kitchen'), wallId, 'door'), includes(baseline, wallId, 'door'));
            }
        }
    }
});

test('stale production data does not give a bunker a production tab', () => {
    const bunker = inspect('fortt3', { 'production-order': { orders: [{ id: 'stale', recipeId: 'stale' }] } });
    assert.equal(bunker.layout?.tabs?.some(tab => tab.id === 'production'), false);
    assert.equal(inspect('facilityfactoryammo').layout?.tabs?.some(tab => tab.id === 'production'), true);
});

test('cargo retains the Native item selection set and enforces published capacity', () => {
    const stockpile = Object.entries(assets).find(([, asset]) => asset.cargo?.allowsAnyItem && asset.cargo.limit === null)!;
    const field = inspect(stockpile[0]).components.find(component => component.componentId === 'cargo')!.fields[0]!;
    assert.equal(field.maxItems, 256);
    assert.equal(field.choices!.options.length, 221);
    assert.equal(field.choices!.uniqueBy, true);
    const fuelTank = Object.entries(assets).find(([, asset]) => asset.cargo?.limit === 1)!;
    assert.equal(inspect(fuelTank[0]).components.find(component => component.componentId === 'cargo')!.fields[0]!.maxItems, 1);
});

test('Bowhead storage exposes all five typed groups and native limits through the public Inspector', () => {
    const cargo = inspect('largeshipresourceship', { cargo: { items: [], stockpileItems: [] } }).components.find(component => component.componentId === 'cargo')!;
    assert.equal(cargo.fields[0]?.hidden, true);
    const field = cargo.fields.find(field => field.path[0] === 'stockpileItems')!;
    assert.equal(field.hidden, false);
    assert.equal(field.choices?.options.length, 34);
    assert.equal(new Set(field.choices!.options.map(option => (option.value as Record<string, string>).groupKey)).size, 5);
    const groups = field.choices!.groupedSelection!.groups;
    assert.deepEqual(groups.map(group => group.label), ['Vehicles', 'Structures', 'Items 1', 'Items 2', 'Items 3']);
    const hints = groups.map(group => group.hint).join(' ');
    assert.match(hints, /30,000/u);
    assert.match(hints, /32,500/u);
    assert.ok(!hints.includes('95,000'));
    const hauler = field.choices!.options.find(option => option.label.includes('Scrap Hauler'))!;
    assert.ok(hauler.image);
    const codename = (hauler.value as Record<string, string>).codename!;
    const legacy = inspect('largeshipresourceship', { cargo: { items: [codename] } }).components.find(component => component.componentId === 'cargo')!;
    assert.equal(legacy.fields[0]?.hidden, true);
    const legacyOptions = legacy.fields[1]!.choices!.options;
    assert.ok(legacyOptions.some(option => option.initiallySelected && option.label === hauler.label));
    const explicit = inspect('largeshipresourceship', { cargo: { items: [codename], stockpileItems: [] } });
    assert.ok(explicit.components.find(component => component.componentId === 'cargo')!.fields[1]!.choices!.options.every(option => !option.initiallySelected));
});

test('modification choices are paired and unique per slot; recipes follow selected variants', () => {
    const before = inspect('facilityfactoryammo');
    const modifications = before.components.find(component => component.componentId === 'modification')!.fields[0]!.choices!;
    assert.deepEqual(modifications.uniqueBy, ['slotId']);
    const upgrade = modifications.options.find(option => typeof option.value === 'object' && option.value !== null
        && option.value.variantId === 'tripodfactory')!;
    assert.ok(upgrade);
    const draftRecipes = before.components.find(component => component.componentId === 'production-order')!.fields[0]!.choices!;
    const upgradeRecipe = draftRecipes.options.find(option => typeof option.value === 'object' && option.value !== null
        && typeof option.value.recipeId === 'string' && option.value.recipeId.includes(':tripodfactory:'))!;
    assert.ok(upgradeRecipe.actionId);
    const action = before.layout!.actions!.find(candidate => candidate.id === upgradeRecipe.actionId);
    assert.deepEqual(action?.collection, { componentId: 'production-order', propertyId: 'orders' });
    assert.deepEqual(action?.patches, [{ componentId: 'modification', set: { selections: [upgrade.value] } }]);
    const after = inspect('facilityfactoryammo', { modification: { selections: [upgrade.value] } });
    const recipes = after.components.find(component => component.componentId === 'production-order')!.fields[0]!.choices!;
    assert.ok(recipes.options.some(option => typeof option.value === 'object' && option.value !== null
        && typeof option.value.recipeId === 'string' && option.value.recipeId.includes(':tripodfactory:')));
    assert.ok(recipes.options.some(option => typeof option.value === 'object' && option.value !== null && option.value.parent === true));
});

test('production lists base recipes first and inherits operating power for Forge recipes', () => {
    const options = inspect('facilityrefinery1').components.find(component => component.componentId === 'production-order')!.fields[0]!.choices!.options;
    assert.equal(options[0]!.details!.group, 'Base Facility');
    assert.equal(options.find(option => option.details?.group === 'Forge')?.details?.metrics?.find(metric => metric.label === 'Power')?.value, -2);
});

test('appearance offers only published variants and atomic valid state combinations', () => {
    const result = inspect('engineeringcenter');
    const fields = result.components.find(component => component.componentId === 'appearance')!.fields;
    assert.deepEqual(fields.find(field => field.path[0] === 'faction')!.choices!.options.map(option => option.label), ['Colonial', 'Warden']);
    const root = fields.find(field => field.path.length === 0)!;
    assert.deepEqual(root.choices!.valuePropertyIds, ['destroyed', 'packaged', 'blueprint']);
    for (const option of root.choices!.options) {
        const value = option.value as Record<string, unknown>;
        assert.equal([value.packaged, value.destroyed, value.blueprint].filter(flag => flag === true).length <= 1, true, option.label);
    }
});

test('catalog and standalone spline stencils expose only applicable authoring controls without changing geometry', () => {
    const connectorProvider = manifest.contributes.inspectorProviders!.find(entry => entry.id === 'spline-connector')!;
    const products = [];
    for (let offset = 0; offset < Object.keys(assets).length; offset += 100) {
        products.push(...listFoxholeSceneV2Products({ contractVersion: 1, query: '', offset, limit: 100 }).items.map(item => item.product));
    }
    products.push(...manifest.contributes.products!.filter(product => product.components.some(component => component.componentId === 'spline-connector')));
    let count = 0;
    for (const product of products) {
        const spline = product.components.find(component => component.componentId === 'spline-connector');
        if (!spline) {
            continue;
        }
        count++;
        const subject = { entityId: product.id, revision: 1, components: product.components.map(component => ({ ...component, definitionAvailable: true })) };
        const request = projectNixieInspectorSubjectV1(subject, manifest.id, connectorProvider);
        const before = structuredClone(request);
        const result = inspectFoxholeSceneV2SplineConnector(request);
        validateNixieInspectorResultV1(result, connectorProvider, manifest.contributes.components!.components, request);
        assert.deepEqual(request, before);
        const hasAsset = subject.components.some(component => component.componentId === 'asset');
        let layout = result.layout;
        if (hasAsset) {
            assert.equal(layout, undefined, 'catalog connectors use the structure provider layout');
            const structureRequest = projectNixieInspectorSubjectV1(subject, manifest.id, provider);
            const structure = inspectFoxholeSceneV2Structure(structureRequest);
            validateNixieInspectorResultV1(structure, provider, manifest.contributes.components!.components, structureRequest);
            layout = structure.layout;
            assert.ok(structure.components.some(component => component.componentId === 'spline-connector'));
        }
        assert.equal(layout?.title, 'Foxhole (SDK)', product.id);
        assert.equal(layout?.summary?.identifier, '#' + spline.data.foxholeKey, product.id);
        const visible = result.components[0]!.fields.filter(field => !field.hidden).map(field => field.path[0]);
        assert.equal(layout?.tabs.some(tab => tab.componentIds.includes('spline-connector')), visible.length > 0, product.id);
        assert.ok(!visible.includes('minLength') && !visible.includes('startAttachmentNodeId'));
        assert.ok(!visible.includes('blueprint') && !visible.includes('tint') && !visible.includes('brightness'));
        if (spline.data.foxholeKey === 'facilitypipe') {
            assert.deepEqual(visible, ['curveT']);
            assert.ok(layout?.menu?.toggles?.some(toggle => toggle.propertyId === 'blueprint'), product.id);
            assert.equal(result.components[0]!.fields.find(field => field.path[0] === 'curveT')?.description, undefined);
        } else if (spline.data.foxholeKey === 'powerline') {
            assert.deepEqual(visible, []);
        }
    }
    assert.ok(count > 20);
});

test('an unavailable connector retains authored geometry and identity for inspection', () => {
    const connectorProvider = manifest.contributes.inspectorProviders!.find(entry => entry.id === 'spline-connector')!;
    const product = manifest.contributes.products!.find(entry => entry.components.some(component => component.componentId === 'spline-connector'))!;
    const components = structuredClone(product.components).map(component => ({ ...component, definitionAvailable: true }));
    components.find(component => component.componentId === 'spline-connector')!.data.foxholeKey = 'unavailable-connector';
    const request = projectNixieInspectorSubjectV1({ entityId: 'missing', revision: 1, components }, manifest.id, connectorProvider);
    const before = structuredClone(request);
    const result = inspectFoxholeSceneV2SplineConnector(request);
    validateNixieInspectorResultV1(result, connectorProvider, manifest.contributes.components!.components, request);
    assert.deepEqual(request, before);
    assert.equal(result.components[0]!.fields.find(field => field.path[0] === 'foxholeKey')!.readOnly, true);
    assert.equal(result.components[0]!.fields.find(field => field.path[0] === 'foxholeKey')!.hidden, false);
});

for (const id of ['engineroomt2', 'engineroomt3']) {
    test(id + ' offers one engine-room power connection while leaving defense and stair slots available', () => {
        const options = inspect(id, { modification: { selections: [{ slotId: 'BackModSlot', variantId: 'powerconnection' }] } })
            .components.find(c => c.componentId === 'modification')!.fields[0]!.choices!.options;
        const has = (slotId: string, variantId: string) => options.some(o => o.value && typeof o.value === 'object'
            && !Array.isArray(o.value) && o.value.slotId === slotId && o.value.variantId === variantId);
        assert.ok(has('BackModSlot', 'powerconnection'));
        for (const side of ['Front', 'Left', 'Right']) assert.equal(has(side + 'ModSlot', 'powerconnection'), false);
        assert.ok(has('FrontDefenseModSlot', 'sandbags'));
        assert.ok(has('RightFortStairsModSlot', 'stairs'));
    });
}

test('assembly picker filters by faction without losing details for previously saved recipes', () => {
    const options = (faction: string) => inspect('facilityvehiclefactory1', {}, faction).components
        .find(component => component.componentId === 'production-order')!.fields[0]!.choices!.options;
    const find = (faction: string, name: string) => options(faction).find(choice => choice.label.includes(name))?.details;
    const warden = 'Dunne Leatherback';
    const colonial = 'Salva';
    assert.equal(find('all', warden)?.omitFromPicker, undefined);
    assert.equal(find('c', warden)?.omitFromPicker, true);
    assert.equal(find('c', warden)?.sections?.length, 2);
    assert.equal(find('w', warden)?.omitFromPicker, undefined);
    assert.equal(find('c', colonial)?.omitFromPicker, undefined);
    assert.equal(find('w', colonial)?.omitFromPicker, true);
    assert.equal(find('c', 'Material Pallet')?.omitFromPicker, undefined);
});

test('assembly recipe previews retain catalog punctuation and distinguish crates', () => {
    const choices = (id: string) => inspect(id).components
        .find(component => component.componentId === 'production-order')!.fields[0]!.choices!.options;
    const bluefin = choices('facilityvehiclefactory3').find(option => option.label === 'BMS - Bluefin');
    assert.ok(bluefin?.details?.sections?.find(section => section.title === 'Outputs')?.rows
        .some(row => row.label === 'BMS - Bluefin' && row.unit === undefined));
    const aircraft = choices('facilityvehiclefactory2').find(option => option.label === 'Daimon aK-5 “Harpy”');
    assert.ok(aircraft?.details?.sections?.find(section => section.title === 'Outputs')?.rows
        .some(row => row.label === 'Daimon aK-5 “Harpy” (Crate)' && row.unit === 'crates'));
});

test('Inspector catalog text follows the shared locale while IDs and wiki targets remain canonical', () => {
    const english = inspect('facilityrefinery1', {}, undefined, 'en');
    const french = inspect('facilityrefinery1', {}, undefined, 'fr-CA');
    assert.equal(french.layout?.summary?.title, 'Usine de Matériaux');
    assert.notEqual(french.layout?.summary?.title, english.layout?.summary?.title);
    assert.deepEqual(french.layout?.summary?.link, english.layout?.summary?.link);
    assert.equal(french.layout?.summary?.identifier, '#facilityrefinery1');
    const recipes = (result: ReturnType<typeof inspect>) => result.components.find(component => component.componentId === 'production-order')!.fields[0]!.choices!.options;
    assert.deepEqual(recipes(french).map(option => option.value), recipes(english).map(option => option.value));
    assert.ok(recipes(french).some((option, index) => option.label !== recipes(english)[index]!.label));
    assert.equal(inspect('facilityrefinery1', {}, undefined, 'ja').layout?.summary?.title, english.layout?.summary?.title);
    assert.equal(inspect('facilitypipe', {}, undefined, 'fr').layout?.summary?.title, 'Pipeline');
});

test('published structure color choices declare swatches without changing saved color values', () => {
    let count = 0;
    for (const [assetId, asset] of Object.entries(assets)) {
        const colors = Object.keys(asset.colorVariants);
        if (!colors.length) continue;
        const choices = inspect(assetId).components.find(component => component.componentId === 'appearance')
            ?.fields.find(field => field.path[0] === 'colorHex')?.choices?.options;
        assert.deepEqual(choices?.map(option => [option.value, option.swatch]), colors.map(hex => [hex, `#${hex}`]));
        count += colors.length;
    }
    assert.ok(count > 0);
});
test('swatch labels retain the native neutral and named color vocabulary', () => {
    for (const [hex, name] of [['000000', 'Black'], ['ffffff', 'White'], ['808080', 'Gray'], ['c0c0c0', 'Silver'], ['b04040', 'Red'], ['4080c0', 'Blue'], ['c2a878', 'Tan']]) {
        assert.equal(foxholeColorLabel(hex!), name);
    }
});

test('structures without appearance declare defaults for shared appearance editing', () => {
    const data = { asset: { catalogId: 'foxhole.structures', assetId: 'engineeringcenter' }, modification: { selections: [] },
        cargo: { items: [] }, 'production-order': { orders: [] }, 'socket-attachments': { attachments: [] } };
    const subject = { entityId: 'fixture', revision: 1, components: Object.entries(data).map(([componentId, value]) =>
        ({ ownerId: manifest.id, componentId, version: 1, definitionAvailable: true, data: value })) };
    const request = projectNixieInspectorSubjectV1(subject, manifest.id, provider);
    const result = inspectFoxholeSceneV2Structure(request);
    validateNixieInspectorResultV1(result, provider, manifest.contributes.components!.components, request);
    assert.deepEqual(result.components.find(component => component.componentId === 'appearance')?.initialData, {});
});