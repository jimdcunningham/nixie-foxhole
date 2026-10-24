import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import { FOXHOLE_STRUCTURE_RENDER_LANES } from '../src/render-lanes.ts';
import { renderFoxholeSceneV2TacticalLine } from '../src/scene-v2-tactical-lines.ts';
import { renderFoxholeSceneV2Range } from '../src/scene-v2-ranges.ts';
import { renderFoxholeSceneV2BinocularLine } from '../src/scene-v2-binocular-lines.ts';
import { renderFoxholeSceneV2Triangulation } from '../src/scene-v2-triangulations.ts';
import { createFoxholeSceneV2AssetMetadata } from '../src/scene-v2-asset-metadata.ts';

test('stale cargo overlays only render items supported by the current asset', () => {
    for (const items of [['Concrete'], ['Concrete', 'Diesel', 'Petrol']]) {
        const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
            entityId: 'engine-cargo', revision: 1, components: [
                { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1,
                    definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId: 'engineroomt3' } },
                { ownerId: 'nixie.foxhole-planner', componentId: 'cargo', version: 1,
                    definitionAvailable: true, data: { items } },
            ],
        }));
        const cargo = plan.root.children.find(node => node.id === 'marked-cargo');
        if (items.length === 1) {
            assert.equal(cargo, undefined);
        } else {
            assert.equal(cargo?.kind === 'group' && cargo.children.length, 1);
            assert.equal(cargo?.kind === 'group' && cargo.children[0]?.kind === 'group'
                && cargo.children[0].children.find(child => child.kind === 'sprite')?.resourceId, 'foxhole.icon.diesel');
        }
    }
});

test('Bowhead grouped cargo renders exact vehicle, structure and resource icons and rejects wrong groups', () => {
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({ entityId: 'bowhead', revision: 1, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: 'largeshipresourceship' } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'cargo', version: 1, definitionAvailable: true,
            data: { items: [], stockpileItems: [
                { groupKey: 'GenericStockpileComponent:0', codename: 'Harvester' },
                { groupKey: 'GenericStockpileComponent:1', codename: 'ResourceContainer' },
                { groupKey: 'GenericStockpileComponent:2', codename: 'Coal' },
                { groupKey: 'GenericStockpileComponent1:0', codename: 'Sulfur' },
                { groupKey: 'GenericStockpileComponent2:0', codename: 'Components' },
                { groupKey: 'GenericStockpileComponent:0', codename: 'ConcreteMixer' },
                { groupKey: 'Unknown', codename: 'Diesel' },
            ] } },
    ] }));
    const resources: string[] = [];
    const visit = (node: import('@nixie/extension-sdk/experimental/scene-v2').NixieExtensionRenderNodeV1) => { if (node.kind === 'sprite') resources.push(node.resourceId); if (node.kind === 'group') node.children.forEach(visit); };
    plan.root.children.filter(node => node.id === 'marked-cargo').forEach(visit);
    assert.deepEqual(resources.sort(), ['foxhole.icon.harvester','foxhole.icon.resourcecontainer','foxhole.icon.coal','foxhole.icon.sulfur','foxhole.icon.components'].sort());
});

test('intersection socket sides render approach pieces and retain concrete corner transitions', () => {
    for (const tier of [1, 2, 3]) {
        for (const side of ['Back', 'Front', 'Left', 'Right']) {
            const subject: NixieExperimentalComponentEntitySnapshotV1 = { entityId: 'intersection', revision: 1, components: [
                { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1,
                    definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId: `trenchintt${tier}` } },
                { ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments', version: 1,
                    definitionAvailable: true, data: { attachments: [{ localSocketName: `TrenchIntCommon:${side}Socket`,
                        targetEntityId: 'neighbor', targetSocketName: 'BackSocket' }] } },
            ] };
            const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(subject));
            const layers = plan.root.children.filter(node => node.id.startsWith('structure-layer-'));
            assert.ok(layers.some(node => node.id === 'structure-layer-floor'));
            assert.equal(layers.some(node => node.id === `structure-layer-${side.toLowerCase()}wall`), false);
            for (const corner of layers.filter(node => node.id.includes('corner'))) {
                if (tier !== 3) assert.equal(corner.id.includes(side.toLowerCase()), false);
                assert.equal(corner.laneId, FOXHOLE_STRUCTURE_RENDER_LANES.corners.laneId);
            }
            assert.equal(layers.length, 8);
            if (tier === 3) assert.equal(layers.filter(node => node.id.includes('corner')).length, 4);
            const floor = layers.find(node => node.id === 'structure-layer-floor');
            assert.ok(floor?.kind === 'mesh');
            assert.ok(floor.uvs.every(uv => uv >= 0 && uv <= 1));
        }
    }
});

test('intersection mods render all four sides and T3 roof respects Hide Roofs', () => {
    for (const tier of [1, 2, 3]) {
        for (const variantId of ['barbedwire', 'sandbags']) {
            const selections = ['BackDefenseModSlot', 'FrontDefenseModSlot',
                'LeftMiddleDefenseModSlot', 'RightMiddleDefenseModSlot'].map(slotId => ({ slotId, variantId }));
            if (tier === 3) selections.push({ slotId: 'BPTrenchRoofModSlot', variantId: 'trenchroof' });
            const subject: NixieExperimentalComponentEntitySnapshotV1 = { entityId: 'intersection', revision: 1, components: [
                { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1,
                    definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId: `trenchintt${tier}` } },
                { ownerId: 'nixie.foxhole-planner', componentId: 'modification', version: 1,
                    definitionAvailable: true, data: { selections } },
            ] };
            const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(subject));
            assert.equal(plan.root.children.filter(node => node.laneId === FOXHOLE_STRUCTURE_RENDER_LANES.trenchDefense.laneId).length, 4);
            const roof = plan.root.children.find(node => node.laneId === FOXHOLE_STRUCTURE_RENDER_LANES.upperModification.laneId);
            assert.equal(Boolean(roof), tier === 3);
            if (roof) assert.equal(roof.laneId, FOXHOLE_STRUCTURE_RENDER_LANES.upperModification.laneId);
            const hidden = renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject],
                settings: { 'foxhole.structure.hideRoofs': true } });
            assert.equal(hidden.root.children.some(node => node.laneId === FOXHOLE_STRUCTURE_RENDER_LANES.upperModification.laneId), false);
            assert.equal(hidden.root.children.filter(node => node.laneId === FOXHOLE_STRUCTURE_RENDER_LANES.trenchDefense.laneId).length, 4);
        }
    }
});

