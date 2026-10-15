import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import * as PIXI from 'pixi.js';
import assets from '../../../../../extensions/foxhole-planner/src/scene-v2-assets-node.ts';
import { renderFoxholeConnectorGuides, sampleFoxholeConnectorGuide, allowsFoxholeConnectorGuideRotation } from '../../../../../extensions/foxhole-planner/src/scene-v2-connector-guides.ts';
import { resolveFoxholeConnectorDisplaySockets, renderFoxholeConnectorSocketOverlays } from '../../../../../extensions/foxhole-planner/src/scene-v2-connector-socket-overlays.ts';
import { NixieExtensionRenderPlanHost } from '../../../../nixie/app/plugins/nixie/scene-v2/render-plan-host.ts';
import { composeNixieSceneV2RenderPlans } from '../../../../nixie/desktop-extensions/scene-v2-render-plan-composition.ts';
import { renderDiagramRoute } from '../../../../../extensions/scene-v2-diagram/src/scene-v2.ts';

const hook = registerHooks({ resolve(specifier, context, next) {
    const root = specifier.startsWith('#nixie/') ? '../../../../nixie/app/' : specifier.startsWith('#foxhole/') ? '../../app/' : null;
    return root ? { url: hostSourceUrl(root + specifier.slice(specifier.indexOf('/') + 1), import.meta.url).href, shortCircuit: true } : next(specifier, context);
} });
const { normalizeFoxholeSplineConnectorState, resolveEffectiveConnectorPathStyle, allowsConnectorRotationHandles } = await import('../../app/plugins/foxhole/nixie/spline-connector.ts');
const { resolveFoxholeSplinePathConstraints, resolveFoxholeSplineGuidePath, drawFoxholeSplineEndpointGizmo } = await import('../../app/plugins/foxhole/nixie/spline-connector-guides.ts');
const { resolveFoxholeSplineConnectorSockets } = await import('../../app/plugins/foxhole/nixie/spline-connector-sockets.ts');
const { getFoxholeManifest } = await import('../../app/plugins/foxhole/nixie/manifest.ts');
hook.deregister();

test('portable connector guides preserve Native path samples and endpoint/rotation-gizmo policy', () => {
    let cases = 0;
    for (const key of ['powerline', 'wallsplinet1', 'facilitypipe', 'facilitypipeunderground', 'facilitypipeoverhead', 'railtrackspline', 'minespline', 'tankstopsplinet3', 'cranerailtrackspline']) {
        const asset = assets[key];
        assert.ok(asset, `Missing published fixture ${key}`);
        for (const curveT of [0, 0.5, 1]) {
            const data = { foxholeKey: key, startX: 12, startY: -20, startRotation: 0.3, endX: 220, endY: 50, endRotation: 2.6,
                minLength: 96, maxLength: 640, minRadius: 16, maxRadius: 96, maxBuffer: 96, curveT, blueprint: false, maxArcAngleDeg: asset.connector?.maxArcAngleDeg };
            const state = normalizeFoxholeSplineConnectorState({ ...data, start: { x: data.startX, y: data.startY, rotation: data.startRotation },
                end: { x: data.endX, y: data.endY, rotation: data.endRotation } });
            const style = resolveEffectiveConnectorPathStyle(asset.connector?.pathStyle, key);
            const constraints = resolveFoxholeSplinePathConstraints(state, style, asset.connector?.maxBufferCm ?? asset.connector?.minLengthCm ?? 0);
            const expected = resolveFoxholeSplineGuidePath(state, constraints, style);
            const actual = sampleFoxholeConnectorGuide(data, asset);
            assert.equal(actual.points.length, expected.points.length, `${key}/${curveT}/point count`);
            actual.points.forEach((point, index) => {
                assert.ok(Math.abs(point.x - expected.points[index]!.x) < 1e-7 && Math.abs(point.y - expected.points[index]!.y) < 1e-7, `${key}/${curveT}/${index}`);
            });
            const rotations = allowsConnectorRotationHandles(style, key, { maxArcAngleDeg: state.maxArcAngleDeg });
            assert.equal(allowsFoxholeConnectorGuideRotation(data, asset), rotations, key);
            const nodes = renderFoxholeConnectorGuides(data, asset);
            assert.deepEqual(nodes[0]?.experimentalPresentation, { contractVersion: 1, selectionOnly: true, excludeFromBounds: true });
            const group = nodes[0]!;
            assert.equal(group.kind, 'group');
            if (group.kind !== 'group') {
                throw new Error('Missing guide group.');
            }
            const handles = group.children[1]!;
            assert.equal(handles.kind, 'graphics');
            if (handles.kind !== 'graphics') {
                throw new Error('Missing guide handles.');
            }
            const native = new PIXI.Graphics();
            drawFoxholeSplineEndpointGizmo(native, state.start, 'start', key, rotations, 1, 0xD8F7FF);
            drawFoxholeSplineEndpointGizmo(native, state.end, 'end', key, rotations, 1, 0xD8F7FF);
            assert.equal(handles.commands.filter(command => command.op === 'circle').length, rotations ? 4 : 2);
            const nativeCircles = native.context.instructions.flatMap(instruction => instruction.data.path.shapePath.shapePrimitives)
                .map(primitive => primitive.shape as PIXI.Circle).map(circle => [circle.x, circle.y, circle.radius]);
            assert.deepEqual(handles.commands.filter(command => command.op === 'circle').map(command => [command.x, command.y, command.radius]), nativeCircles);
            native.destroy();
            cases++;
        }
    }
    assert.equal(cases, 27);
});

