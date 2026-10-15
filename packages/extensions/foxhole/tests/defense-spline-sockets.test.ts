import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import { getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { createFoxholeStructureAssetSnapshot } from '../app/plugins/foxhole/nixie/structure-asset-snapshot.ts';
import { getFoxholeSplineConnectorConstraints, normalizeFoxholeSplineConnectorState, usesSplineConnectorSocketSnapping } from '../app/plugins/foxhole/nixie/spline-connector.ts';
import { resolveFoxholeConnectorEndpointSockets } from '../app/plugins/foxhole/nixie/connector.ts';
import { resolveFoxholeSplineConnectorSockets } from '../app/plugins/foxhole/nixie/spline-connector-sockets.ts';
import { areFoxholeSnapSocketsCompatible, findBestFoxholeSocketSnap } from '../app/plugins/foxhole/nixie/structure-socket-snapping.ts';

const manifest = getFoxholeManifest('/foxhole/assets/');
const catalog = getFoxholeStructureCatalog('/foxhole/assets/');

for (const id of ['barbedwirespline', 'barbedwirewallspline', 'sandbaghalfspline', 'sandbagfullspline', 'waterwallsplinet1']) {
    test(`${id} exposes its published sockets on new and existing spline connectors`, () => {
        const structure = manifest.assets.find(asset => asset.id === id);
        assert.ok(structure);
        assert.deepEqual(structure.buildSockets.map(socket => socket.name).sort(), ['BackSocket', 'FrontSocket']);
        assert.equal(usesSplineConnectorSocketSnapping(id), true);

        const snapshot = createFoxholeStructureAssetSnapshot({ asset: catalog.assetByKey[id]!, structure,
            label: id, x: 0, y: 0 });
        assert.equal(snapshot.type, 'foxholeSplineConnector');
        assert.equal(snapshot.state.startSocketName, 'BackSocket');
        assert.equal(snapshot.state.endSocketName, 'FrontSocket');

        const oldState = normalizeFoxholeSplineConnectorState({ foxholeKey: id });
        assert.equal(oldState.startSocketName, 'BackSocket');
        assert.equal(oldState.endSocketName, 'FrontSocket');
        const endpoints = resolveFoxholeConnectorEndpointSockets(structure, oldState);
        assert.equal(endpoints.start?.name, 'BackSocket');
        assert.equal(endpoints.end?.name, 'FrontSocket');
        assert.ok(endpoints.start?.socketTags.length);
        assert.ok(endpoints.end?.socketTags.length);
        const unlabelledEndpoints = resolveFoxholeConnectorEndpointSockets(structure, {});
        assert.equal(unlabelledEndpoints.start?.name, 'BackSocket');
        assert.equal(unlabelledEndpoints.end?.name, 'FrontSocket');
        const sockets = resolveFoxholeSplineConnectorSockets({ structure, state: snapshot.state,
            constraints: getFoxholeSplineConnectorConstraints(snapshot.state, structure.connector?.pathStyle),
            pathStyle: structure.connector?.pathStyle, lateralOffset: 0 });
        assert.deepEqual(sockets.map(socket => socket.name), ['BackSocket', 'FrontSocket']);
        assert.deepEqual(sockets.map(socket => socket.localX), [snapshot.state.start.x, snapshot.state.end.x]);
        assert.equal(areFoxholeSnapSocketsCompatible({ socketName: sockets[0]!.name, socketTags: sockets[0]!.socketTags },
            { socketName: sockets[1]!.name, socketTags: sockets[1]!.socketTags }), true);
        const match = findBestFoxholeSocketSnap({
            movingSockets: [{ nodeId: 'moving', socketName: sockets[1]!.name,
                x: sockets[1]!.localX, y: sockets[1]!.localY,
                rotation: sockets[1]!.rotationRadians, socketTags: sockets[1]!.socketTags }],
            targetSockets: [{ nodeId: 'target', socketName: sockets[0]!.name,
                x: snapshot.state.end.x + sockets[0]!.localX, y: sockets[0]!.localY,
                rotation: sockets[0]!.rotationRadians, socketTags: sockets[0]!.socketTags }],
            moveX: 0, moveY: 0,
        });
        assert.equal(match?.movingSocketName, 'FrontSocket');
        assert.equal(match?.targetSocketName, 'BackSocket');
    });
}
