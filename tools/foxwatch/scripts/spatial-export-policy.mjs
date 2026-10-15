import assert from 'node:assert/strict';

export const APPROVED_SPATIAL_GEOMETRY_PROFILE = 'curved50-compact16';
const profiles = ['lossless', 'precision16', APPROVED_SPATIAL_GEOMETRY_PROFILE];

export function resolveSpatialExportPolicy(config, catalog, { only, geometryProfile } = {}) {
    assert.equal(config.schemaVersion, 1);
    const catalogWide = config.assetSelection === 'catalog';
    assert.ok(catalogWide || Array.isArray(config.categoryIds) && config.categoryIds.length > 0, 'Spatial categories must be explicit');
    assert.ok(Array.isArray(config.assets) && new Set(config.assets).size === config.assets.length, 'Spatial allowlist must contain unique IDs');
    const byId = new Map(catalog.assets.map(asset => [asset.id, asset]));
    const ids = catalogWide ? catalog.assets.map(asset => asset.id) : config.assets;
    assert.equal(new Set(ids).size, ids.length, 'Duplicate spatial catalog IDs');
    for (const id of ids) {
        const asset = byId.get(id);
        assert.ok(/^[a-z0-9-]+$/.test(id) && (catalogWide || !/destroyed|breached/i.test(id)), `Excluded spatial asset: ${id}`);
        assert.ok(asset && (catalogWide || config.categoryIds.includes(asset.categoryId)
            && !asset.isDestroyed && !asset.isBreached && !/destroyed|breached/i.test(asset.codeName)), `Asset outside spatial scope: ${id}`);
    }
    const selectedProfile = geometryProfile ?? config.geometryProfile ?? APPROVED_SPATIAL_GEOMETRY_PROFILE;
    assert.ok(profiles.includes(selectedProfile), `Unknown geometry profile: ${selectedProfile}`);
    const requested = only?.map(id => id.trim().toLowerCase()).filter(Boolean);
    return { geometryProfile: selectedProfile, allowedIds: new Set(ids),
        targets: ids.filter(id => !requested || requested.includes(id)),
        skipped: requested?.filter(id => !ids.includes(id)) ?? [] };
}

export function filterSpatialModelManifest(manifest, allowedIds, { includeDamaged = false } = {}) {
    const intact = id => includeDamaged || !/destroyed|breached/i.test(id);
    return { ...manifest,
        assets: Object.fromEntries(Object.entries(manifest.assets ?? {}).filter(([id]) => allowedIds.has(id) && intact(id))),
        resources: Object.fromEntries(Object.entries(manifest.resources ?? {}).filter(([id, resource]) =>
            allowedIds.has(resource.assetId) && id.startsWith(`${resource.assetId}.`) && intact(id))) };
}
