import assert from 'node:assert/strict';
import test from 'node:test';
import {
    resolveTrimExtentAlongPipe,
    resolveTrimSocketAnchor,
} from '../app/plugins/foxhole/nixie/spline-ribbon-mesh.ts';
import { FOXHOLE_BOARD_SPRITE_SCALE } from '../app/plugins/foxhole/nixie/spline-connector.ts';

function layer(anchorX: number, width = 64) {
    return {
        id: 'trim',
        textureUrl: 'trim.webp',
        width,
        height: 32,
        anchorX,
        anchorY: 0.5,
    };
}

test('resolveTrimSocketAnchor pins centered manifest anchors to socket edges', () => {
    assert.deepEqual(resolveTrimSocketAnchor(layer(0.5), 'back'), { x: 0, y: 0.5 });
    assert.deepEqual(resolveTrimSocketAnchor(layer(0.5), 'front'), { x: 1, y: 0.5 });
});

test('resolveTrimSocketAnchor keeps authored edge anchors', () => {
    assert.deepEqual(resolveTrimSocketAnchor(layer(0), 'back'), { x: 0, y: 0.5 });
    assert.deepEqual(resolveTrimSocketAnchor(layer(1), 'front'), { x: 0, y: 0.5 });
    assert.deepEqual(resolveTrimSocketAnchor(layer(0), 'front'), { x: 1, y: 0.5 });
});

test('resolveTrimSocketAnchor pins out-of-range front anchors to the end edge', () => {
    assert.deepEqual(resolveTrimSocketAnchor(layer(-0.25), 'front'), { x: 1, y: 0.5 });
    assert.deepEqual(resolveTrimSocketAnchor(layer(1.25), 'front'), { x: 1, y: 0.5 });
});

test('resolveTrimExtentAlongPipe uses full width for centered front trims', () => {
    const centered = layer(0.5, 64);
    const backExtent = resolveTrimExtentAlongPipe(centered, 'back');
    const frontExtent = resolveTrimExtentAlongPipe(centered, 'front');
    assert.equal(backExtent, frontExtent);
    assert.equal(frontExtent, 64 * FOXHOLE_BOARD_SPRITE_SCALE);
});
