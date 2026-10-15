import assert from 'node:assert/strict';
import test from 'node:test';
import type {
    NixieExperimentalComponentEntitySnapshotV1,
    NixieExperimentalEntityRendererContextV1,
} from '@nixie/extension-sdk/experimental/scene-v2';
import {
    resolveFoxholeSceneV2ConnectorAttachments,
    resolveFoxholeSceneV2SplineAttachments,
} from '../src/scene-v2-attachments.ts';

const metadata = {
    factory: {
        label: 'Factory',
        codeName: 'Factory',
        category: 'facility',
        keywords: [],
        isItem: false,
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        canBlueprint: false,
        factionVariants: {},
        colorVariants: {},
        buildSockets: [{ name: 'PowerSocket_GEN_VARIABLE', x: 10, y: 0, rotation: 0 }],
        renderLayers: {},
        modifications: {},
    },
};

const connector: NixieExperimentalComponentEntitySnapshotV1 = {
    entityId: 'connector',
    revision: 0,
    components: [{
        ownerId: 'nixie.core',
        componentId: 'transform',
        version: 1,
        definitionAvailable: true,
        data: { x: 20, y: 10, rotation: 0, scaleX: 1, scaleY: 1 },
    }],
};

const target: NixieExperimentalComponentEntitySnapshotV1 = {
    entityId: 'target',
    revision: 0,
    components: [{
        ownerId: 'nixie.core',
        componentId: 'transform',
        version: 1,
        definitionAvailable: true,
        data: { x: 100, y: 50, rotation: Math.PI / 2, scaleX: 1, scaleY: 1 },
    }, {
        ownerId: 'nixie.foxhole-planner',
        componentId: 'asset',
        version: 1,
        definitionAvailable: true,
        data: { catalogId: 'foxhole.structures', assetId: 'factory' },
    }],
};

const context: NixieExperimentalEntityRendererContextV1 = { contractVersion: 1, entities: [connector, target] };

test('straight connector endpoints follow a linked target socket in connector-local space', () => {
    const resolved = resolveFoxholeSceneV2ConnectorAttachments(connector, {
        foxholeKey: 'powerline',
        points: [0, 0, 25, 30],
        startAttachment: { nodeId: 'target', socketName: 'PowerSocket' },
    }, context, metadata);

    assert.ok(Math.abs(resolved.points[0]! - 80) < 1e-9);
    assert.ok(Math.abs(resolved.points[1]! - 50) < 1e-9);
    assert.deepEqual(resolved.points.slice(2), [25, 30]);
});

test('spline endpoints and tangents follow a linked target socket', () => {
    const resolved = resolveFoxholeSceneV2SplineAttachments(connector, {
        foxholeKey: 'pipeline',
        startX: 0,
        startY: 0,
        startRotation: 0,
        endX: 25,
        endY: 30,
        endRotation: 0,
        minLength: 1,
        maxLength: 100,
        minRadius: 1,
        maxRadius: 100,
        maxBuffer: 100,
        curveT: 1,
        blueprint: false,
        startAttachmentNodeId: 'target',
        startAttachmentSocketName: 'PowerSocket',
    }, context, metadata);

    assert.ok(Math.abs(resolved.startX - 80) < 1e-9);
    assert.ok(Math.abs(resolved.startY - 50) < 1e-9);
    assert.ok(Math.abs(resolved.startRotation - Math.PI / 2) < 1e-9);
    assert.deepEqual([resolved.endX, resolved.endY], [25, 30]);
});
