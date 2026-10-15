import assert from 'node:assert/strict';
import test from 'node:test';
import { Texture, Mesh } from 'pixi.js';
import { buildFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import { normalizeFoxholeSplineConnectorState } from '../app/plugins/foxhole/nixie/spline-connector.ts';
import { resolveFoxholeStructureDestroyedMutation } from '../app/plugins/foxhole/nixie/structure-destroyed-actions.ts';
import { TrenchConnectorVisual } from '../app/plugins/foxhole/nixie/trench-connector-visual.ts';

const catalog = buildFoxholeStructureCatalog(getFoxholeManifest('/foxhole/assets/'));
const start = { x: -57.6, y: 0, rotation: 0 }, end = { x: 57.6, y: 0, rotation: 0 };

test('destroyed connector state preserves its intact key and edited endpoints through restore', () => {
    for (const tier of [1, 2, 3]) {
        const initial = normalizeFoxholeSplineConnectorState({ foxholeKey: `trenchconnectort${tier}`,
            start: { ...start, rotation: Math.PI / 7 }, end: { x: 145, y: 20, rotation: -Math.PI / 9 } });
        const patch = resolveFoxholeStructureDestroyedMutation(catalog, initial, true)!;
        assert.deepEqual(patch, { destroyed: true });
        const destroyed = normalizeFoxholeSplineConnectorState({ ...initial, ...patch });
        assert.equal(destroyed.destroyed, true);
        assert.equal(destroyed.foxholeKey, initial.foxholeKey);
        assert.deepEqual(destroyed.start, initial.start);
        assert.deepEqual(destroyed.end, initial.end);
        const restore = resolveFoxholeStructureDestroyedMutation(catalog, destroyed, false)!;
        assert.deepEqual(restore, { destroyed: false });
        assert.deepEqual(normalizeFoxholeSplineConnectorState({ ...destroyed, ...restore }), initial);
    }
});

test('native destroyed visuals release intact meshes, follow changed endpoints, and restore original art', async () => {
    for (const tier of [1, 2, 3]) {
        const normal = catalog.assetByKey[`trenchconnectort${tier}`]!;
        const wreck = catalog.assetByKey[normal.destroyedStructureId!]!;
        const requested: string[] = [];
        const visual = new TrenchConnectorVisual(url => {
            requested.push(url);
            return Promise.resolve(Texture.WHITE);
        });
        const options = { start, end, alpha: 1, tint: 0xffffff, contactShadows: false };
        visual.sync({ ...options, layers: normal.renderLayers });
        const intactMeshes = [...visual.children];
        assert.ok(intactMeshes.length > 0);
        requested.length = 0;
        visual.sync({ ...options, layers: wreck.renderLayers, destroyedTier: tier });
        await Promise.resolve();
        assert.ok(intactMeshes.every(mesh => mesh.destroyed));
        assert.ok(visual.children.every(mesh => mesh instanceof Mesh));
        assert.ok(requested.every(url => url.includes(`/trenchconnectordestroyedt${tier}/components/`)));
        const ruinedMeshes = [...visual.children];
        const before = ruinedMeshes.map(mesh => [...(mesh as Mesh).geometry.positions]);
        visual.sync({ ...options, layers: wreck.renderLayers, destroyedTier: tier, end: { x: 135, y: 31, rotation: -Math.PI / 6 } });
        assert.ok(ruinedMeshes.some((mesh, i) => !mesh.destroyed && JSON.stringify((mesh as Mesh).geometry.positions) !== JSON.stringify(new Float32Array(before[i]!))));
        requested.length = 0;
        visual.sync({ ...options, layers: normal.renderLayers });
        assert.ok(ruinedMeshes.every(mesh => mesh.destroyed));
        assert.ok(requested.every(url => url.includes(`/trenchconnectort${tier}/components/`)));
        visual.destroy();
    }
});
