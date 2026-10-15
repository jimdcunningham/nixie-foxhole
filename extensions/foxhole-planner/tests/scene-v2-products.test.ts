import assert from 'node:assert/strict';
import test from 'node:test';
import { listFoxholeSceneV2Products, matchesFoxholeSceneV2ProductFilters } from '../src/scene-v2-products.ts';
import foxholeSceneV2Assets from '../src/scene-v2-assets-node.ts';
import { parseNixieExperimentalProductResultV1, parseNixieExtensionRenderPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import { createFoxholeSceneV2AssetMetadata } from '../src/scene-v2-asset-metadata.ts';
import { sampleFoxholeSceneV2Connector } from '../src/scene-v2-connector-path.ts';
import { resolveFacilityPipeSideSocketsFromPath } from '../src/connector-side-sockets.ts';
import { resolveFoxholeConnectorDisplaySockets } from '../src/scene-v2-connector-socket-overlays.ts';
import type { FoxholeSceneV2SplineConnectorData } from '../src/scene-v2-spline-connectors.ts';

test('searches the full published Foxhole asset catalog through a bounded provider page', () => {
    const firstPage = listFoxholeSceneV2Products({
        contractVersion: 1,
        query: '',
        offset: 0,
        limit: 50,
    });
    assert.equal(firstPage.total, Object.keys(foxholeSceneV2Assets).length);
    assert.equal(firstPage.items.length, 50);
    assert.ok(firstPage.items.every(item => item.product.components.some(component => component.componentId === 'asset')));

    const ammoFactories = listFoxholeSceneV2Products({
        contractVersion: 1,
        query: 'facility factory ammo',
        offset: 0,
        limit: 50,
    });
    assert.ok(ammoFactories.items.some(item => item.product.id === 'asset.facilityfactoryammo'));
    assert.ok(ammoFactories.items.some(item => (
        item.product.id === 'asset.facilityfactoryammo'
        && item.product.components.some(component => component.componentId === 'cargo')
    )));
    assert.ok(ammoFactories.items.some(item => item.label === 'Ammunition Factory' && item.category === 'Facilities'));
});

test('catalog spline products use published geometry and socket defaults instead of structure-only templates', () => {
    for (const [assetId, expected] of [
        ['wallsplinet1', { minLength: 96, maxLength: 320, minRadius: 1, maxRadius: 1, maxBuffer: 0.32, endX: 96 }],
        ['facilitypipe', { minLength: 96, maxLength: 640, minRadius: 16, maxRadius: 96, maxBuffer: 96, endX: 96 }],
        ['powerline', { minLength: 3.2, maxLength: 800, minRadius: 16, maxRadius: 800, maxBuffer: 3.2, endX: 3.2 }],
    ] as const) {
        const product = listFoxholeSceneV2Products({ contractVersion: 1, query: assetId, offset: 0, limit: 100 })
            .items.find(item => item.product.id === `asset.${assetId}`)!.product;
        const spline = product.components.find(component => component.componentId === 'spline-connector')!;
        assert.ok(spline, assetId);
        for (const [field, value] of Object.entries(expected)) {
            assert.equal(spline.data[field], value, `${assetId}.${field}`);
        }
        assert.equal(spline.data.curveT, 0);
        assert.equal(spline.data.endY, 0);
        assert.equal(spline.data.startSocketName, foxholeSceneV2Assets[assetId]!.connector!.backSocketName);
        assert.equal(spline.data.endSocketName, foxholeSceneV2Assets[assetId]!.connector!.frontSocketName);
        assert.equal(product.components.some(component => component.componentId === 'appearance'), false);
        const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({ entityId: `fixture-${assetId}`, revision: 1,
            components: product.components.map(component => ({ ...component, definitionAvailable: true })) }));
        assert.ok(plan.root.children.length > 0);
    }
});

test('barbed wire and sandbag products keep their published endpoint sockets', () => {
    for (const assetId of ['barbedwirespline', 'sandbaghalfspline', 'sandbagfullspline']) {
        const product = listFoxholeSceneV2Products({ contractVersion: 1, query: assetId, offset: 0, limit: 100 })
            .items.find(item => item.product.id === `asset.${assetId}`)!.product;
        const spline = product.components.find(component => component.componentId === 'spline-connector');
        assert.ok(spline, assetId);
        assert.equal(spline.data.startSocketName, 'BackSocket');
        assert.equal(spline.data.endSocketName, 'FrontSocket');
        assert.ok(product.components.some(component => component.componentId === 'socket-attachments'));
        assert.deepEqual(foxholeSceneV2Assets[assetId]!.buildSockets.map(socket => socket.name).sort(),
            ['BackSocket', 'FrontSocket']);
        const legacy = { ...spline.data } as unknown as FoxholeSceneV2SplineConnectorData;
        delete legacy.startSocketName;
        delete legacy.endSocketName;
        assert.deepEqual(resolveFoxholeConnectorDisplaySockets(legacy, foxholeSceneV2Assets[assetId]!)
            .map(socket => socket.socket.name), ['BackSocket', 'FrontSocket']);
    }
});

