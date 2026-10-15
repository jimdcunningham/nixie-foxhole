import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { collectDiscoveryImagePaths, runDiscoveryImagePreparation } from '../../../../nixie/app/utils/discovery-image-preparation.ts';
import { runSharedNixieProjectImageContentHashUpload } from '../../../../nixie/app/utils/nixie-project-image-upload-coordinator.ts';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadLegacyImages(dependencies: Record<string, unknown>) {
    const path = hostSourceUrl('../../app/plugins/foxhole/legacy/plan-import-ui.ts', import.meta.url);
    const source = ts.createSourceFile('source.ts', readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const node = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'materializeLegacyPlanImages')!;
    return new Function(...Object.keys(dependencies), `${ts.transpile(node.getText(source), { target: ts.ScriptTarget.ES2022 })}; return materializeLegacyPlanImages;`)(...Object.values(dependencies));
}

test('legacy insertion stops after permission loss and supplies the current catalog for dedupe', async () => {
    let writable = true;
    let calls = 0;
    const catalog = [{ id: 'user-image' }];
    const result = { pendingImages: [{ textureFile: 'one' }, { textureFile: 'two' }], archive: { assets: {} }, report: { importedShapeCounts: {} } };
    const materialize = loadLegacyImages({
        useSupabaseClient: () => ({}),
        createLegacyPlanImageFile: () => ({ file: new File(['image'], 'image.png') }),
        createLegacyPlanImageSpriteSnapshot: () => ({}),
        uploadNixieProjectImageAsset: async (options: { catalogAssets: unknown[]; }) => {
            assert.deepEqual(options.catalogAssets, catalog);
            calls++;
            writable = false;
            return { outcome: 'uploaded', asset: { id: 'shared' }, reused: false };
        },
    });
    const assertCurrent = () => {
        if (!writable) {
            throw new Error('Permission changed.');
        }
    };
    await assert.rejects(runDiscoveryImagePreparation(assertCurrent, recordCompletedUpload => materialize({ projectId: 'target', result,
        strict: true, assertCurrent, recordCompletedUpload, catalogAssets: () => catalog })), /Permission changed.*Assets/);
    assert.equal(calls, 1);
});

test('legacy missing-image preflight completes before uploads', async () => {
    let uploads = 0;
    const materialize = loadLegacyImages({
        useSupabaseClient: () => ({}),
        createLegacyPlanImageFile: ({ pending }: { pending: { textureFile: string; }; }) => pending.textureFile === 'missing'
            ? { unresolved: 'missing' }
            : { file: new File(['image'], 'image.png') },
        uploadNixieProjectImageAsset: async () => {
            uploads++;
        },
    });
    await assert.rejects(materialize({ projectId: 'target', strict: true,
        result: { pendingImages: [{ textureFile: 'present' }, { textureFile: 'missing' }], archive: { assets: {} } } }), /missing image data/);
    assert.equal(uploads, 0);
});

test('selected-scene image preflight rejects a missing image before any upload', async () => {
    let uploads = 0;
    await assert.rejects(async () => {
        const paths = await collectDiscoveryImagePaths(async resolve => {
            await resolve('assets/present.png');
            await resolve('assets/missing.png');
        }, path => path === 'assets/present.png');
        uploads += paths.size;
    }, /Archive image is missing/);
    assert.equal(uploads, 0);
});

test('selected-scene preflight includes only unique referenced images', async () => {
    const assets = new Set(['assets/selected.png', 'assets/other-scene.png']);
    const paths = await collectDiscoveryImagePaths(async resolve => {
        await resolve('assets/selected.png');
        await resolve('assets/selected.png');
    }, path => assets.has(path));
    assert.deepEqual([...paths], ['assets/selected.png']);
});

test('failure before a completed upload retains the original error', async () => {
    const error = new Error('Upload failed.');
    await assert.rejects(runDiscoveryImagePreparation(() => {}, async () => {
        throw error;
    }), candidate => candidate === error);
});

test('permission changes stop further uploads and explain retained assets', async () => {
    let writable = true;
    let uploads = 0;
    let commits = 0;
    const assertCurrent = () => {
        if (!writable) {
            throw new Error('The board changed.');
        }
    };
    await assert.rejects(runDiscoveryImagePreparation(assertCurrent, async record => {
        for (let index = 0; index < 3; index++) {
            assertCurrent();
            uploads++;
            writable = false;
            record();
        }
        commits++;
    }), error => error instanceof Error && /board changed.*remain.*Assets.*retry/.test(error.message) && error.cause instanceof Error);
    assert.equal(uploads, 1);
    assert.equal(commits, 0);
});

test('successful preparation returns the commit result', async () => {
    const result = await runDiscoveryImagePreparation(() => {}, async record => {
        record();
        return ['new-node'];
    });
    assert.deepEqual(result, ['new-node']);
});

test('shared uploads report reused false to both callers, so it cannot prove rollback ownership', async () => {
    let release!: (value: { asset: { id: string; }; reused: boolean; }) => void;
    let uploadCalls = 0;
    const upload = () => {
        uploadCalls++;
        return new Promise<{ asset: { id: string; }; reused: boolean; }>(resolve => {
            release = resolve;
        });
    };
    const first = runSharedNixieProjectImageContentHashUpload('project', 'a'.repeat(64), upload);
    const concurrentUser = runSharedNixieProjectImageContentHashUpload('project', 'a'.repeat(64), upload);
    release({ asset: { id: 'shared-image' }, reused: false });
    const [one, two] = await Promise.all([first, concurrentUser]);
    assert.equal(uploadCalls, 1);
    assert.equal(one, two);
    assert.equal(one.reused, false);
    assert.equal(two.reused, false);
});
