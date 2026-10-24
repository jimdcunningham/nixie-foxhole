import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Planner publishing builds an independent remote package with scoped authority', async () => {
    const text = await readFile(new URL('../../../.github/workflows/publish-planner.yml', import.meta.url), 'utf8');
    assert.match(text, /permissions:\s+contents: read/);
    assert.match(text, /branches: \[main\]/);
    assert.match(text, /NIXIE_FOXHOLE_ASSET_MODE: remote/);
    assert.match(text, /PLANNER_ROOT:.*\/planner-consumer\/extensions\/foxhole-planner/);
    assert.match(text, /NIXIE_FOXHOLE_ASSETS_ROOT:.*\/planner-consumer\/packages\/extensions\/foxhole\/public\/foxhole\/assets/);
    assert.match(text, /cp -R extensions\/foxhole-planner/);
    for (const step of ['typecheck', 'build', 'pack', 'publish:extension']) assert.ok(text.includes('npm run ' + step));
    assert.match(text, /npm test/);
    assert.match(text, /prepare-publication-inputs\.mjs/);
    assert.match(text, /verify-publication-package\.mjs/);
    assert.match(text, /NIXIE_EXTENSION_PUBLISH_TOKEN: \$\{\{ secrets\.NIXIE_EXTENSION_PUBLISH_TOKEN \}\}/);
    assert.doesNotMatch(text, /SERVICE_ROLE|GITHUB_TOKEN|R2_ACCESS|R2_SECRET|nixie\/\.github|repository:.*jimdcunningham\/nixie\s/);
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(pkg.devDependencies['@nixiejs/extension-package'], '0.1.0-preview.2');
    assert.match(pkg.scripts.pack, /^nixie-extension pack /);
    assert.match(pkg.scripts['publish:extension'], /^nixie-extension publish /);
});
