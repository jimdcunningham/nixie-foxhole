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
    const { header, ...panel } = manifest.contributes.panels.find(panel => panel.id === 'statistics')!;
    assert.deepEqual(panel, { id: 'statistics', reportSystemId: 'reports.statistics', reportPreview: true, controlsOnly: true, reportSectionsSettingId: 'nixie.foxhole-planner.stats.exportSections', title: 'Statistics (SDK)', icon: 'ph:chart-bar-horizontal', placement: 'right-sidebar',
        settingIds: ['nixie.foxhole-planner.stats.scope', 'nixie.foxhole-planner.stats.interval', 'nixie.foxhole-planner.stats.customIntervalSeconds'] });
    assert.deepEqual(header?.actions?.map(action => action.icon), ['ph:cursor', 'ph:stack', 'ph:clock']);
    assert.deepEqual(header?.report, { label: 'Export Statistics', icon: 'ph:export' });
    assert.equal(manifest.contributes.settingsPageSections.length, 7);
    assert.ok(manifest.development?.contributionOverrides.includes('foxhole-browser'));
    assert.ok(manifest.development?.contributionOverrides.includes('foxhole.structure.lineOfSight'));
    assert.equal(manifest.contributes.settings.find(setting => setting.id === 'foxhole.structure.lineOfSight')?.defaultValue, false);
    assert.ok(manifest.contributes.products?.some(product => product.id === 'facility.ammo-factory.icon'));
    assert.ok(manifest.contributes.products?.some(product => product.id === 'bunker.artillery-garrison.bunkbed'));
    assert.equal(manifest.contributes.productProviders?.[0]?.systemId, 'products.assets');
    const socketFinalizer = manifest.contributes.transformFinalizers?.find(finalizer => finalizer.systemId === 'transforms.socket-snapping');
    assert.equal(socketFinalizer?.systemId, 'transforms.socket-snapping');
    assert.equal(socketFinalizer?.enabledSettingId, 'foxhole.viewport.socketSnapping');
    assert.equal(socketFinalizer?.candidateQuery.worldRadius, 4096);
    assert.equal(socketFinalizer?.match.componentId, 'socket-attachments');
    assert.equal(socketFinalizer?.candidateQuery.maxCandidates, 256);
    assert.equal(socketFinalizer?.candidateQuery.match.componentId, 'socket-attachments');
    const surfaceFinalizer = manifest.contributes.transformFinalizers?.find(finalizer => finalizer.id === 'surface-placement');
    assert.equal(surfaceFinalizer?.enabledSettingId, undefined);
    assert.equal(surfaceFinalizer?.candidateQuery.match.componentId, 'asset');
    const largestSocketOffset = Math.max(...Object.values(foxholeSceneV2Assets).flatMap(asset => (
        asset.buildSockets.map(socket => Math.hypot(socket.x, socket.y))
    )));
    assert.ok(socketFinalizer!.candidateQuery.worldRadius > largestSocketOffset * 2 + 20);
    assert.deepEqual(manifest.contributes.transformFinalizers?.map(finalizer => finalizer.match.componentId).sort(), ['asset', 'connector', 'socket-attachments', 'spline-connector']);
    assert.ok(manifest.contributes.resourceTemplates?.some(resource => resource.idPrefix === 'foxhole.icon.'));
    assert.ok(manifest.contributes.resourceTemplates?.some(resource => resource.idPrefix === 'foxhole.asset.'));
    assert.ok(manifest.contributes.renderers?.some(renderer => renderer.id === 'foxhole-icons'));
    assert.ok(manifest.contributes.renderers?.some(renderer => renderer.id === 'foxhole-assets'));
    assert.ok(manifest.contributes.renderers?.find(renderer => renderer.id === 'foxhole-assets')?.settingIds?.includes('foxhole.structure.lineOfSight'));
    const placementWarnings = manifest.contributes.settings.find(setting => setting.id === 'nixie.foxhole-planner.debug.placementWarnings');
    assert.equal(placementWarnings?.defaultValue, false);
    assert.equal(placementWarnings?.accessibleInDev, true);
    assert.equal(placementWarnings?.settingsPageSectionId, 'foxhole-debug');
    const placementOverlay = manifest.contributes.menus.find(menu => menu.id === 'nixie.foxhole-planner.overlay.placement-warnings');
    assert.equal(placementOverlay?.menu, 'nixie.foxhole-planner.overlays.experimental');
    assert.equal(placementOverlay?.type, 'toggle-setting');
    assert.equal(placementOverlay?.type === 'toggle-setting' && placementOverlay.settingId, 'nixie.foxhole-planner.debug.placementWarnings');
    assert.ok(manifest.contributes.renderers?.find(renderer => renderer.id === 'foxhole-assets')?.settingIds?.includes('nixie.foxhole-planner.debug.placementWarnings'));
    assert.ok(manifest.contributes.components?.components.some(component => component.id === 'spline-connector'));
    assert.ok(manifest.contributes.components?.components.some(component => component.id === 'cargo'));
    assert.ok(manifest.contributes.components?.components.some(component => component.id === 'socket-attachments'));
    const socketAttachments = manifest.contributes.components?.components.find(
        component => component.id === 'socket-attachments',
    );
    assert.equal(
        socketAttachments?.description,
        "Connections from this structure's local sockets to sockets on other scene entities.",
    );
    assert.equal(socketAttachments?.schema.properties.attachments?.title, 'Socket Attachments');
    assert.ok(manifest.contributes.products?.some(product => product.id === 'connector.facility-pipe'));
    assert.ok(manifest.contributes.renderers?.some(renderer => renderer.id === 'spline-connector'));
});

test('Planner overlay menus link to its own Scene V2 renderer settings', async () => {
    const manifest = parseNixieExtensionManifestV1(JSON.parse(await readFile(resolve(extensionRoot, 'nixie.extension.json'), 'utf8')));
    const menus = manifest.contributes.menus;
    const foxhole = menus.find(row => row.type === 'submenu' && row.menu === 'overlays' && row.label === manifest.name && row.icon === 'nx:hexagon-bars');
    assert.ok(foxhole);
    const ranges = menus.find(row => row.type === 'submenu' && row.menu === foxhole.id && row.label === 'Ranges');
    const experimental = menus.find(row => row.type === 'submenu' && row.menu === foxhole.id && row.label === 'Experimental');
    assert.equal(experimental?.accessibleInDev, true);
    assert.ok(menus.every(row => row.menu !== 'overlays.debug'));
    const volumes = menus.find(row => row.type === 'submenu' && row.menu === experimental?.id && row.label === 'Structure Volumes');
    assert.ok(ranges && volumes);
    for (const [menu, setting] of [[foxhole.id, 'foxhole.structure.hideRoofs'], [foxhole.id, 'foxhole.map.enabled'],
        [ranges.id, 'foxhole.ranges.artillery'], [volumes.id, 'foxhole.debug.structure.volume.seatTrigger']]) {
        assert.ok(menus.some(row => row.menu === menu && row.type === 'toggle-setting' && row.settingId === setting), setting);
    }
    const renderers = [...manifest.contributes.renderers ?? [], ...manifest.contributes.documentRenderers ?? []];
    for (const row of menus) {
        if (row.type === 'toggle-setting') {
            assert.ok(renderers.some(renderer => renderer.settingIds?.includes(row.settingId)), row.settingId);
        }
    }
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
    assert.deepEqual(manifest.contributes.documentRenderers?.map(renderer => renderer.id), ['planning-map', 'planning-grid']);
});
