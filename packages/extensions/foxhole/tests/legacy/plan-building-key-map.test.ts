import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LEGACY_PLAN_BUILDING_KEY_MAP,
    resolveLegacyPlanBuildingKey,
} from '../../app/plugins/foxhole/legacy/plan-building-key-map.ts';

test('resolveLegacyPlanBuildingKey maps renamed facility keys via codeName', () => {
    assert.equal(resolveLegacyPlanBuildingKey('pipeline'), 'facilitypipe');
    assert.equal(resolveLegacyPlanBuildingKey('foundation_2x2'), 'foundation012x2t1');
    assert.equal(resolveLegacyPlanBuildingKey('liquid_transfer_station'), 'facilitytransferliquid');
    assert.equal(resolveLegacyPlanBuildingKey('power_line'), 'powerline');
});

test('resolveLegacyPlanBuildingKey maps bunker upgrade composites to upgrade assets', () => {
    assert.equal(resolveLegacyPlanBuildingKey('fortt3_artilleryait3'), 'artilleryait3');
    assert.equal(resolveLegacyPlanBuildingKey('fortt3_mgait3'), 'mgait3');
});

test('resolveLegacyPlanBuildingKey keeps identity keys that already match manifest ids', () => {
    assert.equal(resolveLegacyPlanBuildingKey('fortt3'), 'fortt3');
    assert.equal(resolveLegacyPlanBuildingKey('trenchempt2'), 'trenchempt2');
});

test('resolveLegacyPlanBuildingKey maps resource fields to separate field assets', () => {
    assert.equal(resolveLegacyPlanBuildingKey('resourcefield'), 'salvagefield');
    assert.equal(resolveLegacyPlanBuildingKey('resourcefield_component'), 'componentsfield');
    assert.equal(resolveLegacyPlanBuildingKey('resourcefield_coal'), 'coalfield');
    assert.equal(resolveLegacyPlanBuildingKey('resourcefield_sulfur'), 'sulfurfield');
});

test('resolveLegacyPlanBuildingKey maps shippingcrate and garrisonstation1 overrides', () => {
    assert.equal(resolveLegacyPlanBuildingKey('shippingcrate'), 'structurecrate');
    assert.equal(resolveLegacyPlanBuildingKey('garrisonstation1'), 'garrisonstation');
    assert.equal(resolveLegacyPlanBuildingKey('garrisonbarn1'), 'garrisonbarn2');
    assert.equal(resolveLegacyPlanBuildingKey('garrisonfishhut1'), 'garrisonfishhut2');
    assert.equal(resolveLegacyPlanBuildingKey('garrisonstation2'), 'garrisonstation');
    assert.equal(resolveLegacyPlanBuildingKey('landingdock'), 'shipyard');
});

test('resolveLegacyPlanBuildingKey maps rail gauges to foundation splines', () => {
    assert.equal(resolveLegacyPlanBuildingKey('rail_small_gauge'), 'smallrailtracksplinefoundation');
    assert.equal(resolveLegacyPlanBuildingKey('rail_large_gauge'), 'railtracksplinefoundation');
});

test('building key map includes renamed entries', () => {
    assert.ok(Object.keys(LEGACY_PLAN_BUILDING_KEY_MAP).length > 300);
    assert.notEqual(LEGACY_PLAN_BUILDING_KEY_MAP.pipeline, 'pipeline');
});
