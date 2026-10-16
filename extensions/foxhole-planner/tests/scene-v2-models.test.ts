import assert from 'node:assert/strict';
import test from 'node:test';
import { listFoxholeSceneV2Products } from '../src/scene-v2-products.ts';
import assets from '../src/scene-v2-assets-node.ts';
import { bindFoxholeSceneV2Models, getFoxholeSceneV2PackagedModelPath, isFoxholeSceneV2ModelAllowed, selectFoxholeSceneV2ModelBuild } from '../src/scene-v2-models.ts';
import spatialPolicy from '../src/scene-v2-model-policy.json' with { type: 'json' };
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateNixieExperimentalComponentDataV1 } from '@nixie/extension-sdk';
import fullModelBundle from '../../../packages/extensions/foxhole/public/foxhole/assets/models/manifest.v1.json' with { type: 'json' };
import catalog from '../../../packages/extensions/foxhole/public/foxhole/assets/manifest.v1.json' with { type: 'json' };

const modelBundle = { ...fullModelBundle,
    assets: Object.fromEntries(Object.entries(fullModelBundle.assets).filter(([id]) => isFoxholeSceneV2ModelAllowed(id))),
    resources: Object.fromEntries(Object.entries(fullModelBundle.resources).filter(([id, value]) =>
        isFoxholeSceneV2ModelAllowed(value.assetId))) };

const spatialAssetIds = Object.keys(modelBundle.assets);
const selectionFile = new URL('../.model-build-selection', import.meta.url);
const developmentSelection = process.env.NIXIE_FOXHOLE_MODEL_IDS ?? (existsSync(selectionFile) ? readFileSync(selectionFile, 'utf8').trim() : undefined);
const declaredBuild = new Set(selectFoxholeSceneV2ModelBuild(structuredClone(assets), bindFoxholeSceneV2Models(structuredClone(assets), fullModelBundle), developmentSelection).map(model => `foxhole.model.${model.id}`));

for (const assetId of spatialAssetIds) {
    test(`${assetId} explorer placement retains catalog identity and ${assets[assetId]!.isItem ? 'portable icon presentation' : 'its declared model binding'}`, () => {
        const item = listFoxholeSceneV2Products({ contractVersion: 1, query: assetId, offset: 0, limit: 100 })
            .items.find(candidate => candidate.product.id === `asset.${assetId}`)!;
        assert.ok(item);
        if (assets[assetId]!.isItem) {
            assert.deepEqual(item.product.components.find(component => component.componentId === 'asset')!.data,
                { catalogId: 'foxhole.icons', assetId });
            assert.ok(item.product.components.some(component => component.ownerId === 'nixie.core' && component.componentId === 'icon'));
            assert.equal(item.product.components.some(component => component.componentId === 'model'), false);
            return;
        }
        const model = item.product.components.find(component => component.componentId === 'model')!;
        const manifest = JSON.parse(readFileSync(new URL('../nixie.extension.json', import.meta.url), 'utf8'));
        const definition = manifest.contributes.experimentalComponents.components.find((component: { id: string; }) => component.id === 'model');
        validateNixieExperimentalComponentDataV1(definition.schema, model.data);
        assert.equal(model.ownerId, 'nixie.foxhole-planner');
        assert.equal(model.data.resourceId, `foxhole.model.${assetId}`);
        assert.deepEqual(item.product.components.find(component => component.componentId === 'asset')!.data,
            { catalogId: 'foxhole.structures', assetId });
        assert.equal(model.data.width, modelBundle.assets[assetId].width);
        assert.equal(model.data.height, modelBundle.assets[assetId].height);
        assert.equal(model.data.depth, modelBundle.assets[assetId].depth);
        assert.equal(model.data.offsetZ, modelBundle.assets[assetId].offsetZ);
    });
}