test('foundation borders render below a facility in Scene V2', () => {
    const renderAsset = (assetId: string) => parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: assetId,
        revision: 1,
        components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1,
            definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId } }],
    }));
    const foundation = renderAsset('foundation012x2t1');
    const facility = renderAsset('facilityrefinery1');
    const border = foundation.root.children.find(node => node.id === 'structure-layer-backborder0');
    const facilitySprite = facility.root.children.find(node => node.kind === 'sprite');
    assert.ok(border && facilitySprite);
    assert.equal(border.laneId, 'foxhole:structure:floor');
    assert.ok(border.laneOrder! < facilitySprite.laneOrder!);
});

test('Scene V2 keeps cranes above facilities and power lines below the Sky Hauler', () => {
    const renderAsset = (assetId: string) => renderFoxholeSceneV2Entity({
        entityId: assetId,
        revision: 1,
        components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1,
            definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId } }],
    }).root.children.find(node => node.id === 'building-texture');
    const facility = renderAsset('facilityrefinery1');
    const crane = renderAsset('crane');
    const facilityCrane = renderAsset('facilitycrane');
    const skyHauler = renderAsset('largecrane');
    const powerline = renderFoxholeSceneV2Entity({ entityId: 'powerline', revision: 1,
        components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'spline-connector', version: 1,
            definitionAvailable: true, data: { foxholeKey: 'powerline', startX: 0, startY: 0, startRotation: 0,
                endX: 100, endY: 0, endRotation: 0, minLength: 3.2, maxLength: 800, minRadius: 16,
                maxRadius: 800, maxBuffer: 3.2, curveT: 0, blueprint: false } }] }).root.children[0];

    assert.ok(facility && crane && facilityCrane && skyHauler && powerline);
    assert.ok(crane.laneOrder! > facility.laneOrder!);
    assert.equal(facilityCrane.laneOrder, crane.laneOrder);
    assert.ok(powerline.laneOrder! < crane.laneOrder!);
    assert.ok(skyHauler.laneOrder! > powerline.laneOrder!);
});

test('power spline rendering uses the Native straight black stroke despite socket rotations and appearance state', () => {
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({ entityId: 'power-line', revision: 1,
        components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'spline-connector', version: 1, definitionAvailable: true,
            data: { foxholeKey: 'powerline', startX: 0, startY: 0, startRotation: Math.PI,
                endX: -108.39712, endY: 136.15168, endRotation: -Math.PI, minLength: 3.2, maxLength: 800,
                minRadius: 16, maxRadius: 800, maxBuffer: 3.2, curveT: 0, blueprint: true, tint: 0xFFFFFF, brightness: 2 } }] }));
    const stroke = plan.root.children.find(node => node.kind === 'graphics');
    assert.ok(stroke?.kind === 'graphics');
    assert.deepEqual(stroke.commands, [
        { op: 'move-to', x: 0, y: 0 }, { op: 'line-to', x: -108.39712, y: 136.15168 },
        { op: 'stroke', color: 0, width: 3, alpha: 1, cap: 'round', join: 'round' },
    ]);
});

test('render layers use their own default offsets instead of inheriting the composite sprite origin', () => {
    const result = createFoxholeSceneV2AssetMetadata({ assets: [{ id: 'railtrackspline', codeName: 'RailTrackSpline',
        sprite: { width: 320, height: 240, offsetX: 154, offsetY: 13.61 },
        renderLayers: [{ i: 'span', u: '/foxhole/assets/types/structures/railtrackspline/components/span/span.texture.webp',
            w: 320, h: 211, ax: null, ay: null, ox: null, oy: null }] }] });
    const layer = result.assets.railtrackspline!.renderLayers.span!;
    assert.equal(layer.offsetX, 0);
    assert.equal(layer.offsetY, 0);
    assert.equal(layer.anchorX, 0.5);
    assert.equal(layer.anchorY, 0.5);
});

test('Foxhole renderer respects layer settings and V1 breach classification', () => {
    const subject = { entityId: 'bunker', revision: 1, components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1,
        definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId: 'artilleryait1' } }] };
    const normal = renderFoxholeSceneV2Entity(subject);
    assert.ok(normal.root.children.some(node => node.laneId === 'foxhole:structure:roof'));
    const hidden = renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject], settings: { 'foxhole.structure.hideRoofs': true } });
    assert.equal(hidden.root.children.some(node => node.laneId === 'foxhole:structure:roof'), false);
    const staticPlan = renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject], settings: { 'foxhole.structure.useStaticRender': true } });
    assert.equal(staticPlan.root.children.filter(node => node.kind === 'sprite').length, 1);
    const breach = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject],
        settings: { 'foxhole.structure.breachIndicators': true } }));
    const faces = breach.root.children.filter(node => node.id.startsWith('breach-'));
    assert.equal(faces.length, 4);
    assert.ok(faces.every(node => node.kind === 'graphics' && node.commands.some(command => command.op === 'fill' && command.color === 0xFF4D4D)));
    const rotated = { ...subject, components: [...subject.components, { ownerId: 'nixie.core', componentId: 'transform', version: 1,
        definitionAvailable: true, data: { rotation: 0.25 } }] };
    const rotatedPlan = renderFoxholeSceneV2Entity(rotated, { contractVersion: 1, entities: [rotated], settings: { 'foxhole.structure.breachIndicators': true } });
    assert.ok(rotatedPlan.root.children.filter(node => node.id.startsWith('breach-')).every(node => !node.rotation));
});

