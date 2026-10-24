import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNixieExtensionManifestV1 } from '@nixiejs/extension-sdk';
import { createFakeNixieExtensionHost } from '@nixiejs/extension-sdk/testing';
import foxholeSceneV2Assets from '../src/scene-v2-assets-node.ts';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('declares real Planner migrations through the public SDK', async () => {
    const manifest = parseNixieExtensionManifestV1(JSON.parse(await readFile(resolve(extensionRoot, 'nixie.extension.json'), 'utf8')));
    assert.equal(manifest.id, 'nixie.foxhole-planner');
    assert.deepEqual(manifest.contributes.panels.filter(panel => panel.id === 'statistics'), [{ id: 'statistics', reportSystemId: 'reports.statistics', reportSectionsSettingId: 'nixie.foxhole-planner.stats.exportSections', title: 'Planning Statistics', icon: 'ph:chart-bar-horizontal', placement: 'right-sidebar',
        settingIds: ['nixie.foxhole-planner.stats.scope', 'nixie.foxhole-planner.stats.interval'] }]);
    assert.equal(manifest.contributes.settingsPageSections.length, 7);
    assert.ok(manifest.development?.contributionOverrides.includes('foxhole-browser'));
    assert.ok(manifest.development?.contributionOverrides.includes('foxhole.structure.lineOfSight'));
    assert.equal(manifest.contributes.settings.find(setting => setting.id === 'foxhole.structure.lineOfSight')?.defaultValue, false);
    assert.ok(manifest.contributes.experimentalProducts?.some(product => product.id === 'facility.ammo-factory.icon'));
    assert.ok(manifest.contributes.experimentalProducts?.some(product => product.id === 'bunker.artillery-garrison.bunkbed'));
    assert.equal(manifest.contributes.experimentalProductProviders?.[0]?.systemId, 'products.assets');
    const socketFinalizer = manifest.contributes.experimentalTransformFinalizers?.find(finalizer => finalizer.systemId === 'transforms.socket-snapping');
    assert.equal(socketFinalizer?.systemId, 'transforms.socket-snapping');
    assert.equal(socketFinalizer?.enabledSettingId, 'foxhole.viewport.socketSnapping');
    assert.equal(socketFinalizer?.candidateQuery.worldRadius, 4096);
    assert.equal(socketFinalizer?.match.componentId, 'socket-attachments');
    assert.equal(socketFinalizer?.candidateQuery.maxCandidates, 256);
    assert.equal(socketFinalizer?.candidateQuery.match.componentId, 'socket-attachments');
    const surfaceFinalizer = manifest.contributes.experimentalTransformFinalizers?.find(finalizer => finalizer.id === 'surface-placement');
    assert.equal(surfaceFinalizer?.enabledSettingId, undefined);
    assert.equal(surfaceFinalizer?.candidateQuery.match.componentId, 'asset');
    const largestSocketOffset = Math.max(...Object.values(foxholeSceneV2Assets).flatMap(asset => (
        asset.buildSockets.map(socket => Math.hypot(socket.x, socket.y))
    )));
    assert.ok(socketFinalizer!.candidateQuery.worldRadius > largestSocketOffset * 2 + 20);
    assert.deepEqual(manifest.contributes.experimentalTransformFinalizers?.map(finalizer => finalizer.match.componentId).sort(), ['asset', 'connector', 'socket-attachments', 'spline-connector']);
    assert.ok(manifest.contributes.experimentalResourceTemplates?.some(resource => resource.idPrefix === 'foxhole.icon.'));
    assert.ok(manifest.contributes.experimentalResourceTemplates?.some(resource => resource.idPrefix === 'foxhole.asset.'));
    assert.ok(manifest.contributes.experimentalRenderers?.some(renderer => renderer.id === 'foxhole-icons'));
    assert.ok(manifest.contributes.experimentalRenderers?.some(renderer => renderer.id === 'foxhole-assets'));
    assert.ok(manifest.contributes.experimentalRenderers?.find(renderer => renderer.id === 'foxhole-assets')?.settingIds?.includes('foxhole.structure.lineOfSight'));
    const placementWarnings = manifest.contributes.settings.find(setting => setting.id === 'nixie.foxhole-planner.debug.placementWarnings');
    assert.equal(placementWarnings?.defaultValue, false);
    assert.equal(placementWarnings?.accessibleInDev, true);
    assert.equal(placementWarnings?.settingsPageSectionId, 'foxhole-debug');
    const placementOverlay = manifest.contributes.menus.find(menu => menu.id === 'nixie.foxhole-planner.overlay.placement-warnings');
    assert.equal(placementOverlay?.menu, 'overlays.debug');
    assert.equal(placementOverlay?.type, 'toggle-setting');
    assert.equal(placementOverlay?.type === 'toggle-setting' && placementOverlay.settingId, 'nixie.foxhole-planner.debug.placementWarnings');
    assert.ok(manifest.contributes.experimentalRenderers?.find(renderer => renderer.id === 'foxhole-assets')?.settingIds?.includes('nixie.foxhole-planner.debug.placementWarnings'));
    assert.ok(manifest.contributes.experimentalComponents?.components.some(component => component.id === 'spline-connector'));
    assert.ok(manifest.contributes.experimentalComponents?.components.some(component => component.id === 'cargo'));
    assert.ok(manifest.contributes.experimentalComponents?.components.some(component => component.id === 'socket-attachments'));
    const socketAttachments = manifest.contributes.experimentalComponents?.components.find(
        component => component.id === 'socket-attachments',
    );
    assert.equal(
        socketAttachments?.description,
        "Connections from this structure's local sockets to sockets on other scene entities.",
    );
    assert.equal(socketAttachments?.schema.properties.attachments?.title, 'Socket Attachments');
    assert.ok(manifest.contributes.experimentalProducts?.some(product => product.id === 'connector.facility-pipe'));
    assert.ok(manifest.contributes.experimentalRenderers?.some(renderer => renderer.id === 'spline-connector'));
});

test('connects with the local migration capability', async () => {
    const host = createFakeNixieExtensionHost({ approvedCapabilities: ['ui.toolbar', 'local.development.contributionOverride'] });
    const connection = await host.connect();
    assert.equal(connection.disconnected, false);
    connection.dispose();
});


test('War owns map controls without duplicate sidebar panels or lost saved settings', async () => {
    const manifest = parseNixieExtensionManifestV1(JSON.parse(await readFile(resolve(extensionRoot, 'nixie.extension.json'), 'utf8')));
    assert.ok(!manifest.contributes.panels.some(panel => panel.id === 'map' || panel.id === 'map-icons'));
    for (const id of ['foxhole.map.enabled', 'foxhole.map.regionKeys', 'foxhole.map.crop.enabled', 'foxhole.map.crop.x',
        'foxhole.map.crop.y', 'foxhole.map.crop.width', 'foxhole.map.crop.height', 'foxhole.map.icons', 'foxhole.map.coloredIcons',
        'foxhole.map.iconCategories.bases', 'foxhole.map.iconCategories.resources', 'foxhole.map.iconCategories.structures', 'foxhole.map.iconBlacklist']) {
        assert.ok(manifest.contributes.settings.some(setting => setting.id === id), id);
    }
    assert.deepEqual(manifest.contributes.experimentalDocumentRenderers?.map(renderer => renderer.id), ['planning-map', 'planning-grid']);
});