test('the allowlisted bundle uses embedded WebP images and baked meshes within package limits', () => {
    const manifest = JSON.parse(readFileSync(new URL('../nixie.extension.json', import.meta.url), 'utf8'));
    for (const [assetId, metadata] of Object.entries({ ...modelBundle.assets, ...modelBundle.resources })) {
        const bytes = readFileSync(new URL(`../../../packages/extensions/foxhole/public/foxhole/assets/${metadata.path}`, import.meta.url));
        assert.equal(bytes.readUInt32LE(0), 0x46546c67);
        assert.equal(bytes.readUInt32LE(8), bytes.length);
        assert.equal(bytes.length, metadata.bytes);
        assert.ok(bytes.length <= 32 * 1024 * 1024);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.sha256);
        const jsonLength = bytes.readUInt32LE(12);
        const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
        assert.deepEqual(document.asset.extras.nixieModelAnchor, { version: 1,
            width: metadata.width, height: metadata.height, depth: metadata.depth,
            offsetX: metadata.offsetX, offsetY: metadata.offsetY, offsetZ: metadata.offsetZ });
        assert.deepEqual(document.asset.extras.nixieBlueprintOrigin, { version: 1, ...metadata.blueprintOrigin });
        if (assetId === 'crane') {
            const treads = document.meshes.flatMap((mesh: { primitives: Array<{ material: number; attributes: { POSITION: number; }; }>; }) => mesh.primitives)
                .filter((primitive: { material: number; }) => document.materials[primitive.material].name === 'ConstructionVehicleTread');
            assert.ok(treads.length > 0);
            const trackHeight = Math.min(...treads.map((primitive: { attributes: { POSITION: number; }; }) =>
                document.accessors[primitive.attributes.POSITION].min[1] * 32 + metadata.offsetZ));
            const contactTolerance = metadata.precisionOptimization.positionStepMetres * 32 + 0.0001;
            assert.ok(Math.abs(trackHeight) <= contactTolerance, 'crane tracks must retain ground contact within their declared precision grid');
            assert.ok(metadata.blueprintOrigin.z > 70, 'the vehicle actor origin is retained above the track reference');
        }
        const binary = bytes.subarray(28 + jsonLength);
        assert.ok(document.buffers.length <= 2);
        assert.ok(document.buffers.every((buffer: { uri?: string; }) => !buffer.uri));
        if (document.buffers.length === 2) {
            assert.equal(document.buffers[1].extensions.EXT_meshopt_compression.fallback, true);
        }
        assert.equal(document.buffers[0].uri, undefined);
        assert.ok(!document.skins?.length && !document.animations?.length);
        // Bounds sizing must preserve the authored 32-units-per-metre ratio.
        // Repeated pipes/crates once shared geometry during transform baking,
        // corrupting these bounds and squashing the entire building at load time.
        const positions = document.meshes.flatMap((mesh: { primitives: Array<{ attributes: { POSITION: number; }; }>; }) =>
            mesh.primitives.map(primitive => document.accessors[primitive.attributes.POSITION]));
        const dimensions = [0, 1, 2].map(axis =>
            Math.max(...positions.map((accessor: { max: number[]; }) => accessor.max[axis]!))
            - Math.min(...positions.map((accessor: { min: number[]; }) => accessor.min[axis]!)));
        for (const [axis, size] of [metadata.width, metadata.height, metadata.depth].entries()) {
            const step = 'precisionOptimization' in metadata ? metadata.precisionOptimization.positionStepMetres : 0;
            // Rounding each bound to the shared grid can change the extent by one step.
            // Still reject scale/baking corruption; allow only that measured rounding budget.
            const roundingBudget = step + Math.max(1, size / 32) * 1e-6;
            assert.ok(step <= 1 / 512, 'the position grid must remain below 2mm');
            assert.ok(Math.abs(size / 32 - dimensions[axis]!) <= roundingBudget,
                `${assetId} axis ${axis} would distort the model during bounds sizing`);
        }
        for (const image of document.images) {
            assert.equal(image.mimeType, 'image/webp');
            assert.equal(image.uri, undefined);
            const view = document.bufferViews[image.bufferView];
            assert.equal(binary.subarray(view.byteOffset, view.byteOffset + 4).toString(), 'RIFF');
            assert.equal(binary.subarray(view.byteOffset + 8, view.byteOffset + 12).toString(), 'WEBP');
        }
        if (declaredBuild.has(metadata.resourceId)) assert.deepEqual(manifest.contributes.experimentalResources.find((resource: { id: string; }) => resource.id === metadata.resourceId),
            { contractVersion: 1, id: metadata.resourceId, kind: 'model', path: `dist/assets/scene-v2/assets/${metadata.assetId ?? assetId}/${assetId}.glb` });
    }
});