test('pipe products preserve surface socket-facing and underground tangent-aligned straight defaults', () => {
    for (const assetId of ['facilitypipe', 'facilitypipeunderground']) {
        const product = listFoxholeSceneV2Products({ contractVersion: 1, query: assetId, offset: 0, limit: 100 }).items
            .find(item => item.product.id === `asset.${assetId}`)!.product;
        const data = product.components.find(component => component.componentId === 'spline-connector')!.data as unknown as FoxholeSceneV2SplineConnectorData;
        assert.equal(data.endRotation, assetId === 'facilitypipe' ? Math.PI : 0);
        const path = sampleFoxholeSceneV2Connector(data, foxholeSceneV2Assets[assetId]!);
        assert.ok(Math.abs(path.totalLength - data.endX) < 1e-8);
        const sides = resolveFacilityPipeSideSocketsFromPath(path, 9.5);
        assert.ok(sides.every(socket => Math.abs(socket.x - data.endX * 0.5) < 1e-8));
    }
});

test('every provider page is bounded and all published items create portable icons rather than structures', () => {
    const items = [];
    let total = 1;
    for (let offset = 0; offset < total; offset += 50) {
        const result = parseNixieExperimentalProductResultV1(listFoxholeSceneV2Products({
            contractVersion: 1, query: '', offset, limit: 50,
        }));
        total = result.total;
        items.push(...result.items);
    }
    const seen = new Set(items.map(item => item.product.id));
    assert.equal(seen.size, Object.keys(foxholeSceneV2Assets).length);
    let iconCount = 0;
    for (const item of items) {
        const asset = item.product.components.find(component => component.componentId === 'asset')!;
        const metadata = foxholeSceneV2Assets[String(asset.data.assetId)]!;
        const spline = item.product.components.find(component => component.componentId === 'spline-connector');
        if (spline) {
            assert.ok(Number(spline.data.minLength) > 0, item.product.id);
            assert.equal(Math.hypot(Number(spline.data.endX) - Number(spline.data.startX),
                Number(spline.data.endY) - Number(spline.data.startY)), Number(spline.data.minLength), item.product.id);
        }
        assert.equal(asset.data.catalogId, metadata.isItem ? 'foxhole.icons' : 'foxhole.structures');
        if (metadata.isItem) {
            iconCount += 1;
            assert.ok(item.product.components.some(component => component.ownerId === 'nixie.core' && component.componentId === 'icon'));
            assert.equal(item.product.components.some(component => component.componentId === 'appearance'), false);
            const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({ entityId: 'provider-item', revision: 1,
                components: item.product.components.map(component => ({ ...component, definitionAvailable: true })) }));
            assert.ok(plan.root.children.some(node => node.kind === 'sprite' && node.resourceId === `foxhole.icon.${asset.data.assetId}`));
        } else {
            assert.equal(item.product.components.some(component => component.componentId === 'production-order'), metadata.supportsProduction === true);
        }
    }
    assert.equal(iconCount, Object.values(foxholeSceneV2Assets).filter(metadata => metadata.isItem).length);
    assert.equal(iconCount, 221);
});

test('provider-created production structures expose empty authored orders without copying recipe bodies', () => {
    const result = listFoxholeSceneV2Products({ contractVersion: 1, query: 'facilityfactoryammo', offset: 0, limit: 50 });
    const factory = result.items.find(item => item.product.id === 'asset.facilityfactoryammo')!;
    assert.deepEqual(factory.product.components.find(component => component.componentId === 'production-order')?.data, { orders: [] });
    assert.equal(JSON.stringify(factory.product).includes('conversionEntries'), false);
    const rifle = listFoxholeSceneV2Products({ contractVersion: 1, query: '7.62mm', offset: 0, limit: 50 }).items
        .find(item => item.product.id === 'asset.rifleammo')!;
    assert.equal(rifle.category, 'Small Arms');
    assert.equal(rifle.product.components.some(component => component.componentId === 'production-order'), false);
});

