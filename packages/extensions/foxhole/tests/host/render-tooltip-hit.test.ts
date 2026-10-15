import assert from 'node:assert/strict';
import test from 'node:test';
import * as PIXI from 'pixi.js';
import { NixieExtensionRenderPlanHost } from '../../../../nixie/app/plugins/nixie/scene-v2/render-plan-host.ts';
import { NixieSceneV2DocumentOverlayHost } from '../../../../nixie/app/plugins/nixie/scene-v2/document-overlay-host.ts';
import { pickNixieSceneV2Tooltip } from '../../../../nixie/app/plugins/nixie/scene-v2/tooltip-hit.ts';
import { renderFoxholePlanningMapIcons } from '../../../../../extensions/foxhole-planner/src/scene-v2-map-icons.ts';
import maps from '../../../../../extensions/foxhole-planner/src/scene-v2-map-data-node.ts';
import { renderDiagramNode } from '../../../../../extensions/scene-v2-diagram/src/scene-v2.ts';

test('materialized Map and Diagram hover targets preserve content/bounds, respect transforms and reject hidden/stale/clipped content', async () => {
    const texture = new PIXI.Texture({ source: new PIXI.TextureSource({ width: 40, height: 40 }) });
    const region = maps.regions.find(value => value.key === 'DeadLandsHex')!;
    const markers = renderFoxholePlanningMapIcons(maps, [region], {}, 25);
    const node = renderDiagramNode({ entityId: 'diagram', revision: 1, components: [{ ownerId: 'example.scene-v2-diagram', componentId: 'node', version: 1,
        definitionAvailable: true, data: { label: 'Process', kind: 'process', color: 0x00ccff, dependencies: [] } }] });
    for (const [ownerId, plan] of [['nixie.foxhole-planner', { schemaVersion: 1 as const, root: { id: 'root', kind: 'group' as const, children: markers } }],
        ['example.scene-v2-diagram', node]] as const) {
        const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => texture,
            loadAnimatedImage: async () => {
                throw new Error('Unused neutral decoration.');
            } });
        // Restrict this hit test to the actual neutral body, independent of its animated decoration.
        const bodyPlan = ownerId === 'example.scene-v2-diagram' ? { ...plan, root: { ...plan.root, children: plan.root.children.filter(child => child.id === 'body') } } : plan;
        const before = structuredClone(bodyPlan);
        const root = await host.replace(bodyPlan);
        root.position.set(100, 80);
        root.scale.set(0.5);
        root.rotation = Math.PI / 4;
        const target = host.getRenderAnnotations().tooltips[0]!;
        const candidate = { ownerId, generationHash: 'one', ...target };
        const point = target.target.toGlobal(new PIXI.Point(0, 0));
        assert.equal(pickNixieSceneV2Tooltip([candidate], point)?.data.title, target.data.title);
        assert.deepEqual(bodyPlan, before);
        target.target.visible = false;
        assert.equal(pickNixieSceneV2Tooltip([candidate], point), null);
        target.target.visible = true;
        root.renderable = false;
        assert.equal(pickNixieSceneV2Tooltip([candidate], point), null);
        root.renderable = true;
        const outsideClip = { ...candidate, clip: { target: root, bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 } } };
        assert.equal(pickNixieSceneV2Tooltip([outsideClip], target.target.toGlobal(new PIXI.Point(5, 5))), null);
        host.destroy();
        assert.equal(pickNixieSceneV2Tooltip([candidate], point), null);
    }
    texture.destroy(true);
});
test('document tooltip references follow only accepted replacements and retire on disable', async () => {
    const host = new NixieSceneV2DocumentOverlayHost({ acquireResources: () => () => {}, releaseUnusedResources: () => {},
        rendererOptions: () => ({ loadTexture: async () => PIXI.Texture.EMPTY }) });
    const result = { contractVersion: 1 as const, plan: { schemaVersion: 1 as const, root: { id: 'root', kind: 'group' as const,
        children: [{ id: 'body', kind: 'graphics' as const, experimentalPresentation: { contractVersion: 1 as const, tooltip: { contractVersion: 1 as const, title: 'Well' } },
            commands: [{ op: 'circle' as const, x: 0, y: 0, radius: 20 }, { op: 'fill' as const, color: 0xffffff }] }] } },
    clip: { minX: -10, minY: -10, maxX: 10, maxY: 10 } };
    await host.replace('one', async () => result);
    const original = host.tooltips[0]!.target;
    await assert.rejects(host.replace('bad', async () => ({ ...result, clip: { ...result.clip, maxX: -30 } })));
    assert.equal(host.tooltips[0]!.target, original);
    assert.deepEqual(host.clipBounds, result.clip);
    await host.replace('empty', async () => ({ contractVersion: 1, plan: { schemaVersion: 1, root: { id: 'root', kind: 'group', children: [] } } }));
    assert.equal(original.destroyed, true);
    assert.equal(host.tooltips.length, 0);
    assert.equal(host.clipBounds, null);
    host.destroy();
});
