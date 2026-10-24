import assets from '../../../../../extensions/foxhole-planner/src/scene-v2-assets-node.ts';
import { createFoxholeSceneV2SplineProductData } from '../../../../../extensions/foxhole-planner/src/scene-v2-connector-products.ts';
import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import * as PIXI from 'pixi.js';
import type { NixieExperimentalComponentEntitySnapshotV1, NixieExtensionRenderPlanV1 } from '@nixie/extension-sdk';
import {
    registerNixieSceneV2RenderPresentationAdapter,
    prepareNixieSceneV2RenderPresentation,
    applyNixieSceneV2RenderPresentation,
    getNixieSceneV2RenderPresentationSettingIds,
    getNixieSceneV2PresentationLocalBounds,
} from '../../../../nixie/app/plugins/nixie/scene-v2/render-presentation.ts';
import { composeNixieSceneV2RenderPlans, resolveComposedNixieSceneV2RenderNodeLabel } from '../../../../nixie/desktop-extensions/scene-v2-render-plan-composition.ts';
import { NixieExtensionRenderPlanHost } from '../../../../nixie/app/plugins/nixie/scene-v2/render-plan-host.ts';
import { NixieSceneV2RenderLanes } from '../../../../nixie/app/plugins/nixie/scene-v2/render-lanes.ts';
import { DEFAULT_FOXHOLE_RANGE_STATE } from '../../app/plugins/foxhole/nixie/range.ts';
import { renderFoxholeSceneV2Range, resolveFoxholeRangeSelectionGeometry } from '../../../../../extensions/foxhole-planner/src/scene-v2-ranges.ts';
import { renderFoxholeSceneV2Entity } from '../../../../../extensions/foxhole-planner/src/scene-v2-renderers.ts';
import { renderFoxholeSceneV2TacticalLine } from '../../../../../extensions/foxhole-planner/src/scene-v2-tactical-lines.ts';
import { DEFAULT_FOXHOLE_TACTICAL_LINE_STATE } from '../../app/plugins/foxhole/nixie/tactical-line.ts';

const hook = registerHooks({ resolve(specifier, context, next) {
    const root = specifier.startsWith('#nixie/')
        ? '../../../../nixie/app/'
        : specifier.startsWith('#foxhole/') ? '../../app/' : null;
    if (root) {
        return { url: hostSourceUrl(root + specifier.slice(specifier.indexOf('/') + 1), import.meta.url).href, shortCircuit: true };
    }
    return next(specifier, context);
} });
const { prepareFoxholeSceneV2RenderPresentation } = await import('../../app/plugins/foxhole/nixie/scene-v2-render-presentation.ts');
const { getFoxholeManifest } = await import('../../app/plugins/foxhole/nixie/manifest.ts');
hook.deregister();

test('presentation annotations stay visible without enlarging authored bounds', () => {
    const root = new PIXI.Container();
    const body = new PIXI.Graphics().rect(-30, -12, 72, 24).fill(0xFFFFFF);
    const annotation = new PIXI.Graphics().rect(100, 200, 20, 30).fill(0xFFFFFF);
    root.addChild(body, annotation);
    assert.equal(root.getLocalBounds().maxY, 230);
    const bounds = getNixieSceneV2PresentationLocalBounds(root, [annotation]);
    assert.deepEqual([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY], [-30, -12, 42, 12]);
    assert.equal(annotation.visible, true);
    annotation.visible = false;
    getNixieSceneV2PresentationLocalBounds(root, [annotation]);
    assert.equal(annotation.visible, false);
    root.destroy({ children: true });
});

