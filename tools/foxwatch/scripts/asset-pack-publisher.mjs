import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {prepareAssetPublication, readPublicationPlan, validateTarget} from './asset-pack-publication.mjs';

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

/** All payloads verify before network writes. Each phase finishes before the next starts. */
export async function publishAssetPublication({planPath, transport, concurrency = 8, signal = new AbortController().signal, onProgress = () => {}}) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('Concurrency must be between 1 and 16');
    const {directory, plan, receipts} = await readPublicationPlan(planPath);
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
    const receipt = {schemaVersion: 1, status: 'complete', planSha256: plan.planSha256, target: plan.target,
        release: plan.release, stats, completedAt: new Date().toISOString()};
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
        const output = path.resolve(repoRoot, values.output ?? path.join(config.outputRoot, 'release-' + randomUUID()));
        const result = await prepareAssetPublication({assetsRoot: config.assetsRoot, output, target: config.target, concurrency: config.concurrency ?? 4, onProgress});
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
