import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

/** Public authoring sources for generator tests/types; never copied into dist. */
export async function prepareAuthoringConsumer({extensionSource, fixtureRoot}) {
    const generators = path.resolve(extensionSource, '../../tools/foxwatch/catalog');
    const destination = path.join(fixtureRoot, 'build/.nixie-authoring');
    await fs.mkdir(destination, {recursive: true});
    for (const name of ['product-metadata.ts','map-metadata.ts','model-layer-nodes.ts','browser-atlas-images.ts']) {
        const code = (await fs.readFile(path.join(generators, name), 'utf8')).replaceAll('../../../extensions/foxhole-planner/src/', '../../src/');
        await fs.writeFile(path.join(destination, name), code);
    }
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
