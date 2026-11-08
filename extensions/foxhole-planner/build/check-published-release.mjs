import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function shouldPublishRelease({ extensionId, version, packageHash }, fetcher = fetch) {
    const url = new URL('/api/nixie/extensions/' + encodeURIComponent(extensionId) + '/versions', 'https://nixiejs.com');
    // The registry returns all versions and reports compatibility separately.
    url.searchParams.set('studioVersion', '1.1.0');
    const response = await fetcher(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw Error('Could not check published Planner releases (HTTP ' + response.status + ').');
    const releases = await response.json();
    if (!Array.isArray(releases) || releases.some(release => !release || typeof release.version !== 'string'
        || !/^[a-f0-9]{64}$/.test(release.packageSha256))) throw Error('Invalid Planner release registry response.');
    const existing = releases.filter(release => release.version === version);
    if (existing.some(release => release.packageSha256 !== packageHash)) {
        throw Error('Planner ' + version + ' is already published with different package bytes. Bump the version to publish this build.');
    }
    return existing.length === 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { verifyNixieExtensionPackage } = await import('@nixiejs/extension-package');
    const { manifest, packageHash } = await verifyNixieExtensionPackage(process.argv[2]);
    const publish = await shouldPublishRelease({ extensionId: manifest.id, version: manifest.version, packageHash });
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'publish=' + publish + '\n');
    console.log('Planner ' + manifest.version + (publish ? ' is ready to publish.' : ' is already published with this exact package.'));
}
