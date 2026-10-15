import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LegacyPlanCargoMapper,
    LegacyPlanFacilityUpgradeResolver,
    LegacyPlanImporter,
    LegacyPlanSocketMapper,
    resolveLegacyPlanOrientationOffsetDeg,
    resolveLegacyPlanSocketId,
    resolveLegacyPlanSocketName,
} from '../../app/plugins/foxhole/legacy/index.ts';
import {
    buildFoxholeItemCatalog,
    buildFoxholeStructureCatalog,
} from '../../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeManifest } from '../../app/plugins/foxhole/nixie/manifest.ts';
import { FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE } from '../../app/plugins/foxhole/nixie/spline-connector.ts';
import type { LegacyPlanSave } from '../../app/plugins/foxhole/legacy/plan-types.ts';

const BASE_ASSETS_URL = '/foxhole/assets/';
const manifest = getFoxholeManifest(BASE_ASSETS_URL);
const structureCatalog = buildFoxholeStructureCatalog(manifest);
const itemCatalog = buildFoxholeItemCatalog(manifest);

test('resolveLegacyPlanSocketName maps plain fort legacy ids clockwise from left', () => {
    for (const foxholeKey of ['fortt1', 'fortt2', 'fortt3', 'fortbuildsite']) {
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 0), 'LeftFortSocket');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 1), 'FrontFortSocket');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 2), 'RightFortSocket');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 3), 'BackFortSocket');
    }
});

test('resolveLegacyPlanSocketId reverses plain fort mappings for debug labels', () => {
    for (const foxholeKey of ['fortt1', 'fortt2', 'fortt3', 'fortbuildsite']) {
        assert.equal(resolveLegacyPlanSocketId(foxholeKey, 'LeftFortSocket'), '0');
        assert.equal(resolveLegacyPlanSocketId(foxholeKey, 'FrontFortSocket'), '1');
        assert.equal(resolveLegacyPlanSocketId(foxholeKey, 'RightFortSocket'), '2');
        assert.equal(resolveLegacyPlanSocketId(foxholeKey, 'BackFortSocket'), '3');
    }
    assert.equal(resolveLegacyPlanSocketId('fortt1', 'MissingSocket'), null);
});

test('resolveLegacyPlanSocketName maps Tier 3 rifle, engine, and observation bunkers like plain forts', () => {
    for (const foxholeKey of [
        'rifleait3',
        'fortt3_rifleait3',
        'engineroomt3',
        'fortt3_engineroomt3',
        'observationbunkert3',
        'fortt3_observationbunkert3',
    ]) {
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 0), 'LeftFortSocket');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 1), 'FrontFortSocket');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 2), 'RightFortSocket');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 3), 'BackFortSocket');
    }
});

test('resolveLegacyPlanSocketName maps confirmed bunker rooms and garrisons like plain forts', () => {
    for (const foxholeKey of [
        'fortt1_fortfirepitt1',
        'fortt1_medicalroomt1',
        'fortt1_observationbunkert1',
        'fortt1_rifleait1',
        'fortt2_ammoroomt2',
        'fortt2_engineroomt2',
        'fortt2_fortartillerysheltert2',
        'fortt2_fortfirepitt2',
        'fortt2_fortflamet2',
        'fortt2_medicalroomt2',
        'fortt2_observationbunkert2',
        'fortt2_rifleait2',
        'fortt3_ammoroomt3',
        'fortt3_fortartillerysheltert3',
        'fortt3_fortfirepitt3',
        'fortt3_fortflamet3',
        'fortt3_medicalroomt3',
    ]) {
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 0), 'LeftFortSocket');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 1), 'FrontFortSocket');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 2), 'RightFortSocket');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 3), 'BackFortSocket');
    }
});

test('resolveLegacyPlanSocketName maps ramps in their rotated legacy frame', () => {
    for (const foxholeKey of [
        'fortt1_fortrampt1',
        'fortrampt1',
        'fortt2_fortrampt2',
        'fortrampt2',
        'fortt3_fortrampt3',
        'fortrampt3',
    ]) {
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 0), 'BackFortSocket');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 1), 'LeftFortSocket');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 2), 'FrontFortSocket');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 3), 'RightFortSocket');
    }
});

test('resolveLegacyPlanSocketName maps MG garrisons in their rotated legacy frame', () => {
    for (const foxholeKey of [
        'fortt1_mgait1',
        'mgait1',
        'fortt2_mgait2',
        'mgait2',
        'fortt3_mgait3',
        'mgait3',
    ]) {
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 0), 'BackFortSocket');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 1), 'LeftFortSocket');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 2), 'FrontFortSocket');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 3), 'RightFortSocket');
    }
});

