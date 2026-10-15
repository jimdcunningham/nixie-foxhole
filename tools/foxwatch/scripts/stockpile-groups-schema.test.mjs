import assert from 'node:assert/strict';
import test from 'node:test';
import { foxholeStockpileGroupSchema } from '../../../packages/foxhole-schema/src/stockpile-groups-schema.ts';

test('grouped storage schema preserves separate native limits, domains and reference indexes', () => {
    const group = { componentName: 'GenericStockpileComponent', stockpileIndex: 0, references: [{ componentName: 'Access', componentType: 'VehicleAccessBox', stockpileIndex: 0, inventoryIndex: 0 }],
        configs: ['Vehicles','Structures','Items'].map((entryType, index) => ({ entryType, listType: 'None', quantityLimit: [10,20,30000][index], totalQuantityLimit: [0,0,30000][index], validEntriesOverride: ['Same'], quantityOverrides: [{Key:'Same',Value:7}], totalQuantityOverrides: [{Key:'Same',Value:11}] })) };
    assert.deepEqual(JSON.parse(JSON.stringify(foxholeStockpileGroupSchema.parse(group))), group);
    assert.equal(foxholeStockpileGroupSchema.parse({...group,configs:[]}).configs.length, 0);
});