test('ladder renders in the roof lane and disappears with Hide Roofs', () => {
    const subject: NixieExperimentalComponentEntitySnapshotV1 = { entityId: 'bunker', revision: 1, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1,
            definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId: 'fortt3' } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'modification', version: 1,
            definitionAvailable: true, data: { selections: [{ slotId: 'FortRoofModSlot', variantId: 'ladder' }] } },
    ] };
    const shown = renderFoxholeSceneV2Entity(subject);
    assert.equal(shown.root.children.find(node => node.id.startsWith('modification-'))?.laneId, 'foxhole:structure:roof');
    const hidden = renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject], settings: { 'foxhole.structure.hideRoofs': true } });
    assert.equal(hidden.root.children.some(node => node.id.startsWith('modification-')), false);
});

test('trench berms and barbed wire render above other trench visuals in Scene V2', () => {
    for (const variantId of ['sandbags', 'barbedwire']) {
        const subject: NixieExperimentalComponentEntitySnapshotV1 = { entityId: `trench-${variantId}`, revision: 1, components: [
            { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1,
                definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId: 'trencht2' } },
            { ownerId: 'nixie.foxhole-planner', componentId: 'modification', version: 1,
                definitionAvailable: true, data: { selections: [{ slotId: 'BackDefenseModSlot', variantId }] } },
        ] };
        const plan = renderFoxholeSceneV2Entity(subject);
        const defense = plan.root.children.find(node => node.id.startsWith('modification-'));
        const walls = plan.root.children.find(node => node.laneId === 'foxhole:structure:base');
        assert.ok(defense && walls, variantId);
        assert.equal(defense.laneId, 'foxhole:structure:trench-defense');
        assert.ok(defense.laneOrder! > walls.laneOrder!);
        assert.ok(defense.laneOrder! > FOXHOLE_STRUCTURE_RENDER_LANES.dirt.laneOrder);
        assert.ok(defense.laneOrder! > FOXHOLE_STRUCTURE_RENDER_LANES.corners.laneOrder);
        assert.ok(defense.laneOrder! > FOXHOLE_STRUCTURE_RENDER_LANES.upperModification.laneOrder);
        const staticPlan = renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject],
            settings: { 'foxhole.structure.useStaticRender': true } });
        assert.equal(staticPlan.root.children.find(node => node.id.startsWith('modification-'))?.laneId,
            'foxhole:structure:trench-defense');
    }
});

test('derives the Ammo Factory render plan from extension-owned ECS data', () => {
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'facility-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'asset',
            version: 1,
            definitionAvailable: true,
            data: {
                catalogId: 'foxhole.structures',
                assetId: 'facilityfactoryammo',
            },
        }],
    }));

    assert.equal(plan.root.children[0]?.kind, 'sprite');
    assert.equal(plan.root.children[0]?.kind === 'sprite' && plan.root.children[0].resourceId, 'foxhole.asset.facilityfactoryammo');
    assert.equal(plan.root.children[0]?.kind === 'sprite' && plan.root.children[0].x, 17.102);
    assert.equal(plan.root.children[0]?.kind === 'sprite' && plan.root.children[0].y, -16.1925);
});

test('derives an Ammo Factory icon texture from extension data and Nixie-owned presentation', () => {
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'facility-icon-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'asset',
            version: 1,
            definitionAvailable: true,
            data: {
                catalogId: 'foxhole.icons',
                assetId: 'facilityfactoryammo',
            },
        }, {
            ownerId: 'nixie.core',
            componentId: 'icon',
            version: 1,
            definitionAvailable: true,
            data: {
                frameWidth: 100,
                frameHeight: 80,
                padding: 10,
                iconTint: 0xDDEEFF,
            },
        }],
    }));

    const texture = plan.root.children[0];
    assert.equal(texture?.kind, 'sprite');
    assert.equal(texture?.kind === 'sprite' && texture.resourceId, 'foxhole.icon.facilityfactoryammo');
    assert.equal(texture?.kind === 'sprite' && texture.laneId, 'structure');
    assert.equal(texture?.kind === 'sprite' && texture.width, 90);
    assert.equal(texture?.kind === 'sprite' && texture.height, 70);
    assert.equal(texture?.kind === 'sprite' && texture.tint, 0xDDEEFF);
});

test('renders every published Foxhole asset from manifest-owned sprite metadata', () => {
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'shipping-container-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'asset',
            version: 1,
            definitionAvailable: true,
            data: {
                catalogId: 'foxhole.structures',
                assetId: 'shippingcontainer',
            },
        }],
    }));

    const texture = plan.root.children[0];
    assert.equal(texture?.kind, 'sprite');
    assert.equal(texture?.kind === 'sprite' && texture.resourceId, 'foxhole.asset.shippingcontainer');
    assert.equal(texture?.kind === 'sprite' && texture.width, 98.5);
    assert.equal(texture?.kind === 'sprite' && texture.height, 195);
});

test('renders persisted Foxhole modification selections as manifest-owned overlays', () => {
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'artillery-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'asset',
            version: 1,
            definitionAvailable: true,
            data: {
                catalogId: 'foxhole.structures',
                assetId: 'artilleryait2',
            },
        }, {
            ownerId: 'nixie.foxhole-planner',
            componentId: 'modification',
            version: 1,
            definitionAvailable: true,
            data: {
                selections: [{ slotId: 'BackInfraModSlot', variantId: 'bunkbed' }],
            },
        }],
    }));

    const overlay = plan.root.children.find(node => node.id === 'modification-1');
    assert.equal(plan.root.children.filter(node => node.id.startsWith('structure-layer-')).length, 12);
    assert.equal(overlay?.kind, 'sprite');
    assert.equal(overlay?.kind === 'sprite' && overlay.resourceId, 'foxhole.mod.shared-bunkbed-47e016ce52d5');
    assert.ok(overlay?.kind === 'sprite' && Math.abs(overlay.x! - (-55.2065)) < 1e-9);
    assert.ok(overlay?.kind === 'sprite' && Math.abs(overlay.y! - (-1.491)) < 1e-9);
    assert.equal(overlay?.kind === 'sprite' && overlay.rotation, Math.PI / 2);
    assert.equal(overlay?.kind === 'sprite' && overlay.width, 131);
});

