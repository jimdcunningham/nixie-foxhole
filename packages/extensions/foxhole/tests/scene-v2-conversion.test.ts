import assert from 'node:assert/strict';
import test from 'node:test';
import { registerFoxholeSceneV2HostPolicy } from '../app/utils/scene-v2-host-policy.ts';
import { convertNixieSceneV1ToV2 } from '../../../nixie/desktop-extensions/scene-v2-conversion.ts';
import { convertFoxholeSceneV1NodeToV2 } from '../app/plugins/foxhole/nixie/scene-v2-conversion.ts';
import { createFoxholeSplineConnectorSnapshot } from '../app/plugins/foxhole/nixie/spline-connector-snapshot.ts';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import { readNixieSceneV2EditableSpline } from '../../../nixie/desktop-extensions/scene-v2-spline-editing.ts';

registerFoxholeSceneV2HostPolicy();

test('authored Wall Tier 1 remains insertable with the implemented spline handles and finalizer', () => {
    const structure = getFoxholeManifest('/foxhole/assets/').assets.find(asset => asset.id === 'wallsplinet1')!;
    const snapshot = createFoxholeSplineConnectorSnapshot({ id: 'wall', foxholeKey: structure.id, structure,
        start: { x: 0, y: 0, rotation: 0 }, end: { x: 160, y: 0, rotation: 0 } });
    const original = structuredClone(snapshot);
    const converted = convertNixieSceneV1ToV2([snapshot], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });
    assert.equal(converted.report.preservedOnlyNodeCount, 0);
    assert.deepEqual(converted.report.issues.filter(issue => issue.code !== 'unmapped-state'), []);
    const entity = converted.content.entities[0]!;
    const spline = readNixieSceneV2EditableSpline({ ...entity,
        components: entity.components.map(component => ({ ...component, definitionAvailable: true })) });
    assert.equal(spline?.componentId, 'spline-connector');
    assert.equal(entity.components.find(component => component.componentId === 'spline-connector')?.data.foxholeKey, 'wallsplinet1');
    assert.deepEqual(snapshot, original);
});

test('old defense splines gain their published endpoint names during conversion', () => {
    for (const id of ['barbedwirespline', 'sandbaghalfspline', 'sandbagfullspline', 'waterwallsplinet1']) {
        const converted = convertNixieSceneV1ToV2([{ id, type: 'foxholeSplineConnector', state: {
            foxholeKey: id, start: { x: 0, y: 0, rotation: 0 }, end: { x: 160, y: 0, rotation: 0 },
        }, children: [] }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });
        const spline = converted.content.entities[0]!.components.find(component => component.componentId === 'spline-connector');
        assert.equal(spline?.data.startSocketName, 'BackSocket', id);
        assert.equal(spline?.data.endSocketName, 'FrontSocket', id);
    }
});

function capabilityIds(entity: { components: Array<{ ownerId: string; componentId: string; }>; }): string[] {
    return entity.components
        .filter(component => (
            component.ownerId === 'nixie.core'
            && component.componentId.startsWith('capability-')
            && component.componentId !== 'capability-model'
        ))
        .map(component => component.componentId);
}

function attachmentTarget() {
    return {
        id: 'factory-1',
        type: 'foxholeAsset',
        key: 'Ammo Factory',
        state: {
            foxholeKey: 'facilityfactoryammo',
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            visible: true,
        },
        children: [],
    };
}

test('spline conversion preserves the disabled arc constraint sentinel without a validation issue', () => {
    const converted = convertNixieSceneV1ToV2([{ id: 'pipe', type: 'foxholeSplineConnector', state: {
        foxholeKey: 'facilitypipeoverhead', maxArcAngleDeg: -1,
        start: { x: 0, y: 0, rotation: 0 }, end: { x: 200, y: 0, rotation: 0 },
    }, children: [] }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });
    assert.equal(converted.report.issues.some(issue => issue.message.includes('maxArcAngleDeg')), false);
    const splineComponent = converted.content.entities[0]!.components.find(component => component.componentId === 'spline-connector')!;
    assert.equal(splineComponent.data.maxArcAngleDeg, undefined);
    const preserved = converted.content.entities[0]!.components.find(component => component.componentId === 'legacy-source')!.data.snapshotJson;
    assert.equal(JSON.parse(String(preserved)).state.maxArcAngleDeg, -1);
});