test('packaged models share their owning asset directory with textures and icons', () => {
    assert.equal(getFoxholeSceneV2PackagedModelPath({
        id: 'facilitypowerdiesel', assetId: 'facilitypowerdiesel', path: 'models/facilitypowerdiesel.glb',
    }), 'assets/facilitypowerdiesel/facilitypowerdiesel.glb');
    assert.equal(getFoxholeSceneV2PackagedModelPath({
        id: 'facilitypowerdiesel.upgrade.coal', assetId: 'facilitypowerdiesel',
        path: 'models/facilitypowerdiesel.upgrade.coal.glb',
    }), 'assets/facilitypowerdiesel/facilitypowerdiesel.upgrade.coal.glb');
    assert.throws(() => getFoxholeSceneV2PackagedModelPath({
        id: 'powerpole.upgrade.coal', assetId: 'facilitypowerdiesel', path: 'models/powerpole.upgrade.coal.glb',
    }), /Invalid Foxhole packaged model identity/);
    const manifest = JSON.parse(readFileSync(new URL('../nixie.extension.json', import.meta.url), 'utf8'));
    const templates = Object.fromEntries(manifest.contributes.experimentalResourceTemplates
        .map((template: { idPrefix: string; pathTemplate: string; }) => [template.idPrefix, template.pathTemplate]));
    assert.equal(templates['foxhole.asset.'], 'dist/assets/scene-v2/assets/{id}/texture.webp');
    assert.equal(templates['foxhole.icon.'], 'dist/assets/scene-v2/assets/{id}/icon.webp');
    assert.equal(templates['foxhole.mod.'], 'dist/assets/scene-v2/shared/modifications/{id}.webp');
    assert.equal(templates['foxhole.visual.'], 'dist/assets/scene-v2/shared/visuals/{id}.webp');
});

test('catalog-wide models bind every exportable category and keep unavailable models optional', () => {
    assert.equal(spatialPolicy.assetSelection, 'catalog');
    assert.equal(spatialPolicy.geometryProfile, 'curved50-compact16');
    for (const asset of catalog.assets) assert.equal(isFoxholeSceneV2ModelAllowed(asset.id), true, asset.id);
    assert.equal(isFoxholeSceneV2ModelAllowed('../escape'), false);
    const selected = bindFoxholeSceneV2Models(structuredClone(assets), fullModelBundle);
    assert.ok(selected.every(model => isFoxholeSceneV2ModelAllowed(model.assetId)));
    for (const asset of catalog.assets) {
        const catalogAssets = { [asset.id]: structuredClone(assets[asset.id]!) };
        const metadata = catalogAssets[asset.id]!;
        const models = bindFoxholeSceneV2Models(catalogAssets, { schemaVersion: 1, assets: { [asset.id]: {
            codeName: metadata.codeName, resourceId: `foxhole.model.${asset.id}`, path: `models/${asset.id}.glb`,
            width: 32, height: 32, depth: 32, offsetX: 0, offsetY: 0, offsetZ: 0,
        } } });
        assert.equal(models[0]!.assetId, asset.id);
    }
    const manifest = JSON.parse(readFileSync(new URL('../nixie.extension.json', import.meta.url), 'utf8'));
    assert.deepEqual(new Set(manifest.contributes.experimentalResources.filter((resource: { kind: string; }) => resource.kind === 'model').map((resource: { id: string; }) => resource.id)), declaredBuild);
});