test('older structure range plans retain Native fallback drawing and visibility', async () => {
    const entity: NixieExperimentalComponentEntitySnapshotV1 = { entityId: 'artillery', revision: 0, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: 'artilleryait1' } },
        { ownerId: 'nixie.core', componentId: 'transform', version: 1, definitionAvailable: true, data: { rotation: 0.4 } },
    ] };
    const plan = renderFoxholeSceneV2Entity(entity, { contractVersion: 1, entities: [entity] });
    // Plans from older extension generations lack the spatial overlay declaration.
    for (const node of plan.root.children) {
        if (node.experimentalPresentation) delete node.experimentalPresentation.groundOverlay;
    }
    assert.ok(plan.root.children.some(node => node.id === 'selected-structure-ranges'));
    const original = structuredClone({ entity, plan });
    for (const enabled of [false, true]) {
        const presentation = prepareFoxholeSceneV2RenderPresentation(entity, plan, 1,
            { 'foxhole.ranges.selectionOnly': true, 'foxhole.ranges.artillery': enabled, 'nixie.debug.overlay': true })!;
        assert.equal(presentation.selectionOnlyNodeId, 'native-selected-structure-ranges');
        assert.deepEqual(presentation.boundsExcludedNodeIds, ['native-structure-ranges', 'native-selected-structure-ranges']);
        assert.equal(presentation.plan.root.children.some(node => node.id === 'structure-ranges' || node.id === 'selected-structure-ranges'), false, 'Native replacement cannot duplicate portable ranges');
        const nodes = new Map(presentation.plan.root.children.map(node => [node.id, new PIXI.Container()]));
        await presentation.apply(id => nodes.get(id) ?? null);
        const always = nodes.get('native-structure-ranges')!;
        const selected = nodes.get('native-selected-structure-ranges')!;
        assert.equal(always.children.length > 0, enabled);
        assert.equal(selected.children.length > 0, !enabled);
        const range = (enabled ? always : selected).children[0]!;
        assert.equal(range.eventMode, 'none');
        assert.equal(range.children.length, 3);
        const label = range.children[2] as PIXI.Text;
        assert.equal(label.visible, true);
        assert.equal(label.rotation, -0.4);
        assert.equal(label.style.fontFamily, 'monospace');
        for (const node of nodes.values()) {
            node.destroy({ children: true });
        }
        assert.equal(range.destroyed, true);
    }
    assert.equal(prepareFoxholeSceneV2RenderPresentation(entity, plan, 1, { 'foxhole.ranges.selectionOnly': false }), null);
    assert.deepEqual({ entity, plan }, original);
});

test('private presentation is owner-qualified, resolves extension nodes and awaits its drawing', async () => {
    const entity: NixieExperimentalComponentEntitySnapshotV1 = { entityId: 'shape', revision: 4, components: [] };
    const plan: NixieExtensionRenderPlanV1 = { schemaVersion: 1, root: { id: 'root', kind: 'group', children: [{ id: 'label', kind: 'group', children: [] }] } };
    let release!: () => void;
    const ready = new Promise<void>(resolve => {
        release = resolve;
    });
    let applied = false;
    const settings = { 'presentation-test.overlay': true };
    registerNixieSceneV2RenderPresentationAdapter('presentation-test.owner', (subject, source, scale, capturedSettings) => {
        assert.equal(subject, entity);
        assert.equal(source, plan);
        assert.equal(scale, 2);
        assert.deepEqual(capturedSettings, settings);
        return { plan: source, async apply(resolveNode) {
            await ready;
            assert.equal(resolveNode('missing'), null);
            const layer = resolveNode('label')!;
            assert.equal(layer.label, 'extension.1');
            layer.addChild(new PIXI.Graphics().rect(0, 0, 12, 8).fill(0xFFFFFF));
            applied = true;
        } };
    }, ['presentation-test.overlay', 'presentation-test.overlay']);
    assert.deepEqual(getNixieSceneV2RenderPresentationSettingIds('unrelated.owner'), []);
    assert.deepEqual(getNixieSceneV2RenderPresentationSettingIds('presentation-test.owner'), ['presentation-test.overlay']);
    assert.equal(prepareNixieSceneV2RenderPresentation('unrelated.owner', entity, plan, 2), null);
    const presentation = prepareNixieSceneV2RenderPresentation('presentation-test.owner', entity, plan, 2, settings)!;
    const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => PIXI.Texture.EMPTY });
    const root = await host.replace(composeNixieSceneV2RenderPlans(plan, presentation.plan)!);
    const completion = applyNixieSceneV2RenderPresentation(presentation, root);
    assert.equal(applied, false);
    release();
    await completion;
    assert.equal(applied, true);
    assert.equal(root.getChildByLabel('core.1', true)!.children.length, 0);
    const graphic = root.getChildByLabel('extension.1', true)!.children[0]!;
    host.destroy();
    assert.equal(graphic.destroyed, true, 'native drawing remains owned by the retained render tree');
});

