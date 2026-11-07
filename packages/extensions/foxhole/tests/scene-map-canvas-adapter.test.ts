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
    const borders = { label: 'foxhole-map-borders' };
    const mask = {}, terrain = { label: 'foxhole-map-regions' }, icons = { label: 'foxhole-map-live-icons' };
    const world = { sync(value: any) { spatialSyncs.push(value); }, active: false, sampleGround: () => null, setGroundCutouts() {}, destroy() {} };
    let settingsReads = 0;
    const settings = reactive({ solidMap: false, regionKeys: ['WestgateHex'], worldLayers: { terrain: true }, enabled: true, background: true, lockCameraToMap: true, cropEnabled: true, cropX: -20, cropY: -30, cropWidth: 40, cropHeight: 60 });
    const root = { visible: true, destroyed: false, mask, children: [terrain, icons, background, summaries, borders, mask] }, runtime = { project: {}, projectStore: { settings: {} } };
    const factory = runInNewContext(stripTypeScriptTypes(source.replaceAll('import.meta.dev', 'false').replace(/^import .*;\r?\n/gm, '').replace('export function', 'function') + '\ncreateFoxholeSceneMapCanvas;'), {
        getFoxholeMapRegionBillboardGroups: (content: unknown) => {
            assert.equal(content, summaries);
            return summaryGroups;
        },
        FoxholeRegionSceneController: class { constructor(options: { manageEnvironment?: boolean; }) { assert.equal(options.manageEnvironment, false); return world; } },
        selectedSpatialRegions, regionIdForKey,
        hasLocalFoxholeSpatialRegion: () => false,
        plannerRoadTourActions: shallowRef(null), plannerRoadTourStatus: shallowRef({}),
        FOXHOLE_MAP_REGIONS: [{key:"WestgateHex"},{key:"OriginHex"},{key:"HomeRegionC",standalone:true}],
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
    assert.equal(layers[3].liveGraphics, true, 'only small map borders opt into display-rate geometry');
    assert.equal(layers[1].liveGraphics, false);
    assert.equal(layers[2].billboardGroups, summaryGroups, '2.5D must retain layout metadata before a budgeted switch to 3D');
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
    assert.equal(adapter.groundAvailable(), false, 'an unattached region supplies no ground samples');
    world.active = true;
    assert.equal(adapter.groundAvailable(), true, 'attached terrain is sampled immediately');
    assert.equal(adapter.spatialGroundVisible(), false, 'keep it hidden after the region is attached');
    world.active = false;
    assert.equal(adapter.groundAvailable(), false, 'retired terrain no longer supplies ground samples');
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
    assert.equal(adapter.spatialLayers().length, 4);
    assert.equal(adapter.spatialLayers().find((layer: { content: unknown; }) => layer.content === summaries).billboardGroups, summaryGroups);
    assert.equal(adapter.spatialLayers().some((layer: any) => layer.content === background), false);
    mode = '2d';
    assert.equal(adapter.spatialLayers().some((layer: any) => layer.content === background), false);
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
    assert.equal(adapter.spatialGroundVisible(),true,'multiple selected regions do not load a spatial world');
    settings.worldLayers.terrain = false;
    assert.equal(adapter.spatialGroundVisible(),true,'multiple selection retains the ordinary editor floor');
    assert.deepEqual(JSON.parse(JSON.stringify(spatialSyncs.at(-1).regions)), []);
    assert.deepEqual(JSON.parse(JSON.stringify(spatialSyncs.at(-1).settings.regionKeys)), []);
    assert.equal(context.needsSpatialWorldData(), false);
    settings.regionKeys = ['WestgateHex'];
    adapter.updateSpatialPresentation({view:{},mode:'3d',deltaMS:16});
    assert.equal(spatialSyncs.at(-1).regions.length, 1);
    assert.equal(context.needsSpatialWorldData(), true);
    settings.regionKeys = ["HomeRegionC"];
    settings.solidMap = true;
    adapter.updateSpatialPresentation({view:{},mode:"3d",deltaMS:16});
    assert.equal(spatialSyncs.at(-1).regions.length, 0);
    assert.equal(context.needsSpatialWorldData(), false);
    assert.ok(adapter.spatialLayers().some((layer: any) => layer.content === terrain));
    adapter.destroy();
    assert.equal(context.session.sceneViewActive.value, false);
    assert.equal(destroyed, 1);
    assert.deepEqual(suppression, [false]);
});

