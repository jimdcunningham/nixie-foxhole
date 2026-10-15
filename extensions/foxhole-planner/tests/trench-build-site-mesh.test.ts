import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrenchBuildSiteMesh } from '../src/trench-connector.ts';

test('short bent build-site rope strips do not fold their texture triangles', () => {
    for (const role of ['start', 'end'] as const) for (const rotation of [-0.785, -0.7, 0.7, 0.785]) {
        const start = { x: 0, y: 0, rotation: role === 'start' ? rotation : 0 };
        const end = { x: 80, y: 0, rotation: role === 'end' ? rotation : 0 };
        const mesh = buildTrenchBuildSiteMesh(start, end);
        const area = (a: number, b: number, c: number) => {
            const x = (index: number) => mesh.positions[index * 2]!;
            const y = (index: number) => mesh.positions[index * 2 + 1]!;
            return (x(b) - x(a)) * (y(c) - y(a)) - (y(b) - y(a)) * (x(c) - x(a));
        };
        for (let offset = 0; offset < mesh.indices.length; offset += 6) {
            const first = area(...mesh.indices.slice(offset, offset + 3) as [number, number, number]);
            const second = area(...mesh.indices.slice(offset + 3, offset + 6) as [number, number, number]);
            assert.ok(first * second > 0, `${role}=${rotation}, patch=${offset / 6}: folded triangles ${first}, ${second}`);
        }
    }
});
