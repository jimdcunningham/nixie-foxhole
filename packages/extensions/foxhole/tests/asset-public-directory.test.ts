import assert from 'node:assert/strict';
import test from 'node:test';
import { withoutLocalAssetPublicDirectory } from '../asset-public-directory.ts';
test('excludes the bulk public root with Nitro and Windows path variants', () => {
    const rows = [{ dir: 'C:/Code/FOXHOLE/public/' }, { dir: 'C:/Code/foxhole/public-other' }, { dir: 'C:/Code/studio/public/' }, {}];
    assert.deepEqual(withoutLocalAssetPublicDirectory(rows, 'C:\\Code\\foxhole\\public'), rows.slice(1));
});
