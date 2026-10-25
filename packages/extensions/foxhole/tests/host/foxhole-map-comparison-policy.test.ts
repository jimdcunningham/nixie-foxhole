import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { computed, ref } from 'vue';
import { foxholeSceneMapRendererSetting } from '../../app/plugins/foxhole/nixie/scene-map-renderer-setting.ts';

const read = (path: string) => readFileSync(new URL(`../../app/${path}`, import.meta.url), 'utf8');
const policySource = read('utils/foxhole-nixie-contributions.ts');
const contributionSource = read('plugins/nixie/contributions/foxhole/map.contrib.ts');
const menuSource = read('components/nixie/foxhole/FoxholeWarNxSidebarOverflow.vue');
const settingId = 'foxhole.map.useSdkRenderer';

function evaluate(source: string, development: boolean, globals: Record<string, unknown>) {
    return runInNewContext(transformSync(source, {
        loader: 'ts', define: { 'import.meta.dev': String(development) },
    }).code, globals);
}

for (const development of [false, true]) {
    test(`${development ? 'local development exposes' : 'production excludes'} the SDK map comparison setting and menu`, () => {
        const definition = foxholeSceneMapRendererSetting;
        assert.equal(definition.accessibleInDev, true, 'settings rows must display the existing dev indicator');
        const settings = evaluate(`const result = [${contributionSource.match(/ {4}settings: \[([\s\S]*?)\n {4}\],/)![1]}]; result;`, development, {
            foxholeMapSettings: [], foxholeStatsUserSettings: [], foxholeSceneMapRendererSetting: definition,
        });
        assert.equal(settings.includes(definition), development);
        const itemsScript = menuSource.slice(menuSource.indexOf('const items = computed'), menuSource.indexOf('\nonMounted('));
        const sceneV2 = ref(true);
        const items = evaluate(`${itemsScript}\nitems;`, development, {
            computed, documentSession: { isSceneV2Active: sceneV2 },
            mapSettings: ref({ coloredIcons: true, adaptiveStreaming: true, modelLod: true }),
            settingsStore: { getValueOr: () => true }, FOXHOLE_USE_SDK_MAP_SETTING_ID: settingId,
            notificationsEnabled: ref(true), shards: ref([]),
        });
        assert.equal(items.value.find((item: { label: string; }) => item.label === 'Use SDK Map').visible, development);
        assert.equal(items.value.find((item: { label: string; }) => item.label === 'Use SDK Map').accessibleInDev, true,
            'checkbox menu rows must display the existing dev badge');
        sceneV2.value = false;
        assert.equal(items.value.find((item: { label: string; }) => item.label === 'Use SDK Map').visible, false);
    });

    test(`${development ? 'local development honors' : 'production ignores'} a saved SDK renderer preference`, () => {
        let preference = true;
        let reads = 0;
        let bundledEnabled: (() => boolean) | undefined;
        evaluate(policySource.match(/ {4}registerNixieSceneV2CanvasContribution\([\s\S]*?\);/)![0], development, {
            registerNixieSceneV2CanvasContribution: (_owner: string, _factory: unknown, enabled: () => boolean) => {
                bundledEnabled = enabled;
            },
            createFoxholeSceneMapCanvas() {}, FOXHOLE_USE_SDK_MAP_SETTING_ID: settingId,
            settings: { getValueOr(id: string) {
                assert.equal(id, settingId);
                reads++;
                return preference;
            } },
        });
        assert.ok(bundledEnabled);
        assert.equal(bundledEnabled(), !development);
        assert.equal(reads, development ? 1 : 0, 'production must not consult a saved comparison override');
        preference = false;
        assert.equal(bundledEnabled(), true, 'bundled rendering remains the default');
    });
}
