import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import test from 'node:test';

const extensionRoot = resolve(import.meta.dirname, '..');
const allowedStandaloneImports = new Set([
    '@nixiejs/extension-sdk',
    '@nixiejs/extension-sdk/experimental/scene-v2',
    '@nixiejs/extension-sdk/testing',
    'vue',
]);
const forbiddenTokens = [
    '#nixie',
    '@nixiejs/platform',
    'from \'electron\'',
    'from "electron"',
    'pixi.js',
    'yjs',
    '@supabase/',
];

async function sourceFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    const visit = async (directory: string): Promise<void> => {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                await visit(path);
            } else if (['.ts', '.tsx', '.vue'].includes(extname(path))) {
                files.push(path);
            }
        }
    };
    await visit(root);
    return files;
}

test('Planner source imports only the public standalone SDK boundary', async () => {
    for (const path of await sourceFiles(join(extensionRoot, 'src'))) {
        const source = await fs.readFile(path, 'utf8');
        for (const token of forbiddenTokens) {
            assert.equal(source.includes(token), false, `${relative(extensionRoot, path)} contains forbidden token ${token}`);
        }
        for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
            const specifier = match[1] ?? '';
            assert.ok(
                specifier.startsWith('.') || specifier.startsWith('#') || allowedStandaloneImports.has(specifier),
                `${relative(extensionRoot, path)} imports non-public dependency ${specifier}`,
            );
        }
    }
});

test('Planner package declares only standalone public dependencies', async () => {
    const extensionPackage = JSON.parse(await fs.readFile(join(extensionRoot, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
    };
    for (const [name, version] of Object.entries(extensionPackage.dependencies ?? {})) {
        assert.equal(allowedStandaloneImports.has(name), true, `Planner depends on non-public package ${name}`);
        assert.equal(version.startsWith('workspace:'), false, `Planner has a workspace dependency on ${name}`);
    }
    const sdkVersion = extensionPackage.dependencies?.['@nixiejs/extension-sdk'];
    assert.ok(
        sdkVersion === '0.1.0-preview.2'
        || sdkVersion === 'file:./vendor/nixiejs-extension-sdk-0.1.0-preview.2.tgz',
        `Planner uses an unexpected SDK version: ${sdkVersion ?? '(missing)'}`,
    );
});
