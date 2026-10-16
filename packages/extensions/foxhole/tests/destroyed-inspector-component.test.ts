/* eslint-disable @typescript-eslint/no-explicit-any -- Compiled Vue component test boundary. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { compileScript, parse } from '@vue/compiler-sfc';
import * as Vue from 'vue';
import { useNixieInspectorFormSectionTab } from '../../../nixie/app/composables/useNixieInspectorFormSectionCollapse.ts';
import { getFoxholeStructureAsset, getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { isFoxholeStructureDestroyed, resolveFoxholeStructureDestroyedMutation } from '../app/plugins/foxhole/nixie/structure-destroyed-actions.ts';
import { normalizeFoxholeColorHex, normalizeFoxholeFaction } from '../app/plugins/foxhole/nixie/types.ts';

const source = readFileSync(new URL('../app/components/nixie/foxhole/FoxholeStructureInspectorCard.vue', import.meta.url), 'utf8');
const compiled = compileScript(parse(source).descriptor, { id: 'destroyed-inspector-test' }).content;
const executable = stripTypeScriptTypes(compiled)
    .replace(/import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?/g, (_match, bindings: string, moduleId: string) => {
        const provider = `modules[${JSON.stringify(moduleId)}]`;
        return bindings.startsWith('{')
            ? `const ${bindings.replace(/\s+as\s+/g, ':')} = ${provider};`
            : `const ${bindings} = ${provider}.default;`;
    })
    .replace('export default', 'module.exports =');

function harness(foxholeKey: string, appearance: Record<string, boolean> = {}) {
    const snapshot = Vue.reactive({ id: 'bunker', type: 'foxholeAsset', state: {
        foxholeKey, destroyed: false, ...appearance, x: 123, y: -47, rotation: 37 * Math.PI / 180, scaleX: 1.25, scaleY: 0.75,
    } });
    const patches: Array<Record<string, unknown>> = [];
    const patchNode = async (id: string, patch: Record<string, unknown>) => {
        assert.equal(id, 'bunker');
        patches.push(patch);
        Object.assign(snapshot.state, patch);
    };
    const runtime = { patchNode, projectStore: { project: null, settings: {} } };
    const services = {
        default: {}, getFoxholeStructureAsset, getFoxholeStructureCatalog,
        isFoxholeStructureDestroyed, resolveFoxholeStructureDestroyedMutation,
        normalizeFoxholeColorHex, normalizeFoxholeFaction,
        useNixieInspectorFormSectionTab,
        useNixieRuntime: () => runtime,
        useNixieSidebarAssetHoverCard: () => null,
        useNixieSettingsStore: () => ({ getValue: () => false }),
        isNixieAdminUser: () => false,
        canAccessNixieDevFeatures: () => false,
        FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS: { hitboxes: 'hitboxes' },
        FOXHOLE_ASSET_SOURCE_ID: 'foxhole.structures',
        resolveFoxholeAssetCompletionMetadata: () => ({}),
    };
    const sandbox = {
        module: { exports: {} as any },
        modules: new Proxy({}, { get: (_target, moduleId) => moduleId === 'vue' ? { ...Vue, onBeforeUnmount: () => {} } : services }),
        useFoxholeLocalization: () => ({ assetBaseUrl: Vue.ref('/foxhole/assets/'), t: (_key: string, fallback: string) => fallback }),
        useRuntimeConfig: () => ({ app: { baseURL: '/' } }),
        useSupabaseUser: () => Vue.ref(null),
        setTimeout, clearTimeout, requestAnimationFrame: setTimeout, cancelAnimationFrame: clearTimeout,
    };
    runInNewContext(executable, sandbox);
    const scope = Vue.effectScope();
    const control = scope.run(() => sandbox.module.exports.setup({
        node: { type: 'foxholeAsset', snapshot, snapshots: [snapshot], targetIds: ['bunker'] },
        canEdit: true, effectiveLocked: false, patchNode: (patch: Record<string, unknown>) => patchNode('bunker', patch),
    }, { expose: () => {} }));
    return { control, snapshot, patches, dispose: () => scope.stop() };
}

test('compiled Inspector evaluates normal and destroyed hover entries while its toggle preserves the selected bunker type', async () => {
    for (const key of ['fortrampt2', 'fortt2', 'engineroomt3', 'aircraftrunwayt1']) {
        const { control, snapshot, patches, dispose } = harness(key);
        try {
            const initial = structuredClone(Vue.toRaw(snapshot.state));
            assert.equal(control.hoverAssetEntry.value.asset.id, key);
            await control.setDestroyedValue(true);
            assert.equal(control.destroyed.value, true);
            assert.equal(snapshot.state.foxholeKey, key);
            assert.equal(control.hoverAssetEntry.value.asset.id, `${key}:destroyed`);
            assert.equal(control.hoverAssetEntry.value.asset.metadata.defaultDestroyedState, true);
            assert.equal(control.hoverAssetEntry.value.previewUrl, getFoxholeStructureAsset(key)!.destroyed!.previewUrl);
            await control.setDestroyedValue(false);
            assert.equal(control.destroyed.value, false);
            assert.equal(control.hoverAssetEntry.value.asset.id, key);
            assert.deepEqual(Vue.toRaw(snapshot.state), initial);
            assert.equal(patches.length, 2);
        } finally {
            dispose();
        }
    }
});

test('compiled Inspector rebuilds standalone shared wrecks into their authored intact targets', async () => {
    for (const [wreck, intact] of [['fortdestroyedt1', 'fortt1'], ['fortdestroyedt2', 'fortt2'],
        ['fortdestroyedt3', 'fortt3'], ['aircraftrunwaydestroyed', 'aircraftrunwayt1']]) {
        const { control, snapshot, dispose } = harness(wreck!);
        try {
            const initial = structuredClone(Vue.toRaw(snapshot.state));
            assert.equal(control.destroyed.value, true);
            assert.equal(control.hoverAssetEntry.value.asset.id, wreck);
            await control.setDestroyedValue(false);
            assert.equal(snapshot.state.foxholeKey, intact);
            assert.equal(control.destroyed.value, false);
            assert.equal(control.hoverAssetEntry.value.asset.id, intact);
            assert.deepEqual({ ...Vue.toRaw(snapshot.state), foxholeKey: wreck }, initial);
        } finally {
            dispose();
        }
    }
});

test('compiled Inspector switches between Demolished and Blueprint with one complete patch', async () => {
    for (const key of ['facilityrefinery1', 'fortrampt2']) {
        const { control, snapshot, patches, dispose } = harness(key, { blueprint: true });
        try {
            assert.equal(control.blueprint.value, true, key);
            await control.setDestroyedValue(true);
            assert.equal(control.destroyed.value, true, key);
            assert.equal(control.blueprint.value, false, key);
            assert.equal(patches.length, 1);
            assert.equal(patches[0]!.blueprint, false);
            await control.setBlueprintValue(true);
            assert.equal(control.blueprint.value, true, key);
            assert.equal(control.destroyed.value, false, key);
            assert.equal(patches.length, 2);
            assert.equal(patches[1]!.destroyed, false);
            assert.equal(snapshot.state.foxholeKey, key);
        } finally {
            dispose();
        }
    }
});

test('compiled Inspector restores standalone wreck identity before enabling Blueprint', async () => {
    const { control, snapshot, patches, dispose } = harness('fortdestroyedt2');
    try {
        assert.equal(control.canBlueprint.value, true);
        await control.setBlueprintValue(true);
        assert.equal(control.blueprint.value, true);
        assert.equal(control.destroyed.value, false);
        assert.equal(snapshot.state.foxholeKey, 'fortt2');
        assert.equal(patches.length, 1);
    } finally {
        dispose();
    }
});
