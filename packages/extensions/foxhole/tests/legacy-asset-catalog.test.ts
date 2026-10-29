import assert from 'node:assert/strict';
import test from 'node:test';
import rawManifest from '../public/foxhole/assets/manifest.v1.json' with { type: 'json' };
import { installFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import { installFoxholeAssetLocations } from '../app/plugins/foxhole/nixie/asset-locations.ts';
import { getFoxholeLegacyStructureCatalog, resolveFoxholeLegacyOverlayIcon } from '../app/plugins/foxhole/nixie/legacy-asset-catalog.ts';

test('legacy production icons and modification textures follow the accepted catalog generation', () => {
    const forge = () => getFoxholeLegacyStructureCatalog().assetByKey.facilityrefinery1
        ?.modificationSlotById.UpgradeSlotComponent?.variantById.forge?.textureUrl;
    const truck = 'types/vehicles/truckmobilityc/truckmobilityc.icon.default.webp';
    const material = 'types/items/facilitymaterials1/facilitymaterials1.icon.default.webp';
    const modification = 'types/structures/facilityrefinery1/modifications/forge/forge.texture.webp';
    try {
        assert.equal(resolveFoxholeLegacyOverlayIcon('TruckMobilityC'), `/foxhole/assets/${truck}`);
        assert.equal(forge(), `/foxhole/assets/${modification}`);
        for (const generation of ['a', 'b']) {
            installFoxholeAssetLocations(path => `https://assets.example/${generation}/${path}`);
            installFoxholeManifest(rawManifest);
            assert.equal(resolveFoxholeLegacyOverlayIcon('TruckMobilityC'), `https://assets.example/${generation}/${truck}`);
            assert.equal(resolveFoxholeLegacyOverlayIcon('FacilityMaterials1'), `https://assets.example/${generation}/${material}`);
            assert.equal(forge(), `https://assets.example/${generation}/${modification}`);
        }
    } finally {
        installFoxholeAssetLocations(null);
        installFoxholeManifest(null);
    }
});