test('Foxhole Ammo Factory converts to renderable Scene V2 components', () => {
    const result = convertNixieSceneV1ToV2([{
        id: 'factory-1',
        type: 'foxholeAsset',
        key: 'Ammo Factory',
        state: {
            foxholeKey: 'facilityfactoryammo',
            x: 100,
            y: 200,
            rotation: 0.25,
            scaleX: 1,
            scaleY: 1,
            visible: true,
            locked: false,
            anchorX: 0.5,
            anchorY: 0.5,
            modificationVariantIds: { upgrade: 'shell' },
            productionOrders: [{ recipeId: '120mm', parent: false, cycles: 2, label: 'Shells' }],
        },
        children: [],
    }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });

    assert.equal(result.report.supportedNodeCount, 1);
    assert.equal(result.report.preservedOnlyNodeCount, 0);
    assert.equal(result.report.visualParity, false);
    assert.ok(result.report.issues.some(issue => issue.message.includes('modification visuals')));
    const entity = result.content.entities[0]!;
    assert.deepEqual(entity.components.find(component => component.componentId === 'asset')?.data, {
        catalogId: 'foxhole.structures',
        assetId: 'facilityfactoryammo',
    });
    assert.deepEqual(entity.components.find(component => component.componentId === 'modification')?.data, {
        selections: [{ slotId: 'upgrade', variantId: 'shell' }],
    });
    assert.deepEqual(entity.components.find(component => component.componentId === 'production-order')?.data, {
        orders: [{ id: 'v1-1.order.1', recipeId: '120mm', cycles: 2, label: 'Shells' }],
    });
    assert.deepEqual(entity.components.find(component => component.componentId === 'socket-attachments')?.data, {
        attachments: [],
    });
    assert.deepEqual(capabilityIds(entity), ['capability-move', 'capability-rotate']);
});

test('Foxhole production orders preserve parent and unlimited-cycle semantics', () => {
    const result = convertNixieSceneV1ToV2([{
        id: 'factory-parent-order',
        type: 'foxholeAsset',
        key: 'Ammo Factory',
        state: {
            foxholeKey: 'facilityfactoryammo',
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            visible: true,
            productionOrders: [{
                recipeId: 'structure:facilityfactoryammo:recipe:0',
                parent: true,
                cycles: null,
            }],
        },
        children: [],
    }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });

    assert.equal(result.report.visualParity, true);
    assert.deepEqual(result.content.entities[0]?.components.find(component => (
        component.componentId === 'production-order'
    ))?.data, {
        orders: [{
            id: 'v1-1.order.1',
            recipeId: 'structure:facilityfactoryammo:recipe:0',
            parent: true,
        }],
    });
    assert.ok(!result.report.issues.some(issue => issue.message.includes('parent recipe')));
    assert.ok(!result.report.issues.some(issue => issue.message.includes('unlimited cycles')));
});

function artilleryBunkbedSnapshot(tier: 1 | 2 | 3) {
    return {
        id: `artillery-${tier}`,
        type: 'foxholeAsset',
        key: 'Artillery Garrison',
        state: {
            foxholeKey: `artilleryait${tier}`,
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            visible: true,
            modificationVariantIds: { BackInfraModSlot: 'bunkbed' },
        },
        children: [],
    };
}

