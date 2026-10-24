import path from 'node:path';
import {parseArgs} from 'node:util';
import {readPublicationConfig} from '../scripts/asset-pack-publisher.mjs';
import {acquireProcessLock} from '../scripts/process-lock.mjs';
import {prepareProductCatalog} from './prepare-catalog.mjs';
const {values} = parseArgs({options: {config: {type: 'string'}, output: {type: 'string'}, release: {type: 'string'}}});
if (!values.release) throw Error('Specify --release with a new immutable asset release ID');
const root = path.resolve(import.meta.dirname, '../../..');
const config = await readPublicationConfig(path.resolve(root, values.config ?? 'tools/foxwatch/local/asset-publication.json'), root);
const releaseLock = acquireProcessLock(path.join(root, 'tools/foxwatch/tmp/foxwatch-refresh.lock.json'), 'FoxWatch product catalog preparation');
try {
    const prepared = await prepareProductCatalog({assetsRoot: config.assetsRoot, target: config.target, assetRelease: values.release,
        output: path.resolve(values.output ?? path.join(config.outputRoot, 'catalog-' + values.release)),
        onProgress: progress => {if (progress.objects % 100 === 0) console.log(JSON.stringify(progress));}});
    console.log(JSON.stringify({status: 'prepared', ...prepared}));
} finally {releaseLock();}
