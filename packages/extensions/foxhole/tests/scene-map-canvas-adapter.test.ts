import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { selectedSpatialRegions, regionIdForKey } from '../app/plugins/foxhole/nixie/map/region-scene-controller.mjs';
import { computed, shallowRef, reactive } from 'vue';
import { stripTypeScriptTypes } from 'node:module';

const source = readFileSync(new URL('../app/plugins/foxhole/nixie/scene-map-canvas-adapter.ts', import.meta.url), 'utf8');

test('the War map adapter uses ECS counts, pointer, camera and lifetime instead of the hidden V1 scene', () => {
    let context: any, destroyed = 0, frames = 0, pointer = { x: 10, y: 20 }, interacting = false;
    const hovers: unknown[] = [];
    const spatialSyncs: any[] = [];
    const moves: unknown[] = [], suppression: boolean[] = [];
    let mode = '2d';
    const background = { label: 'foxhole-map-background' };
    const summaries = { label: 'foxhole-map-casualty-labels' };
    const summaryGroups = [{ content: {}, anchor: { x: 10, y: 20 }, offset: 30, anchorHalfHeight: 10 }];
    const mask = {}, terrain = { label: 'foxhole-map-regions' }, icons = { label: 'foxhole-map-live-icons' };
    const world = { sync(value: any) { spatialSyncs.push(value); }, active: false, sampleGround: () => null, setGroundCutouts() {}, destroy() {} };
    let settingsReads = 0;
    const settings = reactive({ regionKeys: ['WestgateHex'], worldLayers: { terrain: true }, enabled: true, background: true, lockCameraToMap: true, cropEnabled: true, cropX: -20, cropY: -30, cropWidth: 40, cropHeight: 60 });
    const root = { visible: true, destroyed: false, mask, children: [terrain, icons, background, summaries, mask] }, runtime = { project: {}, projectStore: { settings: {} } };
    const factory = runInNewContext(stripTypeScriptTypes(source.replaceAll('import.meta.dev', 'false').replace(/^import .*;\r?\n/gm, '').replace('export function', 'function') + '\ncreateFoxholeSceneMapCanvas;'), {
        getFoxholeMapRegionBillboardGroups: (content: unknown) => {
            assert.equal(content, summaries);
            return summaryGroups;
        },
        FoxholeRegionSceneController: class { constructor(options: { manageEnvironment?: boolean; }) { assert.equal(options.manageEnvironment, false); return world; } },
        selectedSpatialRegions, regionIdForKey,
        plannerRoadTourActions: shallowRef(null), plannerRoadTourStatus: shallowRef({}),
        FOXHOLE_MAP_REGIONS: [{key:"WestgateHex"},{key:"OriginHex"}],
        getFoxholeRegionPosition: (region: any) => ({x:region.key === "WestgateHex" ? 10 : 20,y:0}),
        useRuntimeConfig: () => ({ app: { baseURL: '/' } }),
        foxholeWorldAssetDelivery: () => ({ baseUrl: '/foxhole/assets/world/', loadIndex: () => Promise.resolve({}) }),
        subscribeSceneViewpointRestore: () => () => {},
        preserveViewpointRegionCamera: () => {},
        consumeViewpointRegionCamera: () => false,
        resolveFoxholeMapFitCamera: () => ({ position: { x: 5, y: 6 }, scale: 0.01 }),
        computed, shallowRef, useNixieSettingsStore: () => ({ getValueOr() {} }),
        readFoxholeMapSettings: () => { settingsReads++; return { ...settings }; },
        getFoxholeMapActiveBounds: () => ({ left: -100, top: -200, right: 300, bottom: 400 }),
        FoxholeMapViewportPlugin: class {
            presentationRoot = root;
            getSpatialWarState(key: string) { return {items:[key]}; }
            constructor(_: unknown, value: unknown) { context = value; }
            updatePresentation() { frames++; }
            hoverPresentation(...args: unknown[]) { hovers.push(args); }
            destroy() { destroyed++; }
        },
    });
    const adapter = factory({ app: {}, viewport: {}, before: {}, runtime,
        viewMode: () => mode, nodeCount: () => 17, zoom: () => 0.025, pointer: () => pointer, interacting: () => interacting,
        suppressGrid: (value: boolean) => suppression.push(value),
        cameraTo: (...args: unknown[]) => moves.push(args) });
    for (let i = 0; i < 1000; i++) { adapter.spatialGroundVisible(); adapter.navigationBounds(); adapter.worldBounds(); }
    assert.equal(settingsReads, 1, 'frame callbacks reuse settings until a reactive setting changes');
    assert.equal(context.getSceneNodeCount(), 17);
    assert.equal(context.getZoom(), 0.025);
    assert.equal(context.manualPresentation, true);
    adapter.updatePresentation();
    assert.equal(frames, 1);
    adapter.hoverPresentation(icons, pointer);
    assert.deepEqual(hovers, [[icons, pointer]]);
    const layers = adapter.spatialLayers();
    assert.equal(layers.length, 4);
    assert.equal(layers[3].billboardGroups, summaryGroups, '2.5D must retain layout metadata before a budgeted switch to 3D');
    assert.equal(layers[0].content, terrain);
    assert.equal(layers[0].billboard, false);
    assert.equal(layers[0].pixelScale, 0.025);
    assert.equal(layers[1].pixelScale, 0.025);
    assert.equal(layers[1].billboard, true);
    assert.equal(layers[0].hoverable, false);
    assert.equal(layers[1].hoverable, true);
    assert.equal(JSON.stringify(layers[0].clip), JSON.stringify({ minX: -20, minY: -30, maxX: 20, maxY: 30 }));
    assert.ok(adapter.navigationBounds());
    mode = '3d';
    assert.equal(adapter.spatialGroundVisible(), false, 'hide the editor floor before the region finishes loading');
    world.active = true;
    assert.equal(adapter.spatialGroundVisible(), false, 'keep it hidden after the region is attached');
    world.active = false;
    assert.equal(adapter.spatialGroundVisible(), false, 'a failed or retired region must not reveal the rectangle');
    settings.worldLayers.terrain = false;
    assert.equal(adapter.spatialGroundVisible(), false, 'terrain off must not reveal the editor floor');
    settings.worldLayers.terrain = true;
    settings.enabled = false;
    assert.equal(adapter.spatialGroundVisible(), true, 'map off restores the editor floor');
    settings.enabled = true;
    settings.regionKeys = [];
    assert.equal(adapter.spatialGroundVisible(), true, 'no selected region leaves ordinary canvas ground available');
    settings.regionKeys = ['WestgateHex'];
    assert.equal(adapter.navigationBounds(), null);
    assert.equal(adapter.spatialLayers().length, 3);
    assert.equal(adapter.spatialLayers().find((layer: { content: unknown; }) => layer.content === summaries).billboardGroups, summaryGroups);
    assert.equal(adapter.spatialLayers().some((layer: any) => layer.content === background), false);
    mode = '2d';
    assert.equal(adapter.spatialLayers().some((layer: any) => layer.content === background), true);
    mode = 'flat';
    assert.equal(adapter.spatialLayers().find((layer: { content: unknown; }) => layer.content === summaries).billboardGroups, undefined);
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
    settings.regionKeys = ['WestgateHex','OriginHex']; mode = '3d';
    adapter.updateSpatialPresentation({view:{},mode:'3d',deltaMS:16});
    assert.equal(adapter.spatialGroundVisible(),false,'multiple selected regions own the spatial ground');
    settings.worldLayers.terrain = false;
    assert.equal(adapter.spatialGroundVisible(),false,'hidden regional terrain must not reveal the editor floor');
    assert.deepEqual(JSON.parse(JSON.stringify(spatialSyncs.at(-1).regions)),[
        {id:'westgate',position:{x:10,y:0},warState:{items:['WestgateHex']}},
        {id:'origin',position:{x:20,y:0},warState:{items:['OriginHex']}},
    ]);
    adapter.destroy();
    assert.equal(context.session.sceneViewActive.value, false);
    assert.equal(destroyed, 1);
    assert.deepEqual(suppression, [false]);
});
