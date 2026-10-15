import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import type { FoxholeManifest, FoxholeManifestConversionEntry } from '../app/plugins/foxhole/nixie/manifest.ts';
import {
    resolveFoxholeConversionParentAsset,
    resolveFoxholeRelationshipSelectionAsset,
} from '../app/plugins/foxhole/nixie/structure-tier-actions.ts';

const manifest = getFoxholeManifest('/foxhole/assets/');

function conversion(input: Record<string, number>, output: Record<string, number>): FoxholeManifestConversionEntry {
    const amounts = (resources: Record<string, number>) => Object.fromEntries(
        Object.entries(resources).map(([key, quantity]) => [key, { quantity, limit: null }]),
    );
    return {
        id: null,
        itemInput: amounts(input),
        itemOutput: amounts(output),
        crateInput: {},
        crateOutput: {},
        liquidInput: {},
        liquidOutput: {},
        duration: null,
        powerDelta: null,
        bConsumeResourceNodes: false,
    };
}

function fixture(entries: FoxholeManifestConversionEntry[]): FoxholeManifest {
    const keys = new Set(['facilityvehiclefactory1', 'motorcyclec', 'motorcycleoffensivec', 'truckc', 'truckmobilityc', 'fortt1']);
    const assets = structuredClone(manifest.assets.filter(asset => keys.has(asset.id))).map(asset => ({
        ...asset,
        cost: {},
        conversionCodeNames: [],
        conversionEntries: asset.id === 'facilityvehiclefactory1' ? entries : [],
        modificationSlots: [],
        upgradeStructureCodeName: null,
        destroyedStructureCodeName: null,
    }));
    return { ...manifest, assets };
}

test('published recipes link the four audited vehicle conversions without duplicate facility products', () => {
    const catalog = buildFoxholeStructureCatalog(manifest);
    for (const [sourceKey, targetKey] of [
        ['motorcyclec', 'motorcycleoffensivec'],
        ['mediumtankc', 'mediumtankoffensivec'],
        ['mediumtankc', 'mediumtanklargec'],
        ['mediumtank2c', 'mediumtank2twinc'],
    ]) {
        const source = catalog.assetByKey[sourceKey]!;
        const target = catalog.assetByKey[targetKey]!;
        assert.equal(source.conversionStructureIds.filter(id => id === targetKey).length, 1);
        assert.equal(source.conversionCodeNames.filter(name => name.toLowerCase() === target.codeName.toLowerCase()).length, 1);
        assert.equal(resolveFoxholeConversionParentAsset(catalog, target), source);
        assert.equal(resolveFoxholeRelationshipSelectionAsset(catalog, source, target), target);
        assert.equal(resolveFoxholeRelationshipSelectionAsset(catalog, target, target), source);
    }
    for (const asset of manifest.assets.filter(entry => !entry.isVehicle && !entry.isItem)) {
        assert.deepEqual(catalog.assetByKey[asset.id]!.conversionCodeNames, asset.conversionCodeNames, asset.id);
    }
    assert.deepEqual(manifest.assets.find(asset => asset.id === 'motorcyclec')!.conversionCodeNames, []);
});

test('recipe duplicates merge with explicit vehicle relationships and preserve their order', () => {
    const entry = conversion({ MotorcycleC: 1, Components: 20 }, { MotorcycleOffensiveC: 1 });
    const input = fixture([entry, { ...entry, id: 1 }]);
    const base = input.assets.find(asset => asset.id === 'motorcyclec')!;
    base.conversionCodeNames = ['TruckMobilityC', 'motorcycleoffensivec', ' MotorcycleOffensiveC '];
    const catalog = buildFoxholeStructureCatalog(input);
    assert.deepEqual(catalog.assetByKey.motorcyclec!.conversionCodeNames, ['TruckMobilityC', 'motorcycleoffensivec']);
    assert.deepEqual(catalog.assetByKey.motorcyclec!.conversionStructureIds, ['truckmobilityc', 'motorcycleoffensivec']);
    assert.deepEqual(base.conversionCodeNames, ['TruckMobilityC', 'motorcycleoffensivec', ' MotorcycleOffensiveC ']);
});