test('uses persisted Foxhole upgrade selections as replacement textures', () => {
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'refinery-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'asset',
            version: 1,
            definitionAvailable: true,
            data: {
                catalogId: 'foxhole.structures',
                assetId: 'facilityrefinery1',
            },
        }, {
            ownerId: 'nixie.foxhole-planner',
            componentId: 'modification',
            version: 1,
            definitionAvailable: true,
            data: {
                selections: [{ slotId: 'UpgradeSlotComponent', variantId: 'forge' }],
            },
        }],
    }));

    const replacement = plan.root.children[0];
    assert.equal(plan.root.children.filter(node => node.kind === 'sprite').length, 1);
    assert.equal(replacement?.kind, 'sprite');
    assert.equal(replacement?.kind === 'sprite' && replacement.resourceId, 'foxhole.mod.facilityrefinery1-0-0');
    assert.equal(replacement?.kind === 'sprite' && replacement.width, 242);
    assert.equal(replacement?.kind === 'sprite' && replacement.height, 415);
    assert.equal(replacement?.kind === 'sprite' && replacement.x, -3.594);
    assert.equal(replacement?.kind === 'sprite' && replacement.y, -29.37);
});

test('selects manifest-owned faction and color variants from persisted appearance', () => {
    const factionPlan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'engineering-center-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'asset',
            version: 1,
            definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: 'engineeringcenter' },
        }, {
            ownerId: 'nixie.foxhole-planner',
            componentId: 'appearance',
            version: 1,
            definitionAvailable: true,
            data: { faction: 'w' },
        }],
    }));
    const colorPlan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'liquid-container-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'asset',
            version: 1,
            definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: 'liquidcontainer' },
        }, {
            ownerId: 'nixie.foxhole-planner',
            componentId: 'appearance',
            version: 1,
            definitionAvailable: true,
            data: { colorHex: 'fd9d06' },
        }],
    }));

    assert.equal(factionPlan.root.children[0]?.kind === 'sprite'
        && factionPlan.root.children[0].resourceId, 'foxhole.visual.engineeringcenter-faction-w');
    assert.equal(colorPlan.root.children[0]?.kind === 'sprite'
        && colorPlan.root.children[0].resourceId, 'foxhole.visual.liquidcontainer-color-fd9d06');
});

test('renders destroyed and packaged Foxhole appearances from published resources', () => {
    const destroyedPlan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'observation-bunker-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'asset',
            version: 1,
            definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: 'observationbunkert1' },
        }, {
            ownerId: 'nixie.foxhole-planner',
            componentId: 'appearance',
            version: 1,
            definitionAvailable: true,
            data: { destroyed: true },
        }],
    }));
    const packagedPlan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'motorcycle-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'asset',
            version: 1,
            definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: 'motorcycleoffensivec' },
        }, {
            ownerId: 'nixie.foxhole-planner',
            componentId: 'appearance',
            version: 1,
            definitionAvailable: true,
            data: { packaged: true },
        }],
    }));

    assert.equal(destroyedPlan.root.children[0]?.kind === 'sprite'
        && destroyedPlan.root.children[0].resourceId, 'foxhole.asset.observationbunkert1destroyed');
    assert.equal(packagedPlan.root.children.length, 2);
    assert.equal(packagedPlan.root.children[1]?.kind === 'sprite'
        && packagedPlan.root.children[1].resourceId, 'foxhole.visual.packaging-normal');
});

test('fixed and unoccupied corner floors render their baked textures without clipping walls', () => {
    for (const assetId of ['fortt1', 'fortt2', 'fortt3', 'fortcornert1', 'fortcornert2', 'fortcornert3', 'fortfirepitt1']) {
        const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
            entityId: 'clipped-fort', revision: 1,
            components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
                data: { catalogId: 'foxhole.structures', assetId } }],
        }));
        const floor = plan.root.children.find(node => node.id === 'structure-layer-floor');
        assert.equal(floor?.kind, 'sprite', assetId);
        assert.ok(plan.root.children.some(node => node.id === 'structure-layer-backwall' && node.kind === 'sprite'));
    }
});

test('occupied angled sockets trim corner floor meshes to the joining plane', () => {
    for (const assetId of ['fortcornert1', 'fortcornert2', 'fortcornert3']) {
        const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
            entityId: 'joined-corner', revision: 1,
            components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
                data: { catalogId: 'foxhole.structures', assetId } },
            { ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments', version: 1, definitionAvailable: true,
                data: { attachments: [{ socketName: 'FortCornerCommonSockets:AngleFortSocket', targetEntityId: 'neighbor' }] } }],
        }));
        const floor = plan.root.children.find(node => node.id === 'structure-layer-floor');
        assert.ok(floor?.kind === 'mesh');
        assert.ok(Math.abs(floor.positions[6]! + floor.positions[7]! - 160 * (1 - 1 / Math.SQRT2)) < 0.000001);
        assert.ok(!plan.root.children.some(node => node.id === 'structure-layer-anglewall'));
        const shortWall = plan.root.children.find(node => node.id === 'structure-layer-wallangle1');
        assert.equal(shortWall?.kind, assetId === 'fortcornert3' ? 'mesh' : 'sprite');
    }
});

