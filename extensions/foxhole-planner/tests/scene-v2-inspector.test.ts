import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseNixieExtensionManifestV1 } from '@nixie/extension-sdk';
import { projectNixieExperimentalInspectorSubjectV1, validateNixieExperimentalInspectorResultV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { inspectFoxholeSceneV2Structure, inspectFoxholeSceneV2SplineConnector } from '../src/scene-v2-inspector.ts';
import { listFoxholeSceneV2Products } from '../src/scene-v2-products.ts';
import assets from '#foxhole-scene-v2-assets';

const manifest = parseNixieExtensionManifestV1(JSON.parse(await readFile(new URL('../nixie.extension.json', import.meta.url), 'utf8')));
const provider = manifest.contributes.experimentalInspectorProviders![0]!;
function inspect(assetId: string, overrides: Record<string, Record<string, unknown>> = {}) {
    const data = { 'asset': { catalogId: 'foxhole.structures', assetId }, 'appearance': {}, 'modification': { selections: [] },
        'cargo': { items: [] }, 'production-order': { orders: [] }, 'socket-attachments': { attachments: [] }, ...overrides };
    const subject = { entityId: 'fixture', revision: 1, components: Object.entries(data).map(([componentId, value]) => ({
        ownerId: manifest.id, componentId, version: 1, definitionAvailable: true, data: value,
    })) };
    const request = projectNixieExperimentalInspectorSubjectV1(subject as Parameters<typeof projectNixieExperimentalInspectorSubjectV1>[0], manifest.id, provider);
    const result = inspectFoxholeSceneV2Structure(request);
    validateNixieExperimentalInspectorResultV1(result, provider, manifest.contributes.experimentalComponents!.components, request);
    return result;
}

test('all published assets return bounded Inspector choices validated against their real schemas', () => {
    for (const assetId of Object.keys(assets)) {
        assert.doesNotThrow(() => inspect(assetId), assetId);
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
                assert.ok(includes(choices(infraId, 'kitchen'), wallId, 'door'));
            }
        }
    }
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
    assert.match(field.description!, /30,000/u);
    assert.match(field.description!, /32,500/u);
    assert.ok(!field.description!.includes('95,000'));
    assert.ok(field.choices!.options.some(option => option.label.includes('Scrap Hauler')));
});

test('modification choices are paired and unique per slot; recipes follow selected variants', () => {
    const before = inspect('facilityfactoryammo');
    const modifications = before.components.find(component => component.componentId === 'modification')!.fields[0]!.choices!;
    assert.deepEqual(modifications.uniqueBy, ['slotId']);
    const upgrade = modifications.options.find(option => typeof option.value === 'object' && option.value !== null
        && option.value.variantId === 'tripodfactory')!;
    assert.ok(upgrade);
    const after = inspect('facilityfactoryammo', { modification: { selections: [upgrade.value] } });
    const recipes = after.components.find(component => component.componentId === 'production-order')!.fields[0]!.choices!;
    assert.ok(recipes.options.some(option => typeof option.value === 'object' && option.value !== null
        && typeof option.value.recipeId === 'string' && option.value.recipeId.includes(':tripodfactory:')));
    assert.ok(recipes.options.some(option => typeof option.value === 'object' && option.value !== null && option.value.parent === true));
});

test('appearance offers only published variants and atomic valid state combinations', () => {
    const result = inspect('engineeringcenter');
    const fields = result.components.find(component => component.componentId === 'appearance')!.fields;
    assert.deepEqual(fields.find(field => field.path[0] === 'faction')!.choices!.options.map(option => option.label), ['Colonial', 'Warden']);
    const root = fields.find(field => field.path.length === 0)!;
    assert.deepEqual(root.choices!.valuePropertyIds, ['destroyed', 'packaged', 'blueprint']);
    for (const option of root.choices!.options) {
        const value = option.value as Record<string, unknown>;
        assert.equal(value.packaged === true && (value.destroyed === true || value.blueprint === true), false);
    }
});

test('catalog and standalone spline stencils expose only applicable authoring controls without changing geometry', () => {
    const connectorProvider = manifest.contributes.experimentalInspectorProviders!.find(entry => entry.id === 'spline-connector')!;
    const products = [];
    for (let offset = 0; offset < Object.keys(assets).length; offset += 100) {
        products.push(...listFoxholeSceneV2Products({ contractVersion: 1, query: '', offset, limit: 100 }).items.map(item => item.product));
    }
    products.push(...manifest.contributes.experimentalProducts!.filter(product => product.components.some(component => component.componentId === 'spline-connector')));
    let count = 0;
    for (const product of products) {
        const spline = product.components.find(component => component.componentId === 'spline-connector');
        if (!spline) {
            continue;
        }
        count++;
        const subject = { entityId: product.id, revision: 1, components: product.components.map(component => ({ ...component, definitionAvailable: true })) };
        const request = projectNixieExperimentalInspectorSubjectV1(subject, manifest.id, connectorProvider);
        const before = structuredClone(request);
        const result = inspectFoxholeSceneV2SplineConnector(request);
        validateNixieExperimentalInspectorResultV1(result, connectorProvider, manifest.contributes.experimentalComponents!.components, request);
        assert.deepEqual(request, before);
        const visible = result.components[0]!.fields.filter(field => !field.hidden).map(field => field.path[0]);
        assert.ok(!visible.includes('minLength') && !visible.includes('startAttachmentNodeId'));
        if (spline.data.foxholeKey === 'facilitypipe') {
            assert.ok(visible.includes('curveT') && visible.includes('tint'));
        } else if (spline.data.foxholeKey === 'powerline') {
            assert.deepEqual(visible, []);
        }
    }
    assert.ok(count > 20);
});

test('an unavailable connector retains authored geometry and identity for inspection', () => {
    const connectorProvider = manifest.contributes.experimentalInspectorProviders!.find(entry => entry.id === 'spline-connector')!;
    const product = manifest.contributes.experimentalProducts!.find(entry => entry.components.some(component => component.componentId === 'spline-connector'))!;
    const components = structuredClone(product.components).map(component => ({ ...component, definitionAvailable: true }));
    components.find(component => component.componentId === 'spline-connector')!.data.foxholeKey = 'unavailable-connector';
    const request = projectNixieExperimentalInspectorSubjectV1({ entityId: 'missing', revision: 1, components }, manifest.id, connectorProvider);
    const before = structuredClone(request);
    const result = inspectFoxholeSceneV2SplineConnector(request);
    validateNixieExperimentalInspectorResultV1(result, connectorProvider, manifest.contributes.experimentalComponents!.components, request);
    assert.deepEqual(request, before);
    assert.equal(result.components[0]!.fields.find(field => field.path[0] === 'foxholeKey')!.readOnly, true);
    assert.equal(result.components[0]!.fields.find(field => field.path[0] === 'foxholeKey')!.hidden, false);
});