test('resolveLegacyPlanSocketName maps artillery garrison inward socket after orientation', () => {
    // Artillery garrisons render with a +90° orientation correction. Their
    // legacy socket 2 must therefore resolve to the inward-facing Front socket.
    assert.equal(resolveLegacyPlanSocketName('artilleryait3', 2), 'FrontFortSocket');
    assert.equal(resolveLegacyPlanSocketName('fortt3_artilleryait3', 2), 'FrontFortSocket');
});

test('resolveLegacyPlanSocketName maps AT garrison inward sockets after orientation', () => {
    // AT and artillery garrisons share the same legacy socket frame and +90°
    // sprite correction, so they must use the same clockwise remap.
    assert.equal(resolveLegacyPlanSocketName('atgunait3', 0), 'BackFortSocket');
    assert.equal(resolveLegacyPlanSocketName('atgunait3', 1), 'LeftFortSocket');
    assert.equal(resolveLegacyPlanSocketName('fortt3_atgunait3', 0), 'BackFortSocket');
    assert.equal(resolveLegacyPlanSocketName('fortt3_atgunait3', 1), 'LeftFortSocket');
});

test('resolveLegacyPlanSocketName maps foundation cardinals by board position', () => {
    // Legacy left/right edges are board ±X; Nixie names those Back/Front.
    assert.equal(resolveLegacyPlanSocketName('foundation01t1', 0), 'BackSocket');
    assert.equal(resolveLegacyPlanSocketName('foundation01t1', 1), 'LeftSocket');
    assert.equal(resolveLegacyPlanSocketName('foundation01t1', 2), 'FrontSocket');
    assert.equal(resolveLegacyPlanSocketName('foundation01t1', 3), 'RightSocket');
});

test('orientation map leaves forts/splines at 0 and offsets rotated facilities', () => {
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('fortt1'), 0);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('facilitypipe'), 0);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('mgpillbox'), 90);
    assert.equal(resolveLegacyPlanOrientationOffsetDeg('facilitymodificationcenter'), 90);
});

test('resolveLegacyPlanSocketName maps pipe and powerline sockets', () => {
    assert.equal(resolveLegacyPlanSocketName('facilitypipe', 0), 'BackSocket');
    assert.equal(resolveLegacyPlanSocketName('facilitypipe', 2), 'FrontSocket');
    assert.equal(resolveLegacyPlanSocketName('powerline', 0), 'BackSocket');
    assert.equal(resolveLegacyPlanSocketName('powerline', 1), 'FrontSocket');
});

test('resolveLegacyPlanSocketName maps the confirmed Power Box socket', () => {
    assert.equal(resolveLegacyPlanSocketName('power_box', 0), 'PowerSocket');
    assert.equal(resolveLegacyPlanSocketName('powerbox', 0), 'PowerSocket');
});

test('facility upgrade resolver maps materials_factory_forge to parent + mod', () => {
    const resolver = new LegacyPlanFacilityUpgradeResolver(structureCatalog);
    const resolved = resolver.resolve('materials_factory_forge');
    assert.ok(resolved);
    assert.equal(resolved.kind, 'structure+mod');
    assert.equal(resolved.foxholeKey, 'facilityrefinery1');
    assert.equal(resolved.modificationVariantIds.UpgradeSlotComponent, 'forge');
});

test('facility upgrade resolver maps tank_factory via upgrade codeName', () => {
    const resolver = new LegacyPlanFacilityUpgradeResolver(structureCatalog);
    const resolved = resolver.resolve('light_vehicle_assembly_station_tank_factory');
    assert.ok(resolved);
    assert.equal(resolved.kind, 'structure+mod');
    assert.equal(resolved.foxholeKey, 'facilityvehiclefactory1');
    assert.equal(resolved.modificationVariantIds.UpgradeSlotComponent, 'tankassembly');
});

test('facility upgrade resolver maps petrol_power via upgrade codeName', () => {
    const resolver = new LegacyPlanFacilityUpgradeResolver(structureCatalog);
    const resolved = resolver.resolve('diesel_power_plant_petrol_power');
    assert.ok(resolved);
    assert.equal(resolved.foxholeKey, 'facilitypowerdiesel');
    assert.equal(resolved.modificationVariantIds.UpgradeSlotComponent, 'petrol');
});

test('mapModslots remaps legacy bridge slot to BridgeModSlot', () => {
    const resolver = new LegacyPlanFacilityUpgradeResolver(structureCatalog);
    const mapped = resolver.mapModslots('trencht3', { bridge: 'bridge' });
    assert.deepEqual(mapped.unmatchedSlots, []);
    assert.equal(mapped.modificationVariantIds.BridgeModSlot, 'bridge');
});