test('applies blueprint and custom appearance through bounded static render transforms', () => {
    const blueprintPlan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'blueprint-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'asset',
            version: 1,
            definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: 'trenchempt3' },
        }, {
            ownerId: 'nixie.foxhole-planner',
            componentId: 'appearance',
            version: 1,
            definitionAvailable: true,
            data: { blueprint: true },
        }],
    }, { contractVersion: 1, entities: [], settings: { 'foxhole.structure.useStaticRender': true } }));
    const customPlan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'custom-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'asset',
            version: 1,
            definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: 'trenchempt3' },
        }, {
            ownerId: 'nixie.foxhole-planner',
            componentId: 'appearance',
            version: 1,
            definitionAvailable: true,
            data: { tint: 0xDDEEFF, brightness: 1.5, anchorX: 0.25, anchorY: 0.75 },
        }],
    }, { contractVersion: 1, entities: [], settings: { 'foxhole.structure.useStaticRender': true } }));

    const blueprintBase = blueprintPlan.root.children.find(node => node.id === 'building-texture');
    const customBase = customPlan.root.children.find(node => node.id === 'building-texture');
    assert.equal(blueprintBase?.brightness, 2.15);
    assert.equal(blueprintBase?.kind === 'sprite' && blueprintBase.tint, 0x335CFF);
    assert.equal(customBase?.brightness, 1.5);
    assert.equal(customBase?.kind === 'sprite' && customBase.tint, 0xDDEEFF);
    assert.equal(customBase?.kind === 'sprite' && customBase.anchorX, 0.25);
    assert.equal(customBase?.kind === 'sprite' && customBase.anchorY, 0.75);
    for (const plan of [blueprintPlan, customPlan]) {
        const layers = plan.root.children.filter(node => node.id.startsWith('structure-layer-'));
        assert.equal(layers.length, 0);
    }
});

test('renders persisted marked cargo as upright bounded item-icon tiles', () => {
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'cargo-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'asset',
            version: 1,
            definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: 'artilleryait1' },
        }, {
            ownerId: 'nixie.foxhole-planner',
            componentId: 'cargo',
            version: 1,
            definitionAvailable: true,
            data: { items: ['Diesel', 'Petrol'] },
        }, {
            ownerId: 'nixie.core',
            componentId: 'transform',
            version: 1,
            definitionAvailable: true,
            data: { x: 0, y: 0, rotation: 0.4, scaleX: 1, scaleY: 1 },
        }],
    }));

    const cargo = plan.root.children.find(node => node.id === 'marked-cargo');
    assert.equal(cargo?.kind, 'group');
    assert.equal(cargo?.laneId, 'overlay');
    assert.equal(cargo?.rotation, -0.4);
    assert.equal(cargo?.kind === 'group' && cargo.children.length, 2);
    assert.deepEqual(cargo?.kind === 'group'
        ? cargo.children.map(cell => cell.kind === 'group'
            ? cell.children.find(child => child.kind === 'sprite')?.resourceId
            : null)
        : [], [
        'foxhole.icon.diesel',
        'foxhole.icon.petrol',
    ]);
});

test('clamps marked cargo to the manifest hold limit and hides destroyed cargo', () => {
    const components: Parameters<typeof renderFoxholeSceneV2Entity>[0]['components'] = [{
        ownerId: 'nixie.foxhole-planner',
        componentId: 'asset',
        version: 1,
        definitionAvailable: true,
        data: { catalogId: 'foxhole.structures', assetId: 'engineroomt2' },
    }, {
        ownerId: 'nixie.foxhole-planner',
        componentId: 'cargo',
        version: 1,
        definitionAvailable: true,
        data: { items: ['Diesel', 'Petrol'] },
    }];
    const limited = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'cargo-limited',
        revision: 1,
        components,
    }));
    const cargo = limited.root.children.find(node => node.id === 'marked-cargo');
    assert.equal(cargo?.kind === 'group' && cargo.children.length, 1);

    const destroyed = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'cargo-destroyed',
        revision: 1,
        components: [...components, {
            ownerId: 'nixie.foxhole-planner',
            componentId: 'appearance',
            version: 1,
            definitionAvailable: true,
            data: { destroyed: true },
        }],
    }));
    assert.equal(destroyed.root.children.length, 1);
});

test('renders persisted production orders as upright green output tiles', () => {
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'production-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'asset',
            version: 1,
            definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: 'facilityfactoryammo' },
        }, {
            ownerId: 'nixie.foxhole-planner',
            componentId: 'production-order',
            version: 1,
            definitionAvailable: true,
            data: {
                orders: [{ id: 'order-1', recipeId: 'structure:facilityfactoryammo:recipe:0' }],
            },
        }, {
            ownerId: 'nixie.core',
            componentId: 'transform',
            version: 1,
            definitionAvailable: true,
            data: { x: 0, y: 0, rotation: 0.4, scaleX: 1, scaleY: 1 },
        }],
    }));

    const production = plan.root.children.find(child => child.id === 'production-output');
    assert.equal(production?.kind, 'group');
    assert.equal(production?.kind === 'group' && production.id, 'production-output');
    assert.equal(production?.kind === 'group' && production.rotation, -0.4);
    assert.equal(production?.kind === 'group'
        && production.children[0]?.kind === 'group'
        && production.children[0].children.find(child => child.kind === 'sprite')?.resourceId,
    'foxhole.icon.flameammo');
    assert.ok(production?.kind === 'group'
        && production.children[0]?.kind === 'group'
        && production.children[0].children.some(child => child.kind === 'graphics'
            && child.commands.some(command => command.op === 'stroke' && command.color === 0x22C55E)));
});

