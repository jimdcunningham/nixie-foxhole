import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildFoxholeItemCatalog,
    buildFoxholeStructureCatalog,
} from '../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';

test('tiered structures expose rolled-up totals while preserving direct upgrade costs', () => {
    const catalog = buildFoxholeStructureCatalog(getFoxholeManifest('/foxhole/assets/'));
    const tierOne = catalog.structureByKey.observationbunkert1;
    const tierTwo = catalog.structureByKey.observationbunkert2;
    const tierThree = catalog.structureByKey.observationbunkert3;

    assert.ok(tierOne);
    assert.ok(tierTwo);
    assert.ok(tierThree);
    assert.equal(tierThree.cost.Concrete?.quantity, 10);
    assert.equal(tierThree.totalCost?.Concrete?.quantity, 10);
    assert.equal(tierThree.totalCost?.Cloth?.quantity, 200);
    assert.equal(tierTwo.totalCost?.Cloth?.quantity, 200);
    assert.equal(tierOne.totalCost?.Cloth?.quantity, 75);
});

test('manufactured vehicles use their primary facility recipe inputs as cost', () => {
    const catalog = buildFoxholeStructureCatalog(getFoxholeManifest('/foxhole/assets/'));
    const motorcycle = catalog.assetByKey.motorcycleoffensivec;
    const artilleryTank = catalog.assetByKey.lighttankartilleryw;

    assert.ok(motorcycle);
    assert.equal(motorcycle.cost.FacilityMaterials1?.quantity, 5);
    assert.equal(motorcycle.cost.MotorcycleC?.quantity, 1);
    assert.equal(motorcycle.totalCost?.Cloth, undefined);

    assert.ok(artilleryTank);
    assert.equal(artilleryTank.cost.FacilityMaterials2?.quantity, 3);
    assert.equal(artilleryTank.cost.LightTankW?.quantity, 1);
    assert.equal(artilleryTank.totalCost?.Wood, undefined);
});

test('manufactured item assets expose their primary recipe inputs as cost', () => {
    const catalog = buildFoxholeItemCatalog(getFoxholeManifest('/foxhole/assets/'));
    const aircraftParts = catalog.assetByKey.aircraftpartsmallmechanicalw;

    assert.ok(aircraftParts);
    assert.equal(aircraftParts.cost.FacilityMaterials2?.quantity, 35);
    assert.equal(aircraftParts.cost.FacilityMaterials6?.quantity, 25);
    assert.deepEqual(aircraftParts.totalCost, aircraftParts.cost);
});
