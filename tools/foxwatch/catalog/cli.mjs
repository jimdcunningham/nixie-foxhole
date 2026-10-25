import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {readPublicationConfig} from '../scripts/asset-pack-publisher.mjs';
import {acquireProcessLock} from '../scripts/process-lock.mjs';
import {prepareProductCatalog} from './prepare-catalog.mjs';
export async function runCatalogPreparation(args = process.argv.slice(2)) {
    const {values} = parseArgs({args, options: {config: {type: 'string'}, output: {type: 'string'}, release: {type: 'string'}}});
    if (values.release) throw Error('--release is retired; catalogs share content-addressed objects');
    const root = path.resolve(import.meta.dirname, '../../..');
    const config = await readPublicationConfig(path.resolve(root, values.config ?? 'tools/foxwatch/local/asset-publication.json'), root);
    const releaseLock = acquireProcessLock(path.join(root, 'tools/foxwatch/tmp/foxwatch-refresh.lock.json'), 'FoxWatch product catalog preparation');
    try {
        const prepared = await prepareProductCatalog({assetsRoot: config.assetsRoot, target: config.target,
            output: path.resolve(values.output ?? path.join(config.outputRoot, 'catalog-' + Date.now())),
            onProgress: progress => {if (progress.objects % 100 === 0) console.log(JSON.stringify(progress));}});
        console.log(JSON.stringify({status: 'prepared-offline', publicationReady: false, ...prepared}));
    } finally {releaseLock();}
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCatalogPreparation();