test('places production left of marked cargo and hides disabled production', () => {
    const components: Parameters<typeof renderFoxholeSceneV2Entity>[0]['components'] = [{
        ownerId: 'nixie.foxhole-planner',
        componentId: 'asset',
        version: 1,
        definitionAvailable: true,
        data: { catalogId: 'foxhole.structures', assetId: 'facilityfactoryammo' },
    }, {
        ownerId: 'nixie.foxhole-planner',
        componentId: 'cargo',
        version: 1,
        definitionAvailable: true,
        data: { items: ['Petrol'] },
    }, {
        ownerId: 'nixie.foxhole-planner',
        componentId: 'production-order',
        version: 1,
        definitionAvailable: true,
        data: {
            orders: [{ id: 'order-1', recipeId: 'structure:facilityfactoryammo:recipe:0' }],
        },
    }];
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'cargo-production-1',
        revision: 1,
        components,
    }));
    const overlay = plan.root.children.find(child => child.id === 'cargo-and-production');
    assert.equal(overlay?.kind === 'group' && overlay.id, 'cargo-and-production');
    assert.equal(overlay?.kind === 'group' && overlay.children[0]?.kind === 'group'
        && overlay.children[0].id, 'production-column');
    assert.equal(overlay?.kind === 'group' && overlay.children[1]?.kind === 'group'
        && overlay.children[1].id, 'cargo-column');
    assert.ok(overlay?.kind === 'group'
        && overlay.children[0]?.kind === 'group'
        && overlay.children[1]?.kind === 'group'
        && (overlay.children[0].x ?? 0) < (overlay.children[1].x ?? 0));

    const disabled = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'production-disabled',
        revision: 1,
        components: components.map(component => component.componentId === 'production-order'
            ? { ...component, data: { ...component.data, disabled: true } }
            : component),
    }));
    assert.ok(disabled.root.children.some(child => child.kind === 'group' && child.id === 'marked-cargo'));
});

test('refuses assets outside the published Foxhole manifest', () => {
    assert.throws(() => renderFoxholeSceneV2Entity({
        entityId: 'unknown-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'asset',
            version: 1,
            definitionAvailable: true,
            data: {
                catalogId: 'foxhole.structures',
                assetId: 'not-a-real-foxhole-asset',
            },
        }],
    }), /does not support this entity/);
});

test('derives a tactical-line render plan from persisted style data', () => {
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'line-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'tactical-line',
            version: 1,
            definitionAvailable: true,
            data: {
                points: [0, 0, 80, 20, 160, 0],
                scaleWithZoom: true,
                curveMode: 'smooth',
                strokeColor: 0x5BCB77,
                strokeWidth: 8,
                strokeAlpha: 1,
                strokeStyle: 'solid',
                strokeDashLength: 20,
                strokeDashGap: 12,
                startCap: 'none',
                endCap: 'arrow',
                decoratorMode: 'triangle',
                decoratorSide: 'left',
                decoratorSize: 14,
                decoratorSpacing: 26,
                decoratorFill: true,
                decoratorColor: 0xDDF7D5,
                decoratorAlpha: 1,
                presetId: 'advance',
            },
        }, {
            ownerId: 'nixie.core',
            componentId: 'transform',
            version: 1,
            definitionAvailable: true,
            data: { x: 0, y: 0, rotation: 0.4, scaleX: 1, scaleY: 1 },
        }],
    }));

    assert.equal(plan.root.children.length, 3);
    assert.ok(plan.root.children.every(child => child.kind === 'graphics'));
    const commands = plan.root.children.flatMap(child => child.kind === 'graphics' ? child.commands : []);
    assert.ok(commands.some(command => command.op === 'stroke' && command.color === 0x5BCB77));
    assert.ok(commands.some(command => command.op === 'polygon'));
});

test('renders legacy Foxhole connectors without granting the extension Pixi access', () => {
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'connector-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'connector',
            version: 1,
            definitionAvailable: true,
            data: {
                foxholeKey: 'liquidpipe',
                points: [0, 0, 80, 20, 160, 0],
            },
        }],
    }));

    assert.equal(plan.root.children.length, 2);
    const commands = plan.root.children.flatMap(child => child.kind === 'graphics' ? child.commands : []);
    assert.ok(commands.some(command => command.op === 'stroke' && command.color === 0xD9F6FF));
    assert.equal(commands.filter(command => command.op === 'circle').length, 3);
});

test('derives a labeled dashed Foxhole range from persisted component data', () => {
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'range-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'range',
            version: 1,
            definitionAvailable: true,
            data: {
                points: [0, 0, 160, 0],
                sweepAngle: 120,
                scaleWithZoom: true,
                strokeColor: 0xC084FC,
                strokeWidth: 2,
                strokeAlpha: 1,
                strokeStyle: 'dashed',
                strokeDashLength: 12,
                strokeDashGap: 8,
                fillColor: 0x7E22CE,
                fillAlpha: 0.16,
                showCenterAxis: false,
                showRadius: true,
                showAngle: true,
                labelColor: 0xFFFFFF,
                labelFontSize: 22,
                labelBackgroundColor: 0x6B21A8,
                labelBackgroundAlpha: 0.85,
                labelPadding: 6,
                labelStrokeWidth: 2,
                centerMarkerRadius: 5,
                meterPixels: 32,
                decimals: 1,
            },
        }, {
            ownerId: 'nixie.core',
            componentId: 'transform',
            version: 1,
            definitionAvailable: true,
            data: { x: 0, y: 0, rotation: 0.25, scaleX: 1, scaleY: 1 },
        }],
    }));

    assert.equal(plan.root.children.length, 2);
    const graphics = plan.root.children[0];
    assert.equal(graphics?.kind, 'graphics');
    assert.ok(graphics?.kind === 'graphics' && graphics.commands.some(command => (
        command.op === 'stroke' && command.color === 0xC084FC
    )));
    const labelLayer = plan.root.children[1];
    assert.equal(labelLayer?.kind, 'group');
    assert.equal(labelLayer?.kind === 'group' && labelLayer.children[0]?.kind === 'group'
        && labelLayer.children[0].rotation, -0.25);
    assert.ok(labelLayer?.kind === 'group'
        && labelLayer.children[0]?.kind === 'group'
        && labelLayer.children[0].children.some(child => child.kind === 'text' && child.text === '5.0m\n120.0°'));
});

