import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { NixieComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { NixieToolRealtimeEventMessage } from '../../../../nixie/app/plugins/nixie/project.ts';
import { SceneV2PlacementPresence } from '../../../../nixie/app/plugins/nixie/scene-v2/placement-presence.ts';
import type { SceneV2RemotePlacement } from '../../../../nixie/app/plugins/nixie/scene-v2/placement-presence.ts';
import { applySceneV2TransformChanges, createSceneV2TransformChanges } from '../../../../nixie/app/plugins/nixie/scene-v2/transform-presence.ts';

const presenceSource = readFileSync(
    hostSourceUrl('../../../../nixie/app/plugins/nixie/services/presence.ts', import.meta.url),
    'utf8',
);
const ownerId = 'nixie.foxhole-planner';

function connector(endX: number, attached = false): NixieComponentEntitySnapshotV1 {
    return { entityId: 'pipe', revision: 0, components: [
        { ownerId: 'nixie.core', componentId: 'transform', version: 1, definitionAvailable: true, data: { x: 0, y: 0 } },
        { ownerId, componentId: 'spline-connector', version: 1, definitionAvailable: true,
            data: { foxholeKey: 'facilitypipe', startX: 0, startY: 0, startRotation: 0, endX, endY: 0, endRotation: Math.PI,
                ...(attached ? { endAttachmentNodeId: 'station', endAttachmentSocketName: 'Pipe' } : {}) } },
    ] };
}

test('editable handle previews transmit the typed endpoint without writing to the source', () => {
    const before = [connector(128)];
    const preview = [connector(160)];
    const changes = createSceneV2TransformChanges(before, preview);
    assert.deepEqual(changes[0]?.components, [preview[0]!.components[1]]);
    assert.deepEqual(applySceneV2TransformChanges(before, changes), preview);
    assert.deepEqual(before, [connector(128)]);
});

test('connector placement publishes typed geometry until commit or cancel', context => {
    const listeners = new Set<(message: NixieToolRealtimeEventMessage) => void>();
    let eventId = 0;
    let visible: readonly SceneV2RemotePlacement[] = [];
    let now = 10_000;
    const project = {
        getRealtimeSenderId: () => 'local',
        onToolRealtimeEvent(listener: (message: NixieToolRealtimeEventMessage) => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        async publishToolRealtimeEvent(payload: NixieToolRealtimeEventMessage['payload']) {
            const message = { projectId: 'test', eventId: String(++eventId), senderId: 'remote',
                timestamp: new Date().toISOString(), payload };
            listeners.forEach(listener => listener(message));
        },
    };
    const writer = new SceneV2PlacementPresence({ project, viewId: 'scene', onChange() {}, now: () => now });
    const reader = new SceneV2PlacementPresence({ project, viewId: 'scene', onChange: placements => { visible = placements; } });
    context.after(() => {
        writer.destroy();
        reader.destroy();
    });
    writer.update([connector(128)]);
    assert.deepEqual(visible[0]?.entities, [connector(128)]);
    now += 250;
    writer.update([connector(160, true)]);
    assert.deepEqual(visible[0]?.entities, [connector(160, true)]);
    writer.clear();
    assert.deepEqual(visible, []);
    now += 250;
    writer.update([connector(160, true)]);
    writer.clear(true);
    assert.equal(visible[0]?.committed, true);
    assert.deepEqual(visible[0]?.entities, [connector(160, true)]);
});

test('socket attachments ride the transient Scene V2 move preview alongside transforms', () => {
    const before = [connector(128, true)];
    const moved = connector(160);
    moved.components[0]!.data.x = 32;
    const changes = createSceneV2TransformChanges(before, [moved]);
    assert.deepEqual(changes[0]?.components, moved.components);
    const received = applySceneV2TransformChanges(before, changes);
    assert.deepEqual(received, [moved]);
    assert.equal(received[0]!.components[1]!.data.endAttachmentNodeId, undefined);
    assert.deepEqual(before, [connector(128, true)]);
});

test('remote editable previews apply transiently and cannot revert a newer commit', () => {
    assert.match(
        presenceSource,
        /parseSelectionPreviewEditableNodes[\s\S]*?payload\.editableNodes/,
    );
    assert.match(
        presenceSource,
        /syncRemoteEditablePreview[\s\S]*?reason: 'selection-remote-editable-preview'[\s\S]*?source: 'remote'[\s\S]*?recordHistory: false/,
    );
    assert.match(
        presenceSource,
        /restoreNodeEditablePreview[\s\S]*?node\.boardRevision\.value !== preview\.appliedRevision[\s\S]*?selection-remote-editable-preview-revert/,
    );
    assert.match(
        presenceSource,
        /persistedPreviewKey[\s\S]*?authoritative revision after our transient patch supersedes[\s\S]*?isSelectionPreviewPatchCommitted[\s\S]*?settledRemoteEditablePreviewKeys\.set/,
    );
    assert.match(
        presenceSource,
        /this\.syncRemoteEditablePreview\(remoteSession\);[\s\S]*?Apply transient transforms last[\s\S]*?this\.syncRemoteSelectionPreview\(remoteSession\);/,
    );
});
