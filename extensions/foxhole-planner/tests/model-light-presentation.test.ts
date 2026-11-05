import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseNixieExtensionManifestV1 } from '@nixiejs/extension-sdk';
import { createFakeNixieExtensionHost } from '@nixiejs/extension-sdk/testing';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import assets from '#foxhole-scene-v2-assets';

// The portable renderer consumes catalog metadata, never a Nuxt light policy.
test('Planner declares model-light visibility through renderer RPC without changing authored components', async () => {
    const manifest = parseNixieExtensionManifestV1(JSON.parse(readFileSync(new URL('../nixie.extension.json', import.meta.url), 'utf8')));
    const settingId = 'foxhole.structure.modelLights';
    const setting = manifest.contributes.settings.find(entry => entry.id === settingId)!;
    assert.equal(setting.defaultValue, false);
    assert.equal(setting.scope, 'user');
    assert.ok(manifest.contributes.experimentalRenderers!.find(renderer => renderer.id === 'foxhole-assets')!.settingIds!.includes(settingId));
    const [assetId] = Object.entries(assets).find(([, metadata]) => metadata.model && !metadata.isItem && !metadata.isDestroyed)!;
    const entity = { entityId: 'lit-structure', revision: 1, components: [{ ownerId: manifest.id, componentId: 'asset', version: 1,
        definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId } }] };
    const before = structuredClone(entity);
    const host = createFakeNixieExtensionHost({ extensionId: manifest.id });
    const connection = await host.connect({ sceneV2: { entityRenderers: { 'render.entity': renderFoxholeSceneV2Entity } } });
    try {
        for (const enabled of [false, true, false, true]) {
            const plan = await host.renderEntity('render.entity', entity, { contractVersion: 1, entities: [entity], settings: { [settingId]: enabled } });
            assert.equal(plan.experimentalSpatial?.modelLights, enabled);
            assert.equal(plan.experimentalSpatial?.supplementModel, true);
            assert.deepEqual(entity, before);
        }
        const defaults = await host.renderEntity('render.entity', entity);
        assert.equal(defaults.experimentalSpatial?.modelLights, false);
    } finally {
        connection.dispose();
    }
});
