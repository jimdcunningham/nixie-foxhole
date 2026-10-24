import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveTestGlobal } from '../../../../nixie/tests/nixie/preserve-test-global.ts';
import * as PIXI from 'pixi.js';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk';
import { NixieSceneV2RenderLanes } from '../../../../nixie/app/plugins/nixie/scene-v2/render-lanes.ts';
import { NixieExtensionRenderPlanHost } from '../../../../nixie/app/plugins/nixie/scene-v2/render-plan-host.ts';
import { renderDiagramNode } from '../../../../../extensions/scene-v2-diagram/src/scene-v2.ts';
import { renderFoxholeSceneV2TacticalLine } from '../../../../../extensions/foxhole-planner/src/scene-v2-tactical-lines.ts';
import { DEFAULT_FOXHOLE_TACTICAL_LINE_STATE } from '../../app/plugins/foxhole/nixie/tactical-line.ts';

test('shared lanes preserve logical parents and sort bodies before labels across unrelated entities', async () => {
    const world = new PIXI.Container();
    const lanes = new NixieSceneV2RenderLanes();
    const entities: NixieExperimentalComponentEntitySnapshotV1[] = ['first', 'second'].map(entityId => ({ entityId, revision: 1, components: [] }));
    const visuals = new Map();
    for (const entity of entities) {
        const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => PIXI.Texture.EMPTY });
        const root = await host.replace({ schemaVersion: 1, root: { id: 'root', kind: 'group', children: [
            { id: 'body', kind: 'sprite', laneId: 'body', laneOrder: 0, resourceId: 'body' },
            { id: 'label', kind: 'sprite', laneId: 'label', laneOrder: 10, resourceId: 'label' },
        ] } });
        world.addChild(root);
        visuals.set(entity.entityId, { entityId: entity.entityId, renderHost: host });
    }
    lanes.sync(world, entities, visuals);
    const first = visuals.get('first').renderHost.root!;
    const second = visuals.get('second').renderHost.root!;
    assert.equal(first.children[0]!.parent, first);
    assert.equal(first.children[0]!.parentRenderLayer, second.children[0]!.parentRenderLayer);
    assert.equal(first.children[1]!.parentRenderLayer, second.children[1]!.parentRenderLayer);
    assert.notEqual(first.children[0]!.parentRenderLayer, first.children[1]!.parentRenderLayer);
    assert.equal(first.children[0]!.parentRenderLayer!.parent!.getChildIndex(first.children[0]!.parentRenderLayer!), 0);
    assert.equal(first.children[1]!.parentRenderLayer!.parent!.getChildIndex(first.children[1]!.parentRenderLayer!), 1);
    lanes.destroy();
    assert.equal(first.children[0]!.parentRenderLayer, null);
    for (const visual of visuals.values()) {
        visual.renderHost.destroy();
    }
    world.destroy({ children: true });
});

test('the neutral diagram renderer declares ordered body and label lanes', () => {
    const plan = renderDiagramNode({ entityId: 'process', revision: 1, components: [{
        ownerId: 'example.scene-v2-diagram', componentId: 'node', version: 1, definitionAvailable: true,
        data: { kind: 'process', color: 0x123456, label: 'Process' },
    }] });
    assert.ok(plan.root.children.filter(node => node.laneId === 'body').every(node => node.laneOrder === 0));
    assert.equal(plan.root.children.find(node => node.laneId === 'label')?.laneOrder, 10);
});

test('core brush caches participate as a whole while extension overlays retain their lane', async testContext => {
    preserveTestGlobal(testContext, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ getContext: () => null }) } });
    const world = new PIXI.Container();
    const lanes = new NixieSceneV2RenderLanes();
    const entity = { entityId: 'brush', revision: 1, components: [] };
    const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => PIXI.Texture.EMPTY,
        cacheGraphicsTextureNodeIds: new Set(['core-brush']) });
    try {
        const root = await host.replace({ schemaVersion: 1, root: { id: 'root', kind: 'group', children: [
            { id: 'core-brush', kind: 'graphics', laneId: 'body', commands: [
                { op: 'rect', x: 0, y: 0, width: 20, height: 10 }, { op: 'fill', color: 0x123456 },
            ] },
            { id: 'extension-overlay', kind: 'sprite', laneId: 'label', laneOrder: 10, resourceId: 'label' },
        ] } });
        world.addChild(root);
        const cached = root.children[0]!;
        const brush = cached.children[0]!;
        const overlay = root.children[1]!;
        const visuals = new Map([[entity.entityId, { entityId: entity.entityId, renderHost: host }]]);
        lanes.sync(world, [entity], visuals);
        assert.equal(cached.parent, root);
        assert.equal(brush.parent, cached);
        assert.ok(cached.parentRenderLayer);
        assert.equal(brush.parentRenderLayer, null, 'a leaf render-layer attachment would bypass the parent cache');
        assert.deepEqual(cached.parentRenderLayer.renderLayerChildren, [cached]);
        assert.notEqual(cached.parentRenderLayer, overlay.parentRenderLayer);
        lanes.sync(world, [entity], visuals);
        assert.deepEqual(cached.parentRenderLayer.renderLayerChildren, [cached], 'resync does not flatten or duplicate a cache');
        lanes.destroy();
        assert.equal(cached.parentRenderLayer, null);
    } finally {
        lanes.destroy();
        host.destroy();
        world.destroy({ children: true });
    }
});

test('tactical line parts share V1 default lanes so fills cover strokes within each entity', async () => {
    const world = new PIXI.Container();
    const lanes = new NixieSceneV2RenderLanes();
    const entity = { entityId: 'tactical', revision: 1, components: [] };
    const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => PIXI.Texture.EMPTY });
    const root = await host.replace({ schemaVersion: 1, root: { id: 'root', kind: 'group',
        children: renderFoxholeSceneV2TacticalLine({ ...DEFAULT_FOXHOLE_TACTICAL_LINE_STATE, points: [0, 0, 80, -20, 180, 40] }) } });
    world.addChild(root);
    lanes.sync(world, [entity], new Map([[entity.entityId, { entityId: entity.entityId, renderHost: host }]]));
    const [stroke, decorators, caps] = root.children;
    assert.equal(stroke!.parentRenderLayer, decorators!.parentRenderLayer);
    assert.equal(stroke!.parentRenderLayer, caps!.parentRenderLayer);
    assert.deepEqual(stroke!.parentRenderLayer!.renderLayerChildren.map(target => target.label),
        ['tactical-line-stroke', 'tactical-line-decorators', 'tactical-line-caps']);
    lanes.destroy();
    host.destroy();
    world.destroy({ children: true });
});
