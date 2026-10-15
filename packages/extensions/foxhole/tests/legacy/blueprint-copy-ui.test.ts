import assert from 'node:assert/strict';
import test, { after, afterEach, beforeEach } from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { migrateProjectSnapshotToV3 } from '#nixie/utils/nixie-project-files.ts';

// Fixture boundary captures heterogeneous UI/API arguments, including erased host contracts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const calls: { kind: string; value: any; }[] = [];
let target: { kind: string; workspaceId?: string; workspaceName?: string; setAsDefault?: boolean; } = { kind: 'workspace', workspaceId: 'destination' };
let failPersist = false;
let failCleanup = false;
let failNavigate = false;
let cancel = false;
const stubUrl = `data:text/javascript,${encodeURIComponent(`
const harness = globalThis.__blueprintCopyHarness;
export const useSupabaseUser = () => ({ value: { id: 'actor' } });
export const useSupabaseClient = () => ({});
export const navigateTo = harness.navigate;
export const requestNewProjectCreation = harness.picker;
export const createProjectRecord = harness.create;
export const loadProjectSummaries = async () => {};
export const buildNixieEditorRoute = id => '/app/' + id;
export const setLastOpenedProjectId = () => {};
export const showNxToast = () => {};
export const openLegacyPlanImportReportDialog = () => {};
export const uploadNixieProjectImageAsset = async () => { throw new Error('No fixture images expected'); };
export const importNixieOfflineProjectSnapshot = async () => {};
export const createNixieLocalProject = () => ({ id: 'offline' });
export const removeNixieLocalProject = () => {};
export const touchNixieLocalProject = () => {};
export const confirmDiscoveryExtensions = async () => true;
export const captureDiscoveryInsertTarget = () => { throw new Error('Copy must not capture an insertion target'); };
export const commitDiscoveryInsertion = () => { throw new Error('Copy must not insert into a scene'); };
export const paletteBlobDataUrl = async () => { throw new Error('No fixture images expected'); };
`)}`;
const stubs = new Set(['#imports', '#nixie/composables/useNxToast.ts', '#nixie/plugins/nixie/project-create.ts', '#nixie/plugins/nixie/project-home.ts', '#nixie/plugins/nixie/runtime/project-route.ts', '#nixie/plugins/nixie/project-assets.ts', '#nixie/utils/nixie-offline-project-import.ts', '#nixie/utils/nixie-local-projects.ts', '#foxhole/composables/useLegacyPlanImportReportDialog.ts']);
stubs.add('#nixie/plugins/nixie/discovery-extensions.ts');
stubs.add('#nixie/plugins/nixie/discovery-insert.ts');
stubs.add('#nixie/plugins/nixie/palette-content.ts');
const harness = {
    picker: async (value: unknown) => {
        calls.push({ kind: 'picker', value });
        return cancel ? null : { target, name: 'Selected Name', enabledExtensionIds: ['other'] };
    },
    create: async (value: unknown) => {
        calls.push({ kind: 'create', value });
        return 'new-project-only';
    },
    navigate: async () => {
        if (failNavigate) {
            throw new Error('navigation failed');
        }
    },
};
const previousFetch = (globalThis as Record<string, unknown>).$fetch;
const fetchFixture = async (url: string, options: { method: string; body?: unknown; }) => {
    calls.push({ kind: options.method === 'DELETE' ? 'delete' : 'persist', value: { url, ...options } });
    if (failCleanup && options.method === 'DELETE') {
        throw new Error('cleanup failed');
    }
    if (failPersist && options.method !== 'DELETE') {
        throw new Error('snapshot failed');
    }
    return {};
};
Object.assign(globalThis, { __blueprintCopyHarness: harness });
beforeEach(() => Object.assign(globalThis, { $fetch: fetchFixture }));
afterEach(() => {
    if (previousFetch === undefined) {
        delete (globalThis as Record<string, unknown>).$fetch;
    } else {
        Object.assign(globalThis, { $fetch: previousFetch });
    }
});
after(() => {
    delete (globalThis as Record<string, unknown>).__blueprintCopyHarness;
});
const hook = registerHooks({ resolve(specifier, context, next) {
    return stubs.has(specifier) ? { url: stubUrl, shortCircuit: true } : next(specifier, context);
} });
const { importLegacyPlanFile } = await import('../../app/plugins/foxhole/legacy/plan-import-ui.ts');
hook.deregister();
async function fixture(): Promise<File> {
    const archive = new JSZip();
    archive.file('project.json', readFileSync(new URL('../fixtures/legacy-plans/sample-project.json', import.meta.url)));
    return new File([await archive.generateAsync({ type: 'uint8array' })], 'fixture.plan');
}
const provenance = { sourceKind: 'legacy-foxhole-blueprint' as const, sourceId: 'source', versionId: 'version', archiveSha256: 'hash', converterRevision: 'revision', credits: 'Author', sourceUrl: 'https://foxholeplanner.com/' };
function reset(): void {
    calls.length = 0;
    failPersist = false;
    failCleanup = false;
    failNavigate = false;
    cancel = false;
    target = { kind: 'workspace', workspaceId: 'destination' };
}
test('copy forwards the selected target and stores pinned provenance with foxhole enabled', async () => {
    reset();
    assert.equal(await importLegacyPlanFile(await fixture(), { provenance, initialName: 'Copy Suggestion' }), 'new-project-only');
    assert.deepEqual(calls.find(call => call.kind === 'create')!.value.target, target);
    assert.deepEqual(calls.find(call => call.kind === 'create')!.value.enabledExtensionIds, ['other', 'foxhole']);
    const document = calls.find(call => call.kind === 'persist')!.value.body.document;
    assert.equal(document.settings.name, 'Selected Name');
    const pinned = JSON.parse(document.settings.legacyBlueprintSource);
    assert.match(pinned.assetManifestSha256, /^[a-f0-9]{64}$/);
    delete pinned.assetManifestSha256;
    assert.deepEqual(pinned, provenance);
    assert.deepEqual(document.settings.enabledExtensionIds, ['other', 'foxhole']);
    assert.ok(document.roots.length);
    assert.ok(Array.isArray(document.assets));
    assert.equal(calls.filter(call => call.kind === 'delete').length, 0);
    // Exercise the real durable schema conversion/reload seam, rather than only the UI payload.
    const stored = migrateProjectSnapshotToV3(JSON.parse(JSON.stringify(document)), 'new-project-only', 3);
    assert.equal(stored.roots.length, 0);
    assert.equal(stored.assets.filter(asset => asset.assetType === 'scene').length, 1);
    const scene = Object.values(stored.assetContents)[0] as { roots: unknown[]; };
    assert.ok(scene.roots.length);
    const reloaded = migrateProjectSnapshotToV3(JSON.parse(JSON.stringify(stored)), 'new-project-only', 3);
    assert.deepEqual(reloaded.assetContents, stored.assetContents);
});
test('copy supports the new-workspace target without flattening its fields', async () => {
    reset();
    target = { kind: 'new-workspace', workspaceName: 'Blueprint Workspace', setAsDefault: false };
    await importLegacyPlanFile(await fixture(), { provenance });
    assert.deepEqual(calls.find(call => call.kind === 'create')!.value.target, target);
});
test('failed copy deletes only its newly created destination', async () => {
    reset();
    failPersist = true;
    await assert.rejects(importLegacyPlanFile(await fixture(), { provenance }), /snapshot failed/);
    assert.deepEqual(calls.filter(call => call.kind === 'delete').map(call => call.value.url), ['/api/nixie/projects/new-project-only']);
});
test('navigation failure preserves the successfully persisted copy', async () => {
    reset();
    failNavigate = true;
    await assert.rejects(importLegacyPlanFile(await fixture(), { provenance }), /navigation failed/);
    assert.equal(calls.filter(call => call.kind === 'delete').length, 0);
});

