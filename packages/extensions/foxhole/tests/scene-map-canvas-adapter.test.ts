import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { computed, shallowRef } from 'vue';
import { stripTypeScriptTypes } from 'node:module';

const source = readFileSync(new URL('../app/plugins/foxhole/nixie/scene-map-canvas-adapter.ts', import.meta.url), 'utf8');

test('the War map adapter uses ECS counts, pointer, camera and lifetime instead of the hidden V1 scene', () => {
    let context: any, destroyed = 0, pointer = { x: 10, y: 20 }, interacting = false;
    const moves: unknown[] = [], suppression: boolean[] = [];
    const root = {}, runtime = { project: {}, projectStore: { settings: {} } };
    const factory = runInNewContext(stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm, '').replace('export function', 'function') + '\ncreateFoxholeSceneMapCanvas;'), {
        computed, shallowRef, useNixieSettingsStore: () => ({ getValue() {} }),
        readFoxholeMapSettings: () => ({ enabled: true }),
        getFoxholeMapActiveBounds: () => ({ left: -100, top: -200, right: 300, bottom: 400 }),
        FoxholeMapViewportPlugin: class {
            presentationRoot = root;
            constructor(_: unknown, value: unknown) { context = value; }
            destroy() { destroyed++; }
        },
    });
    const adapter = factory({ app: {}, viewport: {}, before: {}, runtime,
        nodeCount: () => 17, pointer: () => pointer, interacting: () => interacting,
        suppressGrid: (value: boolean) => suppression.push(value),
        cameraTo: (...args: unknown[]) => moves.push(args) });
    assert.equal(context.getSceneNodeCount(), 17);
    assert.equal(context.session.sceneViewActive.value, true);
    assert.deepEqual(context.session.pointerTrackerRef.value.pointer.value.world, pointer);
    context.session.cameraTo({ position: { x: 5, y: 6 }, scale: 0.01 });
    assert.deepEqual(moves, [[{ x: 5, y: 6 }, 0.01]]);
    assert.equal(adapter.root, root);
    assert.equal(JSON.stringify(adapter.worldBounds()), JSON.stringify({ minX: -100, minY: -200, maxX: 300, maxY: 400 }));
    assert.equal(JSON.stringify(adapter.documentRendererIds), JSON.stringify(['planning-map', 'planning-grid']));
    adapter.destroy();
    assert.equal(context.session.sceneViewActive.value, false);
    assert.equal(destroyed, 1);
    assert.deepEqual(suppression, [false]);
});
