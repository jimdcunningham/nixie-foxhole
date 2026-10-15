import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTrenchSharedRotation } from '../app/plugins/foxhole/nixie/trench-shared-rotation.ts';
import { trenchConnectorCorners } from '../app/plugins/foxhole/nixie/trench-connector.ts';

test('either end can rotate a shared seam without separating its floor edges', () => {
    for (const role of ['start', 'end'] as const) for (const partnerRole of ['start', 'end'] as const) {
        const source = { start: { x: role === 'start' ? 0 : -160, y: 0, rotation: 0 },
            end: { x: role === 'end' ? 0 : 160, y: 0, rotation: 0 } };
        const flipped = role === partnerRole;
        const base = flipped ? Math.PI : 0;
        const partner = { start: { x: partnerRole === 'start' ? 0 : (flipped ? 160 : -160), y: 0, rotation: base },
            end: { x: partnerRole === 'end' ? 0 : (flipped ? -160 : 160), y: 0, rotation: base } };
        for (const rotation of [-0.7, 0, 0.7]) {
            const result = resolveTrenchSharedRotation(source, role, rotation, partner, partnerRole, { x: Math.cos(rotation), y: Math.sin(rotation) });
            assert.ok(result);
            assert.equal(result.endpoint.x, 0);
            assert.equal(result.partnerEndpoint.x, 0);
            const a = trenchConnectorCorners(role === 'start' ? result.endpoint : source.start, role === 'end' ? result.endpoint : source.end);
            const b = trenchConnectorCorners(partnerRole === 'start' ? result.partnerEndpoint : partner.start, partnerRole === 'end' ? result.partnerEndpoint : partner.end);
            const edge = role === 'start' ? [a[0]!, a[3]!] : [a[1]!, a[2]!];
            const otherEdge = partnerRole === 'start' ? [b[0]!, b[3]!] : [b[1]!, b[2]!];
            for (const point of edge) assert.ok(otherEdge.some(other => Math.hypot(point.x - other.x, point.y - other.y) < 1e-7));
        }
    }
});

test('shared rotation respects the stricter connector limit without mutating either end', () => {
    const source = { start: { x: -160, y: 0, rotation: 0 }, end: { x: 0, y: 0, rotation: 0 } };
    const partner = { start: { x: 0, y: 0, rotation: 0 }, end: { x: 140, y: -70, rotation: -0.4 } };
    const before = JSON.stringify({ source, partner });
    assert.equal(resolveTrenchSharedRotation(source, 'end', 0.7, partner, 'start', { x: Math.cos(0.7), y: Math.sin(0.7) }), null);
    assert.ok(resolveTrenchSharedRotation(source, 'end', 0.2, partner, 'start', { x: Math.cos(0.2), y: Math.sin(0.2) }));
    assert.equal(JSON.stringify({ source, partner }), before);
});

test('partner tangent may be expressed in a rotated local frame', () => {
    const source = { start: { x: -160, y: 0, rotation: 0 }, end: { x: 0, y: 0, rotation: 0 } };
    const partner = { start: { x: 0, y: 0, rotation: -Math.PI / 2 }, end: { x: 0, y: -160, rotation: -Math.PI / 2 } };
    const rotation = 0.3;
    const result = resolveTrenchSharedRotation(source, 'end', rotation, partner, 'start', { x: Math.sin(rotation), y: -Math.cos(rotation) });
    assert.ok(result);
    assert.ok(Math.abs(result.partnerEndpoint.rotation - (rotation - Math.PI / 2)) < 1e-7);
});
