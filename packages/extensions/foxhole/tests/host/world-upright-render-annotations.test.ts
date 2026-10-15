import assert from 'node:assert/strict';
import test from 'node:test';
import * as PIXI from 'pixi.js';
import { preserveTestGlobal } from '../../../../nixie/tests/nixie/preserve-test-global.ts';
import { NixieExtensionRenderPlanHost } from '../../../../nixie/app/plugins/nixie/scene-v2/render-plan-host.ts';
import { composeNixieSceneV2RenderPlans } from '../../../../nixie/desktop-extensions/scene-v2-render-plan-composition.ts';
import { syncNixieWorldUprightAnnotations } from '../../../../nixie/app/plugins/nixie/scene-v2/render-annotations.ts';
import { syncUprightBoardOverlayChildren, FOXHOLE_UPRIGHT_OVERLAY_LABEL } from '../../app/plugins/foxhole/nixie/upright-overlay-sync.ts';
import { renderFoxholeSceneV2Range } from '../../../../../extensions/foxhole-planner/src/scene-v2-ranges.ts';
import { renderDiagramNode } from '../../../../../extensions/scene-v2-diagram/src/scene-v2.ts';
import { DIAGRAM_NODE_STYLE_DEFAULT } from '../../../../../extensions/scene-v2-diagram/src/node-styles.ts';
import { DEFAULT_FOXHOLE_RANGE_STATE } from '../../app/plugins/foxhole/nixie/range.ts';

test('host upright rotation matches the Native hierarchy walk for nested and root annotations', () => {
    const root = new PIXI.Container();
    const direction = new PIXI.Container();
    direction.rotation = 0.7;
    const upright = new PIXI.Container();
    upright.label = FOXHOLE_UPRIGHT_OVERLAY_LABEL;
    const nested = new PIXI.Container();
    nested.label = FOXHOLE_UPRIGHT_OVERLAY_LABEL;
    root.addChild(direction);
    direction.addChild(upright);
    upright.addChild(nested);
    try {
        for (const angle of [0, 0.25, Math.PI / 2, -Math.PI, 4.5]) {
            syncUprightBoardOverlayChildren(angle, root);
            const expected = [upright.rotation, nested.rotation];
            // Native stops at a marked subtree; a separately declared nested
            // upright target must also cancel the resulting parent rotation.
            syncNixieWorldUprightAnnotations(root, [upright, nested], angle);
            assert.equal(upright.rotation, expected[0]);
            assert.ok(Math.abs(angle + direction.rotation + upright.rotation + nested.rotation) < 1e-12);
            assert.equal(direction.rotation, 0.7);
        }
        syncNixieWorldUprightAnnotations(root, [root], 0.9);
        assert.equal(root.rotation, -0.9);
    } finally {
        root.destroy({ children: true });
    }
});

test('real Planner and Diagram label declarations follow preview rotation without changing plans or text', async context => {
    preserveTestGlobal(context, 'document');
    preserveTestGlobal(context, 'CanvasRenderingContext2D');
    Object.defineProperty(globalThis, 'CanvasRenderingContext2D', { configurable: true, value: { prototype: {} } });
    const metricsContext = { font: '', measureText: (text: string) => ({ width: text.length * 12, actualBoundingBoxAscent: 16, actualBoundingBoxDescent: 4 }) };
    const canvas = { width: 10, height: 10, getContext: () => metricsContext };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas } });
    const metrics = PIXI.CanvasTextMetrics as unknown as { __canvas?: unknown; __context?: unknown; clearMetrics(): void; };
    const oldCanvas = metrics.__canvas;
    const oldContext = metrics.__context;
    metrics.__canvas = canvas;
    metrics.__context = metricsContext;
    metrics.clearMetrics();
    const range = { ...DEFAULT_FOXHOLE_RANGE_STATE, points: [12, -40, 100, -40] };
    const node = { entityId: 'node', revision: 1, components: [{ ownerId: 'example.scene-v2-diagram', componentId: 'node',
        version: 1, definitionAvailable: true, data: { kind: 'process', label: 'Rotate Label', color: 0x52c7e8 } },
    { ownerId: 'example.scene-v2-diagram', componentId: 'node-style', version: 1, definitionAvailable: true, data: { ...DIAGRAM_NODE_STYLE_DEFAULT } }] };
    const diagram = renderDiagramNode(node);
    const plans = [{ schemaVersion: 1 as const, root: { id: 'range-root', kind: 'group' as const, children: renderFoxholeSceneV2Range(range, 0.25) } },
        // The real node's text subtree is sufficient here; browser verification
        // exercises its complete static/GIF resource tree with actual fonts.
        { ...diagram, root: { ...diagram.root, children: diagram.root.children.filter(child => child.kind === 'text') } }];
    const before = structuredClone({ range, node, plans });
    try {
        for (const plan of plans) {
            const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => PIXI.Texture.EMPTY });
            try {
                const root = await host.replace(composeNixieSceneV2RenderPlans(null, plan)!);
                const targets = host.getRenderAnnotations().worldUpright;
                assert.equal(targets.length, 1);
                for (const angle of [0.25, 0.9, Math.PI / 2, -2.5]) {
                    host.syncWorldUpright(angle);
                    let worldAngle = angle;
                    for (let target: PIXI.Container | null = targets[0]!; target && target !== root.parent; target = target.parent) {
                        worldAngle += target.rotation;
                    }
                    assert.ok(Math.abs(worldAngle) < 1e-12);
                }
                const target = targets[0]!;
                await assert.rejects(host.replace({ schemaVersion: 2 }));
                assert.equal(host.getRenderAnnotations().worldUpright[0], target);
                await host.replace({ schemaVersion: 1, root: { id: 'empty', kind: 'group', children: [] } });
                assert.equal(target.destroyed, true);
                assert.equal(host.getRenderAnnotations().worldUpright.length, 0);
            } finally {
                host.destroy();
            }
        }
        assert.deepEqual({ range, node, plans }, before);
    } finally {
        metrics.__canvas = oldCanvas;
        metrics.__context = oldContext;
        metrics.clearMetrics();
    }
});
