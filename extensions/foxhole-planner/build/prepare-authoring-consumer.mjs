import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

/** Public authoring sources for generator tests/types; never copied into dist. */
export async function prepareAuthoringConsumer({extensionSource, fixtureRoot}) {
    const generators = path.resolve(extensionSource, '../../tools/foxwatch/catalog');
    const destination = path.join(fixtureRoot, 'build/.nixie-authoring');
    await fs.mkdir(destination, {recursive: true});
    for (const name of ['product-metadata.ts','map-metadata.ts','model-layer-nodes.ts','browser-atlas-images.ts','contact-shadows.ts']) {
        const code = (await fs.readFile(path.join(generators, name), 'utf8')).replaceAll('../../../extensions/foxhole-planner/src/', '../../src/')
            .replaceAll('../../../packages/extensions/foxhole/app/plugins/foxhole/nixie/map/icon-preview.ts', './map-icon-preview.ts');
        await fs.writeFile(path.join(destination, name), code);
    }
    await fs.copyFile(path.resolve(extensionSource, '../../packages/extensions/foxhole/app/plugins/foxhole/nixie/map/icon-preview.ts'), path.join(destination, 'map-icon-preview.ts'));
    for (const tier of [1, 2, 3]) {
        const override = path.join(destination, 'asset-overrides', `fortbaset${tier}`);
        await fs.mkdir(override, {recursive: true});
        await fs.copyFile(path.resolve(extensionSource, `../../tools/foxwatch/asset-overrides/fortbaset${tier}/manifest.json`), path.join(override, 'manifest.json'));
    }
    const wallTest = path.join(fixtureRoot, 'tests/bunker-base-wall-visibility.test.ts');
    await fs.writeFile(wallTest, (await fs.readFile(wallTest, 'utf8')).replaceAll('../../../tools/foxwatch/asset-overrides/', '../build/.nixie-authoring/asset-overrides/'));
    const shadowTest = path.join(fixtureRoot, 'tests/contact-shadows.test.ts');
    await fs.writeFile(shadowTest, (await fs.readFile(shadowTest, 'utf8')).replaceAll('../../../tools/foxwatch/catalog/', '../build/.nixie-authoring/'));
    for (const [file, target] of [
        ['src/scene-v2-asset-metadata.ts', '../build/.nixie-authoring/product-metadata.ts'],
        ['src/scene-v2-map-metadata.ts', '../build/.nixie-authoring/map-metadata.ts'],
        ['src/model-layer-nodes.ts', '../build/.nixie-authoring/model-layer-nodes.ts'],
        ['build/browser-atlas-images.ts', './.nixie-authoring/browser-atlas-images.ts'],
    ]) await fs.writeFile(path.join(fixtureRoot, file), "// Public authoring fixture; excluded from runtime output.\nexport * from '" + target + "';\n");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const {values} = parseArgs({options: {target: {type: 'string'}}});
    if (!values.target) throw Error('Specify --target for a disposable independent extension consumer');
    const extensionSource = path.resolve(import.meta.dirname, '..'), fixtureRoot = path.resolve(values.target);
    if (fixtureRoot === extensionSource) throw Error('Authoring fixtures cannot replace the source checkout');
    await prepareAuthoringConsumer({extensionSource, fixtureRoot});
}
