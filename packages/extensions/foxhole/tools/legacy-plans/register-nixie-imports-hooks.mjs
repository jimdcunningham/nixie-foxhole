import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NIXIE_APP_ROOT = process.env.NIXIE_HOST_ROOT
    ? path.resolve(process.env.NIXIE_HOST_ROOT, 'packages/nixie/app')
    : path.resolve(__dirname, '../../../../../../nixie/packages/nixie/app');
const EXTENSIONS = ['.ts', '.js', '.mjs', '.json'];

function resolveWithExtensions(absolutePath) {
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
        return absolutePath;
    }
    for (const extension of EXTENSIONS) {
        const candidate = `${absolutePath}${extension}`;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    const indexCandidates = EXTENSIONS.map(extension => path.join(absolutePath, `index${extension}`));
    for (const candidate of indexCandidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }
    return null;
}

/**
 * Node resolve hook: map `#nixie/*` → packages/nixie/app/* and tolerate extensionless TS imports.
 */
export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('#nixie-internal/')) {
        return { shortCircuit: true, url: pathToFileURL(path.join(NIXIE_APP_ROOT, '..', specifier.slice('#nixie-internal/'.length))).href };
    }
    if (specifier.startsWith('#nixie/')) {
        const rest = specifier.slice('#nixie/'.length);
        const resolved = resolveWithExtensions(path.join(NIXIE_APP_ROOT, rest));
        if (!resolved) {
            throw new Error(`Unable to resolve #nixie/${rest}`);
        }
        return {
            shortCircuit: true,
            url: pathToFileURL(resolved).href,
        };
    }

    if (
        (specifier.startsWith('./') || specifier.startsWith('../'))
        && context.parentURL
        && !path.extname(specifier)
    ) {
        try {
            const parentPath = fileURLToPath(context.parentURL);
            const absolute = path.resolve(path.dirname(parentPath), specifier);
            const resolved = resolveWithExtensions(absolute);
            if (resolved) {
                return {
                    shortCircuit: true,
                    url: pathToFileURL(resolved).href,
                };
            }
        } catch {
            // fall through
        }
    }

    return nextResolve(specifier, context);
}