test('spline presentation owns Native selection guides and refreshes their colors without rewriting geometry', async () => {
    const entity: NixieExperimentalComponentEntitySnapshotV1 = { entityId: 'wall', revision: 2, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'spline-connector', version: 1, definitionAvailable: true,
            data: { foxholeKey: 'wallsplinet1', startX: -224, startY: -192, startRotation: 0,
                endX: -64, endY: -192, endRotation: 0, minLength: 96, maxLength: 320, minRadius: 1, maxRadius: 1, maxBuffer: 0.32, curveT: 0 } },
    ] };
    const plan: NixieExtensionRenderPlanV1 = { schemaVersion: 1, root: { id: 'wall-root', kind: 'group', children: [] } };
    const original = structuredClone({ entity, plan });
    let colors = { stem: 0x8BE9FF, handle: 0xD8F7FF };
    const presentation = prepareFoxholeSceneV2RenderPresentation(entity, plan, 1, {}, () => colors)!;
    assert.equal(presentation.selectionOnlyNodeId, 'native-spline-guides');
    const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => PIXI.Texture.EMPTY });
    const root = await host.replace(composeNixieSceneV2RenderPlans(null, presentation.plan)!);
    await applyNixieSceneV2RenderPresentation(presentation, root);
    const layer = root.getChildByLabel('extension.1', true)!;
    assert.equal(layer.children.length, 2);
    const [path, handles] = layer.children as PIXI.Graphics[];
    assert.equal(path!.context.instructions[0]!.data.style.color, colors.stem);
    assert.equal(handles!.context.instructions.length, 2, 'Wall exposes only its two endpoints');
    colors = { stem: 0xFF1122, handle: 0x2244FF };
    presentation.refresh!();
    assert.equal(path!.context.instructions[0]!.data.style.color, colors.stem);
    assert.equal(handles!.context.instructions[0]!.data.style.color, colors.handle);
    assert.deepEqual({ entity, plan }, original);
    host.destroy();
    assert.equal(path!.destroyed && handles!.destroyed, true);
    assert.doesNotThrow(() => presentation.refresh!());
});

test('connected pipeline retains free side indicators and all-socket occupancy without altering authored geometry', async context => {
    context.mock.method(PIXI.CanvasTextMetrics, 'measureText', () => ({ width: 80, height: 16 }));
    const entity: NixieExperimentalComponentEntitySnapshotV1 = { entityId: 'pipe', revision: 3, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'spline-connector', version: 1, definitionAvailable: true,
            data: { foxholeKey: 'facilitypipe', startX: 0, startY: 0, startRotation: -Math.PI / 2,
                endX: 0, endY: -200.08, endRotation: Math.PI / 2, startSocketName: 'BackSocket', endSocketName: 'FrontSocket',
                startAttachmentNodeId: 'source', startAttachmentSocketName: 'PipeInput0',
                endAttachmentNodeId: 'sink', endAttachmentSocketName: 'PipeInput0', minLength: 96, maxLength: 640 } },
        { ownerId: 'nixie.core', componentId: 'transform', version: 1, definitionAvailable: true, data: { rotation: 0.4 } },
    ] };
    const plan: NixieExtensionRenderPlanV1 = { schemaVersion: 1, root: { id: 'pipe-root', kind: 'group', children: [] } };
    const original = structuredClone({ entity, plan });
    for (const all of [false, true]) {
        const presentation = prepareFoxholeSceneV2RenderPresentation(entity, plan, 1,
            { 'foxhole.debug.structure.allSockets': all, 'foxhole.debug.structure.pipeSockets': true, 'foxhole.debug.structure.socketLabels': true })!;
        assert.deepEqual(presentation.boundsExcludedNodeIds, ['native-spline-sockets']);
        const nodes = new Map(presentation.plan.root.children.map(node => [node.id, new PIXI.Container()]));
        await presentation.apply(id => nodes.get(id) ?? null);
        const sockets = nodes.get('native-spline-sockets')!;
        assert.equal(sockets.children.length, all ? 4 : 2);
        if (all) {
            assert.deepEqual(sockets.children.map(child => (child.children[0] as PIXI.Graphics).context.instructions[0]!.data.style.color),
                [0x53D769, 0x53D769, 0xFF4D4D, 0xFF4D4D]);
        } else {
            assert.ok(sockets.children.every(child => child.children.some(descendant => descendant instanceof PIXI.Text)));
        }
        for (const node of nodes.values()) {
            node.destroy({ children: true });
        }
        assert.equal(sockets.destroyed, true);
    }
    assert.deepEqual({ entity, plan }, original);
});

