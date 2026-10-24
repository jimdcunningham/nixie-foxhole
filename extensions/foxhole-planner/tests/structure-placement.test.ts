import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import type { NixieExperimentalComponentEntitySnapshotV1 as Entity } from '@nixiejs/extension-sdk/experimental/scene-v2';
import {
    FOXHOLE_PLACEMENT_WARNING_SETTING_ID,
    FOXHOLE_PLACEMENT_FOUNDATION_COLOR,
    FOXHOLE_PLACEMENT_OVERLAP_COLOR,
    renderFoxholeStructurePlacementOverlay,
    renderFoxholeStructurePlacementSpatialOverlay,
    resolveFoxholeStructurePlacement,
} from '../src/structure-placement.ts';
import type { FoxholeSceneV2AssetMetadata } from '../src/scene-v2-asset-metadata.ts';
import { listFoxholeSceneV2Products } from '../src/scene-v2-products.ts';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';

const transform = (x = 0, y = 0, rotation = 0) => ({ ownerId: 'nixie.core', componentId: 'transform', version: 1,
    definitionAvailable: true, data: { x, y, rotation, scaleX: 1, scaleY: 1 } });
const entity = (entityId: string, assetId: string, x = 0, y = 0, rotation = 0, model = false): Entity => ({
    entityId,
    revision: 1,
    components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
            data: { assetId, catalogId: 'foxhole.structures' } },
        ...(model
            ? [{ ownerId: 'nixie.foxhole-planner', componentId: 'model', version: 1, definitionAvailable: true,
                data: { resourceId: 'test.model', unitsPerMetre: 32 } }]
            : []),
        transform(x, y, rotation),
    ],
});
const metadata = (category: string, shape: number[], requiresFoundation = false) => ({
    category,
    footprintPolygons: [{ shape }],
    requiresFoundation,
    isItem: false,
    isVehicle: false,
} as FoxholeSceneV2AssetMetadata);
const square = [-1, -1, 1, -1, 1, 1, -1, 1];

test('structure overlap uses transformed authored footprints but permits shared edges', () => {
    const assets = { building: metadata('facility', square) };
    const subject = entity('subject', 'building');
    const overlapping = entity('overlapping', 'building', 48, 0, Math.PI / 8);
    const adjacent = entity('adjacent', 'building', 64, 0);
    assert.deepEqual(resolveFoxholeStructurePlacement(subject,
        { contractVersion: 1, entities: [subject, overlapping] }, assets).overlapEntityIds, ['overlapping']);
    assert.deepEqual(resolveFoxholeStructurePlacement(subject,
        { contractVersion: 1, entities: [subject, adjacent] }, assets).overlapEntityIds, []);
});

test('foundation requirements accept full support across adjacent foundations and reject overhang', () => {
    const assets = {
        building: metadata('facility', [-2, -1, 2, -1, 2, 1, -2, 1], true),
        foundation: metadata('foundation', square),
    };
    const subject = entity('subject', 'building');
    const left = entity('left', 'foundation', -32, 0);
    const right = entity('right', 'foundation', 32, 0);
    assert.equal(resolveFoxholeStructurePlacement(subject,
        { contractVersion: 1, entities: [subject] }, assets).foundationSupported, false);
    assert.equal(resolveFoxholeStructurePlacement(subject,
        { contractVersion: 1, entities: [subject, left, right] }, assets).foundationSupported, true);
    subject.components.find(component => component.componentId === 'transform')!.data.x = 2;
    subject.revision += 1;
    assert.equal(resolveFoxholeStructurePlacement(subject,
        { contractVersion: 1, entities: [subject, left, right] }, assets).foundationSupported, false);
});

test('structures may occupy foundations while foundations cannot overlap each other', () => {
    const assets = {
        building: metadata('facility', square, true),
        foundation: metadata('foundation', square),
    };
    const structure = entity('structure', 'building');
    const first = entity('first', 'foundation');
    const second = entity('second', 'foundation', 16, 0);
    const structureState = resolveFoxholeStructurePlacement(structure,
        { contractVersion: 1, entities: [structure, first] }, assets);
    assert.deepEqual(structureState.overlapEntityIds, []);
    assert.equal(structureState.foundationSupported, true);
    assert.deepEqual(resolveFoxholeStructurePlacement(first,
        { contractVersion: 1, entities: [first, structure, second] }, assets).overlapEntityIds, ['second']);
});

