import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import JSZip from 'jszip';
import { NixieProjectArchive } from '../../../../nixie/app/plugins/nixie/project-archive.ts';
import { checkDiscoveryNodeTree, checkNativeDiscoveryZip } from '../../../../nixie/app/utils/discovery-archive.ts';

function loadCopy(dependencies: Record<string, unknown>, functionName = 'importArchiveIntoCloudProject',
    path = new URL('../../../../nixie/app/plugins/nixie/project-archive-import.ts', import.meta.url)) {
    const source = ts.createSourceFile('source.ts', readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const node = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === functionName)!;
    return new Function(...Object.keys(dependencies), `${ts.transpile(node.getText(source).replace(/^export /, ''), { target: ts.ScriptTarget.ES2022 })}; return ${functionName};`)(...Object.values(dependencies));
}

test('signed-out native Discovery copies select a local destination and retain required extensions', async () => {
    const archive = { document: { settings: { enabledExtensionIds: ['foxhole'] }, roots: [] }, projectFiles: [] };
    const provenance = { listingId: 'public-plan', releaseId: 'release' };
    let imported: Record<string, unknown> | undefined;
    const copy = loadCopy({
        useSupabaseUser: () => ({ value: null }),
        NixieProjectArchive: { readProjectArchive: async () => archive },
        prepareDiscoveryProjectExtensions: async () => {},
        readDiscoveryProjectExtensionIds: () => ['foxhole'],
        ensureNixieExtensionContributions: async () => {},
        useNixieRegistry: () => ({}),
        normalizeString: (value: unknown) => typeof value === 'string' ? value.trim() : '',
        DEFAULT_NIXIE_PROJECT_NAME: 'Project',
        requestNewProjectCreation: async (options: { guestOnly: boolean; }) => {
            assert.equal(options.guestOnly, true);
            return { name: 'Plan Copy', target: { kind: 'offline' }, enabledExtensionIds: [] };
        },
        importArchiveIntoOfflineProject: async (options: Record<string, unknown>) => {
            imported = options;
            return 'local-copy';
        },
    }, 'importNixieProjectArchive');
    assert.equal(await copy(new File([], 'plan.zip'), { discovery: { provenance } }), 'local-copy');
    assert.deepEqual(imported, { archive, name: 'Plan Copy', enabledExtensionIds: ['foxhole'], provenance });
});

test('local native copies persist content, extensions and source provenance before navigation', async () => {
    const roots = [{ id: 'node', type: 'foxhole.structure', state: {}, children: [] }];
    const provenance = { listingId: 'public-plan', releaseId: 'release' };
    let snapshot: { settings: Record<string, unknown>; roots: unknown[]; assetContents: unknown; } | undefined;
    const copy = loadCopy({
        createNixieLocalProject: () => ({ id: 'local-copy' }),
        importArchiveAssets: async () => ({ assets: [], uploadedAssetUrls: new Map(), importedFolderIds: new Map(), imageIds: new Map() }),
        importArchiveDocuments: async () => ({ assets: [], assetContents: { scene: { roots } } }),
        NixieProjectArchive: { replaceArchiveAssetPaths: async (document: unknown) => document },
        importNixieOfflineProjectSnapshot: async (_id: string, document: typeof snapshot) => {
            snapshot = document;
        },
        touchNixieLocalProject: () => {},
        setLastOpenedProjectId: () => {},
        buildNixieEditorRoute: (id: string) => `/project/${id}`,
        navigateTo: async (url: string) => {
            assert.ok(snapshot);
            assert.equal(url, '/project/local-copy');
        },
    }, 'importArchiveIntoOfflineProject');
    assert.equal(await copy({ name: 'Plan Copy', enabledExtensionIds: ['foxhole'], provenance,
        archive: { document: { settings: { credits: 'Author' }, roots }, projectFiles: [] } }), 'local-copy');
    assert.deepEqual(snapshot?.settings, { credits: 'Author', name: 'Plan Copy', enabledExtensionIds: ['foxhole'], discoverySource: JSON.stringify(provenance) });
    assert.deepEqual(snapshot?.roots, roots);
    assert.deepEqual(snapshot?.assetContents, { scene: { roots } });
});