test('mapModslots ignores legacy under/pipes bunker gear-power overlay', () => {
    const resolver = new LegacyPlanFacilityUpgradeResolver(structureCatalog);
    const mapped = resolver.mapModslots('trencht3', { under: 'pipes', bridge: 'bridge' });
    assert.deepEqual(mapped.unmatchedSlots, []);
    assert.equal(mapped.modificationVariantIds.BridgeModSlot, 'bridge');
    assert.equal(mapped.modificationVariantIds.under, undefined);
});

test('resolveLegacyPlanSocketName maps water_pump_electric_water upgrade socket', () => {
    assert.equal(
        resolveLegacyPlanSocketName('water_pump_electric_water', 0, {
            legacyKey: 'water_pump_electric_water',
            foxholeKey: 'facilityminewater',
        }),
        'PipeOutput0',
    );
    // Historical plans connect a power line to this undocumented upgrade socket.
    // The current asset exposes the equivalent base PowerSocket.
    assert.equal(
        resolveLegacyPlanSocketName('water_pump_electric_water', 1, {
            legacyKey: 'water_pump_electric_water',
            foxholeKey: 'facilityminewater',
        }),
        'PowerSocket',
    );
    assert.equal(
        resolveLegacyPlanSocketName('diesel_power_plant', 0, {
            legacyKey: 'diesel_power_plant',
            foxholeKey: 'facilitypowerdiesel',
        }),
        'PipeInput0',
    );
    assert.equal(
        resolveLegacyPlanSocketName('liquid_transfer_station', 1, {
            legacyKey: 'liquid_transfer_station',
            foxholeKey: 'facilitytransferliquid',
        }),
        'PipeOutput0',
    );
});

test('importer applies facility orientation offset to board snapshot rotation', async () => {
    const save = {
        version: '1.0.5',
        name: 'Orientation',
        entities: [
            {
                id: 1,
                key: 'mgpillbox',
                x: 0,
                y: 0,
                rotation: 0,
            },
        ],
    };
    const importer = new LegacyPlanImporter({ structureCatalog, itemCatalog });
    const result = await importer.importSave(save);
    const snapshot = result.boardSnapshots[0];
    assert.ok(snapshot);
    assert.equal(snapshot.state.foxholeKey, 'mgpillbox');
    assert.ok(Math.abs(Number(snapshot.state.rotation) - (Math.PI / 2)) < 1e-9);
    assert.equal(result.stubDocument.nodes[0]?.rotationDeg, 90);
});

test('importer rotates legacy image-origin corrections and leaves fixed footprints in place', async () => {
    const save: LegacyPlanSave = {
        version: '1.0.5',
        name: 'Structure origins',
        entities: [
            { id: 1, key: 'ammunition_factory', x: 100, y: 200, rotation: 90 },
            { id: 2, key: 'aircraftbomberc', x: 100, y: 200, rotation: 0 },
            { id: 3, key: 'fortt1', x: 100, y: 200, rotation: 90 },
            { id: 4, key: 'aircraftbomberc', x: 100, y: 200, rotation: 0, packaged: true },
        ],
    };
    const result = await new LegacyPlanImporter({ structureCatalog, itemCatalog }).importSave(save);
    const byId = new Map(result.boardSnapshots.map(snapshot => [snapshot.id, snapshot]));
    assert.ok(Math.abs(Number(byId.get('legacy-1')?.state.x) - 60) < 1e-9);
    assert.ok(Math.abs(Number(byId.get('legacy-1')?.state.y) - 180) < 1e-9);
    assert.equal(byId.get('legacy-2')?.state.x, 232);
    assert.equal(byId.get('legacy-2')?.state.y, 196);
    assert.equal(byId.get('legacy-3')?.state.x, 100);
    assert.equal(byId.get('legacy-3')?.state.y, 200);
    assert.equal(byId.get('legacy-4')?.state.x, 100);
    assert.equal(byId.get('legacy-4')?.state.y, 200);
});

