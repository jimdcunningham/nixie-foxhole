import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildFoxholeStructureCatalog, getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import { isFoxholeStructureDestroyed, resolveFoxholeStructureDestroyedMutation } from '../app/plugins/foxhole/nixie/structure-destroyed-actions.ts';
import { createFoxholeStructureTextureKey } from '../app/plugins/foxhole/nixie/types.ts';
import { NixieSceneV2ComponentHost } from '../../../nixie/desktop-extensions/scene-v2-component-host.ts';
import { NIXIE_SCENE_V2_CORE_COMPONENTS } from '../../../nixie/desktop-extensions/scene-v2-core-components.ts';
import { convertNixieSceneV1ToV2 } from '../../../nixie/desktop-extensions/scene-v2-conversion.ts';
import { buildNixieSceneV2InspectorPatches } from '../../../nixie/app/utils/nixie-scene-v2-inspector.ts';
import { registerNixieSceneV2StateAdapter } from '../../../nixie/app/utils/nixie-scene-v2-state-adapter-registry.ts';
import { convertFoxholeSceneV1NodeToV2 } from '../app/plugins/foxhole/nixie/scene-v2-conversion.ts';
import { foxholeSceneV2StateAdapter } from '../app/plugins/foxhole/nixie/scene-v2-state-adapter.ts';
import { renderFoxholeSceneV2Entity } from '../../../../extensions/foxhole-planner/src/scene-v2-renderers.ts';

const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
const manifest = JSON.parse(readFileSync(new URL('../../../../extensions/foxhole-planner/nixie.extension.json', import.meta.url), 'utf8'));
const groups = Object.groupBy(catalog.assets.filter(asset => asset.destroyedStructureId), asset => asset.destroyedStructureId!);

function fixture(foxholeKey: string) {
    const source = [{ id: 'bunker', type: 'foxholeAsset', state: {
        foxholeKey, x: 123, y: -47, rotation: 37 * Math.PI / 180, scaleX: 1.25, scaleY: 0.75,
    }, children: [] }];
    const converted = convertNixieSceneV1ToV2(source, { nodeConverters: [convertFoxholeSceneV1NodeToV2] });
    const host = new NixieSceneV2ComponentHost();
    host.registerExtension('nixie.core', NIXIE_SCENE_V2_CORE_COMPONENTS);
    host.registerExtension('nixie.foxhole-planner', manifest.contributes.experimentalComponents);
    host.replaceDocument(converted.content);
    return { host, id: converted.content.entities[0]!.entityId };
}

test('paired destroyed appearances use the published wreck texture, dimensions and origin', () => {
    for (const intact of catalog.assets.filter(asset => asset.destroyedStructureId)) {
        const wreck = catalog.structureByKey[intact.destroyedStructureId!]!;
        assert.ok(intact.destroyed?.textureUrl, intact.foxholeKey);
        assert.equal(catalog.textureUrlByKey[createFoxholeStructureTextureKey(intact.foxholeKey, null, true)], intact.destroyed.textureUrl);
        assert.equal(intact.destroyed.textureUrl, wreck.variants.default?.textureUrl, intact.foxholeKey);
        assert.equal(intact.destroyed.width, wreck.sprite.width, intact.foxholeKey);
        assert.equal(intact.destroyed.height, wreck.sprite.height, intact.foxholeKey);
        assert.equal(intact.destroyed.offsetX, wreck.sprite.offsetX, intact.foxholeKey);
        assert.equal(intact.destroyed.offsetY, wreck.sprite.offsetY, intact.foxholeKey);
    }
});

