import assert from 'node:assert/strict';
import test from 'node:test';
import {
    remapFoxholeRenderLayersWithUpgrade,
    resolveFoxholeSplineConnectorRenderLayers,
    resolveFoxholeSplineConnectorUpgradeHoverPreviewAlpha,
} from '../app/plugins/foxhole/nixie/spline-connector-upgrade-layers.ts';
import { normalizeFoxholeSplineConnectorState, FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE } from '../app/plugins/foxhole/nixie/spline-connector.ts';
import { createFoxholeSplineConnectorSnapshot } from '../app/plugins/foxhole/nixie/spline-connector-snapshot.ts';
import { createFoxholeStructureAssetSnapshot } from '../app/plugins/foxhole/nixie/structure-asset-snapshot.ts';

function createLayer(id: string, textureUrl: string) {
    return {
        id,
        textureUrl,
        width: 10,
        height: 10,
        anchorX: 0.5,
        anchorY: 0.5,
        offsetX: 0,
        offsetY: 0,
        componentName: null,
        componentTags: [],
    };
}

function createAsset(options?: {
    modificationVariantIds?: Record<string, string>;
    insulationLayers?: ReturnType<typeof createLayer>[];
}) {
    const insulationLayers = options?.insulationLayers ?? [
        createLayer('backtrim', '/insulated/backtrim.webp'),
        createLayer('span', '/insulated/span.webp'),
        createLayer('fronttrim', '/insulated/fronttrim.webp'),
    ];
    const insulationVariant = {
        id: 'insulation',
        modificationId: 'insulation',
        name: 'Insulated Pipe',
        nameLocalizationId: null,
        description: '',
        descriptionLocalizationId: null,
        requiredSocketConnectionMask: null,
        hiddenBySocketConnectionMask: null,
        textureUrl: '/insulated/composite.webp',
        iconUrl: null,
        previewIconUrl: null,
        previewUrl: null,
        previewDirection: null,
        textureWidth: null,
        textureHeight: null,
        anchorX: null,
        anchorY: null,
        offsetX: null,
        offsetY: null,
        renderLayers: insulationLayers,
        buildSockets: [],
        cost: {},
        isUpgrade: true,
        upgradeName: 'Insulated Pipe',
        parentStructureId: 'facilitypipe',
        rootStructureId: 'facilitypipe',
        appliedModificationId: 'insulation',
    };
    const slot = {
        id: 'UpgradeSlotComponent',
        name: 'UpgradeSlotComponent',
        componentType: 'ModificationSlotComponent',
        x: null,
        y: null,
        z: null,
        rotation: null,
        isLinkedToSocket: false,
        linkedSocketNames: [],
        blockedByModSlotNames: [],
        variants: [insulationVariant],
        variantById: { insulation: insulationVariant },
    };

    return {
        foxholeKey: 'facilitypipe',
        renderLayers: [
            createLayer('backtrim', '/base/backtrim.webp'),
            createLayer('span', '/base/span.webp'),
            createLayer('fronttrim', '/base/fronttrim.webp'),
        ],
        modificationSlots: [slot],
        modificationSlotById: { UpgradeSlotComponent: slot },
    } as any;
}

test('normalizeFoxholeSplineConnectorState keeps modificationVariantIds', () => {
    const state = normalizeFoxholeSplineConnectorState({
        foxholeKey: 'facilitypipe',
        modificationVariantIds: {
            UpgradeSlotComponent: 'insulation',
        },
    });

    assert.deepEqual(state.modificationVariantIds, {
        UpgradeSlotComponent: 'insulation',
    });
});

test('createFoxholeSplineConnectorSnapshot seeds modificationVariantIds', () => {
    const snapshot = createFoxholeSplineConnectorSnapshot({
        foxholeKey: 'facilitypipe',
        modificationVariantIds: {
            UpgradeSlotComponent: 'insulation',
        },
    });

    assert.equal(snapshot.type, FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE);
    assert.deepEqual(snapshot.state.modificationVariantIds, {
        UpgradeSlotComponent: 'insulation',
    });
});

