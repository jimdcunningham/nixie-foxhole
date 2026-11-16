import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('a refreshed discovery consumer retains the importer registered by loaded contributions', async () => {
    const compile = (file: string) => ts.transpileModule(
        readFileSync(hostSourceUrl('../../../../nixie/app/plugins/nixie/' + file, import.meta.url), 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    const sharedModules = new Map<string, unknown>();
    function loadConsumer(file = 'legacy-blueprint-import.ts') {
        const exports: Record<string, any> = {};
        runInNewContext(compile(file), {
            exports,
            require: (specifier: string) => {
                if (specifier === './legacy-blueprint-reuse.ts') return loadConsumer('legacy-blueprint-reuse.ts');
                if (specifier === './discovery-required-extensions.ts') return { prepareDiscoveryRequiredExtensions: async () => {} };
                if (specifier.endsWith('/extensions/index.ts')) return { getNixieExtension: () => ({ id: 'foxhole' }), ensureNixieExtensionContributions: async () => {} };
                if (specifier.endsWith('/legacy-blueprint-importer.ts')) {
                    if (!sharedModules.has(specifier)) {
                        const registryExports = {};
                        runInNewContext(compile('legacy-blueprint-importer.ts'), { exports: registryExports });
                        sharedModules.set(specifier, registryExports);
                    }
                    return sharedModules.get(specifier);
                }
                if (specifier.endsWith('/legacy-blueprints.ts')) return { LEGACY_BLUEPRINT_REQUIRED_EXTENSION_IDS: ['foxhole'] };
                return {};
            },
            fetch: async () => { throw new Error('archive requested'); },
        });
        return exports;
    }
    // Extension contributions register once; their already-resolved loader is not rerun
    // when a Vue consumer is refreshed during development.
    const original = loadConsumer();
    original.registerLegacyBlueprintImporter({ copy: async () => 'copy', insert: async () => true });
    const refreshed = loadConsumer();
    await assert.rejects(refreshed.reuseLegacyBlueprint({ id: 'blueprint' }), /archive requested/);
    await assert.rejects(original.reuseLegacyBlueprint({ id: 'blueprint' }), /archive requested/);
});
