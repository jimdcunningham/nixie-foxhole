import assert from 'node:assert/strict';
import test from 'node:test';
import {
    collectFoxholeLivePreviewTargetNodeIds,
    hasFoxholeLiquidPipeSocketTag,
} from '../app/plugins/foxhole/nixie/structure-socket-snapping.ts';
import {
    FOXHOLE_PIPE_BIDIRECTIONAL_SOCKET_COLOR,
    FOXHOLE_PIPE_INPUT_SOCKET_COLOR,
    FOXHOLE_PIPE_OUTPUT_SOCKET_COLOR,
    resolveFoxholePipeSocketColor,
    resolveFoxholePipeSocketFlow,
    resolveFoxholeSocketOverlayOccupancyKeys,
    resolveFoxholeSocketKind,
} from '../app/plugins/foxhole/nixie/structure-socket-visuals.ts';

test('resolveFoxholePipeSocketFlow maps explicit pipe types', () => {
    assert.equal(resolveFoxholePipeSocketFlow('Input'), 'input');
    assert.equal(resolveFoxholePipeSocketFlow('output'), 'output');
    assert.equal(resolveFoxholePipeSocketFlow(''), 'bidirectional');
});

test('resolveFoxholePipeSocketColor uses legacy palette', () => {
    assert.equal(resolveFoxholePipeSocketColor('input'), FOXHOLE_PIPE_INPUT_SOCKET_COLOR);
    assert.equal(resolveFoxholePipeSocketColor('output'), FOXHOLE_PIPE_OUTPUT_SOCKET_COLOR);
    assert.equal(resolveFoxholePipeSocketColor('bidirectional'), FOXHOLE_PIPE_BIDIRECTIONAL_SOCKET_COLOR);
});

test('hasFoxholeLiquidPipeSocketTag recognizes liquid pipeline socket tags', () => {
    assert.equal(hasFoxholeLiquidPipeSocketTag([{ mask: 16795648n, category: 2048n }]), true);
    assert.equal(hasFoxholeLiquidPipeSocketTag([{ mask: 16779264n, category: 16384n }]), true);
    assert.equal(hasFoxholeLiquidPipeSocketTag([{ mask: 18432n, category: 16777216n }]), true);
    assert.equal(hasFoxholeLiquidPipeSocketTag([{ mask: 2097152n, category: 2097152n }]), false);
    assert.equal(hasFoxholeLiquidPipeSocketTag([{ mask: 4608n, category: 512n }]), false);
    assert.equal(hasFoxholeLiquidPipeSocketTag([{ mask: 33554432n, category: 33554432n }]), false);
});

test('resolveFoxholeSocketKind only classifies liquid pipe sockets as pipe', () => {
    assert.equal(resolveFoxholeSocketKind({ name: 'FrontSocket' }), 'generic');
    assert.equal(resolveFoxholeSocketKind({ name: 'BackSocket' }), 'generic');
    assert.equal(resolveFoxholeSocketKind({ name: 'WallSplineCommon:FrontSocket', socketTags: [{ mask: 4608n, category: 512n }] }), 'generic');
    assert.equal(resolveFoxholeSocketKind({
        name: 'FrontSocket',
        socketTags: [{ mask: 16795648n, category: 2048n }],
    }), 'pipe');
    assert.equal(resolveFoxholeSocketKind({ name: 'PipeInput0', pipeType: 'Input' }), 'pipe');
    assert.equal(resolveFoxholeSocketKind({ name: 'PowerSocket' }), 'power');
});

test('live socket previews retain earlier targets until they can be restored', () => {
    const targets = collectFoxholeLivePreviewTargetNodeIds({
        nearbyTargetNodeIds: ['nearby'],
        previouslyTouchedTargetNodeIds: ['earlier-preview', 'moving'],
        occupancyAttachmentsByNode: new Map([
            ['drag-start-partner', { Front: { nodeId: 'moving' } }],
            ['unrelated', { Front: { nodeId: 'someone-else' } }],
        ]),
        selectedNodeIds: new Set(['moving']),
    });

    assert.deepEqual([...targets].sort(), [
        'drag-start-partner',
        'earlier-preview',
        'nearby',
    ]);
});

test('live socket visuals ignore stale scene occupancy after dragging away', () => {
    const localAttachmentKeys = new Set<string>();
    const staleSceneOccupancyKeys = new Set(['target:Bottom']);

    assert.equal(resolveFoxholeSocketOverlayOccupancyKeys({
        liveAttachmentPreviewActive: true,
        localAttachmentKeys,
        sceneOccupancyKeys: staleSceneOccupancyKeys,
    }), localAttachmentKeys);
    assert.equal(resolveFoxholeSocketOverlayOccupancyKeys({
        liveAttachmentPreviewActive: false,
        localAttachmentKeys,
        sceneOccupancyKeys: staleSceneOccupancyKeys,
    }), staleSceneOccupancyKeys);
});