test('portable connector sockets retain Native endpoint/side placement, visual rotations, flow and occupied exclusions', () => {
    const nativeAssets = getFoxholeManifest('/foxhole/assets/').assets;
    for (const key of ['powerline', 'facilitypipe', 'facilitypipeunderground', 'facilitypipeoverhead', 'fieldbridge']) {
        const asset = assets[key];
        const structure = nativeAssets.find(value => value.id === key);
        if (!asset || !structure) {
            continue;
        }
        for (const curveT of [0, 0.5, 1]) {
            const data = { foxholeKey: key, startX: 12, startY: -20, startRotation: 0.3, endX: 220, endY: 50, endRotation: 2.6,
                startSocketName: 'BackSocket', endSocketName: 'FrontSocket', minLength: 96, maxLength: 640, minRadius: 16, maxRadius: 96, maxBuffer: 96, curveT, blueprint: false };
            const state = normalizeFoxholeSplineConnectorState({ ...data, start: { x: data.startX, y: data.startY, rotation: data.startRotation },
                end: { x: data.endX, y: data.endY, rotation: data.endRotation } });
            const style = resolveEffectiveConnectorPathStyle(asset.connector?.pathStyle, key);
            const constraints = resolveFoxholeSplinePathConstraints(state, style, asset.connector?.maxBufferCm ?? asset.connector?.minLengthCm ?? 0);
            const span = asset.renderLayers.span ?? asset.renderLayers.underlay;
            const expected = resolveFoxholeSplineConnectorSockets({ structure, state, constraints, pathStyle: style,
                lateralOffset: Math.max(2, (span?.height ?? 8) * 0.5), visualRotations: true });
            const actual = resolveFoxholeConnectorDisplaySockets(data, asset);
            assert.equal(actual.length, expected.length, key);
            actual.forEach((socket, index) => {
                const target = expected[index]!;
                assert.equal(socket.socket.name, target.name);
                assert.equal(socket.endpoint, target.endpoint);
                assert.ok(Math.abs(socket.x - target.localX) < 1e-7 && Math.abs(socket.y - target.localY) < 1e-7
                    && Math.abs(socket.rotation - target.rotationRadians) < 1e-7, `${key}/${curveT}/${socket.socket.name}`);
            });
            const settings = { 'foxhole.debug.structure.powerSockets': true, 'foxhole.debug.structure.pipeSockets': true };
            const free = renderFoxholeConnectorSocketOverlays(data, asset, [], settings);
            const linked = renderFoxholeConnectorSocketOverlays({ ...data, startAttachmentNodeId: 'target', startAttachmentSocketName: 'port' }, asset,
                [{ localSocketName: 'RightSocket', targetEntityId: 'branch', targetSocketName: 'BackSocket' }], settings);
            const freeCount = free[0]?.kind === 'group' ? free[0].children.length : 0;
            const linkedCount = linked[0]?.kind === 'group' ? linked[0].children.length : 0;
            if (freeCount > 0) {
                assert.ok(linkedCount < freeCount, key);
            } else {
                assert.equal(linkedCount, 0, 'generic endpoints do not draw normal power/pipe indicators');
            }
        }
    }
});

test('host color hints update real Planner and Diagram guide graphics while retaining plans and selection-only state', async () => {
    const data = { foxholeKey: 'facilitypipe', startX: 0, startY: 0, startRotation: 0, endX: 200, endY: 0, endRotation: Math.PI,
        minLength: 96, maxLength: 640, minRadius: 16, maxRadius: 96, maxBuffer: 96, curveT: 0, blueprint: false };
    const plans = [{ schemaVersion: 1 as const, root: { id: 'root', kind: 'group' as const, children: renderFoxholeConnectorGuides(data, assets.facilitypipe) } },
        renderDiagramRoute({ entityId: 'route', revision: 1, components: [{ ownerId: 'example.scene-v2-diagram', componentId: 'route', version: 1,
            definitionAvailable: true, data: { points: [0, 0, 80, 40], color: 0x52c7e8 } }] })];
    const before = structuredClone(plans);
    for (const plan of plans) {
        const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => PIXI.Texture.EMPTY });
        try {
            await host.replace(composeNixieSceneV2RenderPlans(null, plan)!);
            assert.equal(host.getRenderAnnotations().selectionOnly[0]?.renderable, false);
            host.syncToolAccents({ stem: 0x123456, handle: 0xabcdef });
            for (const annotation of host.getRenderAnnotations().toolAccents) {
                const colors = annotation.target.context.instructions.map(instruction => instruction.data.style.color);
                assert.ok(colors.length > 0);
                assert.ok(colors.every(color => color === (annotation.role === 'stem' ? 0x123456 : 0xabcdef)));
            }
            host.syncToolAccents({ stem: 0x444444, handle: 0x555555 });
            for (const annotation of host.getRenderAnnotations().toolAccents) {
                assert.ok(annotation.target.context.instructions.every(instruction => instruction.data.style.color === (annotation.role === 'stem' ? 0x444444 : 0x555555)));
            }
            assert.deepEqual(plans, before);
        } finally {
            host.destroy();
        }
    }
});