test('createFoxholeStructureAssetSnapshot passes upgrade selections onto spline connectors', () => {
    const snapshot = createFoxholeStructureAssetSnapshot({
        asset: {
            foxholeKey: 'facilitypipe',
        } as any,
        structure: {
            connector: {
                splineComponentName: 'SplineConnector',
                minLengthCm: 300,
                maxLengthCm: 2000,
            },
        } as any,
        label: 'Pipeline (Insulated Pipe)',
        modificationVariantIds: {
            UpgradeSlotComponent: 'insulation',
        },
        x: 10,
        y: 20,
    });

    assert.equal(snapshot.type, FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE);
    assert.equal(snapshot.state.foxholeKey, 'facilitypipe');
    assert.deepEqual(snapshot.state.modificationVariantIds, {
        UpgradeSlotComponent: 'insulation',
    });
});

test('remapFoxholeRenderLayersWithUpgrade swaps matching layer textures', () => {
    const remapped = remapFoxholeRenderLayersWithUpgrade(
        [
            createLayer('backtrim', '/base/backtrim.webp'),
            createLayer('span', '/base/span.webp'),
            createLayer('fronttrim', '/base/fronttrim.webp'),
        ],
        [
            createLayer('backtrim', '/insulated/backtrim.webp'),
            createLayer('span', '/insulated/span.webp'),
        ],
    );

    assert.equal(remapped[0]?.textureUrl, '/insulated/backtrim.webp');
    assert.equal(remapped[1]?.textureUrl, '/insulated/span.webp');
    assert.equal(remapped[2]?.textureUrl, '/base/fronttrim.webp');
});

test('resolveFoxholeSplineConnectorRenderLayers applies selected insulation layers', () => {
    const layers = resolveFoxholeSplineConnectorRenderLayers({
        asset: createAsset(),
        modificationVariantIds: {
            UpgradeSlotComponent: 'insulation',
        },
    });

    assert.deepEqual(layers.map(layer => layer.textureUrl), [
        '/insulated/backtrim.webp',
        '/insulated/span.webp',
        '/insulated/fronttrim.webp',
    ]);
});

test('resolveFoxholeSplineConnectorRenderLayers restores base layers when previewing base upgrade', () => {
    const layers = resolveFoxholeSplineConnectorRenderLayers({
        asset: createAsset(),
        modificationVariantIds: {
            UpgradeSlotComponent: 'insulation',
        },
        nodeId: 'pipe-1',
        hoverPreview: {
            nodeId: 'pipe-1',
            slotId: 'UpgradeSlotComponent',
            variantId: '',
            mode: 'replacement',
        },
    });

    assert.deepEqual(layers.map(layer => layer.textureUrl), [
        '/base/backtrim.webp',
        '/base/span.webp',
        '/base/fronttrim.webp',
    ]);
});

test('resolveFoxholeSplineConnectorUpgradeHoverPreviewAlpha ghosts only real swaps', () => {
    const asset = createAsset({
        modificationVariantIds: { UpgradeSlotComponent: 'insulation' },
    });

    assert.equal(resolveFoxholeSplineConnectorUpgradeHoverPreviewAlpha({
        asset,
        modificationVariantIds: { UpgradeSlotComponent: 'insulation' },
        hoverPreview: {
            nodeId: 'pipe-1',
            slotId: 'UpgradeSlotComponent',
            variantId: 'insulation',
            mode: 'replacement',
        },
        nodeId: 'pipe-1',
        previewAlpha: 0.52,
    }), 1);

    assert.equal(resolveFoxholeSplineConnectorUpgradeHoverPreviewAlpha({
        asset: createAsset(),
        modificationVariantIds: {},
        hoverPreview: {
            nodeId: 'pipe-1',
            slotId: 'UpgradeSlotComponent',
            variantId: 'insulation',
            mode: 'replacement',
        },
        nodeId: 'pipe-1',
        previewAlpha: 0.52,
    }), 0.52);
});
