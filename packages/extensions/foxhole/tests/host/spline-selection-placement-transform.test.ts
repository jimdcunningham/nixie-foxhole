import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { setActiveNixieSelectionIds } from '#nixie/plugins/nixie/runtime/shared-state.ts';

// The legacy renderer imports Nuxt primitives with extensionless paths.
const hooks = registerHooks({
    load(url, context, next) {
        if (url.startsWith('file:') && url.endsWith('.ts') && url.includes('/packages/nixie/')) {
            return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
                compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
            }).outputText };
        }
        return next(url, context);
    },
    resolve(specifier, context, next) {
        // Rendering only needs setting defaults, not the Nuxt settings lifecycle.
        if (specifier === '#nixie/stores/settings.ts') {
            return {
                url: 'data:text/javascript,export function useNixieSettingsStore(){return {getValue:()=>undefined,getValueOr:(_id,fallback)=>fallback}}', shortCircuit: true,
            };
        }
        try {
            return next(specifier, context);
        } catch (error) {
            if ((specifier.startsWith('#nixie/') || specifier.startsWith('.')) && !/\.[a-z]+$/i.test(specifier)) {
                try {
                    return next(`${specifier}.ts`, context);
                } catch {
                    return next(`${specifier}/index.ts`, context);
                }
            }
            throw error;
        }
    },
});
// Nuxt normally auto-imports this theme helper for the legacy structure dependency.
const { resolveNxCanvasLabelTheme } = await import('#nixie/utils/nx-design-tokens.ts');
const previousThemeHelper = Object.getOwnPropertyDescriptor(globalThis, 'resolveNxCanvasLabelTheme');
Object.defineProperty(globalThis, 'resolveNxCanvasLabelTheme', { configurable: true, value: resolveNxCanvasLabelTheme });
after(() => {
    if (previousThemeHelper) {
        Object.defineProperty(globalThis, 'resolveNxCanvasLabelTheme', previousThemeHelper);
    } else {
        delete (globalThis as Record<string, unknown>).resolveNxCanvasLabelTheme;
    }
});
const { FoxholeSplineConnectorNode } = await import('../../app/plugins/nixie/board/types/foxhole-spline-connector.ts');
hooks.deregister();

for (const foxholeKey of ['facilitypipe', 'powerline', 'railtrackspline']) {
    test(`${foxholeKey} selection refresh preserves the live placement transform`, () => {
        setActiveNixieSelectionIds([]);
        const node = new FoxholeSplineConnectorNode({
            id: `palette-${foxholeKey}`, type: 'foxholeSplineConnector',
            state: { foxholeKey, x: -289, y: -504, rotation: 0.2,
                start: { x: 0, y: 0, rotation: 0 }, end: { x: 192, y: 0, rotation: Math.PI } },
        });
        try {
            // Palette placement moves the Pixi node before the queued selection update.
            node.position.set(160, 320);
            node.rotation = 0.7;
            node.scale.set(1.25, 0.8);
            const saved = node.toBoardSnapshot();
            for (const ids of [[String(node.boardId)], []]) {
                setActiveNixieSelectionIds(ids);
                assert.equal(node.x, 160);
                assert.equal(node.y, 320);
                assert.equal(node.rotation, 0.7);
                assert.equal(node.scale.x, 1.25);
                assert.equal(node.scale.y, 0.8);
                assert.deepEqual(node.toBoardSnapshot(), saved);
            }
            // Persisted edits must still apply their new transform normally.
            node.patchBoardState({ x: 400, y: 500, rotation: 1 });
            assert.equal(node.x, 400);
            assert.equal(node.y, 500);
            assert.equal(node.rotation, 1);
        } finally {
            node.onBoardUnmounted();
            node.destroy({ children: true });
            setActiveNixieSelectionIds([]);
        }
    });
}
