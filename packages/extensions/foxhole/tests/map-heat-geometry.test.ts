import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContextBatches, GpuGraphicsContext, Graphics } from 'pixi.js';
import { drawFoxholeMapHeatCircle } from '../app/plugins/foxhole/nixie/map/heat-geometry.ts';

test('normalized map heat retains bounds, colors and painter order with bounded geometry', () => {
    const native = new Graphics(), normalized = new Graphics();
    const rings = Array.from({ length: 15 }, (_, index) => ({ x: 1500000 + index * 3200, y: -1000000 - index * 2600,
        radius: 5000 + index * 2000, fill: { color: index % 2 ? 0xff9900 : 0xff3300, alpha: 0.05 + index * 0.01 } }));
    for (const ring of rings) {
        native.circle(ring.x, ring.y, ring.radius).fill(ring.fill);
        drawFoxholeMapHeatCircle(normalized, ring.x, ring.y, ring.radius, ring.fill);
    }
    const original = new GpuGraphicsContext(), bounded = new GpuGraphicsContext();
    try {
        assert.deepEqual(normalized.getLocalBounds().rectangle, native.getLocalBounds().rectangle);
        buildContextBatches(native.context, original);
        buildContextBatches(normalized.context, bounded);
        assert.equal(bounded.batches.length, rings.length);
        assert.ok(bounded.geometryData.vertices.length < original.geometryData.vertices.length / 4);
        assert.ok(bounded.geometryData.vertices.length / 2 < 5000);
        assert.deepEqual(bounded.batches.map(batch => [batch.baseColor, batch.alpha]), original.batches.map(batch => [batch.baseColor, batch.alpha]));
        for (let index = 0; index < rings.length; index++) {
            const ring = rings[index]!;
            const batch = bounded.batches[index]!;
            // The first vertex is the circle center; every rim vertex retains its world radius.
            for (let vertex = batch.attributeOffset + 1; vertex < batch.attributeOffset + batch.attributeSize; vertex++) {
                const radius = Math.hypot(bounded.geometryData.vertices[vertex * 2]! - ring.x, bounded.geometryData.vertices[vertex * 2 + 1]! - ring.y);
                assert.ok(Math.abs(radius - ring.radius) < 0.000001);
            }
        }
    } finally {
        original.destroy();
        bounded.destroy();
        native.destroy();
        normalized.destroy();
    }
});

test('heat circle transforms preserve the caller context for subsequent drawings', () => {
    const graphics = new Graphics().translateTransform(70, 90);
    drawFoxholeMapHeatCircle(graphics, 100, 200, 30000, 0xff6600);
    graphics.rect(0, 0, 10, 10).fill(0xffffff);
    const primitives = graphics.context.instructions.flatMap(instruction => 'path' in instruction.data ? [instruction.data.path.shapePath.shapePrimitives[0]!] : []);
    assert.equal(primitives[0]!.transform!.tx, 170);
    assert.equal(primitives[0]!.transform!.ty, 290);
    assert.equal(primitives[1]!.transform!.a, 1);
    assert.equal(primitives[1]!.transform!.tx, 70);
    assert.equal(primitives[1]!.transform!.ty, 90);
    graphics.destroy();
});
