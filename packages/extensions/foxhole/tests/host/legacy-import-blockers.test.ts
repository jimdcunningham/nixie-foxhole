import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function loadFunction(path: string, name: string, dependencies: Record<string, unknown>) {
    const source = ts.createSourceFile('source.ts', readFileSync(hostSourceUrl(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
    return new Function(...Object.keys(dependencies), `${ts.transpile(declaration.getText(source).replace(/^export /, ''), { target: ts.ScriptTarget.ES2022 })}; return ${name};`)(...Object.values(dependencies));
}

for (const blocker of ['references', 'empty', 'images'] as const) {
    test(`Legacy ${blocker} blocker prevents the extension prompt`, async () => {
        const insert = loadFunction('../../app/plugins/foxhole/legacy/plan-import-ui.ts', 'insertLegacyBlueprintFile', {
            captureDiscoveryInsertTarget: () => ({ assertCurrent() {} }),
            LegacyPlanImporter: class {
                async importArchive() {
                    return {
                        report: { unresolvedBuildingKeys: blocker === 'references' ? ['missing'] : [], unresolvedSocketIds: [] },
                        boardSnapshots: blocker === 'empty' ? [] : [{}],
                        pendingImages: blocker === 'images' ? [{}] : [],
                        archive: { assets: [] },
                    };
                }
            },
            pinLegacyBlueprintConversion: async () => ({}),
            createLegacyPlanImageFile: () => ({ unresolved: 'missing' }),
            confirmDiscoveryExtensions: () => { throw new Error('Prompt must not run'); },
        });
        await assert.rejects(insert({ arrayBuffer: async () => new ArrayBuffer(0) }, {}, { finalizeSelectionPlacement() {} }),
            blocker === 'references' ? /unresolved structures/ : blocker === 'empty' ? /no insertable content/ : /missing image data/);
    });
}
