import { promises as fs } from 'node:fs';
import { isFoxholeGeneratedModelPath } from '../src/scene-v2-models.ts';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readPinnedAssetJson } from '../src/asset-release.ts';
import { parseNixieExperimentalAssetPackIndexV1 } from './remote-resource-bindings.ts';

export async function prepareStandalone({ extensionSource, fixtureRoot, foxholeAssetsRoot = join(extensionSource, '../../packages/extensions/foxhole/public/foxhole/assets') }) {
    const fixtureInputRoot = join(fixtureRoot, 'src', '.nixie-build-input');
    await fs.mkdir(fixtureInputRoot, { recursive: true });
    await fs.copyFile(
        join(foxholeAssetsRoot, 'manifest.v1.json'),
        join(fixtureInputRoot, 'manifest.v1.json'),
    );
    await fs.copyFile(join(foxholeAssetsRoot, 'models', 'manifest.v1.json'), join(fixtureInputRoot, 'models.v1.json'));
    const modelInput = JSON.parse(await fs.readFile(join(fixtureInputRoot, 'models.v1.json'), 'utf8'));
    await fs.mkdir(join(fixtureInputRoot, 'models'), { recursive: true });
    const modelSources = [
        ...Object.entries({ ...modelInput.assets, ...modelInput.resources })
            .map(([id, model]) => ({ id, assetId: model.assetId ?? id, path: model.path, resourceId: model.resourceId,
                dependencyIds: (model.modelParts?.parts ?? []).map(part => part.resourceId) })),
        ...Object.entries(modelInput.sharedParts ?? {})
            .map(([id, model]) => ({ id, assetId: 'shared', path: model.path, resourceId: model.resourceId, sharedPart: true })),
    ];
    for (const model of modelSources) {
        if (!/^[a-z0-9.-]+$/.test(model.id) || !isFoxholeGeneratedModelPath(model)) {
            throw new Error(`Invalid standalone model input: ${model.id}`);
        }
        await fs.mkdir(join(fixtureInputRoot, model.path, '..'), { recursive: true });
        await fs.copyFile(join(foxholeAssetsRoot, model.path), join(fixtureInputRoot, model.path));
    }
    await fs.cp(join(foxholeAssetsRoot, 'localizations'), join(fixtureInputRoot, 'localizations'), { recursive: true });
    // The live watcher may intentionally declare only a development model selection.
    // The detached fixture consumes its complete model input, so derive declarations from that input too.
    // Build-input preparation precedes npm install in the detached fixture.
    const { isFoxholeSceneV2ModelAllowed, getFoxholeSceneV2PackagedModelPath } = await import(
        pathToFileURL(join(extensionSource, 'src', 'scene-v2-models.ts')).href);
    const selectedModels = modelSources.filter(model => !model.sharedPart && isFoxholeSceneV2ModelAllowed(model.assetId));
    const dependencies = new Set(selectedModels.flatMap(model => model.dependencyIds));
    const packagedModels = [...selectedModels, ...modelSources.filter(model => model.sharedPart && dependencies.has(model.resourceId))];
    const manifestPath = join(fixtureRoot, 'nixie.extension.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.contributes.experimentalResources = [
        ...manifest.contributes.experimentalResources.filter(resource => resource.kind !== 'model'),
        ...packagedModels.map(model => ({ contractVersion: 1, id: model.resourceId, kind: 'model',
            path: 'dist/assets/scene-v2/' + getFoxholeSceneV2PackagedModelPath(model),
            ...(manifest.contributes.experimentalAssetPacks?.some(pack => pack.id === 'foxhole.runtime') ? { assetPack: 'foxhole.runtime' } : {}) })),
    ];
    await fs.writeFile(manifestPath, JSON.stringify(manifest) + '\n', 'utf8');
    const nodeAssetsPath = join(fixtureRoot, 'src', 'scene-v2-assets-node.ts');
    const nodeAssetsSource = await fs.readFile(nodeAssetsPath, 'utf8');
    await fs.writeFile(
        nodeAssetsPath,
        nodeAssetsSource.replace(
            '../../../packages/extensions/foxhole/public/foxhole/assets/manifest.v1.json',
            './.nixie-build-input/manifest.v1.json',
        ).replace('../../../packages/extensions/foxhole/public/foxhole/assets/models/manifest.v1.json', './.nixie-build-input/models.v1.json').replaceAll('../../../packages/extensions/foxhole/public/foxhole/assets/localizations/', './.nixie-build-input/localizations/'),
        'utf8',
    );
    // Catalog regression tests consume the same detached generated input as the
    // Node alias; they must not require a monorepo beside the standalone fixture.
    for (const filename of await fs.readdir(join(fixtureRoot, 'tests'))) {
        if (!filename.endsWith('.ts')) {
            continue;
        }
        const testPath = join(fixtureRoot, 'tests', filename);
        const source = await fs.readFile(testPath, 'utf8');
        await fs.writeFile(testPath, source.replaceAll(
            '../../../packages/extensions/foxhole/public/foxhole/assets/manifest.v1.json',
            '../src/.nixie-build-input/manifest.v1.json',
        ).replaceAll(
            '../../../packages/extensions/foxhole/public/foxhole/assets/models/manifest.v1.json',
            '../src/.nixie-build-input/models.v1.json',
        ).replaceAll(
            '../../../packages/extensions/foxhole/public/foxhole/assets/',
            '../src/.nixie-build-input/',
        ), 'utf8');
    }
    process.env.NIXIE_FOXHOLE_ASSETS_ROOT = foxholeAssetsRoot;
    await fs.copyFile(join(foxholeAssetsRoot, 'maps', 'map-data.v1.json'), join(fixtureInputRoot, 'map-data.v1.json'));
    const nodeMapPath = join(fixtureRoot, 'src', 'scene-v2-map-data-node.ts');
    await fs.writeFile(nodeMapPath, (await fs.readFile(nodeMapPath, 'utf8')).replace(
        '../../../packages/extensions/foxhole/public/foxhole/assets/maps/map-data.v1.json',
        './.nixie-build-input/map-data.v1.json',
    ), 'utf8');
}

