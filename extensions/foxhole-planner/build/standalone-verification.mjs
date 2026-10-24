import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareAuthoringConsumer} from './prepare-authoring-consumer.mjs';

export async function prepareStandalone({extensionSource, fixtureRoot, foxholeAssetsRoot = path.join(extensionSource, '../../packages/extensions/foxhole/public/foxhole/assets')}) {
    await prepareAuthoringConsumer({extensionSource, fixtureRoot});
    const input = path.join(fixtureRoot, 'src/.nixie-build-input'); await fs.mkdir(input, {recursive: true});
    const names = ['manifest.v1.json','models/manifest.v1.json','maps/map-data.v1.json', ...['de','fr','pt','ru','zh'].map(locale => 'localizations/' + locale + '.json')];
    const modelManifest = JSON.parse(await fs.readFile(path.join(foxholeAssetsRoot, 'models/manifest.v1.json')));
    for (const model of Object.values({...modelManifest.assets, ...modelManifest.resources, ...modelManifest.sharedParts})) {
        if (typeof model.path !== 'string' || !/^[a-z0-9._/-]+\.glb$/.test(model.path) || model.path.split('/').some(value => value === '..' || !value)) throw Error('Unsafe standalone model input');
        names.push(model.path);
    }
    for (const name of new Set(names)) {
        const destination = path.join(input,name); await fs.mkdir(path.dirname(destination),{recursive:true}); await fs.copyFile(path.join(foxholeAssetsRoot,name),destination);
    }
    await fs.copyFile(process.env.NIXIE_FOXHOLE_CATALOG_FILE || path.join(foxholeAssetsRoot,'catalog.v1.json'), path.join(input,'catalog.v1.json'));
    for (const name of await fs.readdir(path.join(fixtureRoot,'tests'))) if (name.endsWith('.ts')) {
        const file = path.join(fixtureRoot,'tests',name);
        await fs.writeFile(file,(await fs.readFile(file,'utf8')).replaceAll('../../../packages/extensions/foxhole/public/foxhole/assets/','../src/.nixie-build-input/'));
    }
    process.env.NIXIE_FOXHOLE_CATALOG_FILE = path.join(input,'catalog.v1.json');
    process.env.NIXIE_FOXHOLE_ASSETS_ROOT = input;
}

export async function verifyStandalone({fixtureRoot, packageVerification}) {
    const {verifyRemotePublicationPackage} = await import(pathToFileURL(path.join(fixtureRoot,'build/verify-publication-package.mjs')).href);
    const result = await verifyRemotePublicationPackage(packageVerification.packagePath);
    const catalogFile = path.join(fixtureRoot,'dist/catalog.v1.json');
    const source = await fs.readFile(process.env.NIXIE_FOXHOLE_CATALOG_FILE), built = await fs.readFile(catalogFile);
    if (!source.equals(built)) throw Error('Standalone build changed FoxWatch catalog bytes');
    const files = await fs.readdir(path.join(fixtureRoot,'dist/assets'));
    for (const name of files.filter(name => name.endsWith('.js'))) {
        const code = await fs.readFile(path.join(fixtureRoot,'dist/assets',name),'utf8');
        if (!/catalog\.v1\.json["']\s*with\s*\{\s*type\s*:\s*["']json["']/.test(code)) throw Error('Planner must load its single packaged JSON module');
        if (code.includes('catalogSchemaVersion')) throw Error('Planner JavaScript duplicates its catalog');
    }
    console.log(JSON.stringify({standaloneCatalog: result}));
}