test('mounted spatial worlds retire on catalog revision, clear on disable, and reselect older content', async () => {
    let selected: any = {baseUrl: '/same-content-root/', revision: 1, loadIndex: async () => ({version: 'a'})};
    const worlds: any[] = [], jobs = new Map<string, any>(), toasts: any[] = [], dismissed: string[] = [];
    let jobSequence = 0;
    const factory = runInNewContext(stripTypeScriptTypes(source.replaceAll('import.meta.dev', 'false').replace(/^import .*;\r?\n/gm, '').replace('export function', 'function') + '\ncreateFoxholeSceneMapCanvas;'), {
        FoxholeRegionSceneController: class {
            constructor(options: any) {
                const record = {options, destroyed: 0, syncs: 0, retries: 0, sync() {this.syncs++;}, retryFailed() {this.retries++; return true;}, whenDisposed() {return Promise.resolve();}, destroy() {this.destroyed++; options.onStatus({phase: 'idle'});}};
                worlds.push(record); return record;
            }
        },
        FoxholeMapViewportPlugin: class {updatePresentation() {} getSpatialWarState() {return null;} destroy() {}},
        selectedSpatialRegions, regionIdForKey,
        hasLocalFoxholeSpatialRegion: () => false, computed, shallowRef, setTimeout: () => 1, clearTimeout: () => {},
        foxholeWorldAssetDelivery: () => selected,
        subscribeSceneViewpointRestore: () => () => {}, consumeViewpointRegionCamera: () => true,
        plannerRoadTourActions: shallowRef(null), plannerRoadTourStatus: shallowRef({}),
        beginShellProgressJob: (job: any) => {const id = `world-${++jobSequence}`; jobs.set(id, job); return id;},
        updateShellProgressJob: (id: string, update: any) => {jobs.set(id, {...jobs.get(id), ...update});},
        finishShellProgressJob: (id: string) => {jobs.delete(id);},
        showNxToast: (toast: any) => {toasts.push(toast); return `toast-${toasts.length}`;},
        dismissNxToast: (id: string) => {dismissed.push(id);},
        FOXHOLE_MAP_REGIONS: [{key: 'WestgateHex', name: 'Westgate'}], getFoxholeRegionPosition: () => ({x: 0, y: 0}),
        useNixieSettingsStore: () => ({getValueOr() {}}),
        readFoxholeMapSettings: () => ({enabled: true, regionKeys: ['WestgateHex']}),
    });
    const adapter = factory({app: {}, viewport: {}, before: {}, runtime: {projectStore: {settings: {}}},
        viewMode: () => '3d', nodeCount: () => 0, zoom: () => 1, pointer: () => null,
        interacting: () => false, suppressGrid() {}, cameraTo() {}});
    const frame = () => adapter.updateSpatialPresentation({view: {}, mode: '3d', deltaMS: 16});
    frame(); frame();
    assert.equal(worlds.length, 1); assert.equal(worlds[0].syncs, 2);
    worlds[0].options.onStatus({phase: 'Downloading Region', region: 'westgate'});
    assert.equal(jobs.size, 1);
    assert.equal(jobs.get('world-1').title, 'Loading Westgate');
    assert.equal(jobs.get('world-1').currentFile, 'Loading region data…');
    assert.equal(jobs.get('world-1').percent, null, 'partial download totals must not imply a percentage');
    assert.equal(jobs.get('world-1').cancellable, false);
    worlds[0].options.onStatus({phase: 'Preparing region cache', region: 'westgate', progress: {completed: 5, total: 10, unit: 'asset records'}});
    assert.equal(jobs.get('world-1').title, 'Preparing Westgate Cache');
    assert.equal(jobs.get('world-1').percent, 50);
    assert.equal(jobs.get('world-1').currentFile, 'Preparing region cache · 5/10 asset records');
    worlds[0].options.onStatus({phase: 'Preparing terrain', region: 'westgate', progress: {completed: 1, total: 4, unit: 'layers'}});
    assert.equal(jobs.get('world-1').title, 'Loading Westgate Layers');
    assert.equal(jobs.get('world-1').percent, 25);
    assert.equal(jobs.get('world-1').currentFile, 'Preparing terrain · 1/4 layers');
    worlds[0].options.onStatus({phase: 'Loading terrain textures', region: 'westgate', progress: {completed: 7, total: 20, unit: 'terrain textures'}});
    assert.equal(jobs.get('world-1').title, 'Loading Westgate Terrain Textures');
    assert.equal(jobs.get('world-1').percent, 35);
    assert.equal(jobs.get('world-1').currentFile, 'Loading terrain textures · 7/20 terrain textures');
    worlds[0].options.onStatus({phase: 'Preparing surface geometry', region: 'westgate', progress: {completed: 200, total: 471, unit: 'surface geometry assets'}});
    assert.equal(jobs.get('world-1').title, 'Preparing Westgate Surface Geometry');
    assert.equal(jobs.get('world-1').percent, 42);
    assert.equal(jobs.get('world-1').currentFile, 'Preparing surface geometry · 200/471 surface geometry assets');
    worlds[0].options.onStatus({phase: 'Assembling surface geometry', region: 'westgate'});
    assert.equal(jobs.get('world-1').percent, null, 'asset completion is not overall geometry completion');
    worlds[0].options.onStatus({phase: 'Loading native terrain material textures…', region: 'westgate'});
    assert.equal(jobs.size, 1, 'stages update the same job');
    assert.equal(jobs.get('world-1').currentFile, 'Loading native terrain material textures…');
    assert.equal(jobs.get('world-1').percent, null, 'unknown stages do not retain old percentages');
    assert.equal(jobs.get('world-1').total, 0);
    worlds[0].options.onStatus({phase: 'Ready', region: 'westgate'});
    assert.equal(jobs.size, 0);
    worlds[0].options.onStatus({phase: 'Loading regions 1/2', progress: {completed: 1, total: 2, unit: 'regions'}});
    assert.equal(jobs.get('world-2').title, 'Loading World Map Regions');
    assert.equal(jobs.get('world-2').percent, 50);
    worlds[0].options.onStatus({phase: 'error', region: 'westgate', error: 'resource unavailable', retryableFailed: true});
    assert.equal(jobs.size, 0, 'failed loads do not leave stale progress');
    assert.equal(toasts.length, 1, 'a failed map load is visible instead of silently disappearing');
    assert.equal(toasts[0].kind, 'error');
    assert.equal(toasts[0].persistent, true);
    assert.match(toasts[0].message, /Westgate.*resource unavailable.*Select to retry/);
    assert.equal(toasts[0].actionLabel, 'Retry');
    worlds[0].options.onStatus({phase: 'error', region: 'westgate', error: 'resource unavailable', retryableFailed: true});
    assert.equal(toasts.length, 1, 'repeated status frames do not stack duplicate errors');
    toasts[0].onClick();
    assert.equal(worlds[0].retries, 1, 'retry invokes the controller owning the failure');
    worlds[0].options.onStatus({phase: 'error', region: 'westgate', error: 'resource unavailable', retryableFailed: true});
    assert.equal(toasts.length, 2, 'a failed retry is visible again');
    worlds[0].options.onStatus({phase: 'Ready', region: 'westgate'});
    assert.deepEqual(dismissed, ['toast-2'], 'successful recovery removes the persistent error');
    toasts[0].onClick();
    assert.equal(worlds[0].retries, 1, 'an already-consumed retry callback is inert');
    worlds[0].options.onStatus({phase: 'Downloading Region', region: 'westgate'});
    worlds[0].options.onStatus({phase: 'error', region: 'westgate', retryableFailed: true});
    assert.equal(toasts.length, 3, 'unknown failures still produce a visible error');
    assert.match(toasts[2].message, /Westgate could not load.*Select to retry/);
    const staleRetry = toasts[2].onClick;
    selected = {...selected, revision: 2, loadIndex: async () => ({version: 'b'})};
    frame();
    assert.equal(worlds[0].destroyed, 1); assert.equal(worlds.length, 2);
    assert.deepEqual(dismissed, ['toast-2', 'toast-3'], 'retiring a world clears its error');
    assert.equal(staleRetry(), false, 'stale toast cannot retry a retired world');
    assert.equal(worlds[0].retries, 1); assert.equal(worlds[1].retries, 0);
    assert.equal(jobs.size, 1, 'catalog replacement shows its retirement wait');
    assert.equal([...jobs.values()][0].currentFile, 'Waiting for the previous map to stop…');
    assert.equal(worlds[1].options.indexLoader, selected.loadIndex);
    selected = null; frame(); frame();
    assert.equal(worlds[1].destroyed, 1);
    assert.equal(worlds[2].syncs, 0, 'disabled worlds never load a region');
    selected = {baseUrl: '/same-content-root/', revision: 3, loadIndex: worlds[0].options.indexLoader};
    frame();
    assert.equal(worlds[3].syncs, 0, 'replacement waits for all previous retirements');
    await new Promise(resolve => setImmediate(resolve));
    frame();
    assert.equal(worlds[2].destroyed, 1); assert.equal(worlds[3].syncs, 1);
    assert.equal(worlds[3].options.indexLoader, worlds[0].options.indexLoader);
    adapter.destroy(); assert.equal(worlds[3].destroyed, 1);
});