test('range presentation replaces SDK measured labels with V1 drawing without dangling measurement references or changing ECS data', async context => {
    // This tests the presentation boundary without rasterization; browser proof
    // uses actual font measurement and compares settled native/V2 pixels.
    context.mock.method(PIXI.CanvasTextMetrics, 'measureText', () => ({ width: 45.8919677734375, height: 24 }));
    const range = { ...DEFAULT_FOXHOLE_RANGE_STATE, points: [0, 0, 60, 0], rotation: 0.25 };
    const entity: NixieExperimentalComponentEntitySnapshotV1 = { entityId: 'range', revision: 7, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'range', version: 1, definitionAvailable: true, data: { ...range } },
        { ownerId: 'nixie.core', componentId: 'transform', version: 1, definitionAvailable: true,
            data: { x: 140, y: 150, rotation: 0.25, scaleX: 1, scaleY: 1 } },
    ] };
    const plan: NixieExtensionRenderPlanV1 = { schemaVersion: 1,
        experimentalSelectionGeometry: resolveFoxholeRangeSelectionGeometry(range),
        root: { id: 'root', kind: 'group', children: renderFoxholeSceneV2Range(range, 0.25, 1.046810281974576) } };
    const original = structuredClone({ entity, plan });
    for (const altered of [
        { ...entity, components: entity.components.map(component => ({ ...component, ownerId: 'unrelated.owner' })) },
        { ...entity, components: entity.components.map(component => ({ ...component, version: 2 })) },
        { ...entity, components: entity.components.map(component => ({ ...component, definitionAvailable: false })) },
    ]) {
        assert.equal(prepareFoxholeSceneV2RenderPresentation(altered, plan, 1, {}), null);
    }
    const presentation = prepareFoxholeSceneV2RenderPresentation(entity, plan, 1.046810281974576, {})!;
    assert.deepEqual(presentation.plan.experimentalSelectionGeometry, {
        ...plan.experimentalSelectionGeometry, measuredTextBounds: [],
    });
    const bodyPlan = presentation.plan.root.children[0]!;
    assert.deepEqual(bodyPlan.kind === 'graphics' && bodyPlan.commands, [], 'portable geometry is replaced by Native drawing');
    const layerPlan = presentation.plan.root.children[1]!;
    assert.equal(layerPlan.kind, 'group');
    assert.deepEqual(layerPlan.kind === 'group' && layerPlan.children, [], 'estimated text/background are not materialized');
    const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => PIXI.Texture.EMPTY });
    const root = await host.replace(composeNixieSceneV2RenderPlans(null, presentation.plan)!);
    await applyNixieSceneV2RenderPresentation(presentation, root);
    const layer = root.getChildByLabel('extension.2', true)!;
    const label = layer.children[0]!;
    const text = label.children[1] as PIXI.Text;
    assert.equal(layer.rotation, -0.25);
    assert.equal(text.text, '1.9m');
    assert.equal(text.width, 45.8919677734375);
    assert.equal(text.height, 24);
    assert.equal(text.resolution, null, 'retain native automatic resolution instead of imposing the general board-text resolution');
    assert.equal(label.scale.x, 1.036413207352225);
    assert.equal(label.children[0]!.getLocalBounds().width, 59.8919677734375);
    presentation.refresh!(0.5);
    assert.equal(label.destroyed, true, 'scale changes retire the old measured label');
    const replacement = layer.children[0]!;
    assert.equal(replacement.scale.x, 0.5);
    presentation.refresh!();
    assert.equal(layer.children[0], replacement, 'color refresh preserves the current full-world scale and measured label');
    assert.deepEqual({ entity, plan }, original);
    const world = new PIXI.Container();
    const lanes = new NixieSceneV2RenderLanes();
    world.addChild(root);
    lanes.sync(world, [entity], new Map([[entity.entityId, { entityId: entity.entityId, renderHost: host }]]));
    const body = root.children[0]!;
    assert.equal(body.parentRenderLayer === replacement.children[1]!.parentRenderLayer, true, 'the center marker must stay behind the label as in V1');
    assert.deepEqual(body.parentRenderLayer!.renderLayerChildren.map(child => child.constructor.name), ['Graphics', 'Graphics', 'Text']);
    lanes.destroy();
    host.destroy();
    world.destroy({ children: true });
    assert.equal(text.destroyed, true);
});