test('signed-out legacy Blueprint copies persist locally with credits and pinned provenance', async () => {
    const provenance = { credits: 'Author', sourceId: 'blueprint' };
    let written: Record<string, unknown> | undefined;
    const result = { boardSnapshots: [{ id: 'node' }], pendingImages: [], stubDocument: {}, upgradedSave: { projectSettings: {} },
        report: { unresolvedBuildingKeys: [], unresolvedSocketIds: [], hasReportableFindings: false } };
    const copy = loadCopy({
        LegacyPlanImporter: class {
            async importArchive() {
                return result;
            }
        },
        normalizeString: (value: unknown) => typeof value === 'string' ? value.trim() : '',
        useSupabaseUser: () => ({ value: null }),
        requestNewProjectCreation: async (options: { guestOnly: boolean; }) => {
            assert.equal(options.guestOnly, true);
            return { name: 'Plan Copy', target: { kind: 'offline' }, enabledExtensionIds: [] };
        },
        createNixieLocalProject: () => ({ id: 'local-blueprint' }),
        materializeLegacyPlanImages: async () => ({ snapshots: [], assets: [] }),
        mapLegacyPlanIdentitySettings: () => ({}),
        mapLegacyPlanProjectSettings: () => ({}),
        pinLegacyBlueprintConversion: async (value: unknown) => value,
        writeLegacyPlanRoots: async (options: Record<string, unknown>) => {
            written = options;
        },
        loadProjectSummaries: async () => {},
        setLastOpenedProjectId: () => {},
        buildNixieEditorRoute: String,
        navigateTo: async () => {
            assert.ok(written);
        },
        showNxToast: () => {},
        buildImportToastMessage: () => 'Imported',
    }, 'importLegacyPlanFile', new URL('../../app/plugins/foxhole/legacy/plan-import-ui.ts', import.meta.url));
    assert.equal(await copy(new File([], 'plan.zip'), { initialName: 'Plan Copy', provenance }), 'local-blueprint');
    assert.equal(written?.offline, true);
    assert.equal(written?.credits, 'Author');
    assert.deepEqual(written?.enabledExtensionIds, ['foxhole']);
    assert.deepEqual(written?.provenance, provenance);
    assert.deepEqual(written?.roots, result.boardSnapshots);
});

for (const phase of ['upload', 'persist', 'icon', 'navigation', 'cleanup']) {
    test(`native copy lifecycle preserves ownership at ${phase} failure`, async () => {
        const deleted: string[] = [];
        const copy = loadCopy({
            createProjectRecord: async () => 'new-project',
            importArchiveAssets: async () => {
                if (phase === 'upload' || phase === 'cleanup') {
                    throw new Error('Upload failed');
                }
                return { assets: [], uploadedAssetUrls: new Map(), importedFolderIds: new Map() };
            },
            importArchiveDocuments: async () => ({ assets: [], assetContents: {} }),
            NixieProjectArchive: { replaceArchiveAssetPaths: async (document: unknown) => document },
            $fetch: async (url: string, options: { method: string; body?: unknown; }) => {
                if (options.method === 'DELETE') {
                    deleted.push(url);
                    if (phase === 'cleanup') {
                        throw new Error('Delete failed');
                    }
                } else if (phase === 'persist') {
                    throw new Error('Persist failed');
                }
            },
            uploadNixieProjectIconFile: async () => {
                if (phase === 'icon') {
                    throw new Error('Icon failed');
                }
            },
            buildProjectIconDisplayName: String,
            loadProjectSummaries: async () => {},
            setLastOpenedProjectId: () => {},
            buildNixieEditorRoute: String,
            navigateTo: async () => {
                if (phase === 'navigation') {
                    throw new Error('Navigation failed');
                }
            },
        });
        await assert.rejects(copy({ name: 'Copy', target: { kind: 'personal' }, archive: { document: { settings: {}, roots: [] }, iconFile: {} } }),
            phase === 'cleanup' ? /new project could not be removed/ : /failed/i);
        assert.deepEqual(deleted, ['upload', 'persist', 'cleanup'].includes(phase) ? ['/api/nixie/projects/new-project'] : []);
    });
}

