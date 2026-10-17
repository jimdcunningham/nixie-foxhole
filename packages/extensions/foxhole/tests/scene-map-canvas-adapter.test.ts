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
    const mask = {}, terrain = { label: 'foxhole-map-regions' }, icons = { label: 'foxhole-map-live-icons' };
    const settings = { enabled: true, background: true, lockCameraToMap: true, cropEnabled: true, cropX: -20, cropY: -30, cropWidth: 40, cropHeight: 60 };
    const root = { visible: true, destroyed: false, mask, children: [terrain, icons, mask] }, runtime = { project: {}, projectStore: { settings: {} } };
    const factory = runInNewContext(stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm, '').replace('export function', 'function') + '\ncreateFoxholeSceneMapCanvas;'), {
        computed, shallowRef, useNixieSettingsStore: () => ({ getValue() {} }),
        readFoxholeMapSettings: () => settings,
        getFoxholeMapActiveBounds: () => ({ left: -100, top: -200, right: 300, bottom: 400 }),
        FoxholeMapViewportPlugin: class {
            presentationRoot = root;
            constructor(_: unknown, value: unknown) { context = value; }
            destroy() { destroyed++; }
        },
    });
    const adapter = factory({ app: {}, viewport: {}, before: {}, runtime,
        nodeCount: () => 17, zoom: () => 0.025, pointer: () => pointer, interacting: () => interacting,
        suppressGrid: (value: boolean) => suppression.push(value),
        cameraTo: (...args: unknown[]) => moves.push(args) });
    assert.equal(context.getSceneNodeCount(), 17);
    assert.equal(context.getZoom(), 0.025);
    const layers = adapter.spatialLayers();
    assert.equal(layers.length, 2);
    assert.equal(layers[0].content, terrain);
    assert.equal(layers[0].billboard, false);
    assert.equal(layers[1].billboard, true);
    assert.equal(JSON.stringify(layers[0].clip), JSON.stringify({ minX: -20, minY: -30, maxX: 20, maxY: 30 }));
    assert.ok(adapter.navigationBounds());
    settings.lockCameraToMap = false;
    assert.equal(adapter.navigationBounds(), null);
    root.visible = false;
    assert.equal(adapter.spatialLayers().length, 0);
    root.visible = true;
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
