import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import path from 'node:path';

import { buildInputSnapshot, createRegenPlan, diffSnapshots } from './regen-core.mjs';

const manifest = {
    assets: [
        { id: 'alpha' },
        { id: 'bravo' },
        { id: 'charlie' },
    ],
};

function snapshot(inputs) {
    return {
        schemaVersion: 1,
        inputs,
        pakInventory: null,
    };
}

function input(hash, text, stages = ['hydrate', 'scene']) {
    return { hash, text, stages, size: text?.length ?? 0, mtimeNs: 1 };
}

describe('FoxWatch regen dirty planning', () => {
    it('keeps every FoxWatch pipeline source assigned to an invalidation stage', async () => {
        const repositoryRoot = path.resolve(import.meta.dirname, '..', '..', '..');
        const stageMapPath = path.join(repositoryRoot, 'tools', 'foxwatch', 'regen-stages.v1.json');

        const current = await buildInputSnapshot(repositoryRoot, stageMapPath);

        assert.ok(current.inputs['tools/foxwatch/run-foxwatch.mjs']?.stages.includes('publish'));
        assert.ok(current.inputs['tools/foxwatch/scripts/blender-batches.mjs']?.stages.includes('publish'));
        assert.ok(current.inputs['tools/foxwatch/FoxWatchManifestGenerator.cs']?.stages.includes('extract'));
        assert.ok(current.inputs['tools/foxwatch/blender/render_render_scenes.py']?.stages.includes('render'));
    });

    it('keeps a metadata-only override out of Blender', () => {
        const file = 'tools/foxwatch/asset-overrides/alpha/manifest.json';
        const previous = snapshot({ [file]: input('old', '{"name":"Old"}') });
        const current = snapshot({ [file]: input('new', '{"name":"New"}') });
        const plan = createRegenPlan(previous, current, manifest);

        assert.deepEqual(plan.affectedAssetIds, ['alpha']);
        assert.deepEqual(plan.modesByAsset.alpha, []);
        assert.equal(plan.requiresBlender, false);
        assert.equal(plan.requiresPublish, true);
    });

    it('invalidates only preview-derived roles for previewDirection', () => {
        const file = 'tools/foxwatch/asset-overrides/alpha/manifest.json';
        const previous = snapshot({ [file]: input('old', '{"previewDirection":"nw"}') });
        const current = snapshot({ [file]: input('new', '{"previewDirection":"se"}') });
        const plan = createRegenPlan(previous, current, manifest);

        assert.deepEqual(plan.modesByAsset.alpha, ['preview', 'rendered-icon']);
    });

    it('invalidates only default-icon roles for a local icon override', () => {
        const iconPath = 'tools/foxwatch/asset-overrides/trencht2/icon.default.webp';
        const previous = snapshot({
            [iconPath]: input('old-icon', null, ['hydrate', 'scene']),
        });
        const current = snapshot({
            [iconPath]: input('new-icon', null, ['hydrate', 'scene']),
        });

        const plan = createRegenPlan(previous, current, manifest);

        assert.deepEqual(plan.affectedAssetIds, ['trencht2']);
        assert.deepEqual(plan.modesByAsset.trencht2, ['default-icon']);
        assert.equal(plan.requiresBlender, false);
        assert.equal(plan.requiresImagePublish, true);
    });

    it('keeps deleted authored files dirty', () => {
        const file = 'tools/foxwatch/pose-overrides/bravo/pose.json';
        const previous = snapshot({ [file]: input('old', '{}', ['scene']) });
        const current = snapshot({});
        const plan = createRegenPlan(previous, current, manifest);

        assert.deepEqual(diffSnapshots(previous, current), [file]);
        assert.deepEqual(plan.affectedAssetIds, ['bravo']);
        assert.equal(plan.reasons[0].kind, 'deleted');
    });

    it('expands shared modification edits through the reverse dependency index', () => {
        const file = 'tools/foxwatch/asset-overrides/modifications.json';
        const previous = snapshot({ [file]: input('old', '{"modifications":{"door-a":{"previewDirection":"nw"}}}') });
        const current = snapshot({ [file]: input('new', '{"modifications":{"door-a":{"previewDirection":"se"}}}') });
        const dependencyIndex = {
            entries: {
                'door-a': {
                    consumers: [{ structureId: 'bravo' }, { structureId: 'charlie' }],
                },
            },
        };
        const plan = createRegenPlan(previous, current, manifest, dependencyIndex);

        assert.deepEqual(plan.affectedAssetIds, ['bravo', 'charlie']);
        assert.deepEqual(plan.modesByAsset.bravo, ['preview', 'rendered-icon']);
        assert.deepEqual(plan.modesByAsset.charlie, ['preview', 'rendered-icon']);
    });

    it('makes a warm no-op produce no work', () => {
        const previous = snapshot({});
        const current = snapshot({});
        const plan = createRegenPlan(previous, current, manifest);

        assert.deepEqual(plan.changedPaths, []);
        assert.equal(plan.requiresBuild, false);
        assert.equal(plan.requiresBlender, false);
        assert.equal(plan.requiresPublish, false);
    });

    it('reuses Blender masters for publisher-only changes', () => {
        const file = 'tools/foxwatch/scripts/publish-structure-icons.mjs';
        const previous = snapshot({ [file]: input('old', 'old', ['publish']) });
        const current = snapshot({ [file]: input('new', 'new', ['publish']) });
        const plan = createRegenPlan(previous, current, manifest);

        assert.deepEqual(plan.affectedAssetIds, ['alpha', 'bravo', 'charlie']);
        assert.equal(plan.requiresHydration, false);
        assert.equal(plan.requiresBlender, false);
        assert.equal(plan.requiresPublish, true);
    });
});