// Native infrastructure starts at T2; T3 reuses the published T2 bunk visual.
for (const tier of [2, 3] as const) {
    test(`published Tier ${tier} bunkbed selections retain visual parity in Scene V2`, () => {
        const source = artilleryBunkbedSnapshot(tier);
        const structure = getFoxholeManifest('/foxhole/assets/').assets.find(asset => asset.id === source.state.foxholeKey)!;
        assert.ok(structure.modificationSlots.find(slot => slot.name === 'BackInfraModSlot')?.variants.bunkbed);

        const result = convertNixieSceneV1ToV2([source], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });

        assert.equal(result.report.visualParity, true);
        assert.deepEqual(result.report.issues, []);
        assert.deepEqual(result.content.entities[0]?.components.find(component => component.componentId === 'modification')?.data, {
            selections: [{ slotId: 'BackInfraModSlot', variantId: 'bunkbed' }],
        });
    });
}

test('Tier 1 bunkbed conversion reports unavailable infrastructure and preserves the saved selection', () => {
    const source = artilleryBunkbedSnapshot(1);
    const before = structuredClone(source);
    const structure = getFoxholeManifest('/foxhole/assets/').assets.find(asset => asset.id === source.state.foxholeKey)!;
    assert.equal(structure.modificationSlots.some(slot => slot.name === 'BackInfraModSlot'), false);

    const result = convertNixieSceneV1ToV2([source], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });

    assert.equal(result.report.supportedNodeCount, 1);
    assert.equal(result.report.dataPreserved, true);
    assert.equal(result.report.visualParity, false);
    assert.ok(result.report.issues.some(issue => issue.code === 'unsupported-state'
        && issue.message.includes('BackInfraModSlot/bunkbed')));
    const preserved = result.content.entities[0]?.components.find(component => component.componentId === 'legacy-source')?.data.snapshotJson;
    assert.equal(typeof preserved, 'string');
    assert.deepEqual(JSON.parse(String(preserved)).state, source.state);
    assert.deepEqual(source, before, 'conversion must not rewrite the original Tier 1 scene node');
});

test('Foxhole icon conversion composes a manifest-owned texture with the Nixie icon frame', () => {
    const result = convertNixieSceneV1ToV2([{
        id: 'factory-icon-1',
        type: 'nixieIcon',
        key: 'Ammo Factory',
        state: {
            x: 10,
            y: 20,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            visible: true,
            textureUrl: '/foxhole/assets/types/structures/facilityfactoryammo/facilityfactoryammo.icon.default.webp?v=1',
            label: 'Ammo Factory',
            frameWidth: 96,
            frameHeight: 96,
            padding: 14,
            backgroundColor: 0x0B0B0B,
            borderColor: 0x14B4EE,
            borderWidth: 3,
            iconTint: 0xFFFFFF,
            labelPosition: 'bottom',
            showFrame: true,
        },
        children: [],
    }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });

    assert.equal(result.report.visualParity, true);
    assert.ok(!result.report.issues.some(issue => issue.message.includes('arbitrary URL texture')));
    const entity = result.content.entities[0]!;
    assert.equal(entity.components.find(component => component.componentId === 'icon')?.ownerId, 'nixie.core');
    assert.deepEqual(entity.components.find(component => component.componentId === 'asset')?.data, {
        catalogId: 'foxhole.icons',
        assetId: 'facilityfactoryammo',
    });
});

test('published Foxhole assets and icons convert through the manifest-wide renderer', () => {
    const result = convertNixieSceneV1ToV2([{
        id: 'container-1',
        type: 'foxholeAsset',
        key: 'Shipping Container',
        state: {
            foxholeKey: 'shippingcontainer',
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            visible: true,
        },
        children: [],
    }, {
        id: 'container-icon-1',
        type: 'nixieIcon',
        key: 'Shipping Container',
        state: {
            x: 100,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            visible: true,
            textureUrl: '/foxhole/assets/types/structures/shippingcontainer/shippingcontainer.icon.default.webp?cache=1',
        },
        children: [],
    }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });

    assert.equal(result.report.supportedNodeCount, 2);
    assert.equal(result.report.visualParity, true);
    assert.equal(result.content.entities[0]?.components.find(component => component.componentId === 'asset')?.data.assetId, 'shippingcontainer');
    assert.deepEqual(result.content.entities[1]?.components.find(component => component.componentId === 'asset')?.data, {
        catalogId: 'foxhole.icons',
        assetId: 'shippingcontainer',
    });
});

