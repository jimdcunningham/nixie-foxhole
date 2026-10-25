import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {readPublicationPlan, validateTarget} from './asset-pack-publication.mjs';

const matches = (remote, row) => remote && ['sha256', 'bytes', 'mediaType', 'contentEncoding', 'cacheControl', 'decodedSha256', 'decodedBytes']
    .every(key => remote[key] === row[key]);
const retryable = error => error.$metadata?.httpStatusCode === 429 || error.$metadata?.httpStatusCode >= 500
    || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'].includes(error.code);
async function retry(task, signal) {
    for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        try {return await task();} catch (error) {
            if (attempt >= 3 || !retryable(error)) throw error;
            await new Promise((resolve, reject) => {
                const finish = () => {signal.removeEventListener('abort', abort); resolve();};
                const timer = setTimeout(finish, [250, 1000, 2500][attempt]);
                const abort = () => {clearTimeout(timer); reject(signal.reason);};
                signal.addEventListener('abort', abort, {once: true});
            });
        }
    }
}

/** Read-only comparison of a frozen plan with storage; never creates or overwrites objects. */
export async function inspectAssetPublication({planPath, transport, concurrency = 8, signal = new AbortController().signal}) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw Error('Concurrency must be between 1 and 16');
    const {plan} = await readPublicationPlan(planPath);
    const objects = new Array(plan.objects.length); let cursor = 0;
    const summary = {reused: 0, missing: 0, conflicting: 0, missingBytes: 0};
    await Promise.all(Array.from({length: Math.min(concurrency, plan.objects.length)}, async () => {
        while (cursor < plan.objects.length) {
            const index = cursor++, row = plan.objects[index];
            const remote = await retry(() => transport.head(row.key, signal), signal);
            const status = !remote ? 'missing' : matches(remote, row) ? 'reused' : 'conflicting';
            summary[status]++;
            if (status === 'missing') summary.missingBytes += row.bytes;
            objects[index] = {...row, status, ...(status === 'conflicting' ? {existing: remote} : {})};
        }
    }));
    return {schemaVersion: 1, planSha256: plan.planSha256, target: plan.target, summary, objects};
}

