import assert from 'node:assert/strict';
import test from 'node:test';
import { canDissolveHitboxPolygons, canDissolveHitboxTriangles, dissolveHitboxPolygons, dissolveHitboxTriangles } from '../app/plugins/foxhole/nixie/hitbox-dissolve.ts';

test('dissolves a consistently wound triangle pair into its exterior polygon', () => {
    const dissolved = dissolveHitboxTriangles([
        [0, 0, 4, 0, 4, 2],
        [0, 0, 4, 2, 0, 2],
    ]);

    assert.deepEqual(dissolved, [[0, 2, 0, 0, 4, 0, 4, 2]]);
});

test('dissolves triangles with mixed winding', () => {
    const dissolved = dissolveHitboxTriangles([
        [0, 0, 4, 0, 4, 2],
        [0, 2, 4, 2, 0, 0],
    ]);

    assert.deepEqual(dissolved, [[0, 2, 0, 0, 4, 0, 4, 2]]);
});

test('leaves disconnected triangle hitboxes alone', () => {
    const triangles = [
        [0, 0, 1, 0, 0, 1],
        [3, 0, 4, 0, 3, 1],
    ];
    assert.equal(dissolveHitboxTriangles(triangles)?.length, 2);
    assert.equal(canDissolveHitboxTriangles(triangles), false);
});

test('reports whether a triangle mesh can be reduced', () => {
    assert.equal(canDissolveHitboxTriangles([
        [0, 0, 4, 0, 4, 2],
        [0, 0, 4, 2, 0, 2],
    ]), true);
});

test('dissolves polygons when they share a full edge', () => {
    const polygons = [
        [0, 0, 2, 0, 2, 2, 0, 2],
        [2, 0, 4, 0, 4, 2, 2, 2],
    ];
    assert.equal(canDissolveHitboxPolygons(polygons), true);
    assert.deepEqual(dissolveHitboxPolygons(polygons), [[4, 2, 0, 2, 0, 0, 4, 0]]);
});