test('importer aligns base and upgraded oil refineries from legacy plans', async () => {
    const save: LegacyPlanSave = {
        version: '1.0.5',
        entities: [
            { id: 1, key: 'oil_refinery', x: 0, y: 0, rotation: 0 },
            { id: 2, key: 'oil_refinery_cracking_unit', x: 128, y: 0, rotation: 0 },
            { id: 3, key: 'oil_refinery_petro_plant', x: 256, y: 0, rotation: 0 },
            { id: 4, key: 'oil_refinery_reformer', x: 384, y: 0, rotation: 0 },
            { id: 5, key: 'oil_refinery_reformer', x: 512, y: 0, rotation: 90 },
        ],
    };
    const result = await new LegacyPlanImporter({ structureCatalog, itemCatalog }).importSave(save);
    const byId = new Map(result.boardSnapshots.map(snapshot => [snapshot.id, snapshot]));

    assert.deepEqual([byId.get('legacy-1')?.state.x, byId.get('legacy-1')?.state.y], [11, 8]);
    assert.deepEqual([byId.get('legacy-2')?.state.x, byId.get('legacy-2')?.state.y], [139, 8]);
    assert.deepEqual([byId.get('legacy-3')?.state.x, byId.get('legacy-3')?.state.y], [267, 8]);
    assert.deepEqual([byId.get('legacy-4')?.state.x, byId.get('legacy-4')?.state.y], [395, -15]);
    assert.ok(Math.abs(Number(byId.get('legacy-5')?.state.x) - 527) < 1e-9);
    assert.ok(Math.abs(Number(byId.get('legacy-5')?.state.y) - 11) < 1e-9);
});

test('importer aligns base and upgraded coal refineries from legacy plans', async () => {
    const save: LegacyPlanSave = {
        version: '1.0.5',
        entities: [
            { id: 1, key: 'coal_refinery', x: 0, y: 0, rotation: 0 },
            { id: 2, key: 'coal_refinery_coke_furnace', x: 128, y: 0, rotation: 0 },
            { id: 3, key: 'coal_refinery_liquifier', x: 256, y: 0, rotation: 0 },
            { id: 4, key: 'coal_refinery_adv_liquifier', x: 384, y: 0, rotation: 0 },
            { id: 5, key: 'coal_refinery_liquifier', x: 512, y: 0, rotation: 90 },
        ],
    };
    const result = await new LegacyPlanImporter({ structureCatalog, itemCatalog }).importSave(save);
    const byId = new Map(result.boardSnapshots.map(snapshot => [snapshot.id, snapshot]));

    assert.deepEqual([byId.get('legacy-1')?.state.x, byId.get('legacy-1')?.state.y], [-9, -1]);
    assert.deepEqual([byId.get('legacy-2')?.state.x, byId.get('legacy-2')?.state.y], [125, -1]);
    assert.deepEqual([byId.get('legacy-3')?.state.x, byId.get('legacy-3')?.state.y], [231, -1]);
    assert.deepEqual([byId.get('legacy-4')?.state.x, byId.get('legacy-4')?.state.y], [359, -1]);
    assert.ok(Math.abs(Number(byId.get('legacy-5')?.state.x) - 513) < 1e-9);
    assert.ok(Math.abs(Number(byId.get('legacy-5')?.state.y) + 25) < 1e-9);
});

test('importer maps description, authors→credits, and tags onto the stub document', async () => {
    const save: LegacyPlanSave = {
        version: '1.0.5',
        name: 'Identity',
        description: 'Frontline bunker line',
        authors: 'Antoine & elpargo',
        tags: ['Bunker', 'hand'],
        entities: [],
    };
    const importer = new LegacyPlanImporter({ structureCatalog, itemCatalog });
    const result = await importer.importSave(save);
    assert.equal(result.stubDocument.description, 'Frontline bunker line');
    assert.equal(result.stubDocument.credits, 'Antoine & elpargo');
    assert.equal(result.stubDocument.tags, 'Bunker\nhand');
});

test('importer maps legacy map context onto the stub document', async () => {
    const save: LegacyPlanSave = {
        version: '1.0.5',
        name: 'Map Context',
        projectSettings: {
            shardId: 'live-2',
            regionKeys: ['DeadLands'],
            showWorldRegion: true,
        },
        entities: [],
    };
    const importer = new LegacyPlanImporter({ structureCatalog, itemCatalog });
    const result = await importer.importSave(save);
    assert.deepEqual(result.stubDocument.projectSettings, {
        'foxhole.map.enabled': true,
        'foxhole.map.shardId': 'live-2',
        'foxhole.map.regionKeys': 'DeadLands',
    });
});

test('cargo mapper remaps stockpile item keys to markedItemCodenames', () => {
    const mapper = new LegacyPlanCargoMapper(structureCatalog, itemCatalog);
    const result = mapper.mapEntityCargo({
        foxholeKey: 'facilitytransferresource',
        stockpileItems: ['metal', 'sulfur', 'not_a_real_item'],
    });
    assert.ok(result.markedItemCodenames.includes('Metal'));
    assert.ok(result.markedItemCodenames.includes('Sulfur'));
    assert.deepEqual(result.unresolvedItemKeys, ['not_a_real_item']);
    assert.deepEqual(result.consumedFields, ['stockpileItems']);
});