/** All payloads verify before network writes. Each phase finishes before the next starts. */
export async function publishAssetPublication({planPath, transport, concurrency = 8, signal = new AbortController().signal, onProgress = () => {}}) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('Concurrency must be between 1 and 16');
    const {directory, plan, receipts} = await readPublicationPlan(planPath);
    const releaseObject = plan.objects.find(row => row.phase === 'release');
    const releaseBytes = await fs.readFile(path.join(directory, releaseObject.file));
    const releaseDocument = JSON.parse((releaseObject.contentEncoding === 'br' ? brotliDecompressSync(releaseBytes, {maxOutputLength: 8 * 1024 ** 2}) : releaseBytes).toString('utf8'));
    if (releaseDocument.format === 'foxwatch-product-catalog-release-v1' && (!/^[a-f0-9]{64}$/.test(plan.reuseInventory?.sha256)
        || !Number.isSafeInteger(plan.reuseInventory.objects) || plan.reuseInventory.objects < 0)) throw Error('Prepare this catalog with existing-storage inspection before publishing');
    const cancel = new AbortController(), activeSignal = AbortSignal.any([signal, cancel.signal]);
    const stats = {uploaded: 0, reused: 0, uploadedBytes: 0, completed: 0, total: plan.objects.length};
    for (const phase of ['assets', 'indexes', 'release']) {
        const rows = plan.objects.filter(row => row.phase === phase); let cursor = 0, failure;
        const results = await Promise.allSettled(Array.from({length: Math.min(concurrency, rows.length)}, async () => {
            while (cursor < rows.length) {
                activeSignal.throwIfAborted();
                const row = rows[cursor++];
                try {
                    let remote = await retry(() => transport.head(row.key, activeSignal), activeSignal);
                    if (remote && !matches(remote, row)) throw new Error('Immutable object already exists with different bytes or headers: ' + row.key);
                    if (remote) stats.reused++;
                    else {
                        let created = true;
                        try {await retry(() => transport.put({...row, md5: receipts.get(row.key).md5, sourceFile: path.join(directory, row.file)}, activeSignal), activeSignal);}
                        catch (error) {if (error.$metadata?.httpStatusCode !== 412) throw error; created = false;}
                        remote = await retry(() => transport.head(row.key, activeSignal), activeSignal);
                        if (!matches(remote, row)) throw new Error('Uploaded object receipt or headers do not match: ' + row.key);
                        if (created) {stats.uploaded++; stats.uploadedBytes += row.bytes;} else stats.reused++;
                    }
                    stats.completed++; onProgress({phase, ...stats});
                } catch (error) {failure ??= error; cancel.abort(error); throw error;}
            }
        }));
        if (failure) throw failure;
        const rejected = results.find(result => result.status === 'rejected'); if (rejected) throw rejected.reason;
    }
    let channelUrl;
    const canonical = releaseDocument.schemaVersion === 1 && releaseDocument.format === 'foxwatch-product-catalog-release-v1';
    if (canonical || releaseDocument.schemaVersion === 1 && releaseDocument.format === 'foxwatch-asset-release-v1') {
        // Inspection clients discover the latest explicitly published release here.
        // Immutable payloads and release metadata have all verified before cutover.
        if (typeof transport.putChannel !== 'function') throw new Error('The publication transport must support the stable channel');
        let channelDocument = {schemaVersion: 1, release: plan.release};
        if (canonical) {
            const catalog = releaseDocument.catalog;
            const object = plan.objects.find(row => new URL(row.key, plan.target.publicBaseUrl).href === catalog?.url);
            if (!object || object.phase !== 'indexes' || object.decodedSha256 !== catalog.sha256 || object.decodedBytes !== catalog.byteLength) throw Error('Completion catalog differs from publication plan');
            channelDocument = {schemaVersion: 1, pin: {schemaVersion: 1, baseUrl: plan.target.publicBaseUrl, catalog, completion: plan.release}};
        }
        const channelBody = Buffer.from(JSON.stringify(channelDocument));
        const channelSha256 = createHash('sha256').update(channelBody).digest('hex');
        const channel = {key: plan.target.prefix + '/channels/stable.json', sha256: channelSha256, bytes: channelBody.length,
            mediaType: 'application/json', cacheControl: 'no-cache, max-age=0, must-revalidate', decodedSha256: channelSha256,
            decodedBytes: channelBody.length, md5: createHash('md5').update(channelBody).digest('base64')};
        const channelFile = path.join(directory, '.channel-' + randomUUID() + '.json');
        try {
            await fs.writeFile(channelFile, channelBody, {flag: 'wx'});
            if (!matches(await retry(() => transport.head(channel.key, activeSignal), activeSignal), channel)) await retry(() => transport.putChannel({...channel, sourceFile: channelFile}, activeSignal), activeSignal);
            if (!matches(await retry(() => transport.head(channel.key, activeSignal), activeSignal), channel)) throw new Error('Published channel receipt does not match');
        } finally {await fs.unlink(channelFile).catch(error => {if (error.code !== 'ENOENT') throw error;});}
        channelUrl = new URL(channel.key, plan.target.publicBaseUrl).href;
    }
    const receipt = {schemaVersion: 1, status: 'complete', planSha256: plan.planSha256, target: plan.target,
        release: plan.release, channelUrl, stats, completedAt: new Date().toISOString()};
    await writeAtomic(path.join(directory, 'publication-receipt.json'), receipt);
    return receipt;
}
async function writeAtomic(file, value) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
    await fs.rename(temporary, file);
}
export async function readPublicationConfig(file, repoRoot) {
    const config = JSON.parse(await fs.readFile(file, 'utf8'));
    if (Object.keys(config).some(key => !['schemaVersion', 'assetsRoot', 'outputRoot', 'target', 'concurrency', 'credentialEnvFile', 'credentialFile'].includes(key))
        || config.schemaVersion !== 1 || !config.assetsRoot || !config.outputRoot) throw new Error('Invalid asset publication config');
    validateTarget(config.target);
    return {...config, assetsRoot: path.resolve(repoRoot, config.assetsRoot), outputRoot: path.resolve(repoRoot, config.outputRoot)};
}
export async function runAssetPublicationCommand(command, args, repoRoot = process.cwd()) {
    const {values} = parseArgs({args, options: {config: {type: 'string'}, plan: {type: 'string'}, output: {type: 'string'}, upload: {type: 'boolean'}, help: {type: 'boolean'}}});
    if (values.help) {console.log('FoxWatch assets-prepare|assets-publish --config <config.json> [--plan <plan.json>] [--upload]. Publishing is a dry run unless --upload is passed.'); return;}
    const configPath = path.resolve(repoRoot, values.config ?? 'tools/foxwatch/local/asset-publication.json');
    const config = await readPublicationConfig(configPath, repoRoot);
    const onProgress = progress => console.log('asset-publication: ' + JSON.stringify(progress));
    if (command === 'assets-prepare') {
        if (values.upload || values.plan) throw new Error('Prepare does not upload or consume a prepared plan');
        const output = path.resolve(repoRoot, values.output ?? path.join(config.outputRoot, 'catalog-' + randomUUID()));
        const {prepareProductCatalog} = await import('../catalog/prepare-catalog.mjs');
        if (config.credentialEnvFile) process.loadEnvFile(path.resolve(repoRoot, config.credentialEnvFile));
        const {createAssetPublicationS3} = await import('./asset-pack-s3.mjs');
        const {loadAssetPublicationCredentials} = await import('./asset-pack-credentials.mjs');
        const {inspectExistingAssetObjects} = await import('./existing-objects.mjs');
        const storage = createAssetPublicationS3(config.target, await loadAssetPublicationCredentials(config, repoRoot), {maxAttempts:3});
        let prepared;
        try {
            const existingInventory = await inspectExistingAssetObjects({target:config.target,transport:storage,concurrency:config.concurrency ?? 8,onProgress});
            prepared = await prepareProductCatalog({assetsRoot: config.assetsRoot, output, target: config.target, onProgress, existingInventory, readExistingObject:key=>storage.readEncoded(key)});
            await fs.writeFile(path.join(prepared.directory,'existing-objects.json'),JSON.stringify(existingInventory,null,2)+'\n',{flag:'wx'});
        } finally {storage.close();}
        const {plan} = await readPublicationPlan(prepared.planPath);
        const result = {...prepared, plan};
        await fs.mkdir(config.outputRoot, {recursive: true});
        await writeAtomic(path.join(config.outputRoot, 'latest-plan.json'), {planPath: path.join(result.directory, 'plan.json')});
        onProgress({phase: 'prepared', planPath: path.join(result.directory, 'plan.json'), ...result.plan.summary, release: result.plan.release}); return result;
    }
    if (command !== 'assets-publish') throw new Error('Unknown asset publication command');
    const planPath = path.resolve(repoRoot, values.plan ?? JSON.parse(await fs.readFile(path.join(config.outputRoot, 'latest-plan.json'), 'utf8')).planPath);
    const {plan} = await readPublicationPlan(planPath);
    if (JSON.stringify(validateTarget(config.target)) !== JSON.stringify(plan.target)) throw new Error('Config target differs from prepared plan; prepare a new publication');
    if (!values.upload) {onProgress({phase: 'dry-run', planPath, ...plan.summary, target: plan.target, release: plan.release}); return {plan};}
    if (config.credentialEnvFile) process.loadEnvFile(path.resolve(repoRoot, config.credentialEnvFile));
    const {createAssetPublicationS3} = await import('./asset-pack-s3.mjs');
    const {loadAssetPublicationCredentials} = await import('./asset-pack-credentials.mjs');
    const transport = createAssetPublicationS3(plan.target, await loadAssetPublicationCredentials(config, repoRoot)), controller = new AbortController();
    const stop = () => controller.abort(new Error('Asset publication stopped; rerun the same plan to resume'));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
        const receipt = await publishAssetPublication({planPath, transport, concurrency: config.concurrency ?? 8, signal: controller.signal, onProgress});
        onProgress({phase: 'published', ...receipt}); return receipt;
    } finally {transport.close(); process.off('SIGINT', stop); process.off('SIGTERM', stop);}
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {await runAssetPublicationCommand(process.argv[2], process.argv.slice(3));}
    catch (error) {console.error('Asset publication failed: ' + error.message); process.exitCode = 1;}
}
