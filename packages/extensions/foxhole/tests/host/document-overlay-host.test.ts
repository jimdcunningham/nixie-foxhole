import assert from 'node:assert/strict';
import test from 'node:test';
import * as PIXI from 'pixi.js';
import { NixieSceneV2DocumentOverlayHost } from '../../../../nixie/app/plugins/nixie/scene-v2/document-overlay-host.ts';
import { NixieSceneV2ResourceOwnership } from '../../../../nixie/app/utils/nixie-scene-v2-resource-ownership.ts';
import { renderFoxholePlanningMap } from '../../../../../extensions/foxhole-planner/src/scene-v2-map-renderer.ts';
import { renderDiagramDocumentPage } from '../../../../../extensions/scene-v2-diagram/src/document-page.ts';
import { clampNixieSceneV2CameraScale, nixieSceneV2CameraWorldTransform } from '../../../../nixie/desktop-extensions/scene-v2-camera.ts';

function fixture(load: (id: string) => Promise<PIXI.Texture> = async () => PIXI.Texture.EMPTY) {
    const ownership = new NixieSceneV2ResourceOwnership();
    const retained: Set<string>[] = [];
    const host = new NixieSceneV2DocumentOverlayHost({ acquireResources: keys => ownership.acquire(keys),
        rendererOptions: keys => ({ loadTexture: async id => {
            keys.add(id);
            return await load(id);
        } }),
        releaseUnusedResources: () => {
            const keys = new Set<string>();
            ownership.retainInto(keys);
            retained.push(keys);
        } });
    return { host, retained };
}
test('Planner terrain and neutral page backdrops materialize noninteractive clipping and retire all resources on disable', async () => {
    for (const render of [() => renderFoxholePlanningMap({ contractVersion: 1, settings: { 'foxhole.map.enabled': true, 'foxhole.map.regionKeys': 'DeadLandsHex',
        'foxhole.map.crop.enabled': true, 'foxhole.map.crop.width': 1000, 'foxhole.map.crop.height': 800 }, viewport: { renderScale: 400 }, theme: 'dark' }),
    () => renderDiagramDocumentPage({ contractVersion: 1, settings: { 'example.scene-v2-diagram.page.enabled': true }, viewport: { renderScale: 1 }, theme: 'light' })]) {
        const { host, retained } = fixture();
        const expected = render();
        assert.equal(await host.replace('visible', async () => expected), true);
        assert.deepEqual(host.worldBounds, expected.worldBounds);
        assert.equal(host.container.eventMode, 'none');
        assert.equal(host.container.interactiveChildren, false);
        assert.ok(host.container.children[0]!.children[0]!.mask);
        assert.ok(retained.at(-1)!.size > 0);
        await host.replace('disabled', async () => ({ contractVersion: 1, plan: { schemaVersion: 1, root: { id: 'empty', kind: 'group', children: [] } } }));
        assert.equal(host.worldBounds, null);
        assert.equal(retained.at(-1)!.size, 0);
        host.destroy();
    }
});
test('failed results preserve accepted bounds and pending stale loads keep ownership until their trees retire', async () => {
    let resolveLoad!: (texture: PIXI.Texture) => void;
    let loaded!: () => void;
    const started = new Promise<void>(resolve => {
        loaded = resolve;
    });
    const { host, retained } = fixture(async () => {
        loaded();
        return await new Promise(resolve => {
            resolveLoad = resolve;
        });
    });
    const empty = { contractVersion: 1 as const, plan: { schemaVersion: 1 as const, root: { id: 'empty', kind: 'group' as const, children: [] } },
        worldBounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 } };
    await host.replace('original', async () => empty);
    await assert.rejects(host.replace('invalid', async () => ({ ...empty, clip: { minX: 0, minY: 0, maxX: -1, maxY: 1 } })));
    assert.deepEqual(host.worldBounds, empty.worldBounds);
    const pending = host.replace('pending', async () => ({ contractVersion: 1, plan: { schemaVersion: 1,
        root: { id: 'media', kind: 'group', children: [{ id: 'texture', kind: 'sprite', resourceId: 'test.texture', width: 50, height: 50 }] } } }));
    await started;
    await host.replace('replacement', async () => empty);
    assert.equal(retained.at(-1)!.has('test.texture'), true);
    resolveLoad(PIXI.Texture.EMPTY);
    assert.equal(await pending, false);
    assert.equal(retained.at(-1)!.has('test.texture'), false);
    assert.deepEqual(host.worldBounds, empty.worldBounds);
    host.destroy();
    assert.equal(retained.at(-1)!.size, 0);
});
test('host camera transforms honor an explicit document fit floor while keeping the normal floor by default', () => {
    assert.equal(clampNixieSceneV2CameraScale(0.0005), 0.0025);
    assert.equal(clampNixieSceneV2CameraScale(0.0005, 0.0004), 0.0005);
    assert.deepEqual(nixieSceneV2CameraWorldTransform({ centerX: 10000, centerY: -20000, scale: 0.0005 }, { width: 1000, height: 800 }, 0.0004),
        { x: 495, y: 410, scale: 0.0005 });
});
test('identical pending catalog refreshes cannot cancel the first map load or request it repeatedly', async () => {
    let settle!: () => void;
    const loaded = new Promise<void>(resolve => {
        settle = resolve;
    });
    const { host } = fixture();
    const result = { contractVersion: 1 as const, plan: { schemaVersion: 1 as const, root: { id: 'empty', kind: 'group' as const, children: [] } } };
    let requests = 0;
    const first = host.replace('same', async () => {
        requests++;
        await loaded;
        return result;
    });
    const repeated = host.replace('same', async () => {
        requests++;
        return result;
    });
    settle();
    await repeated;
    assert.equal(await first, true);
    assert.equal(requests, 1);
    host.destroy();
});
test('returning to accepted preferences cancels a different pending replacement', async () => {
    const { host } = fixture();
    const result = { contractVersion: 1 as const, plan: { schemaVersion: 1 as const, root: { id: 'empty', kind: 'group' as const, children: [] } },
        worldBounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 } };
    await host.replace('original', async () => result);
    let settle!: () => void;
    const pending = host.replace('other', async () => {
        await new Promise<void>(resolve => {
            settle = resolve;
        });
        return { ...result, worldBounds: { ...result.worldBounds, maxX: 99 } };
    });
    await host.replace('original', async () => result);
    settle();
    assert.equal(await pending, false);
    assert.deepEqual(host.worldBounds, result.worldBounds);
    host.destroy();
});

test('pointer changes with an equivalent derived plan retain the accepted tree and resource lease', async () => {
    const { host, retained } = fixture();
    const result = { contractVersion: 1 as const, plan: { schemaVersion: 1 as const, root: { id: 'root', kind: 'group' as const,
        children: [{ id: 'image', kind: 'sprite' as const, resourceId: 'test.image', width: 50, height: 50 }] } } };
    await host.replace('pointer-one', async () => result);
    const original = host.container.children[0];
    assert.equal(await host.replace('pointer-two', async () => structuredClone(result)), false);
    assert.equal(host.container.children[0], original);
    assert.equal(retained.at(-1)!.has('test.image'), true);
    host.destroy();
    assert.equal(retained.at(-1)!.size, 0);
});
