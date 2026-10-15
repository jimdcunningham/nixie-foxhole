import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import { getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { createFoxholeStructureAssetSnapshot } from '../app/plugins/foxhole/nixie/structure-asset-snapshot.ts';
import { isFoxholeSplineConnectorStructure } from '../app/plugins/foxhole/nixie/spline-connector.ts';
import { resolveConnectorSpanInsets, shouldRenderConnectorSpan } from '../app/plugins/foxhole/nixie/pipe-connector-path.ts';

const manifest = getFoxholeManifest('/foxhole/assets/');
const catalog = getFoxholeStructureCatalog('/foxhole/assets/');

for (const id of ['sandbaghalfspline', 'sandbagfullspline']) {
    test(`${id} uses its blueprint connector path and full textured span`, () => {
        const structure = manifest.assets.find(asset => asset.id === id);
        assert.ok(structure);
        assert.equal(isFoxholeSplineConnectorStructure(structure), true);
        assert.equal(structure.connector?.pathStyle, 'interval');
        assert.equal(shouldRenderConnectorSpan('interval', structure.connector, id), true);
        assert.deepEqual(resolveConnectorSpanInsets('interval', structure.connector, undefined, undefined,
            { foxholeKey: id }), { startInset: 0, endInset: 0 });
        const snapshot = createFoxholeStructureAssetSnapshot({ asset: catalog.assetByKey[id]!, structure,
            label: id, x: 25, y: 40 });
        assert.equal(snapshot.type, 'foxholeSplineConnector');
        assert.equal(snapshot.state.foxholeKey, id);
        assert.equal(snapshot.state.minLength, 134.4);
        assert.equal(snapshot.state.maxLength, 320);
    });
}
