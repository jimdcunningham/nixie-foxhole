import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {parseNixieExtensionManifestV1} from '@nixiejs/extension-sdk';
import {createFakeNixieExtensionHost} from '@nixiejs/extension-sdk/testing';
import {renderFoxholeSceneV2Entity} from '../src/scene-v2-renderers.ts';
import {FOXHOLE_SCENE_FACTION_SETTING_ID as settingId} from '../src/model-texture-presentation.ts';
import assets, {flagAtlasesByResourceId} from '#foxhole-scene-v2-assets';

test('retained faction selection crosses actual Planner renderer RPC without authored changes', async () => {
    const manifest = parseNixieExtensionManifestV1(JSON.parse(readFileSync(new URL('../nixie.extension.json', import.meta.url), 'utf8')));
    const setting = manifest.contributes.settings.find(row => row.id === settingId)!;
    assert.ok(setting.scope === 'user'); assert.equal(setting.persist, 'local'); assert.ok(manifest.contributes.viewpointSettings?.settingIds.includes(settingId));
    assert.equal(setting.type, 'select'); assert.equal(setting.scope, 'user'); assert.equal(setting.defaultValue, 'asset-default');
    assert.ok(manifest.contributes.renderers!.find(row => row.id === 'foxhole-assets')!.settingIds!.includes(settingId));
    const examples = Object.entries(assets).filter(([, metadata]) => metadata.model && flagAtlasesByResourceId?.[metadata.model.resourceId]);
    if (flagAtlasesByResourceId) assert.ok(examples.length > 0, 'the enriched flag catalog must exercise real assets');
    const host = createFakeNixieExtensionHost({extensionId: manifest.id});
    const connection = await host.connect({sceneV2: {entityRenderers: {'render.entity': renderFoxholeSceneV2Entity}}});
    try {
        for (const [assetId, metadata] of examples) {
            const entity = {entityId: 'flag-' + assetId, revision: 7, components: [{ownerId: manifest.id, componentId: 'asset', version: 1,
                definitionAvailable: true, data: {catalogId: 'foxhole.structures', assetId}}]};
            const before = structuredClone(entity), rows = flagAtlasesByResourceId![metadata.model!.resourceId]!;
            for (const [faction, target] of [['colonial', 0], ['warden', 1], ['asset-default', undefined]] as const) {
                const plan = await host.renderEntity('render.entity', entity, {contractVersion: 1, entities: [entity], settings: {[settingId]: faction}});
                assert.deepEqual(plan.spatial?.modelTextureTransforms, target === undefined ? [] : rows.map(row => ({
                    materialName: row.materialName, offset: [0, (target - row.authoredRow) * 0.5],
                })));
                assert.deepEqual(entity, before);
            }
        }
        const entity = {entityId: 'plain', revision: 1, components: [{ownerId: manifest.id, componentId: 'asset', version: 1,
            definitionAvailable: true, data: {catalogId: 'foxhole.structures', assetId: 'rifleait3'}}]};
        assert.deepEqual((await host.renderEntity('render.entity', entity)).spatial?.modelTextureTransforms, []);
    } finally {connection.dispose();}
});
