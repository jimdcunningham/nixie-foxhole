import assert from 'node:assert/strict';
import test from 'node:test';
import { configureWorldAssetLocations, resolveWorldAsset, hasPinnedWorldAssets, fetchWorldAsset } from '../runtime/asset-locations.mjs';
test('the compiled map resolves catalog and native effect assets through its pinned release', async t => {
    t.after(()=>configureWorldAssetLocations(null));
    const requests=[];
    configureWorldAssetLocations({resolve:path=>'https://cdn.test/objects/'+path.replaceAll('/','-'),
        fetch:async url=>{requests.push(url);return new Response('verified');}});
    assert.equal(hasPinnedWorldAssets(),true);
    const url=resolveWorldAsset('https://cdn.test/world/','shared/flags/colonial.webp');
    assert.equal(url,'https://cdn.test/objects/shared-flags-colonial.webp');
    assert.equal(await (await fetchWorldAsset(url)).text(),'verified');
    assert.deepEqual(requests,[url]);
    configureWorldAssetLocations(null);
    assert.equal(resolveWorldAsset('https://viewer.test/assets/world/','models/manifest.v1.json'),'https://viewer.test/assets/models/manifest.v1.json');
});