test('published names retain code-name search aliases and production capability includes shared modifications', () => {
    const metadata = createFoxholeSceneV2AssetMetadata({
        categories: [{ id: 'facility', name: 'category-name' }],
        localizations: [{ locale: 'en', strings: { 'asset-name': 'Ammunition Factory', 'category-name': 'Facilities' } }],
        shared: { modifications: { workshop: { sprite: { width: 20, height: 20 }, conversionEntries: [{ id: 7 }] } } },
        assets: [{ id: 'factory', codeName: 'FacilityFactory', name: 'asset-name', categoryId: 'facility',
            sprite: { width: 100, height: 100 },
            modifications: [{ name: 'Upgrade', variants: { workshop: { sharedModificationId: 'workshop' } } }] }],
    }).assets.factory!;
    assert.equal(metadata.label, 'Ammunition Factory');
    assert.equal(metadata.categoryLabel, 'Facilities');
    assert.ok(metadata.keywords.includes('Facility Factory'));
    assert.equal(metadata.supportsProduction, true);
});

test('upgrade filtering exposes owner-local modification products without duplicating recipe bodies', () => {
    const query = { contractVersion: 1 as const, query: 'tripod factory', offset: 0, limit: 50,
        settings: { 'foxhole.assets.filter.upgrades': true, 'foxhole.assets.filter.showPreviousTiers': true } };
    const result = parseNixieExperimentalProductResultV1(listFoxholeSceneV2Products(query));
    const upgrade = result.items.find(item => item.product.id.startsWith('upgrade.facilityfactoryammo.'));
    assert.ok(upgrade);
    const selections = upgrade.product.components.find(component => component.componentId === 'modification')?.data.selections;
    assert.ok(Array.isArray(selections) && selections.some(selection => typeof selection === 'object' && selection !== null
        && 'variantId' in selection && selection.variantId === 'tripodfactory'));
    assert.equal(JSON.stringify(upgrade.product).includes('conversionEntries'), false);
    assert.equal(listFoxholeSceneV2Products({ ...query, settings: { ...query.settings, 'foxhole.assets.filter.upgrades': false } }).items
        .some(item => item.product.id.startsWith('upgrade.')), false);
});

test('3D-ready filtering exposes only products with packaged model bindings', () => {
    const result = parseNixieExperimentalProductResultV1(listFoxholeSceneV2Products({
        contractVersion: 1,
        query: '',
        offset: 0,
        limit: 1_000,
        settings: {
            'foxhole.assets.filter.3dReady': true,
            'foxhole.assets.filter.showPreviousTiers': true,
            'foxhole.assets.filter.upgrades': true,
        },
    }));
    assert.ok(result.items.length > 0);
    assert.ok(result.items.every(item => item.product.components.some(component => component.componentId === 'model')));
    assert.ok(result.items.some(item => item.product.id === 'asset.facilitypowerdiesel'));
    assert.equal(result.items.some(item => item.product.id === 'asset.crane'), false);
});

test('facility structural tiers do not hide standalone assets or bypass technology and lineage gates', () => {
    const assets = createFoxholeSceneV2AssetMetadata({ assets: [
        { id: 'standalone', codeName: 'Standalone', isFacility: true, tier: 3, sprite: { width: 100, height: 100 } },
        { id: 'technology', codeName: 'Technology', isFacility: true, tier: 3, techId: 'unlockfacilitytier3', sprite: { width: 100, height: 100 } },
        { id: 'base', codeName: 'Base', isFacility: true, tier: 1, upgradeStructureCodeName: 'Child', sprite: { width: 100, height: 100 } },
        { id: 'child', codeName: 'Child', isFacility: true, tier: 3, sprite: { width: 100, height: 100 } },
        { id: 'modification', codeName: 'Modification', isFacility: true, tier: 3, parentStructureId: 'base', sprite: { width: 100, height: 100 } },
    ] }).assets;
    const settings = { 'foxhole.assets.filter.tier': '1' };
    assert.equal(matchesFoxholeSceneV2ProductFilters(assets.standalone!, settings), true);
    for (const id of ['technology', 'child', 'modification']) assert.equal(matchesFoxholeSceneV2ProductFilters(assets[id]!, settings), false, id);
    assert.equal(assets.child!.downgradeStructureId, 'base');
    assert.equal(assets.modification!.parentStructureId, 'base');
    assert.equal(matchesFoxholeSceneV2ProductFilters(assets.standalone!, { ...settings, 'foxhole.assets.filter.category.facilities': false }), false);
    assert.ok(listFoxholeSceneV2Products({ contractVersion: 1, query: 'facilitytransfercrate', offset: 0, limit: 50, settings }).items
        .some(item => item.product.id === 'asset.facilitytransfercrate'));
});