for (const [wreckKey, intactAssets] of Object.entries(groups).filter(([, assets]) => assets!.length > 1)) {
    test(`all intact types sharing ${wreckKey} retain identity and wreck geometry through toggles and history`, () => {
        registerNixieSceneV2StateAdapter('nixie.foxhole-planner', foxholeSceneV2StateAdapter);
        const wreckFixture = fixture(wreckKey);
        const wreckEntity = wreckFixture.host.readEntity(wreckFixture.id);
        const nativeWreckBounds = foxholeSceneV2StateAdapter.selectionLocalBounds!(wreckEntity, 1);
        const sdkWreckBounds = renderFoxholeSceneV2Entity(wreckEntity).experimentalSelectionGeometry!.localBounds;
        for (const intact of intactAssets!) {
            const { host, id } = fixture(intact.foxholeKey);
            const before = host.exportDocument();
            const initial = host.readEntity(id);
            const retained = initial.components.filter(component => component.componentId !== 'appearance');
            const normalPlan = renderFoxholeSceneV2Entity(initial);
            const edit = (destroyed: boolean) => {
                const state = foxholeSceneV2StateAdapter.project(host.readEntity(id))!.state;
                const patch = resolveFoxholeStructureDestroyedMutation(catalog, state, destroyed);
                assert.ok(patch, intact.foxholeKey);
                const updates = buildNixieSceneV2InspectorPatches(host.readEntity(id), patch);
                host.applyEditorComponentPatches(updates.map(update => ({ ...update, entityId: id })));
                const current = host.readEntity(id);
                const projected = foxholeSceneV2StateAdapter.project(current)!.state;
                assert.equal(current.entityId, initial.entityId);
                assert.equal(projected.foxholeKey, intact.foxholeKey);
                assert.equal(projected.destroyed === true, destroyed);
                assert.equal(isFoxholeStructureDestroyed(intact, projected), destroyed);
                assert.deepEqual(current.components.filter(component => component.componentId !== 'appearance'), retained);
                return current;
            };
            const destroyed = edit(true);
            assert.deepEqual(foxholeSceneV2StateAdapter.selectionLocalBounds!(destroyed, 1), nativeWreckBounds, intact.foxholeKey);
            const destroyedPlan = renderFoxholeSceneV2Entity(destroyed);
            assert.deepEqual(destroyedPlan.experimentalSelectionGeometry!.localBounds, sdkWreckBounds, intact.foxholeKey);
            const body = destroyedPlan.root.children.find(node => node.id === 'building-texture');
            assert.ok(body?.kind === 'sprite');
            assert.equal(body.resourceId, `foxhole.asset.${wreckKey}`);
            assert.equal(destroyedPlan.root.children.some(node => node.id.startsWith('structure-layer-')), false);
            edit(false);
            assert.deepEqual(renderFoxholeSceneV2Entity(host.readEntity(id)), normalPlan);
            host.undo();
            assert.deepEqual(renderFoxholeSceneV2Entity(host.readEntity(id)), destroyedPlan);
            host.undo();
            assert.deepEqual(host.exportDocument(), before);
            host.redo();
            assert.deepEqual(renderFoxholeSceneV2Entity(host.readEntity(id)), destroyedPlan);
        }
    });
}

test('a directly placed wreck retains its existing intact fallback and missing pairs stay unchanged', () => {
    const wreck = catalog.assetByKey.fortdestroyedt2!;
    assert.equal(resolveFoxholeStructureDestroyedMutation(catalog, { foxholeKey: wreck.foxholeKey }, false)?.foxholeKey, wreck.intactStructureId);
    assert.equal(resolveFoxholeStructureDestroyedMutation(catalog, { foxholeKey: 'missing' }, true), null);
    assert.equal(resolveFoxholeStructureDestroyedMutation(catalog, { foxholeKey: 'fortrampt2', destroyed: true }, true), null);
});

test('standalone shared wrecks restore their authored rebuild targets independently of manifest order', () => {
    const published = getFoxholeManifest('/foxhole/assets/');
    const expected = { fortdestroyedt1: 'fortt1', fortdestroyedt2: 'fortt2', fortdestroyedt3: 'fortt3',
        aircraftrunwaydestroyed: 'aircraftrunwayt1' };
    const uniquePairs = Object.entries(groups).filter(([, candidates]) => candidates!.length === 1);
    const midpoint = Math.floor(published.assets.length / 2);
    for (const assets of [published.assets, published.assets.slice().reverse(), [...published.assets.slice(midpoint), ...published.assets.slice(0, midpoint)]]) {
        const ordered = buildFoxholeStructureCatalog({ ...published, assets });
        for (const [destroyedKey, intactKey] of Object.entries(expected)) {
            const wreck = published.assets.find(asset => asset.id === destroyedKey)!;
            assert.equal(wreck.upgradeStructureCodeName?.toLowerCase(), intactKey);
            assert.equal(ordered.assetByKey[destroyedKey]!.intactStructureId, intactKey);
            assert.equal(resolveFoxholeStructureDestroyedMutation(ordered, { foxholeKey: destroyedKey }, false)?.foxholeKey, intactKey);
        }
        for (const [destroyedKey, candidates] of uniquePairs) {
            assert.equal(ordered.assetByKey[destroyedKey]!.intactStructureId, candidates![0]!.foxholeKey, destroyedKey);
        }
    }
});

test('shared wrecks without a matching declared rebuild target stay unresolved instead of selecting an arbitrary intact type', () => {
    for (const restoreCodeName of [undefined, 'FortT1']) {
        const published = structuredClone(getFoxholeManifest('/foxhole/assets/'));
        published.assets.find(asset => asset.id === 'fortdestroyedt2')!.upgradeStructureCodeName = restoreCodeName;
        for (const assets of [published.assets, published.assets.slice().reverse()]) {
            const unresolved = buildFoxholeStructureCatalog({ ...published, assets });
            assert.equal(unresolved.assetByKey.fortdestroyedt2!.intactStructureId, null);
            assert.equal(resolveFoxholeStructureDestroyedMutation(unresolved, { foxholeKey: 'fortdestroyedt2', destroyed: true }, false), null);
            const rampState = { foxholeKey: 'fortrampt2', destroyed: true };
            assert.deepEqual(resolveFoxholeStructureDestroyedMutation(unresolved, rampState, false), { destroyed: false });
        }
    }
});