test('resolveLegacyPlanSocketName maps 1x2 foundation perimeter sockets clockwise', () => {
    for (const foxholeKey of [
        'foundation_1x2',
        'foundation011x2t1',
        'foundation_1x2_foundation011x2t3',
        'foundation011x2t3',
    ]) {
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 0), 'RightSocket1');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 1), 'BackSocket');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 2), 'LeftSocket0');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 3), 'LeftSocket1');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 4), 'FrontSocket');
        assert.equal(resolveLegacyPlanSocketName(foxholeKey, 5), 'RightSocket0');
    }
});

test('cargo mapper ignores the legacy excavation construction-state key', () => {
    const mapper = new LegacyPlanCargoMapper(structureCatalog, itemCatalog);
    const result = mapper.mapEntityCargo({
        foxholeKey: 'facilitytransferresource',
        stockpileItems: ['excavation', 'coal'],
    });
    assert.deepEqual(result.markedItemCodenames, ['Coal']);
    assert.deepEqual(result.unresolvedItemKeys, []);
});

test('importer silently drops legacy missing-asset points but retains other point findings', async () => {
    const save: LegacyPlanSave = {
        version: '1.0.5',
        name: 'Missing asset point',
        entities: [
            { id: 1, type: 'point', key: 'pipematerials', x: 40, y: 20 },
            { id: 2, type: 'point', key: 'unknown-marker', x: 80, y: 20 },
        ],
    };
    const importer = new LegacyPlanImporter({ structureCatalog, itemCatalog });
    const result = await importer.importSave(save);

    assert.deepEqual(result.boardSnapshots, []);
    assert.deepEqual(result.report.skippedEntityTypes, { point: 1 });
});

test('importer maps legacy tank mines to the placeable defense asset', async () => {
    const save: LegacyPlanSave = {
        version: '1.0.5',
        name: 'Tank mine',
        entities: [
            { id: 1, key: 'tankmine', x: 40, y: 20 },
        ],
    };
    const importer = new LegacyPlanImporter({ structureCatalog, itemCatalog });
    const result = await importer.importSave(save);

    assert.equal(result.boardSnapshots.length, 1);
    assert.equal(result.boardSnapshots[0]?.state.foxholeKey, 'tankmine');
    assert.deepEqual(result.report.unresolvedBuildingKeys, []);
});

test('importer maps legacy world roads to the Great March road asset', async () => {
    const save: LegacyPlanSave = {
        version: '1.0.5',
        name: 'World road',
        entities: [
            { id: 1, key: 'worldroad', x: 40, y: 20 },
        ],
    };
    const importer = new LegacyPlanImporter({ structureCatalog, itemCatalog });
    const result = await importer.importSave(save);

    assert.equal(structureCatalog.assetByKey.greatmarchroad?.name, 'Great March Cobble Road');
    assert.equal(result.boardSnapshots[0]?.state.foxholeKey, 'greatmarchroad');
    assert.deepEqual(result.report.unresolvedBuildingKeys, []);
});

test('importer maps legacy road upgrade keys to individual road assets', async () => {
    const save: LegacyPlanSave = {
        version: '1.0.5',
        name: 'Road upgrades',
        entities: [
            { id: 1, key: 'world_road', x: 0, y: 0, connections: { 0: { 2: 1 } } },
            { id: 2, key: 'world_road_packed_dirt', x: 10, y: 0, connections: { 1: { 1: 0 } } },
            { id: 3, key: 'world_road_gravel', x: 20, y: 0 },
            { id: 4, key: 'world_road_great_march', x: 30, y: 0 },
        ],
    };
    const importer = new LegacyPlanImporter({ structureCatalog, itemCatalog });
    const result = await importer.importSave(save);

    assert.deepEqual(
        result.boardSnapshots.map(snapshot => snapshot.state.foxholeKey),
        ['dirtroad', 'packeddirtroad', 'gravelroad', 'greatmarchroad'],
    );
    assert.deepEqual(result.report.unresolvedBuildingKeys, []);
    assert.deepEqual(result.report.unresolvedSockets ?? [], []);
});

test('importer maps legacy trees to the FirBunch01 catalog asset', async () => {
    const save: LegacyPlanSave = {
        version: '1.0.5',
        name: 'Tree',
        entities: [
            { id: 1, key: 'tree', x: 40, y: 20 },
        ],
    };
    const importer = new LegacyPlanImporter({ structureCatalog, itemCatalog });
    const result = await importer.importSave(save);

    assert.equal(structureCatalog.assetByKey.tree?.name, 'Tree');
    assert.equal(result.boardSnapshots[0]?.state.foxholeKey, 'tree');
    assert.deepEqual(result.report.unresolvedBuildingKeys, []);
});