async function zip(project: unknown, files?: unknown): Promise<Blob> {
    const archive = new JSZip();
    archive.file('project.json', JSON.stringify(project));
    if (files) {
        archive.file('project-files.json', JSON.stringify({ files }));
    }
    return new Blob([await archive.generateAsync({ type: 'uint8array' })]);
}
const image = { id: 'image', type: 'nixie.url-sprite', state: { textureUrl: 'assets/picture.png', projectAssetId: 'old-image' }, children: [] };

test('Discovery archive parser rejects unsupported formats, external images and duplicate nodes', async () => {
    await assert.rejects(NixieProjectArchive.readProjectArchive(await zip({ entities: [] }), { discovery: true }), /supported Nixie/);
    await assert.rejects(NixieProjectArchive.readProjectArchive(await zip({ settings: {}, roots: [{ ...image, state: { textureUrl: 'https://other.example/image.png' } }] }), { discovery: true }), /included in the archive/);
    await assert.rejects(NixieProjectArchive.readProjectArchive(await zip({ settings: {}, roots: [image, image] }), { discovery: true }), /duplicate/);
    await assert.rejects(NixieProjectArchive.readProjectArchive(await zip({ settings: {}, roots: [] }, [{ assetType: 'scene-v2', content: {} }]), { discovery: true }), /Scene V2/);
});

test('bounded parser checks additional native scenes and remaps their image references', async () => {
    await assert.rejects(NixieProjectArchive.readProjectArchive(await zip({ settings: {}, roots: [] }, [{ assetType: 'scene', content: { roots: [{ ...image, state: { textureUrl: '/api/source/image' } }] } }]), { discovery: true }), /scene images/);
    const archive = new JSZip();
    archive.file('project.json', JSON.stringify({ settings: {}, roots: [] }));
    archive.file('project-files.json', JSON.stringify({ files: [{ assetType: 'scene', content: { type: 'scene', roots: [image] } }] }));
    archive.file('assets/picture.png', new Uint8Array([1, 2, 3]));
    const imported = await NixieProjectArchive.readProjectArchive(new Blob([await archive.generateAsync({ type: 'uint8array' })]), { discovery: true });
    const scene = imported.projectFiles[0]!.content as { roots: typeof image[]; };
    const rewritten = await NixieProjectArchive.replaceArchiveAssetPaths({ ...imported.document, roots: scene.roots }, async () => '/api/nixie/projects/target/assets/new-image/object');
    assert.equal(rewritten.roots[0]!.state.projectAssetId, 'new-image');
    assert.ok(imported.assetFiles.has('assets/picture.png'));
});

test('Discovery ZIP allowlist and nesting checks precede compatibility decoding', async () => {
    const archive = new JSZip();
    archive.file('project.json', '{}');
    archive.file('../../../../nixie/tests/attack.js', 'bad');
    const bytes = new Uint8Array(await archive.generateAsync({ type: 'uint8array' }));
    assert.throws(() => checkNativeDiscoveryZip(bytes), /unsafe|unsupported/i);
});

test('overly deep raw and compact node trees are bounded', () => {
    const root: { i: string; t: string; c: unknown[]; } = { i: '0', t: 'container', c: [] };
    let parent = root;
    for (let index = 1; index < 70; index++) {
        const child = { i: String(index), t: 'container', c: [] };
        parent.c.push(child);
        parent = child;
    }
    assert.throws(() => checkDiscoveryNodeTree([root]), /excessive/);
});