test('tactical presentation retains Native cap order and full-world scaling without materializing duplicate decorations', async () => {
    const data = { ...DEFAULT_FOXHOLE_TACTICAL_LINE_STATE, points: [0, 0, 192, 0], curveMode: 'polyline' as const,
        decoratorMode: 'none' as const, startCap: 'none' as const, endCap: 'arrow' as const, strokeWidth: 3 };
    const entity: NixieExperimentalComponentEntitySnapshotV1 = { entityId: 'tactical', revision: 0, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'tactical-line', version: 1, definitionAvailable: true, data: { ...data } },
    ] };
    const plan: NixieExtensionRenderPlanV1 = { schemaVersion: 1,
        root: { id: 'root', kind: 'group', children: renderFoxholeSceneV2TacticalLine(data, 0, 1) } };
    const original = structuredClone({ entity, plan });
    const presentation = prepareFoxholeSceneV2RenderPresentation(entity, plan, 1, {})!;
    assert.deepEqual(presentation.plan.root.children.map(node => node.id), ['tactical-line-stroke']);
    const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => PIXI.Texture.EMPTY });
    const root = await host.replace(composeNixieSceneV2RenderPlans(null, presentation.plan)!);
    await applyNixieSceneV2RenderPresentation(presentation, root);
    const graphic = root.children[0] as PIXI.Graphics;
    assert.equal(graphic.context.instructions[0]!.data.style.width, 3);
    assert.deepEqual(graphic.context.instructions.map(instruction => instruction.action), ['stroke', 'fill', 'stroke']);
    presentation.refresh!(0.5);
    assert.equal(graphic.context.instructions[0]!.data.style.width, 1.5);
    presentation.refresh!();
    assert.equal(graphic.context.instructions[0]!.data.style.width, 1.5);
    assert.deepEqual({ entity, plan }, original);
    host.destroy();
    assert.equal(graphic.destroyed, true);
    assert.doesNotThrow(() => presentation.refresh!(2));
});