test('importer maps legacy faction players to their assembled catalog assets', async () => {
    const save: LegacyPlanSave = {
        version: '1.0.5',
        name: 'Players',
        entities: [
            { id: 1, key: 'playerc', x: 40, y: 20 },
            { id: 2, key: 'playerw', x: 60, y: 20 },
        ],
    };
    const importer = new LegacyPlanImporter({ structureCatalog, itemCatalog });
    const result = await importer.importSave(save);

    assert.equal(result.boardSnapshots[0]?.state.foxholeKey, 'playerc');
    assert.equal(result.boardSnapshots[1]?.state.foxholeKey, 'playerw');
    assert.deepEqual(result.report.unresolvedBuildingKeys, []);
});

test('socket mapper builds reciprocal named attachments', () => {
    const mapper = new LegacyPlanSocketMapper();
    const { links, findings } = mapper.mapConnections({
        entities: [
            {
                legacyId: 1,
                foxholeKey: 'fortt1',
                connections: { 0: { 2: 2 } },
            },
            {
                legacyId: 2,
                foxholeKey: 'fortt1',
                connections: { 2: { 1: 0 } },
            },
        ],
    });
    assert.equal(findings.length, 0);
    assert.equal(links.length, 1);
    assert.equal(links[0]?.fromSocketName, 'LeftFortSocket');
    assert.equal(links[0]?.toSocketName, 'RightFortSocket');

    const maps = mapper.buildAttachmentMaps({
        links,
        nodeIdByLegacyId: new Map([
            [1, 'legacy-1'],
            [2, 'legacy-2'],
        ]),
    });
    assert.deepEqual(maps.get(1)?.LeftFortSocket, {
        nodeId: 'legacy-2',
        socketName: 'RightFortSocket',
    });
    assert.deepEqual(maps.get(2)?.RightFortSocket, {
        nodeId: 'legacy-1',
        socketName: 'LeftFortSocket',
    });
});

