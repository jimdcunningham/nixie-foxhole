import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { shallowRef } from 'vue';
import { parseNixieExtensionManifestV1 } from '@nixiejs/extension-sdk';
import { NixieRegistry } from '#nixie/plugins/nixie/registry/index.ts';
import type { NixiePrimaryToolbarContext } from '#nixie/plugins/nixie/registry/types.ts';
import { configureNixieSceneV2AuthoringIsolation } from '#nixie/utils/nixie-scene-v2-authoring-isolation.ts';
import { registerNixieEditorDocumentSessionBridge } from '#nixie/utils/nixie-editor-document-session-bridge.ts';
import { createExternalDeclarativeContribution } from '#nixie-internal/desktop-extensions/contribution-adapter.ts';
import { createNixieSurfaceRoutedSdkUi } from '#nixie-internal/desktop-extensions/ui-routing.ts';
import { createFoxholeRetainedSceneV2Ui } from '#foxhole/plugins/foxhole/nixie/scene-v2-retained-ui.ts';
import { FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS as sources } from '#foxhole/plugins/foxhole/nixie/contribution-source-ids.ts';
import { foxholeMapSettings } from '#foxhole/plugins/foxhole/nixie/map-settings.ts';
import { foxholeStatsUserSettings } from '#foxhole/plugins/foxhole/nixie/stats-settings.ts';
import { foxholeSceneMapRendererSetting } from '#foxhole/plugins/foxhole/nixie/scene-map-renderer-setting.ts';

// Real Planner metadata and real registry dispatch; private UI callbacks are poisoned.
test('Planner SDK socket/overlay/settings UI composes with the precise retained War map controls', async context => {
    const manifest = parseNixieExtensionManifestV1(JSON.parse(readFileSync(new URL('../../../../../extensions/foxhole-planner/nixie.extension.json', import.meta.url), 'utf8')));
    const registry = new NixieRegistry();
    registry.setEnabledExtensionIds([manifest.id]);
    const socketId = 'foxhole.viewport.socketSnapping';
    const socketItemId = 'foxhole.primary-toolbar.snapping.sockets';
    const statsId = 'nixie.foxhole-planner.stats.exportSections';
    const trap = () => {
        throw new Error('Private authoring UI executed');
    };
    const mapControls = [...foxholeMapSettings, foxholeSceneMapRendererSetting];
    registry.registerMany([
        { sourceId: sources.toolbar, contribution: {
            settings: [{ id: socketId, name: 'Private Socket Snapping', scope: 'user', type: 'boolean', group: 'general', defaultValue: true, validate: trap }],
            primaryToolbarItems: [{ id: socketItemId, group: 'nixie.primary-toolbar.snapping', label: 'Private Socket Snapping', run: trap }],
        } },
        { sourceId: sources.map, contribution: {
            settings: [...mapControls, ...foxholeStatsUserSettings],
            commands: [{ id: 'foxhole.map.toggle', name: 'Retained Map', type: 'editor', run: () => {
                mapCalls++;
            } }],
            menus: [{ menu: 'overlays.structures', item: { id: 'foxhole.map.menu.toggle', type: 'checkbox', label: 'Retained Map', checked: false, onClick: () => {
                mapCalls++;
            } } }],
            leftSidebar: [{ id: 'foxhole-war-shell', name: 'Foxhole War', icon: 'ph:map', sections: [{ id: 'war', name: 'War', component: {} }] }],
        } },
    ]);
    let mapCalls = 0;
    const values = new Map([[socketId, true]]);
    const sdkSource = `test.sdk.${manifest.id}`;
    const declaration = createExternalDeclarativeContribution(manifest, manifest.capabilities, {
        getSetting: id => values.get(id), toggleSetting: id => {
            values.set(id, !values.get(id));
        },
    });
    registry.register(sdkSource, createNixieSurfaceRoutedSdkUi(manifest.id, sdkSource, declaration,
        new Set((manifest.contributes.experimentalProductTools ?? []).map(tool => `nixie.tool.activate.extension:${manifest.id}:${tool.id}`)), registry));
    context.after(() => {
        configureNixieSceneV2AuthoringIsolation(false, false);
        registerNixieEditorDocumentSessionBridge(null);
    });
    configureNixieSceneV2AuthoringIsolation(true, true);
    registerNixieEditorDocumentSessionBridge({ isSceneV2Active: shallowRef(true) } as never);
    registry.refreshExtensionContributions();
    assert.equal(registry.getSettingDefinition(socketId)?.name, 'Socket Snapping');
    assert.equal(registry.normalizeSettingValue(registry.getSettingDefinition(socketId)!, false), false);
    for (const setting of foxholeStatsUserSettings) {
        assert.equal(registry.getSettingDefinition(setting.id), undefined);
    }
    assert.ok(registry.getSettingDefinition(statsId), 'Statistics settings are SDK-owned even though the old map source also declared them');
    for (const setting of mapControls) {
        assert.equal(registry.getSettingDefinition(setting.id), setting);
    }
    assert.deepEqual(registry.getAllLeftSidebarContributions().map(panel => panel.id), ['foxhole-war-shell']);
    const toolbar = registry.getAllPrimaryToolbarItems().find(item => item.id === socketItemId)!;
    assert.equal(toolbar.label, 'Socket Snapping');
    const toolbarContext = { canEdit: shallowRef(true), getSetting: id => values.get(id),
        toggleSetting: id => {
            values.set(id, !values.get(id));
            return values.get(id)!;
        } } as NixiePrimaryToolbarContext;
    await toolbar.run(toolbarContext);
    assert.equal(values.get(socketId), false);
    assert.ok(registry.getMenuContributions('overlays.debug').some(entry => entry.item.id === 'nixie.foxhole-planner.overlay.placement-warnings'));
    assert.ok(registry.getAllSettingsPageSections().some(section => section.id === 'foxhole'));
    await registry.getCommand('foxhole.map.toggle')!.run({} as never);
    assert.equal(mapCalls, 1);
    assert.deepEqual(registry.getDiagnostics(), []);
    assert.equal(createFoxholeRetainedSceneV2Ui(false)[0]!.settings!.includes(foxholeSceneMapRendererSetting.id), false);
    configureNixieSceneV2AuthoringIsolation(false, false);
    registry.refreshExtensionContributions();
    assert.equal(registry.getSettingDefinition(socketId)?.name, 'Private Socket Snapping');
    assert.equal(registry.getAllPrimaryToolbarItems().find(item => item.id === socketItemId)?.label, 'Private Socket Snapping');
    await registry.getCommand('foxhole.map.toggle')!.run({} as never);
    assert.equal(mapCalls, 2);
});