test('cleanup failure identifies only the new failed project and preserves the original cause', async () => {
    reset();
    failPersist = true;
    failCleanup = true;
    await assert.rejects(importLegacyPlanFile(await fixture(), { provenance }), error => {
        assert.match((error as Error).message, /new-project-only/);
        assert.match(String((error as Error).cause), /snapshot failed/);
        return true;
    });
    assert.deepEqual(calls.filter(call => call.kind === 'delete').map(call => call.value.url), ['/api/nixie/projects/new-project-only']);
});

test('missing image bytes cannot persist a partial Blueprint copy', async () => {
    reset();
    const archive = new JSZip();
    archive.file('project.json', JSON.stringify({ version: '1.0.5', entities: [{ id: 1, type: 'image', textureFile: 'missing.png', x: 0, y: 0, width: 20, height: 20 }] }));
    const file = new File([await archive.generateAsync({ type: 'uint8array' })], 'missing.plan');
    await assert.rejects(importLegacyPlanFile(file, { provenance }), /missing image data/);
    assert.equal(calls.filter(call => call.kind === 'persist').length, 0);
    assert.deepEqual(calls.filter(call => call.kind === 'delete').map(call => call.value.url), ['/api/nixie/projects/new-project-only']);
});
test('cancel creates nothing and offline destination avoids cloud creation', async () => {
    reset();
    cancel = true;
    assert.equal(await importLegacyPlanFile(await fixture(), { provenance }), null);
    assert.equal(calls.filter(call => call.kind === 'create').length, 0);
    reset();
    target = { kind: 'offline' };
    assert.equal(await importLegacyPlanFile(await fixture(), { provenance }), 'offline');
    assert.equal(calls.filter(call => call.kind === 'create').length, 0);
    assert.equal(calls.filter(call => call.kind === 'persist').length, 0);
});