test('invalid placement produces matching planar and model-supplement overlays', () => {
    const asset = metadata('facility', square, true);
    const subject = entity('subject', 'building', 0, 0, 0, true);
    const unsupported = { overlapEntityIds: [], requiresFoundation: true, foundationSupported: false };
    const planar = renderFoxholeStructurePlacementOverlay(asset, unsupported);
    const spatial = renderFoxholeStructurePlacementSpatialOverlay(subject, asset, unsupported);
    assert.equal(planar[0]?.kind, 'graphics');
    assert.equal(planar[0]?.kind === 'graphics'
        && planar[0].commands.find(command => command.op === 'stroke')?.color, FOXHOLE_PLACEMENT_FOUNDATION_COLOR);
    assert.equal(spatial?.supplementModel, true);
    assert.equal(spatial?.nodes[0]?.kind === 'line' && spatial.nodes[0].color, FOXHOLE_PLACEMENT_FOUNDATION_COLOR);
    assert.equal(spatial?.nodes[0]?.kind === 'line' && spatial.nodes[0].closed, true);
    const overlap = { ...unsupported, overlapEntityIds: ['other'], foundationSupported: true };
    const overlapSpatial = renderFoxholeStructurePlacementSpatialOverlay(subject, asset, overlap);
    assert.equal(overlapSpatial?.nodes[0]?.kind === 'line' && overlapSpatial.nodes[0].color, FOXHOLE_PLACEMENT_OVERLAP_COLOR);
});

test('the real diesel plant keeps its model while placement feedback updates against a foundation and neighbor', () => {
    const product = (id: string): Entity => {
        const template = listFoxholeSceneV2Products({ contractVersion: 1, query: id, offset: 0, limit: 100 })
            .items.find(item => item.product.id === `asset.${id}`)!.product;
        return { entityId: id, revision: 1, components: [...template.components.map(component => ({
            ...component,
            definitionAvailable: true,
            data: structuredClone(component.data),
        })), transform()] };
    };
    const diesel = product('facilitypowerdiesel');
    const foundation = product('foundation012x2t1');
    for (const enabled of [undefined, false]) {
        const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(diesel, {
            contractVersion: 1, entities: [diesel],
            ...(enabled === undefined ? {} : { settings: { [FOXHOLE_PLACEMENT_WARNING_SETTING_ID]: enabled } }),
        }));
        assert.equal(plan.root.children.some(node => node.id.startsWith('placement-invalid-')), false);
        assert.equal(plan.experimentalSpatial?.nodes.some(node => node.id.startsWith('placement-')) ?? false, false);
    }
    const settings = { [FOXHOLE_PLACEMENT_WARNING_SETTING_ID]: true };
    const unsupported = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(diesel,
        { contractVersion: 1, entities: [diesel], settings }));
    assert.equal(unsupported.experimentalSpatial?.supplementModel, true);
    assert.equal(unsupported.experimentalSpatial?.nodes[0]?.kind === 'line'
        && unsupported.experimentalSpatial.nodes[0].color, FOXHOLE_PLACEMENT_FOUNDATION_COLOR);
    const supported = renderFoxholeSceneV2Entity(diesel, { contractVersion: 1, entities: [diesel, foundation], settings });
    assert.deepEqual(supported.experimentalSpatial?.nodes, []);
    assert.ok(supported.experimentalSpatial?.markers?.some(marker => marker.label === 'PowerSocket'));
    const neighbor = product('facilitypowerdiesel');
    neighbor.entityId = 'neighbor';
    neighbor.components.find(component => component.componentId === 'transform')!.data.x = 16;
    const overlapping = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(diesel,
        { contractVersion: 1, entities: [diesel, foundation, neighbor], settings }));
    assert.equal(overlapping.experimentalSpatial?.supplementModel, true);
    assert.equal(overlapping.experimentalSpatial?.nodes[0]?.kind === 'line'
        && overlapping.experimentalSpatial.nodes[0].color, FOXHOLE_PLACEMENT_OVERLAP_COLOR);
});