test('derives a measured binocular line with caps and azimuth arrows', () => {
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'binocular-line-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'binocular-line',
            version: 1,
            definitionAvailable: true,
            data: {
                points: [0, 0, 160, 0],
                scaleWithZoom: true,
                strokeColor: 0x77E5C3,
                strokeWidth: 2,
                strokeAlpha: 1,
                multiSegmentAlpha: 0.5,
                showDistance: true,
                showAzimuth: true,
                showAzimuthArrows: true,
                labelColor: 0xFFFFFF,
                labelFontSize: 22,
                labelBackgroundColor: 0x529E87,
                labelBackgroundAlpha: 0.85,
                labelPadding: 6,
                labelStrokeWidth: 2,
                endpointRadius: 0,
                startCap: 'circle',
                endCap: 'arrow',
                meterPixels: 32,
                decimals: 1,
            },
        }, {
            ownerId: 'nixie.core',
            componentId: 'transform',
            version: 1,
            definitionAvailable: true,
            data: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        }],
    }));

    assert.equal(plan.root.children.length, 2);
    const graphics = plan.root.children[0];
    assert.ok(graphics?.kind === 'graphics'
        && graphics.commands.some(command => command.op === 'polygon')
        && graphics.commands.some(command => command.op === 'circle'));
    const labels = plan.root.children[1];
    assert.ok(labels?.kind === 'group'
        && labels.children[0]?.kind === 'group'
        && labels.children[0].children.some(child => child.kind === 'text' && child.text === '5.0m\n90.0°'));
});

test('derives a fitted Foxhole triangulation with spokes, markers, and radius label', () => {
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'triangulation-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'triangulation',
            version: 1,
            definitionAvailable: true,
            data: {
                edgePoints: [160, 0, 0, 160, -160, 0],
                scaleWithZoom: true,
                strokeColor: 0xFE2AA6,
                strokeWidth: 2,
                strokeAlpha: 1,
                strokeStyle: 'dashed',
                strokeDashLength: 12,
                strokeDashGap: 8,
                fillColor: 0xE5158E,
                fillAlpha: 0.14,
                spokeAlpha: 0.65,
                edgeLineAlpha: 0.35,
                showSpokes: true,
                showRadius: true,
                showEdgeMarkers: true,
                labelColor: 0xFFFFFF,
                labelFontSize: 22,
                labelBackgroundColor: 0x8E0655,
                labelBackgroundAlpha: 0.85,
                labelPadding: 6,
                labelStrokeWidth: 2,
                centerMarkerRadius: 5,
                edgeMarkerRadius: 5,
                meterPixels: 32,
                decimals: 1,
            },
        }, {
            ownerId: 'nixie.core',
            componentId: 'transform',
            version: 1,
            definitionAvailable: true,
            data: { x: 0, y: 0, rotation: 0.5, scaleX: 1, scaleY: 1 },
        }],
    }));

    assert.equal(plan.root.children.length, 2);
    const graphics = plan.root.children[0];
    assert.ok(graphics?.kind === 'graphics'
        && graphics.commands.filter(command => command.op === 'circle').length === 5
        && graphics.commands.some(command => command.op === 'stroke' && command.alpha === 0.65));
    const labels = plan.root.children[1];
    assert.ok(labels?.kind === 'group'
        && labels.children[0]?.kind === 'group'
        && labels.children[0].rotation === -0.5
        && labels.children[0].children.some(child => child.kind === 'text' && child.text === '5.0m'));
});

test('derives a manifest-textured cubic ribbon for Foxhole spline connectors', () => {
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'spline-connector-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'spline-connector',
            version: 1,
            definitionAvailable: true,
            data: {
                foxholeKey: 'facilitypipe',
                startX: 0,
                startY: 0,
                startRotation: 0,
                startHandleLength: 72,
                endX: 180,
                endY: 60,
                endRotation: 0,
                endHandleLength: 72,
                minLength: 48,
                maxLength: 100_000,
                minRadius: 24,
                maxRadius: 24,
                maxBuffer: 0,
                curveT: 0.75,
                blueprint: false,
            },
        }],
    }));

    assert.equal(plan.root.children.filter(child => child.id !== 'spline-connector-guides' && child.id !== 'spline-connector-socket-presentation').length, 3);
    assert.ok(plan.root.children.every(child => child.kind !== 'graphics'), 'editing handles and draft outlines remain inside declared selected-only groups');
    assert.deepEqual(plan.root.children.find(child => child.id === 'spline-connector-guides')?.experimentalPresentation,
        { contractVersion: 1, selectionOnly: true, excludeFromBounds: true });
    const ribbon = plan.root.children[0];
    assert.equal(ribbon?.kind, 'mesh');
    assert.equal(ribbon?.kind === 'mesh' && ribbon.resourceId, 'foxhole.visual.facilitypipe-layer-span');
    assert.equal(ribbon?.kind === 'mesh' && ribbon.textureAddressMode, 'repeat');
    assert.ok(ribbon?.kind === 'mesh' && ribbon.positions.length > 100);
    assert.ok(ribbon?.kind === 'mesh' && ribbon.indices.length % 3 === 0);
    const backTrim = plan.root.children[1];
    assert.equal(backTrim?.kind === 'sprite' && backTrim.resourceId, 'foxhole.visual.facilitypipe-layer-backtrim');
    assert.equal(backTrim?.kind === 'sprite' && backTrim.x, 0);
    assert.equal(backTrim?.kind === 'sprite' && backTrim.y, 0);
    const frontTrim = plan.root.children[2];
    assert.equal(frontTrim?.kind === 'sprite' && frontTrim.resourceId, 'foxhole.visual.facilitypipe-layer-fronttrim');
    assert.equal(frontTrim?.kind === 'sprite' && frontTrim.x, 180);
    assert.equal(frontTrim?.kind === 'sprite' && frontTrim.y, 60);
});

