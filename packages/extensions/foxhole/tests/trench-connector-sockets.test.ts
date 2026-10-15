import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import { resolveFoxholeConnectorEndpointSockets, reconcileFoxholeConnectorAttachments } from '../app/plugins/foxhole/nixie/connector.ts';
import { createFoxholeSplineConnectorSnapshot } from '../app/plugins/foxhole/nixie/spline-connector-snapshot.ts';
import { resolveFoxholeSplineEndpointSocketSnap } from '../app/plugins/foxhole/nixie/spline-connector-placement.ts';
import { resolveConnectorSocketSnapStemRotation } from '../app/plugins/foxhole/nixie/spline-connector.ts';
import { normalizeFoxholeSocketTags } from '../app/plugins/foxhole/nixie/structure-socket-snapping.ts';
import { trenchConnectorCorners } from '../app/plugins/foxhole/nixie/trench-connector.ts';

const assets = getFoxholeManifest('/foxhole/assets/').assets;
const keys = ['trenchconnectorbuildsite', 'trenchconnectort1', 'trenchconnectort2', 'trenchconnectort3'];

for (const key of keys) test(`${key} snaps both ends and maintains reciprocal trench attachments`, () => {
    const structure = assets.find(asset => asset.id === key)!;
    const state = createFoxholeSplineConnectorSnapshot({ foxholeKey: key, structure,
        start: { x: 0, y: 0, rotation: 0 }, end: { x: 160, y: 0, rotation: 0 } }).state;
    const endpoints = resolveFoxholeConnectorEndpointSockets(structure, state);
    for (const targetKey of [...keys, 'trencht1', 'trencht2', 'trencht3', 'trenchintt1', 'trenchintt2', 'trenchintt3']) {
        const targetAsset = assets.find(asset => asset.id === targetKey)!;
        // Real manifest tags and socket names, including inherited-name prefixes.
        const sockets = targetAsset.buildSockets!.filter(socket => /(?:^|:)(?:Back|Front|Left|Right)Socket$/.test(socket.name));
        for (const socket of sockets) for (const role of ['start', 'end'] as const) for (const angle of [-0.6, 0, 0.6]) {
            const endpoint = endpoints[role]!;
            const targetRotation = (socket.rotation ?? 0) * Math.PI / 180 + angle;
            const desiredRotation = targetRotation + (role === 'start' ? 0 : -Math.PI);
            const posed = { ...state, [role]: { ...state[role], rotation: desiredRotation + 0.05 } };
            const target = { nodeId: 'host', socketName: socket.name, x: 160, y: 30,
                rotation: targetRotation, socketTags: normalizeFoxholeSocketTags(socket.socketTags) };
            const moving = { nodeId: 'connector', socketName: endpoint.name, x: 164, y: 32,
                rotation: resolveConnectorSocketSnapStemRotation(role, posed[role].rotation, 0, key), socketTags: endpoint.socketTags };
            const snap = resolveFoxholeSplineEndpointSocketSnap({ state: posed, role, local: moving, world: moving,
                nodeRotation: 0, movingSocket: moving, targetSockets: [target], toLocal: point => point, isAvailable: () => true });
            assert.deepEqual(snap.attachment, { nodeId: 'host', socketName: socket.name }, `${key} -> ${targetKey}, ${role}`);
            assert.deepEqual(snap.local, { x: target.x, y: target.y });
            assert.ok(Math.abs(Math.sin(snap.rotation! - desiredRotation)) < 1e-7);
            const aligned = { ...moving, ...snap.local, rotation: resolveConnectorSocketSnapStemRotation(role, snap.rotation!, 0, key) };
            const options = { connectorNodeId: 'connector', startSocketName: endpoints.start!.name, endSocketName: endpoints.end!.name,
                movingSockets: [aligned], targets: [{ nodeId: 'host', sockets: [target], attachments: {} }] };
            const attached = reconcileFoxholeConnectorAttachments(options);
            assert.deepEqual(attached[role === 'start' ? 'startAttachment' : 'endAttachment'], snap.attachment);
            assert.deepEqual(attached.targetAttachmentsByNode.get('host'), { [socket.name]: { nodeId: 'connector', socketName: endpoint.name } });
            const detached = reconcileFoxholeConnectorAttachments({ ...options, movingSockets: [{ ...aligned, x: aligned.x + 50 }],
                targets: [{ ...options.targets[0]!, attachments: attached.targetAttachmentsByNode.get('host')! }] });
            assert.equal(detached.startAttachment, undefined);
            assert.equal(detached.endAttachment, undefined);
            assert.deepEqual(detached.targetAttachmentsByNode.get('host'), {});
        }
    }
});

test('connector floor edges coincide along a rotated shared socket', () => {
    for (const rotation of [-0.7, 0, 0.7]) {
        const shared = { x: 160, y: 30, rotation };
        const left = trenchConnectorCorners({ x: 0, y: 0, rotation: 0 }, shared);
        const right = trenchConnectorCorners(shared, { x: 320, y: 60, rotation: 0 });
        assert.deepEqual(left[1], right[0]);
        assert.deepEqual(left[2], right[3]);
    }
});
