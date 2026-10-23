import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {transformAssetCredentialSecret, loadAssetPublicationCredentials} from './asset-pack-credentials.mjs';

test('asset credentials use current-user DPAPI and explicit environment values take precedence', {skip: process.platform !== 'win32'}, async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'foxwatch-publish-secrets-'));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    const credentials = {accessKeyId: 'dummy-test-key', secretAccessKey: 'dummy-test-secret'};
    const encrypted = await transformAssetCredentialSecret('encrypt-stdin', JSON.stringify(credentials));
    assert.match(encrypted, /^dpapi-v1:/); assert.ok(!encrypted.includes(credentials.secretAccessKey));
    await fs.writeFile(path.join(directory, 'credentials.dpapi'), encrypted);
    const config = {credentialFile: 'credentials.dpapi'};
    assert.deepEqual(await loadAssetPublicationCredentials(config, directory, {}), {FOXWATCH_ASSETS_ACCESS_KEY_ID: credentials.accessKeyId, FOXWATCH_ASSETS_SECRET_ACCESS_KEY: credentials.secretAccessKey});
    const env = {FOXWATCH_ASSETS_ACCESS_KEY_ID: 'override', FOXWATCH_ASSETS_SECRET_ACCESS_KEY: 'override'};
    assert.equal(await loadAssetPublicationCredentials(config, directory, env), env);
});