test('vehicle ancestry rejects ambiguous, batch, self-repair, and non-vehicle recipes', () => {
    for (const [label, entry] of [
        ['self-repair', conversion({ MotorcycleC: 1 }, { MotorcycleC: 1 })],
        ['batch input', conversion({ MotorcycleC: 2 }, { MotorcycleOffensiveC: 1 })],
        ['batch output', conversion({ MotorcycleC: 1 }, { MotorcycleOffensiveC: 2 })],
        ['two vehicle inputs', conversion({ MotorcycleC: 1, TruckC: 1 }, { MotorcycleOffensiveC: 1 })],
        ['two vehicle outputs', conversion({ MotorcycleC: 1 }, { MotorcycleOffensiveC: 1, TruckC: 1 })],
        ['non-vehicle input', conversion({ FortT1: 1 }, { MotorcycleOffensiveC: 1 })],
        ['non-vehicle output', conversion({ MotorcycleC: 1 }, { FortT1: 1 })],
        ['manufacture from materials', conversion({ Components: 10 }, { MotorcycleOffensiveC: 1 })],
    ] as const) {
        const catalog = buildFoxholeStructureCatalog(fixture([entry]));
        assert.deepEqual(catalog.assetByKey.motorcyclec!.conversionStructureIds, [], label);
        assert.equal(resolveFoxholeConversionParentAsset(catalog, catalog.assetByKey.motorcycleoffensivec!), null, label);
    }
});

test('destroyed and breached vehicle transformations do not become conversion relationships', () => {
    for (const key of ['motorcyclec', 'motorcycleoffensivec']) {
        for (const flag of ['isDestroyed', 'isBreached'] as const) {
            const input = fixture([conversion({ MotorcycleC: 1 }, { MotorcycleOffensiveC: 1 })]);
            input.assets.find(asset => asset.id === key)![flag] = true;
            assert.deepEqual(buildFoxholeStructureCatalog(input).assetByKey.motorcyclec!.conversionStructureIds, [], `${key}.${flag}`);
        }
    }
    const repair = fixture([conversion({ MotorcycleOffensiveC: 1 }, { MotorcycleC: 1 })]);
    repair.assets.find(asset => asset.id === 'motorcyclec')!.destroyedStructureCodeName = 'MotorcycleOffensiveC';
    assert.deepEqual(buildFoxholeStructureCatalog(repair).assetByKey.motorcycleoffensivec!.conversionStructureIds, []);
});

test('crate vehicle recipes and extra vehicle channels do not imply an individual vehicle conversion', () => {
    const crateOnly = conversion({}, {});
    crateOnly.crateInput = { MotorcycleC: { quantity: 1, limit: null } };
    crateOnly.crateOutput = { MotorcycleOffensiveC: { quantity: 1, limit: null } };
    const mixed = conversion({ MotorcycleC: 1 }, { MotorcycleOffensiveC: 1 });
    mixed.crateInput = { TruckC: { quantity: 1, limit: null } };
    for (const entry of [crateOnly, mixed]) {
        assert.deepEqual(buildFoxholeStructureCatalog(fixture([entry])).assetByKey.motorcyclec!.conversionStructureIds, []);
    }
});

test('competing vehicle parents remain unresolved while explicit relationships remain authoritative', () => {
    const input = fixture([
        conversion({ MotorcycleC: 1 }, { MotorcycleOffensiveC: 1 }),
        conversion({ TruckC: 1 }, { MotorcycleOffensiveC: 1 }),
    ]);
    const catalog = buildFoxholeStructureCatalog(input);
    assert.deepEqual(catalog.assetByKey.motorcyclec!.conversionStructureIds, []);
    assert.deepEqual(catalog.assetByKey.truckc!.conversionStructureIds, []);
    assert.equal(resolveFoxholeConversionParentAsset(catalog, catalog.assetByKey.motorcycleoffensivec!), null);

    input.assets.find(asset => asset.id === 'truckc')!.conversionCodeNames = ['MotorcycleOffensiveC'];
    const explicit = buildFoxholeStructureCatalog(input);
    assert.deepEqual(explicit.assetByKey.motorcyclec!.conversionStructureIds, []);
    assert.deepEqual(explicit.assetByKey.truckc!.conversionStructureIds, ['motorcycleoffensivec']);
});
