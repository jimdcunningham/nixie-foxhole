import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import { getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { createFoxholeStructureAssetSnapshot } from '../app/plugins/foxhole/nixie/structure-asset-snapshot.ts';
import { isFoxholeSplineConnectorStructure } from '../app/plugins/foxhole/nixie/spline-connector.ts';

const manifest = getFoxholeManifest('/foxhole/assets/');
const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
for (const id of ['trenchconnectorbuildsite', 'trenchconnectort1', 'trenchconnectort2', 'trenchconnectort3']) {
    test(`${id} enters the editor as an editable connector`, () => {
        const structure = manifest.assets.find(asset => asset.id === id)!;
        assert.ok(structure);
        const snapshot = createFoxholeStructureAssetSnapshot({ asset: catalog.assetByKey[id]!, structure, label: id, x: 25, y: 40 });
        assert.equal(snapshot.type, 'foxholeSplineConnector');
        assert.equal(isFoxholeSplineConnectorStructure(structure), true);
        assert.equal(snapshot.state.foxholeKey, id);
    });
}