test('initial region framing does not wait for catalog delivery or refit after delayed delivery',async()=>{
 let delivery:any=null;const moves:any[]=[],screen={width:1000,height:700};
 const settings=reactive({enabled:true,regionKeys:['WestgateHex']});
 const factory=runInNewContext(stripTypeScriptTypes(source.replaceAll('import.meta.dev','false').replace(/^import .*;\r?\n/gm,'').replace('export function','function')+'\ncreateFoxholeSceneMapCanvas;'),{
  FoxholeRegionSceneController:class{sync(){}destroy(){}whenDisposed(){return Promise.resolve();}},
  FoxholeMapViewportPlugin:class{destroy(){}getSpatialWarState(){return null;}},
  selectedSpatialRegions,regionIdForKey,computed,shallowRef,
  beginShellProgressJob:()=>'job',updateShellProgressJob(){},finishShellProgressJob(){},setTimeout:()=>1,clearTimeout(){},
  foxholeWorldAssetDelivery:()=>delivery,
  subscribeSceneViewpointRestore:()=>()=>{},consumeViewpointRegionCamera:()=>false,
  plannerRoadTourActions:shallowRef(null),plannerRoadTourStatus:shallowRef({}),
  FOXHOLE_MAP_REGIONS:[{key:'WestgateHex'}],getFoxholeRegionPosition:()=>({x:10000,y:20000}),
  getFoxholeMapActiveBounds:()=>({left:9000,right:11000,top:19000,bottom:21000,width:2000,height:2000}),
  resolveFoxholeMapFitCamera:(_bounds:any,viewport:any)=>{assert.equal(viewport,screen);return{position:{x:10000,y:20000},scale:0.25};},
  useNixieSettingsStore:()=>({getValueOr(){}}),readFoxholeMapSettings:()=>({...settings}),
 });
 const adapter=factory({app:{screen},viewport:{},before:{},runtime:{projectStore:{settings:{}}},viewMode:()=>'2d',nodeCount:()=>0,zoom:()=>1,pointer:()=>null,interacting:()=>false,suppressGrid(){},cameraTo:(...args:any[])=>moves.push(args)});
 const frame=()=>adapter.updateSpatialPresentation({view:{},mode:'2d',deltaMS:16});
 screen.width=1;screen.height=1;frame();assert.equal(moves.length,0,'a placeholder canvas must not consume the one-time fit');
 screen.width=1000;screen.height=700;frame();assert.equal(moves.length,1,'known region bounds must frame the first spatial frame even without catalog delivery');
 delivery={revision:'ready',baseUrl:'https://assets.test/world/',loadIndex:async()=>({})};frame();await Promise.resolve();frame();
 assert.equal(moves.length,1,'catalog readiness must not undo a user pan made while waiting');
 adapter.destroy();
});