test('Foxhole conversion reports unimplemented visuals while preserving their source state', () => {
    const result = convertNixieSceneV1ToV2([{
        id: 'bunker-1',
        type: 'foxholeAsset',
        state: {
            foxholeKey: 'shippingcontainer',
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            visible: true,
            destroyed: true,
        },
        children: [],
    }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });

    assert.equal(result.report.supportedNodeCount, 1);
    assert.equal(result.report.preservedOnlyNodeCount, 0);
    assert.equal(result.report.dataPreserved, true);
    assert.equal(result.report.visualParity, false);
    assert.ok(result.report.issues.some(issue => issue.message.includes('destroyed appearance')));
    assert.ok(!result.report.issues.some(issue => issue.message.includes('no Scene V2 product renderer')));
    assert.ok(result.content.entities[0]?.components.some(component => component.componentId === 'legacy-source'));
});

test('Foxhole conversion maps supported appearance state into editable Scene V2 components', () => {
    const node = (id: string, foxholeKey: string, appearance: Record<string, unknown>) => ({
        id,
        type: 'foxholeAsset',
        state: {
            foxholeKey,
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            visible: true,
            ...appearance,
        },
        children: [],
    });
    const result = convertNixieSceneV1ToV2([
        node('faction-1', 'engineeringcenter', { faction: 'w' }),
        node('color-1', 'liquidcontainer', { colorHex: '#FD9D06' }),
        node('destroyed-1', 'observationbunkert1', { destroyed: true }),
        node('packaged-1', 'motorcycleoffensivec', { packaged: true }),
        node('blueprint-1', 'observationbunkert1', {
            blueprint: true,
            tint: 0xDDEEFF,
            brightness: 1.5,
            anchorX: 0.25,
            anchorY: 0.75,
        }),
    ], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });

    assert.equal(result.report.supportedNodeCount, 5);
    assert.equal(result.report.visualParity, true);
    assert.deepEqual(result.content.entities.map(entity => (
        entity.components.find(component => component.componentId === 'appearance')?.data
    )), [
        { faction: 'w' },
        { colorHex: 'fd9d06' },
        { destroyed: true },
        { packaged: true },
        { blueprint: true, tint: 0xDDEEFF, brightness: 1.5, anchorX: 0.25, anchorY: 0.75 },
    ]);
    assert.equal(result.report.issues.length, 0);
    assert.ok(result.content.entities.every(entity => (
        entity.components.some(component => component.componentId === 'legacy-source')
    )), 'the duplicate keeps its non-destructive V1 recovery snapshot');
});

test('Foxhole conversion maps marked cargo into a bounded editable component', () => {
    const result = convertNixieSceneV1ToV2([{
        id: 'cargo-1',
        type: 'foxholeAsset',
        state: {
            foxholeKey: 'artilleryait1',
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            visible: true,
            markedItemCodenames: ['Diesel', 'Petrol', 'Diesel'],
        },
        children: [],
    }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });

    assert.equal(result.report.visualParity, true);
    assert.deepEqual(
        result.content.entities[0]?.components.find(component => component.componentId === 'cargo')?.data,
        { items: ['Diesel', 'Petrol'] },
    );
    assert.ok(!result.report.issues.some(issue => issue.message.includes('marked cargo')));
});

test('Foxhole conversion drops stale cargo selections on build sites', () => {
    const result = convertNixieSceneV1ToV2([{
        id: 'buildsite-cargo',
        type: 'foxholeAsset',
        state: {
            foxholeKey: 'fortbuildsite',
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            visible: true,
            markedItemCodenames: ['Diesel'],
        },
        children: [],
    }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });

    assert.deepEqual(
        result.content.entities[0]?.components.find(component => component.componentId === 'cargo')?.data,
        { items: [] },
    );
});

