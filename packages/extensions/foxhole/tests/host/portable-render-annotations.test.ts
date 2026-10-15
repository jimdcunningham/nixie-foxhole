import assert from 'node:assert/strict';
import test from 'node:test';
import * as PIXI from 'pixi.js';
import { NixieExtensionRenderPlanHost } from '../../../../nixie/app/plugins/nixie/scene-v2/render-plan-host.ts';
import { composeNixieSceneV2RenderPlans } from '../../../../nixie/desktop-extensions/scene-v2-render-plan-composition.ts';
import { getNixieSceneV2PresentationLocalBounds } from '../../../../nixie/app/plugins/nixie/scene-v2/render-presentation.ts';
import { renderPlanHasPersistentContent } from '../../../../nixie/app/plugins/nixie/scene-v2/render-annotations.ts';
import { renderFoxholeSceneV2Connector } from '../../../../../extensions/foxhole-planner/src/scene-v2-connectors.ts';
import { renderDiagramRoute } from '../../../../../extensions/scene-v2-diagram/src/scene-v2.ts';

test('both domains materialize host-selected guides without enlarging content or mutating authored data', async () => {
    const data = { foxholeKey: 'wall', points: [0, 0, 50, 0, 90, 40] };
    const route = { entityId: 'route', revision: 1, components: [{ ownerId: 'example.scene-v2-diagram', componentId: 'route',
        version: 1, definitionAvailable: true, data: { points: data.points, color: 0x52c7e8 } }] };
    const before = structuredClone({ data, route });
    const plans = [{ schemaVersion: 1 as const, root: { id: 'root', kind: 'group' as const, children: renderFoxholeSceneV2Connector(data) } }, renderDiagramRoute(route)];
    for (const plan of plans) {
        const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => PIXI.Texture.EMPTY });
        try {
            const composed = composeNixieSceneV2RenderPlans(null, plan)!;
            const root = await host.replace(composed);
            const annotations = host.getRenderAnnotations();
            assert.equal(annotations.selectionOnly.length, 1);
            assert.equal(annotations.boundsExcluded.length, 1);
            const guide = annotations.selectionOnly[0]!;
            assert.equal(guide.renderable, false);
            assert.equal(guide.eventMode, 'none');
            const bounds = getNixieSceneV2PresentationLocalBounds(root, annotations.boundsExcluded);
            const baseline = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY];
            guide.renderable = true;
            const selected = getNixieSceneV2PresentationLocalBounds(root, annotations.boundsExcluded);
            assert.deepEqual([selected.minX, selected.minY, selected.maxX, selected.maxY], baseline);
            assert.ok(renderPlanHasPersistentContent(plan));
            await assert.rejects(host.replace({ schemaVersion: 2 } as never));
            assert.equal(host.getRenderAnnotations().selectionOnly[0], guide);
            await host.replace({ schemaVersion: 1, root: { id: 'empty', kind: 'group', children: [] } });
            assert.equal(guide.destroyed, true);
            assert.equal(host.getRenderAnnotations().selectionOnly.length, 0);
        } finally {
            host.destroy();
        }
    }
    assert.deepEqual({ data, route }, before);
});

test('annotated root groups retain their meaning through composition and subtree content checks', async () => {
    const plan = { schemaVersion: 1 as const, root: { id: 'root', kind: 'group' as const,
        experimentalPresentation: { contractVersion: 1 as const, selectionOnly: true }, children: [{
            id: 'point', kind: 'graphics' as const, commands: [{ op: 'circle' as const, x: 0, y: 0, radius: 7 }, { op: 'fill' as const, color: 0xffffff }],
        }] } };
    assert.equal(renderPlanHasPersistentContent(plan), false);
    const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => PIXI.Texture.EMPTY });
    try {
        await host.replace(composeNixieSceneV2RenderPlans(null, plan)!);
        assert.equal(host.getRenderAnnotations().selectionOnly.length, 1);
        assert.equal(host.getRenderAnnotations().selectionOnly[0]!.renderable, false);
    } finally {
        host.destroy();
    }
});