test('structure all-socket labels retain Native names, occupancy and upright rotation', async context => {
    context.mock.method(PIXI.CanvasTextMetrics, 'measureText', () => ({ width: 90, height: 16 }));
    const structure = getFoxholeManifest('/foxhole/assets/').assets.find(asset => asset.id === 'facilitypowerdiesel')!;
    const entity: NixieExperimentalComponentEntitySnapshotV1 = { entityId: 'diesel', revision: 2, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: structure.id } },
        { ownerId: 'nixie.core', componentId: 'transform', version: 1, definitionAvailable: true, data: { rotation: Math.PI } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments', version: 1, definitionAvailable: true,
            data: { attachments: [{ localSocketName: 'PipeInput0', targetEntityId: 'pipe', targetSocketName: 'FrontSocket' }] } },
    ] };
    const plan: NixieExtensionRenderPlanV1 = { schemaVersion: 1, root: { id: 'root', kind: 'group', children: [] } };
    const original = structuredClone({ entity, plan });
    const presentation = prepareFoxholeSceneV2RenderPresentation(entity, plan, 1,
        { 'foxhole.debug.structure.allSockets': true, 'foxhole.debug.structure.socketLabels': true })!;
    assert.ok(presentation);
    const nodes = new Map(presentation.plan.root.children.map(node => [node.id, new PIXI.Container()]));
    await presentation.apply(id => nodes.get(id) ?? null);
    const layer = nodes.get('native-socket-indicators')!;
    assert.equal(layer.children.length, 2);
    const labels = layer.children.flatMap(visual => visual.children.flatMap(child => child.children)).filter(child => child instanceof PIXI.Text) as PIXI.Text[];
    assert.deepEqual(labels.map(label => label.text).sort(), ['0 — PipeInput0', '1 — PowerSocket']);
    assert.ok(labels.every(label => label.rotation === -Math.PI));
    assert.equal(labels.find(label => label.text.includes('PipeInput0'))!.style.fill, 0x53D769);
    assert.equal(labels.find(label => label.text.includes('PowerSocket'))!.style.fill, 0xFF4D4D);
    for (const node of nodes.values()) {
        node.destroy({ children: true });
    }
    assert.deepEqual({ entity, plan }, original);
});

test('structure presentation retains native socket placement, occupancy, settings and resource ownership', async context => {
    // SVG rasterization is browser-verified; this isolates lifetime and layout.
    context.mock.method(PIXI.Graphics.prototype, 'svg', function(this: PIXI.Graphics) {
        return this;
    });
    const structure = getFoxholeManifest('/foxhole/assets/').assets.find(asset => asset.id === 'facilitypowerdiesel')!;
    const entity: NixieExperimentalComponentEntitySnapshotV1 = { entityId: 'diesel', revision: 5, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: structure.id } },
        { ownerId: 'nixie.core', componentId: 'transform', version: 1, definitionAvailable: true,
            data: { x: 0, y: 0, rotation: 0.4, scaleX: 1, scaleY: 1 } },
    ] };
    const settings = { 'foxhole.debug.structure.powerSockets': true, 'foxhole.debug.structure.pipeSockets': true };
    const plan = renderFoxholeSceneV2Entity(entity, { contractVersion: 1, entities: [entity], settings });
    assert.ok(plan.root.children.some(node => node.id === 'structure-socket-presentation'));
    assert.equal(prepareFoxholeSceneV2RenderPresentation(entity, plan, 1, settings), null, 'SDK socket output remains authoritative');
    // Old generations did not declare SDK socket presentation.
    plan.root.children = plan.root.children.filter(node => node.id !== 'structure-socket-presentation');
    const original = structuredClone({ entity, plan });
    const presentation = prepareFoxholeSceneV2RenderPresentation(entity, plan, 1, settings)!;
    assert.ok(presentation);
    assert.deepEqual(presentation.boundsExcludedNodeIds, ['native-socket-indicators']);
    assert.equal(presentation.plan.root.children.some(node => node.id === 'structure-socket-presentation'), false, 'the bundled replacement cannot duplicate SDK socket indicators');
    const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => PIXI.Texture.EMPTY });
    const root = await host.replace(composeNixieSceneV2RenderPlans(null, presentation.plan)!);
    await applyNixieSceneV2RenderPresentation(presentation, root);
    const layer = root.getChildByLabel(resolveComposedNixieSceneV2RenderNodeLabel(presentation.plan, 'extension', 'native-socket-indicators')!, true)!;
    assert.equal(layer.children.length, 2);
    for (const socket of structure.buildSockets) {
        const visual = layer.children.find(child => child.x === Number(socket.x ?? 0) * 0.32 && child.y === Number(socket.y ?? 0) * 0.32);
        if (visual) {
            assert.equal(visual.rotation, Number(socket.rotation ?? 0) * Math.PI / 180);
            assert.equal(visual.eventMode, 'none');
        }
    }
    const power = layer.children.find(child => child.children.length === 2)!;
    assert.equal(power.children[1]!.rotation, -(power.rotation + 0.4));
    const occupied = { ...entity, components: [...entity.components, {
        ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments', version: 1, definitionAvailable: true,
        data: { attachments: structure.buildSockets.map(socket => ({ localSocketName: socket.name, targetEntityId: 'neighbor', targetSocketName: 'input' })) },
    }] };
    assert.equal(prepareFoxholeSceneV2RenderPresentation(occupied, plan, 1, settings), null);
    assert.equal(prepareFoxholeSceneV2RenderPresentation(entity, plan, 1, {}), null);
    for (const appearance of [{ destroyed: true }, { packaged: true }]) {
        assert.equal(prepareFoxholeSceneV2RenderPresentation({ ...entity, components: [...entity.components,
            { ownerId: 'nixie.foxhole-planner', componentId: 'appearance', version: 1, definitionAvailable: true, data: appearance },
        ] }, plan, 1, settings), null);
    }
    assert.deepEqual({ entity, plan }, original);
    const children = [...layer.children];
    host.destroy();
    assert.equal(children.every(child => child.destroyed), true);
});