test('synthetic import emits sockets, spline, facility mod, and cargo snapshots', async () => {
    const save: LegacyPlanSave = {
        version: '1.0.5',
        name: 'Synthetic Import',
        layers: [{ id: 0, name: 'Base', visible: true, locked: false, zIndex: 0 }],
        entities: [
            {
                id: 1,
                key: 'fortt1',
                x: 100,
                y: 200,
                rotation: 0,
                connections: {
                    0: { 2: 2 },
                },
                inventoryItems: ['mgammo'],
            },
            {
                id: 2,
                key: 'fortt1',
                x: 100,
                y: 40,
                rotation: 0,
                connections: {
                    2: { 1: 0 },
                },
                modslots: {
                    under: 'pipes',
                },
            },
            {
                id: 3,
                key: 'pipeline',
                x: 150,
                y: 250,
                rotation: 0,
                bezier: [
                    { x: 0, y: 0, rotation: 180 },
                    { x: 120, y: 0, rotation: 0 },
                ],
            },
            {
                id: 4,
                key: 'materials_factory_forge',
                x: 400,
                y: 400,
                rotation: 45,
                blueprint: true,
            },
            {
                id: 5,
                key: 'resource_transfer_station',
                x: 500,
                y: 500,
                rotation: 0,
                stockpileItems: ['coal', 'metal'],
            },
            {
                id: 6,
                key: 'materials_factory',
                x: 600,
                y: 600,
                rotation: 0,
                packaged: true,
                blueprint: true,
            },
            {
                id: 7,
                key: 'foundation_1x1',
                x: 700,
                y: 700,
                rotation: 0,
                tint: '#D0021B',
                brightness: 0.75,
            },
        ],
    };

    const importer = new LegacyPlanImporter({
        structureCatalog,
        itemCatalog,
        fixtureName: 'synthetic',
    });
    const result = await importer.importSave(save);

    assert.equal(result.boardSnapshots.length, 7);
    assert.equal(result.report.unresolvedBuildingKeys.length, 0);

    const fortA = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-1');
    const fortB = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-2');
    assert.ok(fortA);
    assert.ok(fortB);
    assert.deepEqual(fortA.state.socketAttachments?.LeftFortSocket, {
        nodeId: 'legacy-2',
        socketName: 'RightFortSocket',
    });
    assert.deepEqual(fortB.state.socketAttachments?.RightFortSocket, {
        nodeId: 'legacy-1',
        socketName: 'LeftFortSocket',
    });
    assert.ok((fortA.state.markedItemCodenames as string[] | undefined)?.includes('MGAmmo'));

    const pipe = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-3');
    assert.ok(pipe);
    assert.equal(pipe.type, FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE);
    assert.equal(pipe.state.foxholeKey, 'facilitypipe');
    assert.equal(pipe.state.start?.x, 0);
    assert.equal(pipe.state.end?.x, 120);
    // Start flips into Nixie into-span (180° → 0). Ground-pipe ends stay socket-facing
    // (legacy 0° → into-span π → stored socket-facing 0).
    assert.ok(Math.abs(Number(pipe.state.start?.rotation)) < 1e-9);
    assert.ok(Math.abs(Number(pipe.state.end?.rotation)) < 1e-9);

    const forge = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-4');
    assert.ok(forge);
    assert.equal(forge.state.foxholeKey, 'facilityrefinery1');
    assert.equal(forge.state.modificationVariantIds?.UpgradeSlotComponent, 'forge');
    assert.equal(forge.state.blueprint, true);
    const forgeOffsetDeg = resolveLegacyPlanOrientationOffsetDeg('facilityrefinery1');
    assert.ok(Math.abs(Number(forge.state.rotation) - ((45 + forgeOffsetDeg) * Math.PI / 180)) < 1e-9);

    const transfer = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-5');
    assert.ok(transfer);
    assert.equal(transfer.state.foxholeKey, 'facilitytransferresource');
    assert.deepEqual(
        [...(transfer.state.markedItemCodenames as string[])].sort(),
        ['Coal', 'Metal'],
    );

    const packaged = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-6');
    assert.ok(packaged);
    assert.equal(packaged.state.foxholeKey, 'facilityrefinery1');
    assert.equal(packaged.state.packaged, true);
    assert.equal(packaged.state.blueprint, false);

    const tinted = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-7');
    assert.ok(tinted);
    assert.equal(tinted.state.tint, 0xD0021B);
    assert.equal(tinted.state.brightness, 0.75);

    const unmappedFields = new Set(result.report.toJSON().unmappedEntityFields.map(entry => entry.field));
    assert.equal(unmappedFields.has('connections'), false);
    assert.equal(unmappedFields.has('bezier'), false);
    assert.equal(unmappedFields.has('stockpileItems'), false);
    assert.equal(unmappedFields.has('inventoryItems'), false);
    assert.equal(unmappedFields.has('modslots'), false);
    assert.equal(unmappedFields.has('packaged'), false);
    assert.equal(unmappedFields.has('tint'), false);
    assert.equal(unmappedFields.has('brightness'), false);
});

test('importer flips legacy rail bezier rotations into Nixie tangents', async () => {
    const save: LegacyPlanSave = {
        version: '1.0.5',
        entities: [
            {
                id: 0,
                key: 'rail_small_gauge',
                x: -96,
                y: -96,
                rotation: 0,
                layer: 0,
                sortOffset: 0,
                bezier: [
                    { x: 0, y: 0, rotation: 180 },
                    { x: 288, y: 176, rotation: 180 },
                ],
            },
        ],
    };

    const importer = new LegacyPlanImporter({
        structureCatalog,
        itemCatalog,
        fixtureName: 'rail-bezier-rotation',
    });
    const result = await importer.importSave(save);
    const rail = result.boardSnapshots[0];

    assert.ok(rail);
    assert.equal(rail.type, FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE);
    assert.equal(rail.state.foxholeKey, 'smallrailtracksplinefoundation');
    assert.equal(rail.state.start?.x, 0);
    assert.equal(rail.state.start?.y, 0);
    assert.equal(rail.state.end?.x, 288);
    assert.equal(rail.state.end?.y, 176);
    assert.ok(Math.abs(Number(rail.state.start?.rotation)) < 1e-9);
    assert.ok(Math.abs(Number(rail.state.end?.rotation)) < 1e-9);
    assert.ok(Math.abs(Number(rail.state.rotation)) < 1e-9);
});