test('places manifest-owned interval connector markers without a ribbon mesh', () => {
    const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({
        entityId: 'tank-stop-connector-1',
        revision: 1,
        components: [{
            ownerId: 'nixie.foxhole-planner',
            componentId: 'spline-connector',
            version: 1,
            definitionAvailable: true,
            data: {
                foxholeKey: 'tankstopsplinet3',
                startX: 0,
                startY: 0,
                startRotation: 0,
                endX: 360,
                endY: 0,
                endRotation: 0,
                minLength: 120,
                maxLength: 481.6,
                minRadius: 0,
                maxRadius: 0,
                maxBuffer: 0,
                curveT: 1,
                blueprint: false,
            },
        }],
    }));

    assert.ok(!plan.root.children.some(child => child.kind === 'mesh'));
    const markers = plan.root.children.filter(child => child.kind === 'sprite');
    assert.equal(markers.length, 4);
    assert.deepEqual(markers.map(marker => marker.kind === 'sprite' ? marker.resourceId : null), [
        'foxhole.visual.tankstopsplinet3-layer-span',
        'foxhole.visual.tankstopsplinet3-layer-spanalt',
        'foxhole.visual.tankstopsplinet3-layer-spanalt2',
        'foxhole.visual.tankstopsplinet3-layer-spanalt3',
    ]);
    assert.deepEqual(markers.map(marker => marker.x), [0, 120, 240, 360]);
});

test('reproduces V1 viewport-relative detail scaling without changing persisted geometry', () => {
    const tactical = renderFoxholeSceneV2TacticalLine({
        points: [0, 0, 1_000, 0],
        scaleWithZoom: true,
        curveMode: 'polyline',
        strokeColor: 0xFFAA88,
        strokeWidth: 8,
        strokeAlpha: 1,
        strokeStyle: 'solid',
        strokeDashLength: 20,
        strokeDashGap: 12,
        startCap: 'none',
        endCap: 'none',
        decoratorMode: 'semicircle',
        decoratorSide: 'left',
        decoratorSize: 14,
        decoratorSpacing: 26,
        decoratorFill: false,
        decoratorColor: 0xFFAA88,
        decoratorAlpha: 1,
        presetId: 'frontline',
    }, 0, 4);
    const tacticalStroke = tactical[0]!.commands.find(command => command.op === 'stroke');
    const tacticalDecorators = tactical[1]!.commands.filter(command => command.op === 'move-to');
    assert.equal(tacticalStroke?.op === 'stroke' && tacticalStroke.width, 32);
    assert.equal(tacticalDecorators.length, 9);

    const range = renderFoxholeSceneV2Range({
        points: [0, 0, 1_000, 0],
        sweepAngle: 360,
        scaleWithZoom: true,
        strokeColor: 0xC084FC,
        strokeWidth: 2,
        strokeAlpha: 1,
        strokeStyle: 'solid',
        strokeDashLength: 12,
        strokeDashGap: 8,
        fillColor: 0x7E22CE,
        fillAlpha: 0.16,
        showCenterAxis: false,
        showRadius: true,
        showAngle: false,
        labelColor: 0xFFFFFF,
        labelFontSize: 22,
        labelBackgroundColor: 0x6B21A8,
        labelBackgroundAlpha: 0.85,
        labelPadding: 6,
        labelStrokeWidth: 2,
        centerMarkerRadius: 5,
        meterPixels: 32,
        decimals: 1,
    }, 0, 4);
    assert.ok(range[0]?.kind === 'graphics'
        && range[0].commands.some(command => command.op === 'stroke' && command.width === 8)
        && range[0].commands.some(command => command.op === 'circle' && command.radius === 20));
    assert.equal(range[1]?.kind === 'group'
        && range[1].children[0]?.kind === 'group'
        && range[1].children[0].children[0]?.kind === 'text'
        && range[1].children[0].children[0].experimentalBox?.renderScale, 4);

    const binocular = renderFoxholeSceneV2BinocularLine({
        points: [0, 0, 1_000, 0],
        scaleWithZoom: true,
        strokeColor: 0x77E5C3,
        strokeWidth: 2,
        strokeAlpha: 1,
        multiSegmentAlpha: 0.5,
        showDistance: true,
        showAzimuth: false,
        showAzimuthArrows: false,
        labelColor: 0xFFFFFF,
        labelFontSize: 22,
        labelBackgroundColor: 0x529E87,
        labelBackgroundAlpha: 0.85,
        labelPadding: 6,
        labelStrokeWidth: 2,
        endpointRadius: 5,
        startCap: 'circle',
        endCap: 'circle',
        meterPixels: 32,
        decimals: 1,
    }, 0, 4);
    assert.ok(binocular[0]?.kind === 'graphics'
        && binocular[0].commands.some(command => command.op === 'stroke' && command.width === 8)
        && binocular[0].commands.filter(command => command.op === 'circle' && command.radius === 20).length >= 2);
    assert.equal(binocular[1]?.kind === 'group'
        && binocular[1].children[0]?.kind === 'group'
        && binocular[1].children[0].scaleX, 4);

    const triangulation = renderFoxholeSceneV2Triangulation({
        edgePoints: [1_000, 0, 0, 1_000, -1_000, 0],
        scaleWithZoom: true,
        strokeColor: 0xFE2AA6,
        strokeWidth: 2,
        strokeAlpha: 1,
        strokeStyle: 'solid',
        strokeDashLength: 12,
        strokeDashGap: 8,
        fillColor: 0xE5158E,
        fillAlpha: 0.14,
        spokeAlpha: 0.65,
        edgeLineAlpha: 0.35,
        showSpokes: true,
        showRadius: true,
        showEdgeMarkers: true,
        labelColor: 0xFFFFFF,
        labelFontSize: 22,
        labelBackgroundColor: 0x8E0655,
        labelBackgroundAlpha: 0.85,
        labelPadding: 6,
        labelStrokeWidth: 2,
        centerMarkerRadius: 5,
        edgeMarkerRadius: 5,
        meterPixels: 32,
        decimals: 1,
    }, 0, 4);
    assert.ok(triangulation[0]?.kind === 'graphics'
        && triangulation[0].commands.some(command => command.op === 'stroke' && command.width === 8)
        && triangulation[0].commands.filter(command => command.op === 'circle' && command.radius === 20).length === 4);
    assert.equal(triangulation[1]?.kind === 'group'
        && triangulation[1].children[0]?.kind === 'group'
        && triangulation[1].children[0].children[0]?.kind === 'text'
        && triangulation[1].children[0].children[0].experimentalBox?.renderScale, 4);
});
