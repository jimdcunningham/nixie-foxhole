import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import * as PIXI from 'pixi.js';
import { preserveTestGlobal } from '../../../../nixie/tests/nixie/preserve-test-global.ts';
import { NixieExtensionRenderPlanHost } from '../../../../nixie/app/plugins/nixie/scene-v2/render-plan-host.ts';
import { resolveNixieMeasuredSelectionGeometry } from '../../../../nixie/app/plugins/nixie/scene-v2/measured-selection-geometry.ts';
import { composeNixieSceneV2RenderPlans } from '../../../../nixie/desktop-extensions/scene-v2-render-plan-composition.ts';
import { renderFoxholeSceneV2Entity } from '../../../../../extensions/foxhole-planner/src/scene-v2-renderers.ts';
import { DEFAULT_FOXHOLE_RANGE_STATE } from '../../app/plugins/foxhole/nixie/range.ts';
import { DEFAULT_FOXHOLE_TRIANGULATION_STATE } from '../../app/plugins/foxhole/nixie/triangulation.ts';

const hook = registerHooks({ resolve(specifier, context, next) {
    const directory = specifier.startsWith('#nixie/') ? '../../../../nixie/app/' : specifier.startsWith('#foxhole/') ? '../../app/' : null;
    return directory ? { url: new URL(directory + specifier.slice(specifier.indexOf('/') + 1), import.meta.url).href, shortCircuit: true } : next(specifier, context);
} });
const { getFoxholeRangeSelectionLocalBounds } = await import('../../app/plugins/nixie/board/types/foxhole-range.ts');
const { getFoxholeTriangulationSelectionLocalBounds } = await import('../../app/plugins/nixie/board/types/foxhole-triangulation.ts');
hook.deregister();

test('host-measured Range labels and bounds match Native for radius, sweep, orientation and viewport scaling', async testContext => {
    preserveTestGlobal(testContext, 'document');
    preserveTestGlobal(testContext, 'CanvasRenderingContext2D');
    Object.defineProperty(globalThis, 'CanvasRenderingContext2D', { configurable: true, value: { prototype: {} } });
    const context = { font: '', measureText: (text: string) => ({ width: text.length * 12, actualBoundingBoxAscent: 16, actualBoundingBoxDescent: 4 }) };
    const canvas = { width: 10, height: 10, getContext: () => context };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas } });
    const metrics = PIXI.CanvasTextMetrics as unknown as { __canvas?: unknown; __context?: unknown; clearMetrics(): void; };
    const previousCanvas = metrics.__canvas;
    const previousContext = metrics.__context;
    metrics.__canvas = canvas;
    metrics.__context = context;
    metrics.clearMetrics();
    try {
        for (const renderScale of [0.05, 0.5, 1, 4, 16]) {
            for (const sweepAngle of [45, 180, 360]) {
                for (const radius of [8, 80, 500]) {
                    const data = { ...DEFAULT_FOXHOLE_RANGE_STATE, points: [12, -40, 12 + radius * Math.cos(0.7), -40 + radius * Math.sin(0.7)], sweepAngle };
                    const subject = { entityId: 'range', revision: 1, components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'range', version: 1,
                        definitionAvailable: true, data }] };
                    const plan = composeNixieSceneV2RenderPlans(null, renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject], viewport: { renderScale } }))!;
                    const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => PIXI.Texture.EMPTY });
                    try {
                        await host.replace(plan);
                        const geometry = resolveNixieMeasuredSelectionGeometry(plan.experimentalSelectionGeometry, id => host.getTextBoxLayout(id));
                        const expected = getFoxholeRangeSelectionLocalBounds(data, renderScale);
                        for (const edge of ['minX', 'minY', 'maxX', 'maxY'] as const) {
                            assert.ok(Math.abs(geometry!.localBounds![edge] - expected[edge]) < 1e-7,
                                `${renderScale}/${sweepAngle}/${radius}/${edge}: ${geometry!.localBounds![edge]} != ${expected[edge]}`);
                        }
                    } finally {
                        host.destroy();
                    }
                }
            }
        }
    } finally {
        metrics.__canvas = previousCanvas;
        metrics.__context = previousContext;
        metrics.clearMetrics();
    }
});

test('Triangulation bounds retain Native circle and marker padding across viewport scales', () => {
    for (const renderScale of [0.05, 0.5, 1, 4]) {
        for (const edgePoints of [[0, 0, 80, 0, 40, 70], [20, -10, -30, 60, 100, 80], [0, 0, 40, 0, 80, 0]]) {
            const data = { ...DEFAULT_FOXHOLE_TRIANGULATION_STATE, edgePoints };
            const subject = { entityId: 'triangulation', revision: 1, components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'triangulation', version: 1,
                definitionAvailable: true, data }] };
            const actual = renderFoxholeSceneV2Entity(subject, { contractVersion: 1, entities: [subject], viewport: { renderScale } }).experimentalSelectionGeometry?.localBounds;
            const expected = getFoxholeTriangulationSelectionLocalBounds(data, renderScale);
            assert.ok(actual && expected);
            for (const edge of ['minX', 'minY', 'maxX', 'maxY'] as const) {
                assert.ok(Math.abs(actual[edge] - expected[edge]) < 1e-7, `${renderScale}/${edge}`);
            }
        }
    }
});