test('importer keeps ground-pipe front socket rotation socket-facing', async () => {
    const save: LegacyPlanSave = {
        version: '1.0.5',
        entities: [
            {
                id: 6,
                key: 'pipeline',
                x: -672,
                y: -96,
                rotation: 0,
                layer: 0,
                sortOffset: 0,
                bezier: [
                    { x: 0, y: 0, rotation: 180 },
                    { x: 64, y: 384, rotation: 180 },
                ],
            },
        ],
    };

    const importer = new LegacyPlanImporter({
        structureCatalog,
        itemCatalog,
        fixtureName: 'pipe-bezier-front-rotation',
    });
    const result = await importer.importSave(save);
    const pipe = result.boardSnapshots[0];

    assert.ok(pipe);
    assert.equal(pipe.type, FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE);
    assert.equal(pipe.state.foxholeKey, 'facilitypipe');
    assert.equal(pipe.state.start?.x, 0);
    assert.equal(pipe.state.start?.y, 0);
    assert.equal(pipe.state.end?.x, 64);
    assert.equal(pipe.state.end?.y, 384);
    assert.ok(Math.abs(Number(pipe.state.start?.rotation)) < 1e-9);
    assert.ok(Math.abs(Number(pipe.state.end?.rotation) - Math.PI) < 1e-9);
});

test('importer reconnects adjacent foundations on Front/Back sockets', async () => {
    const save: LegacyPlanSave = {
        version: '1.0.5',
        entities: [
            {
                id: 4,
                key: 'foundation_1x1',
                x: -608,
                y: -288,
                rotation: 0,
                layer: 0,
                sortOffset: 0,
                connections: { 2: { 5: 0 } },
            },
            {
                id: 5,
                key: 'foundation_1x1',
                x: -448,
                y: -288,
                rotation: 0,
                layer: 0,
                sortOffset: 1,
                connections: { 0: { 4: 2 } },
            },
        ],
    };

    const importer = new LegacyPlanImporter({
        structureCatalog,
        itemCatalog,
        fixtureName: 'foundation-socket-reconnect',
    });
    const result = await importer.importSave(save);
    const left = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-4');
    const right = result.boardSnapshots.find(snapshot => snapshot.id === 'legacy-5');

    assert.ok(left);
    assert.ok(right);
    assert.equal(left.state.foxholeKey, 'foundation01t1');
    assert.deepEqual(left.state.socketAttachments?.FrontSocket, {
        nodeId: 'legacy-5',
        socketName: 'BackSocket',
    });
    assert.deepEqual(right.state.socketAttachments?.BackSocket, {
        nodeId: 'legacy-4',
        socketName: 'FrontSocket',
    });
});

test('importer places locomotive bodies and skips undercarriages', async () => {
    const save: LegacyPlanSave = {
        version: '1.0.5',
        name: 'Locomotive Import',
        entities: [
            {
                id: 299,
                type: 'locomotive',
                key: 'trainlrartillery',
                x: 120,
                y: 340,
                rotation: 45,
                currentTrackId: 10,
                currentTrackT: 0.5,
                trackDirection: 1,
            },
            {
                id: 300,
                type: 'locomotive_undercarriage',
                key: 'trainlrartillery_undercarriage',
                x: 100,
                y: 320,
                rotation: 45,
                trainCarId: 299,
                carriageType: 'front',
                currentTrackId: 10,
                currentTrackT: 0.4,
                trackDirection: 1,
            },
            {
                id: 301,
                type: 'locomotive_undercarriage',
                key: 'trainlrartillery_undercarriage',
                x: 140,
                y: 360,
                rotation: 45,
                trainCarId: 299,
                carriageType: 'back',
            },
        ],
    };
    const importer = new LegacyPlanImporter({ structureCatalog, itemCatalog });
    const result = await importer.importSave(save);

    assert.equal(result.boardSnapshots.length, 1);
    const body = result.boardSnapshots[0];
    assert.ok(body);
    assert.equal(body.id, 'legacy-299');
    assert.equal(body.state.foxholeKey, 'trainlrartillery');
    assert.equal(body.state.x, 120);
    assert.equal(body.state.y, 340);
    assert.ok(Math.abs(Number(body.state.rotation) - (Math.PI / 4)) < 1e-9);
    assert.equal((body.state as { currentTrackId?: unknown; }).currentTrackId, undefined);
    assert.equal((body.state as { currentTrackT?: unknown; }).currentTrackT, undefined);
    assert.equal((body.state as { trackDirection?: unknown; }).trackDirection, undefined);
    assert.equal(result.report.skippedEntityTypes.locomotive, undefined);
    assert.equal(result.report.skippedEntityTypes.locomotive_undercarriage, 2);

    const droppedTrackFields = new Set(
        result.report.toJSON().unmappedEntityFields.map(entry => entry.field),
    );
    assert.equal(droppedTrackFields.has('currentTrackId'), false);
    assert.equal(droppedTrackFields.has('currentTrackT'), false);
    assert.equal(droppedTrackFields.has('trackDirection'), false);
    assert.equal(droppedTrackFields.has('trainCarId'), false);
    assert.equal(droppedTrackFields.has('carriageType'), false);
});