test('facility upgrades reference declared parts assembled in the original blueprint coordinate space', () => {
    let variants = 0;
    for (const assetId of spatialAssetIds) {
        const metadata = modelBundle.assets[assetId];
        const bytes = readFileSync(new URL(`../../../packages/extensions/foxhole/public/foxhole/assets/${metadata.path}`, import.meta.url));
        const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
        const assembly = document.asset.extras.nixieModelAssembly;
        if (!assembly) {
            continue;
        }
        assert.equal(assembly.scale, 32);
        for (const slot of assembly.slots) {
            assert.equal(slot.componentId, 'modification');
            for (const option of slot.options) {
                assert.ok(assets[assetId]!.modifications[option.match.slotId]?.variants[option.match.variantId]?.isUpgrade);
                assert.ok(Object.values(modelBundle.resources).some(resource => resource.resourceId === option.part.resourceId));
                variants++;
            }
        }
    }
    const expectedVariants = spatialAssetIds.reduce((count, id) => count + Object.values(assets[id]!.modifications)
        .reduce((sum, slot) => sum + Object.entries(slot.variants).filter(([id, variant]) => variant.isUpgrade).length, 0), 0);
    assert.equal(variants, expectedVariants, 'every exported facility upgrade has its declared part');
});

test('the explorer station product binds the real asset entry to the packaged model at Native scale', () => {
    const item = listFoxholeSceneV2Products({ contractVersion: 1, query: 'facilitytransferresource', offset: 0, limit: 100 })
        .items.find(candidate => candidate.product.id === 'asset.facilitytransferresource')!;
    assert.ok(item);
    const model = item.product.components.find(component => component.componentId === 'model')!;
    assert.equal(model.ownerId, 'nixie.foxhole-planner');
    assert.equal(model.data.resourceId, 'foxhole.model.facilitytransferresource');
    assert.ok(Math.abs(Number(model.data.width) - assets.facilitytransferresource!.width) < 1);
    assert.equal(model.data.offsetX, modelBundle.assets.facilitytransferresource.offsetX);
    assert.ok(Number(model.data.offsetZ) < Number(model.data.height) / 2, 'the station foundation remains below authored ground');
    assert.deepEqual(item.product.components.find(component => component.componentId === 'asset')!.data,
        { catalogId: 'foxhole.structures', assetId: 'facilitytransferresource' });
    assert.ok(item.product.components.some(component => component.componentId === 'cargo'));
});

test('model bundle identity mismatches fail rather than pointing a catalog entry at another model', () => {
    assert.throws(() => bindFoxholeSceneV2Models(assets, { schemaVersion: 1, assets: { facilitytransferresource: {
        resourceId: 'foxhole.model.other', codeName: 'FacilityTransferResource', path: 'models/other.glb',
        width: 310, height: 70, depth: 209, offsetX: 0, offsetY: 0, offsetZ: 0,
    } } }), /Invalid Foxhole model binding/);
});

test('newly allowlisted defenses, utilities and locomotives bind when model output becomes available', () => {
    for (const id of ['watchtower', 'maintenancetunnel', 'crane', 'trainengine']) {
        const catalogAssets = structuredClone(assets);
        const asset = catalogAssets[id]!;
        assert.ok(asset, id);
        assert.equal(isFoxholeSceneV2ModelAllowed(id), true, id);
        const models = bindFoxholeSceneV2Models(catalogAssets, { schemaVersion: 1, assets: { [id]: {
            codeName: asset.codeName, resourceId: 'foxhole.model.' + id, path: 'models/' + id + '.glb',
            width: 32, height: 32, depth: 32, offsetX: 0, offsetY: 0, offsetZ: 0,
        } } });
        assert.deepEqual(models, [{ id, assetId: id, path: 'models/' + id + '.glb' }]);
        assert.equal(catalogAssets[id]!.model!.resourceId, 'foxhole.model.' + id);
    }
});
