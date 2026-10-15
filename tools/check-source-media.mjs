import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const mediaPath = /\.(?:glb|gltf|fbx|obj|blend\d*|pak|uasset|umap|png|webp|jpe?g|tga|dds|wav|ogg|mp3|mp4|zip|7z|bin|ico|icns|gif|bmp|ktx2?|svg|dat|bytes)$/i;
const generatedOutput = /(?:^|\/)(?:outputs?|artifacts?|logs?|screenshots?|test-results|playwright-report|coverage|\.tmp|tmp|dist|\.output|\.nuxt)(?:\/|$)|\.(?:log|bak|blend\d+|har|trx)$/i;

/** An exact content allowlist is a review gate, not a copyright/license determination. */
export function verifySourceMedia(entries, policy) {
    const failures = [];
    let reviewed = 0;
    const seen = new Set();
    for (const { path, bytes } of entries) {
        if (generatedOutput.test(path) || policy.forbiddenFiles?.includes(path)) {
            failures.push(`Generated output must not be tracked: ${path}`);
            continue;
        }
        if (policy.forbiddenPrefixes.some(prefix => path.startsWith(prefix))) {
            failures.push(`Generated/game-content directory must not be tracked: ${path}`);
            continue;
        }
        if (mediaPath.test(path) || bytes.includes(0)) {
            const allowed = policy.files[path];
            const digest = createHash('sha256').update(bytes).digest('hex');
            if (!allowed?.provenance || allowed.sha256 !== digest) failures.push(`Unreviewed media/binary bytes: ${path}`);
            else { reviewed++; seen.add(path); }
        } else if (/data:(?:image|model|audio)\/[^\s"']{120,}|[A-Za-z0-9+/]{1000,}={0,2}/.test(bytes.toString('utf8'))) {
            failures.push(`Embedded media/encoded payload needs review: ${path}`);
        }
    }
    for (const path of Object.keys(policy.files)) {
        if (!seen.has(path)) failures.push(`Stale or invalid media allowlist entry: ${path}`);
    }
    if (failures.length) throw new Error(failures.join('\n'));
    return reviewed;
}

export function checkSourceMedia(root = resolve(import.meta.dirname, '..')) {
    const policy = JSON.parse(readFileSync(resolve(root, 'config/source-media.json'), 'utf8'));
    if (policy.schemaVersion !== 1) throw new Error('Unsupported source-media policy.');
    const git = (args, options = {}) => execFileSync('git', args, { cwd: root, maxBuffer: 256 * 1024 * 1024, ...options });
    const files = git(['ls-files', '--stage', '-z']).toString('utf8').split('\0').filter(Boolean).map(record => {
        const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(record);
        if (!match || match[3] !== '0') throw new Error('Resolve index conflicts before auditing source media.');
        return { mode: match[1], oid: match[2], path: match[4] };
    }).filter(file => file.mode !== '160000'); // Third-party submodules retain their own repository/license boundary.
    const objects = git(['cat-file', '--batch'], { input: files.map(file => file.oid).join('\n') + '\n' });
    let offset = 0;
    const entries = files.map(file => {
        const end = objects.indexOf(10, offset);
        const header = objects.subarray(offset, end).toString('utf8');
        const match = /^[a-f0-9]+ blob (\d+)$/.exec(header);
        if (!match) throw new Error(`Cannot audit Git object: ${file.path}`);
        const length = Number(match[1]);
        const bytes = objects.subarray(end + 1, end + 1 + length);
        offset = end + 1 + length + 1;
        return { path: file.path, bytes };
    });
    const reviewed = verifySourceMedia(entries, policy);
    console.log(`Source media guard passed (${files.length} indexed files; ${reviewed} exact reviewed media/binary files).`);
    return reviewed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) checkSourceMedia();