test('SDK ground range groups survive the Native compatibility adapter', () => {
    const entity: NixieExperimentalComponentEntitySnapshotV1 = { entityId: 'garrison', revision: 0, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: 'mgait2' } },
    ] };
    for (const enabled of [false, true]) {
        const settings = { 'foxhole.ranges.selectionOnly': true, 'foxhole.ranges.machineGun': enabled };
        const plan = renderFoxholeSceneV2Entity(entity, { contractVersion: 1, entities: [entity], settings });
        const original = JSON.stringify(plan);
        assert.ok(plan.root.children.some(node => node.experimentalPresentation?.groundOverlay));
        const presentation = prepareFoxholeSceneV2RenderPresentation(entity, plan, 1, settings);
        assert.equal(presentation === null, true, 'the host must render the portable ranges without a private replacement');
        assert.equal(JSON.stringify(plan), original);
    }
});

test('SDK structure sockets and connector guides survive private compatibility without replacement or duplicate drawing', () => {
    const ownerId = 'nixie.foxhole-planner';
    for (const all of [false, true]) for (const key of ['facilitypowerdiesel', 'facilitypipe', 'facilitypipeunderground', 'powerline', 'railtrackspline', 'waterwallsplinet1']) {
        const data = key === 'facilitypowerdiesel' ? { catalogId: 'foxhole.structures', assetId: key }
            : createFoxholeSceneV2SplineProductData(key, assets[key]!.connector!);
        const entity: NixieExperimentalComponentEntitySnapshotV1 = { entityId: key, revision: 0, components: [
            { ownerId, componentId: key === 'facilitypowerdiesel' ? 'asset' : 'spline-connector', version: 1, definitionAvailable: true, data },
        ] };
        const settings = { 'foxhole.debug.structure.allSockets': all, 'foxhole.debug.structure.powerSockets': all,
            'foxhole.debug.structure.pipeSockets': all, 'foxhole.debug.structure.socketLabels': all };
        const plan = renderFoxholeSceneV2Entity(entity, { contractVersion: 1, entities: [entity], settings });
        const before = structuredClone({ entity, plan });
        assert.equal(prepareFoxholeSceneV2RenderPresentation(entity, plan, 1, settings), null, key + '/' + all);
        assert.deepEqual({ entity, plan }, before);
        const overlayId = key === 'facilitypowerdiesel' ? 'structure-socket-presentation' : 'spline-connector-socket-presentation';
        const overlay = plan.root.children.find(node => node.id === overlayId);
        assert.ok(overlay?.kind === 'group');
        if (!all) assert.equal(overlay.children.length, 0, 'empty SDK declarations prevent fallback from resurrecting hidden indicators');
        if (key !== 'facilitypowerdiesel') {
            const old = { ...plan, root: { ...plan.root, children: plan.root.children.map(node => node.id === overlayId
                ? { ...node, id: 'spline-connector-socket-overlays' } : node) } };
            assert.ok(prepareFoxholeSceneV2RenderPresentation(entity, old, 1, settings), 'older partial SDK overlays retain native All Sockets diagnostics');
        }
    }
});