test('switching a positioned region from 2D to spatial views preserves the camera', async () => {
    let mode = 'flat', delivery: any = null;
    let camera = { x: 12345, y: 23456, scale: 2 };
    const moves: unknown[] = [];
    const settings = reactive({ enabled: true, regionKeys: ['WestgateHex'] });
    const factory = runInNewContext(stripTypeScriptTypes(source.replaceAll('import.meta.dev', 'false').replace(/^import .*;\r?\n/gm, '').replace('export function', 'function') + '\ncreateFoxholeSceneMapCanvas;'), {
        FoxholeRegionSceneController: class { sync() {} destroy() {} whenDisposed() { return Promise.resolve(); } },
        FoxholeMapViewportPlugin: class { destroy() {} getSpatialWarState() { return null; } },
        selectedSpatialRegions, regionIdForKey,
        hasLocalFoxholeSpatialRegion: () => false, computed, shallowRef,
        beginShellProgressJob: () => 'job', updateShellProgressJob() {}, finishShellProgressJob() {}, setTimeout: () => 1, clearTimeout() {},
        foxholeWorldAssetDelivery: () => delivery,
        subscribeSceneViewpointRestore: () => () => {}, consumeViewpointRegionCamera: () => false,
        plannerRoadTourActions: shallowRef(null), plannerRoadTourStatus: shallowRef({}),
        FOXHOLE_MAP_REGIONS: [{ key: 'WestgateHex' }, { key: 'OriginHex' }], getFoxholeRegionPosition: () => ({ x: 10000, y: 20000 }),
        getFoxholeMapActiveBounds: () => ({ left: 9000, right: 11000, top: 19000, bottom: 21000, width: 2000, height: 2000 }),
        resolveFoxholeMapFitCamera: () => ({ position: { x: 10000, y: 20000 }, scale: 0.25 }),
        useNixieSettingsStore: () => ({ getValueOr() {} }), readFoxholeMapSettings: () => ({ ...settings }),
    });
    const adapter = factory({ app: { screen: { width: 1000, height: 700 } }, viewport: {}, before: {},
        runtime: { projectStore: { settings: {} } }, viewMode: () => mode, nodeCount: () => 17,
        zoom: () => camera.scale, pointer: () => null, interacting: () => false, suppressGrid() {},
        cameraTo: (position: { x: number; y: number }, scale: number) => {
            moves.push({ position, scale });
            camera = { ...position, scale };
        } });
    const frame = () => adapter.updateSpatialPresentation({ view: {}, mode, deltaMS: 16 });
    try {
        frame();
        const positioned = { ...camera };
        mode = '2d';
        frame();
        assert.deepEqual(camera, positioned, 'entering 2.5D must not replace a positioned camera with a region fit');
        mode = '3d';
        frame();
        mode = 'flat';
        frame();
        camera = { x: 13000, y: 24000, scale: 3 };
        mode = '2d';
        frame();
        assert.deepEqual(camera, { x: 13000, y: 24000, scale: 3 }, 'returning from 2D must retain subsequent pans and zooms');
        delivery = { revision: 'ready', baseUrl: 'https://assets.test/world/', loadIndex: async () => ({}) };
        frame();
        await Promise.resolve();
        frame();
        assert.equal(moves.length, 0, 'late world delivery must not reframe a retained region');
        settings.regionKeys = ['OriginHex'];
        frame();
        assert.equal(moves.length, 1, 'selecting a different region in a spatial view still frames that region');
    } finally {
        adapter.destroy();
    }
});
