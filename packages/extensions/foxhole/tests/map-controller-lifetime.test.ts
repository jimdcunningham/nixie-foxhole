import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const controller = readFileSync(new URL('../app/plugins/foxhole/nixie/map/controller.ts', import.meta.url), 'utf8');
const renderer = readFileSync(new URL('../app/plugins/foxhole/nixie/map/renderer.ts', import.meta.url), 'utf8');

test('a cache load completing after canvas teardown cannot resume the retired renderer', async () => {
    const method = controller.match(/    private async syncRenderer\([\s\S]*?\n    \}/)![0];
    const sync = runInNewContext(stripTypeScriptTypes(method.replace('private async syncRenderer', 'async function syncRenderer') + '\nsyncRenderer;'));
    let finish: () => void = () => {};
    const cache = new Promise<void>(resolve => { finish = resolve; });
    const state = { isDestroyed: false, syncPending: false, renderer: {},
        readMapSettings: () => ({ enabled: true }), needsLiveData: () => true,
        syncViewportGridSuppression() {}, pluginContext: { session: { sceneViewActive: { value: true } } },
        mountRendererIfNeeded: async () => {}, ensureCacheLoaded: () => cache };
    const pending = sync.call(state);
    await Promise.resolve();
    state.isDestroyed = true;
    state.renderer = null as any;
    finish();
    await pending;
});

test('a destroyed map renderer ignores a late live-data synchronization', () => {
    const method = renderer.match(/    sync\(\): void \{[\s\S]*?\n    \}/)![0];
    const sync = runInNewContext(stripTypeScriptTypes(method.replace('sync(): void', 'function sync(): void') + '\nsync;'));
    sync.call({ root: { destroyed: true }, context: { readMapSettings() { throw new Error('Retired context was used'); } } });
});


test('a late initialization abort cannot tear down an already destroyed map twice', () => {
    const method = renderer.match(/    teardown\(\): void \{[\s\S]*?\n    \}/)![0];
    const teardown = runInNewContext(stripTypeScriptTypes(method.replace('teardown(): void', 'function teardown(): void') + '\nteardown;'));
    teardown.call({ root: { destroyed: true } });
});

test('a region texture finishing after its initialization retires cannot create a detached view', async () => {
    const method = renderer.match(/    private async createRegionView\([\s\S]*?\n    \}/)![0];
    const create = runInNewContext(stripTypeScriptTypes(method.replace('private async createRegionView', 'async function createRegionView') + '\ncreateRegionView;'), {
        getFoxholeRegionPosition: () => ({ x: 0, y: 0 }),
    });
    let finish: (value: unknown) => void = () => {};
    const pending = new Promise(resolve => { finish = resolve; });
    const state = { initializationEpoch: 1, context: { readMapSettings: () => ({ enabled: true }) },
        resolveBaseRegionTexturePath: () => 'base', loadRegionTexture: () => pending,
        isInitializationStillActive(epoch: number) { return epoch === this.initializationEpoch; } };
    const loading = create.call(state, {});
    state.initializationEpoch++;
    finish({});
    await loading;
});
