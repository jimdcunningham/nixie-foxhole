import assert from 'node:assert/strict';
import test from 'node:test';
import * as PIXI from 'pixi.js';
import {
    FOXHOLE_UPRIGHT_OVERLAY_LABEL,
    syncUprightBoardOverlayChildren,
} from '../app/plugins/foxhole/nixie/upright-overlay-sync.ts';

test('syncUprightBoardOverlayChildren counters node and nested socket rotation once', () => {
    const socketOverlay = new PIXI.Container();
    const powerSocket = new PIXI.Container();
    powerSocket.rotation = Math.PI / 2;
    const bolt = new PIXI.Container();
    bolt.label = FOXHOLE_UPRIGHT_OVERLAY_LABEL;
    powerSocket.addChild(bolt);
    socketOverlay.addChild(powerSocket);

    const nodeRotation = Math.PI / 2;
    syncUprightBoardOverlayChildren(nodeRotation, socketOverlay);

    // Bake/sync target: -(nodeRotation + socketLocalRotation)
    assert.equal(bolt.rotation, -(nodeRotation + powerSocket.rotation));

    // World rotation of the bolt should be upright (0).
    const worldRotation = nodeRotation + powerSocket.rotation + bolt.rotation;
    assert.ok(Math.abs(worldRotation) < 1e-9);
});

test('syncUprightBoardOverlayChildren stays upright as node rotation changes', () => {
    const socketOverlay = new PIXI.Container();
    const powerSocket = new PIXI.Container();
    powerSocket.rotation = Math.PI / 2;
    const bolt = new PIXI.Container();
    bolt.label = FOXHOLE_UPRIGHT_OVERLAY_LABEL;
    powerSocket.addChild(bolt);
    socketOverlay.addChild(powerSocket);

    for (const nodeRotation of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
        syncUprightBoardOverlayChildren(nodeRotation, socketOverlay);
        const worldRotation = nodeRotation + powerSocket.rotation + bolt.rotation;
        assert.ok(
            Math.abs(worldRotation) < 1e-9,
            `expected upright at nodeRotation=${nodeRotation}, got world=${worldRotation}`,
        );
    }
});