test('Foxhole conversion keeps unknown cargo in legacy source and reports the parity gap', () => {
    const result = convertNixieSceneV1ToV2([{
        id: 'cargo-unknown',
        type: 'foxholeAsset',
        state: {
            foxholeKey: 'artilleryait1',
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            visible: true,
            markedItemCodenames: ['NotARealFoxholeItem'],
        },
        children: [],
    }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });

    assert.equal(result.report.visualParity, false);
    assert.ok(result.report.issues.some(issue => issue.message.includes('has no published Scene V2 icon')));
    assert.deepEqual(
        result.content.entities[0]?.components.find(component => component.componentId === 'cargo')?.data,
        { items: [] },
    );
    assert.ok(result.content.entities[0]?.components.some(component => component.componentId === 'legacy-source'));
});

test('Foxhole tactical lines convert to editable renderer data without losing their style', () => {
    const result = convertNixieSceneV1ToV2([{
        id: 'line-1',
        type: 'foxholeTacticalLine',
        key: 'Advance Route',
        state: {
            x: 10,
            y: 20,
            rotation: 0.4,
            scaleX: 1,
            scaleY: 1,
            visible: true,
            locked: false,
            id: 'advance',
            label: 'Advance',
            description: 'Offensive movement line.',
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
        children: [],
    }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });

    assert.equal(result.report.supportedNodeCount, 1);
    assert.equal(result.report.visualParity, true);
    const line = result.content.entities[0]?.components.find(component => component.componentId === 'tactical-line');
    assert.deepEqual(line?.data.points, [0, 0, 80, 20, 160, 0]);
    assert.equal(line?.data.curveMode, 'smooth');
    assert.equal(line?.data.endCap, 'arrow');
    assert.equal(line?.data.decoratorMode, 'triangle');
    assert.deepEqual(capabilityIds(result.content.entities[0]!), [
        'capability-move',
        'capability-rotate',
        'capability-geometry-resize',
        'capability-geometry-reshape',
    ]);
});

test('Foxhole connectors remap live attachments to Scene V2 entity IDs', () => {
    const result = convertNixieSceneV1ToV2([attachmentTarget(), {
        id: 'connector-1',
        type: 'foxholeConnector',
        key: 'Power Line',
        state: {
            foxholeKey: 'powerline',
            x: -40,
            y: 20,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            visible: true,
            alpha: 0.6,
            points: [0, 0, 80, 20, 160, 0],
            startSocketName: 'PowerStart',
            endSocketName: 'PowerEnd',
            startAttachment: { nodeId: 'factory-1', socketName: 'Power' },
        },
        children: [],
    }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });

    assert.equal(result.report.supportedNodeCount, 2);
    assert.ok(!result.report.issues.some(issue => issue.message.includes('attached socket')));
    const connector = result.content.entities[1]?.components.find(component => component.componentId === 'connector');
    assert.deepEqual(connector?.data, {
        foxholeKey: 'powerline',
        points: [0, 0, 80, 20, 160, 0],
        startSocketName: 'PowerStart',
        endSocketName: 'PowerEnd',
        startAttachment: { nodeId: 'v1-1', socketName: 'Power' },
    });
    assert.deepEqual(result.content.entities[1]?.components.find(component => component.componentId === 'visibility')?.data, {
        visible: true,
        alpha: 0.6,
    });
    assert.deepEqual(capabilityIds(result.content.entities[1]!), [
        'capability-move',
        'capability-rotate',
        'capability-geometry-resize',
        'capability-geometry-reshape',
    ]);
});

test('Foxhole spline connectors preserve live attachments without blocking insertion', () => {
    const result = convertNixieSceneV1ToV2([attachmentTarget(), {
        id: 'spline-connector-1',
        type: 'foxholeSplineConnector',
        key: 'Facility Pipe',
        state: {
            foxholeKey: 'facilitypipe',
            x: 40,
            y: -20,
            rotation: 0.15,
            scaleX: 1,
            scaleY: 1,
            visible: true,
            alpha: 0.7,
            locked: false,
            start: { x: 0, y: 0, rotation: 0, handleLength: 72 },
            end: { x: 180, y: 60, rotation: Math.PI, handleLength: 64 },
            minLength: 48,
            maxLength: 100_000,
            minRadius: 24,
            maxRadius: 48,
            maxBuffer: 90,
            curveT: 0.6,
            maxTargetAngleDeg: 120,
            maxArcAngleDeg: 180,
            startSocketName: 'PipeStart',
            endSocketName: 'PipeEnd',
            startAttachment: { nodeId: 'factory-1', socketName: 'Pipe' },
            socketAttachments: { PipeStart: { nodeId: 'factory-1', socketName: 'PipeEnd' } },
            modificationVariantIds: { pipeStyle: 'reinforced' },
            blueprint: true,
            tint: 0x55CCEE,
            brightness: 0.8,
        },
        children: [],
    }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });

    assert.equal(result.report.supportedNodeCount, 2);
    assert.equal(result.report.visualParity, true);
    assert.ok(!result.report.issues.some(issue => issue.message.includes('spline endpoint socket-snapping')));
    assert.ok(!result.report.issues.some(issue => issue.message.includes('attached socket')));
    assert.deepEqual(result.report.issues, []);
    const connector = result.content.entities[1]?.components.find(component => component.componentId === 'spline-connector');
    assert.deepEqual(connector?.data, {
        foxholeKey: 'facilitypipe',
        startX: 0,
        startY: 0,
        startRotation: 0,
        startHandleLength: 72,
        endX: 180,
        endY: 60,
        endRotation: Math.PI,
        endHandleLength: 64,
        minLength: 48,
        maxLength: 100_000,
        minRadius: 24,
        maxRadius: 48,
        maxBuffer: 90,
        curveT: 0.6,
        maxTargetAngleDeg: 120,
        maxArcAngleDeg: 180,
        startSocketName: 'PipeStart',
        endSocketName: 'PipeEnd',
        startAttachmentNodeId: 'v1-1',
        startAttachmentSocketName: 'Pipe',
        blueprint: true,
        tint: 0x55CCEE,
        brightness: 0.8,
    });
    assert.deepEqual(result.content.entities[1]?.components.find(component => component.componentId === 'modification')?.data, {
        selections: [{ slotId: 'pipeStyle', variantId: 'reinforced' }],
    });
    assert.deepEqual(result.content.entities[1]?.components.find(component => component.componentId === 'socket-attachments')?.data, {
        attachments: [{
            localSocketName: 'PipeStart',
            targetEntityId: 'v1-1',
            targetSocketName: 'PipeEnd',
        }],
    });
});

test('Foxhole structure socket topology becomes remapped Scene V2 component data', () => {
    const result = convertNixieSceneV1ToV2([attachmentTarget(), {
        id: 'factory-2',
        type: 'foxholeAsset',
        key: 'Second Ammo Factory',
        state: {
            foxholeKey: 'facilityfactoryammo',
            x: 200,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            visible: true,
            socketAttachments: {
                Pipe: { nodeId: 'factory-1', socketName: 'Pipe' },
            },
        },
        children: [],
    }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });

    assert.deepEqual(result.content.entities[1]?.components.find(component => (
        component.componentId === 'socket-attachments'
    ))?.data, {
        attachments: [{
            localSocketName: 'Pipe',
            targetEntityId: 'v1-1',
            targetSocketName: 'Pipe',
        }],
    });
    assert.deepEqual(result.report.issues, []);
    assert.ok(!result.report.issues.some(issue => issue.message.includes('not represented')));
});

test('Foxhole ranges convert to editable renderer data without losing display settings', () => {
    const result = convertNixieSceneV1ToV2([{
        id: 'range-1',
        type: 'foxholeRange',
        key: 'Range',
        state: {
            x: 20,
            y: -30,
            rotation: 0.2,
            scaleX: 1,
            scaleY: 1,
            visible: true,
            alpha: 0.75,
            locked: false,
            points: [0, 0, 192, 0],
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
            showCenterAxis: true,
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
        children: [],
    }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });

    assert.equal(result.report.supportedNodeCount, 1);
    assert.equal(result.report.visualParity, true);
    const range = result.content.entities[0]?.components.find(component => component.componentId === 'range');
    assert.equal(range?.data.sweepAngle, 120);
    assert.equal(range?.data.strokeStyle, 'dashed');
    assert.equal(range?.data.showCenterAxis, true);
    assert.equal(range?.data.meterPixels, 32);
    assert.deepEqual(result.content.entities[0]?.components.find(component => component.componentId === 'visibility')?.data, {
        visible: true,
        alpha: 0.75,
    });
});

test('Foxhole binocular lines convert to measured renderer data without losing caps', () => {
    const result = convertNixieSceneV1ToV2([{
        id: 'binocular-line-1',
        type: 'foxholeBinocularLine',
        key: 'Binocular Line',
        state: {
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            visible: true,
            locked: false,
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
        children: [],
    }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });

    assert.equal(result.report.supportedNodeCount, 1);
    assert.equal(result.report.visualParity, true);
    const line = result.content.entities[0]?.components.find(component => component.componentId === 'binocular-line');
    assert.deepEqual(line?.data.points, [0, 0, 160, 0]);
    assert.equal(line?.data.startCap, 'circle');
    assert.equal(line?.data.endCap, 'arrow');
    assert.equal(line?.data.showAzimuthArrows, true);
});

test('Foxhole triangulations convert to fitted renderer data without losing display settings', () => {
    const result = convertNixieSceneV1ToV2([{
        id: 'triangulation-1',
        type: 'foxholeTriangulation',
        key: 'Triangulation',
        state: {
            x: 30,
            y: 40,
            rotation: 0.3,
            scaleX: 1,
            scaleY: 1,
            visible: true,
            alpha: 0.8,
            locked: false,
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
        children: [],
    }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });

    assert.equal(result.report.supportedNodeCount, 1);
    assert.equal(result.report.visualParity, true);
    const triangulation = result.content.entities[0]?.components.find(component => component.componentId === 'triangulation');
    assert.deepEqual(triangulation?.data.edgePoints, [160, 0, 0, 160, -160, 0]);
    assert.equal(triangulation?.data.strokeStyle, 'dashed');
    assert.equal(triangulation?.data.showSpokes, true);
    assert.equal(triangulation?.data.edgeLineAlpha, 0.35);
    assert.deepEqual(result.content.entities[0]?.components.find(component => component.componentId === 'visibility')?.data, {
        visible: true,
        alpha: 0.8,
    });
});

test('invalid socket topology still blocks insertion rather than claiming parity', () => {
    for (const [socketAttachments, expected] of [
        [[], /malformed/],
        [{ Pipe: { nodeId: 'missing', socketName: 'Pipe' } }, /missing or ambiguous/],
        [{ Pipe: { nodeId: 'factory-1' } }, /malformed/],
        [Object.fromEntries(Array.from({ length: 129 }, (_, index) => [String(index), { nodeId: 'factory-1', socketName: 'Pipe' }])), /component limit/],
    ] as const) {
        const source = [attachmentTarget(), { ...attachmentTarget(), id: 'factory-2', state: {
            ...attachmentTarget().state, socketAttachments,
        } }];
        const original = structuredClone(source);
        const result = convertNixieSceneV1ToV2(source, { nodeConverters: [convertFoxholeSceneV1NodeToV2] });
        assert.equal(result.report.visualParity, false);
        assert.ok(result.report.issues.some(issue => issue.code === 'unsupported-state' && expected.test(issue.message)));
        assert.deepEqual(source, original);
    }
});