export async function verifyStandalone({ fixtureRoot, packageVerification, readAssetIndex = readPinnedAssetJson }) {
    const manifest = JSON.parse(await fs.readFile(join(fixtureRoot, 'nixie.extension.json'), 'utf8'));
    const pack = manifest.contributes?.experimentalAssetPacks?.find(pack => pack.id === 'foxhole.runtime');
    const remoteEntries = pack
        ? new Map(parseNixieExperimentalAssetPackIndexV1(await readAssetIndex(pack.manifest)).assets.map(entry => [entry.path, entry]))
        : null;
    const { default: mapMetadata, foxholeMapResources } = await import(pathToFileURL(join(fixtureRoot, 'src', 'scene-v2-map-data-node.ts')).href);
    const builtMetadata = JSON.parse(await fs.readFile(join(fixtureRoot, 'dist', 'assets', 'maps', 'metadata.json'), 'utf8'));
    if (JSON.stringify(builtMetadata) !== JSON.stringify(mapMetadata)) {
        throw new Error('The standalone map metadata differs from the published offline projection.');
    }
    let bytes = 0;
    for (const resource of foxholeMapResources) {
        if (remoteEntries) {
            const source = await fs.readFile(join(process.env.NIXIE_FOXHOLE_ASSETS_ROOT, resource.sourcePath));
            const entry = remoteEntries.get(resource.path);
            if (!entry || entry.sha256 !== createHash('sha256').update(source).digest('hex') || entry.byteLength !== source.length
                || packageVerification.metadata.files.some(file => file.path === resource.path)) {
                throw new Error('The standalone remote map differs from its pinned source or was bundled: ' + resource.id);
            }
            bytes += source.length;
            continue;
        }
        const [source, built] = await Promise.all([
            fs.readFile(join(process.env.NIXIE_FOXHOLE_ASSETS_ROOT, resource.sourcePath)),
            fs.readFile(join(fixtureRoot, resource.path)),
        ]);
        const sha256 = createHash('sha256').update(source).digest('hex');
        const packaged = packageVerification.metadata.files.find(file => file.path === resource.path);
        if (createHash('sha256').update(built).digest('hex') !== sha256 || packaged?.sha256 !== sha256 || packaged?.bytes !== source.length) {
            throw new Error(`The standalone map resource differs from its source or package payload: ${resource.id}`);
        }
        bytes += source.length;
    }
    return { mapResourceVerification: { regions: mapMetadata.regions.length, resources: foxholeMapResources.length, bytes,
        labels: mapMetadata.regions.reduce((total, region) => total + region.labels.length, 0),
        staticIcons: mapMetadata.regions.reduce((total, region) => total + region.staticIcons.length, 0) } };
}

export function verifyStandaloneManifest(manifest) {
    const settingIds = new Set((manifest.contributes?.settings ?? []).map(setting => setting.id));
    if (!settingIds.has('foxhole.viewport.socketSnapping')
        || manifest.contributes?.primaryToolbarItems?.[0]?.id !== 'foxhole.primary-toolbar.snapping.sockets'
        || !settingIds.has('foxhole.assets.filter.showPreviousTiers')
        || !settingIds.has('foxhole.assets.filter.upgrades')
        || !settingIds.has('foxhole.assets.filter.destroyed')
        || !settingIds.has('foxhole.assets.filter.breached')
        || !settingIds.has('nixie.foxhole-planner.stats.scope')
        || !settingIds.has('nixie.foxhole-planner.stats.interval')
        || !manifest.contributes?.panels?.find(panel => panel.id === 'statistics')?.settingIds?.includes('nixie.foxhole-planner.stats.scope')
        || !manifest.contributes?.panels?.find(panel => panel.id === 'statistics')?.settingIds?.includes('nixie.foxhole-planner.stats.interval')) {
        throw new Error('The standalone Planner SDK build did not retain its migrated contributions.');
    }
}
