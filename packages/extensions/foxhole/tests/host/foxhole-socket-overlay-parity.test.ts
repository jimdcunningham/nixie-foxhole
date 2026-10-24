import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import * as PIXI from 'pixi.js';
import { NX_BOOTSTRAP_LIGHTNING_PATH } from '../../../../nixie/app/utils/nx-bootstrap-lightning.ts';
import { preserveTestGlobal } from '../../../../nixie/tests/nixie/preserve-test-global.ts';
import published from '../../public/foxhole/assets/manifest.v1.json' with { type: 'json' };
import { createFoxholeSceneV2AssetMetadata } from '../../../../../extensions/foxhole-planner/src/scene-v2-asset-metadata.ts';
import type { PublishedFoxholeAssetForSceneV2 } from '../../../../../extensions/foxhole-planner/src/scene-v2-asset-metadata.ts';
import { renderFoxholeStructureSocketOverlays, resolveFoxholeStructureDisplaySockets, FOXHOLE_SOCKET_LIGHTNING_POINTS } from '../../../../../extensions/foxhole-planner/src/scene-v2-socket-overlays.ts';
import { resolveFoxholeEntityStructureSockets } from '../../../../../extensions/foxhole-planner/src/effective-structure-sockets.ts';
import { NixieExtensionRenderPlanHost } from '../../../../nixie/app/plugins/nixie/scene-v2/render-plan-host.ts';
import { composeNixieSceneV2RenderPlans } from '../../../../nixie/desktop-extensions/scene-v2-render-plan-composition.ts';
import { getNixieSceneV2PresentationLocalBounds } from '../../../../nixie/app/plugins/nixie/scene-v2/render-presentation.ts';

const hook = registerHooks({ resolve(specifier, context, next) {
    const root = specifier.startsWith('#nixie/') ? '../../../../nixie/app/' : specifier.startsWith('#foxhole/') ? '../../app/' : null;
    return root ? { url: hostSourceUrl(root + specifier.slice(specifier.indexOf('/') + 1), import.meta.url).href, shortCircuit: true } : next(specifier, context);
} });
const { getFoxholeManifest } = await import('../../app/plugins/foxhole/nixie/manifest.ts');
const { resolveFoxholeEffectiveBuildSockets } = await import('../../app/plugins/foxhole/nixie/structure-socket-resolution.ts');
const { resolveFoxholeStructureOverlaySockets, createFoxholeSocketAttachmentStatusVisual, createFoxholeAllSocketsLabel } = await import('../../app/plugins/foxhole/nixie/structure-socket-overlay.ts');
const { createFoxholePowerSocketVisual, createFoxholePipeSocketVisual, createFoxholeSocketLabel, resolveFoxholePipeSocketFlow,
    resolveFoxholePipeSocketColor, FOXHOLE_POWER_SOCKET_COLOR } = await import('../../app/plugins/foxhole/nixie/structure-socket-visuals.ts');
hook.deregister();

test('structure socket projection matches Native base/modification resolution, positions, kinds and flows across the catalog', () => {
    const generated = createFoxholeSceneV2AssetMetadata(published as unknown as { assets: PublishedFoxholeAssetForSceneV2[]; });
    const native = getFoxholeManifest('/foxhole/assets/');
    const expectedCases = native.assets.reduce((count, structure) => count + 1
        + structure.modificationSlots.reduce((total, slot) => total + Object.keys(slot.variants).length, 0), 0);
    assert.ok(expectedCases > 0);
    let cases = 0;
    for (const structure of native.assets) {
        const asset = generated.assets[structure.id];
        assert.ok(asset, `Missing socket metadata for Native asset: ${structure.id}`);
        const variants = [null, ...structure.modificationSlots.flatMap(slot => Object.entries(slot.variants).map(([id, source]) => ({ slot: slot.name, id, source })))];
        for (const variant of variants) {
            const sdkVariant = variant ? asset.modifications[variant.slot]?.variants[variant.id] : null;
            if (variant) assert.ok(sdkVariant, `Missing Native socket variant: ${structure.id}/${variant.slot}/${variant.id}`);
            const expected = resolveFoxholeStructureOverlaySockets(resolveFoxholeEffectiveBuildSockets(structure.buildSockets,
                variant ? [variant.source] : [], structure.railCouplers), { x: 0, y: 0 }, 'fixture')
                .filter(socket => socket.kind === 'power' || socket.kind === 'pipe');
            for (const configuration of [{ power: true, occupy: false }, { power: true, occupy: true }, { power: false, occupy: true }]) {
                const power = configuration.power;
                const occupied = new Set(configuration.occupy ? expected.slice(0, 1).flatMap(socket => socket.name ? [socket.name] : []) : []);
                const actual = resolveFoxholeStructureDisplaySockets(asset, sdkVariant ? [sdkVariant] : [], occupied,
                    { 'foxhole.debug.structure.powerSockets': power, 'foxhole.debug.structure.pipeSockets': true });
                const filtered = expected.filter(socket => !occupied.has(String(socket.name ?? '').trim()) && (power || socket.kind !== 'power'));
                assert.deepEqual(actual.map(socket => [socket.socket.name, socket.kind, socket.flow, socket.x, socket.y, socket.rotation]),
                    filtered.map(socket => [socket.name ?? '', socket.kind, resolveFoxholePipeSocketFlow(socket.socket.pipeType), socket.localX, socket.localY, socket.rotationRadians]),
                    `${structure.id}/${variant?.slot ?? 'base'}/${variant?.id ?? ''}/${power}`);
                cases++;
            }
        }
    }
    assert.equal(cases, expectedCases * 3);
    console.info(`Compared ${cases} Native/SDK structure socket cases.`);
});

test('attachment templates use the same full Native base/modification/coupler socket set as presentation', () => {
    const generated = createFoxholeSceneV2AssetMetadata(published as unknown as { assets: PublishedFoxholeAssetForSceneV2[]; });
    let cases = 0;
    const native = getFoxholeManifest('/foxhole/assets/');
    const expectedCases = native.assets.reduce((count, structure) => count + 1
        + structure.modificationSlots.reduce((total, slot) => total + Object.keys(slot.variants).length, 0), 0);
    assert.ok(expectedCases > 0);
    for (const structure of native.assets) {
        const metadata = generated.assets[structure.id];
        assert.ok(metadata, `Missing attachment metadata for Native asset: ${structure.id}`);
        const variants = [null, ...structure.modificationSlots.flatMap(slot => Object.entries(slot.variants).map(([id, source]) => ({ slot: slot.name, id, source })))];
        for (const variant of variants) {
            if (variant) assert.ok(metadata.modifications[variant.slot]?.variants[variant.id],
                `Missing Native attachment variant: ${structure.id}/${variant.slot}/${variant.id}`);
            const entity = { entityId: 'fixture', revision: 1, components: variant
                ? [{ ownerId: 'nixie.foxhole-planner', componentId: 'modification', version: 1,
                    definitionAvailable: true, data: { selections: [{ slotId: variant.slot, variantId: variant.id }] } }]
                : [] };
            const actual = resolveFoxholeEntityStructureSockets(entity, metadata);
            const expected = resolveFoxholeEffectiveBuildSockets(structure.buildSockets, variant ? [variant.source] : [], structure.railCouplers)
                .filter(socket => socket.name && Number.isFinite(Number(socket.x ?? 0)) && Number.isFinite(Number(socket.y ?? 0)) && Number.isFinite(Number(socket.rotation ?? 0)));
            assert.deepEqual(actual.map(socket => [socket.name, socket.x, socket.y, socket.rotation, socket.componentType,
                socket.socketTags?.map(tag => [tag.mask, tag.category])]),
            expected.map(socket => [socket.name, Number(socket.x ?? 0) / 100 * 32, Number(socket.y ?? 0) / 100 * 32, Number(socket.rotation ?? 0) * Math.PI / 180,
                String(socket.componentType ?? ''), socket.socketTags.filter(tag => Number.isSafeInteger(tag.mask) && Number(tag.mask) > 0 && Number.isSafeInteger(tag.category) && Number(tag.category) > 0)
                    .map(tag => [tag.mask, tag.category])]), `${structure.id}/${variant?.slot ?? 'base'}/${variant?.id ?? ''}`);
            cases++;
        }
    }
    assert.equal(cases, expectedCases);
    console.info(`Compared ${cases} full Native/SDK attachment template cases.`);
});

test('the resource-free lightning polygon retains the bundled SVG path geometry', () => {
    const primitives = new PIXI.GraphicsPath(NX_BOOTSTRAP_LIGHTNING_PATH).shapePath.shapePrimitives;
    assert.equal(primitives.length, 1);
    const shape = primitives[0]!.shape as PIXI.Polygon;
    assert.deepEqual(FOXHOLE_SOCKET_LIGHTNING_POINTS, shape.points);
});

test('materialized socket visuals retain Native geometry, label outlines, upright rotation and excluded bounds', async context => {
    preserveTestGlobal(context, 'document');
    preserveTestGlobal(context, 'CanvasRenderingContext2D');
    Object.defineProperty(globalThis, 'CanvasRenderingContext2D', { configurable: true, value: { prototype: {} } });
    const metricsContext = { font: '', measureText: (text: string) => ({ width: text.length * 7, actualBoundingBoxAscent: 11, actualBoundingBoxDescent: 3 }) };
    const canvas = { width: 10, height: 10, getContext: () => metricsContext };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas } });
    const metrics = PIXI.CanvasTextMetrics as unknown as { __canvas?: unknown; __context?: unknown; clearMetrics(): void; };
    const oldCanvas = metrics.__canvas, oldContext = metrics.__context;
    metrics.__canvas = canvas;
    metrics.__context = metricsContext;
    metrics.clearMetrics();
    // Parse the exact bundled path through Pixi's same GraphicsPath parser;
    // an HTML SVG DOM wrapper is unnecessary for this geometry comparison.
    context.mock.method(PIXI.Graphics.prototype, 'svg', function(this: PIXI.Graphics, svg: string) {
        return this.path(new PIXI.GraphicsPath(svg.match(/d="([^"]+)"/)![1]!)).fill(0xffffff);
    });
    try {
        for (const flow of ['power', 'input', 'output', 'bidirectional'] as const) {
            const generated = createFoxholeSceneV2AssetMetadata({ assets: [{ id: 'fixture', sprite: { width: 100, height: 100 }, buildSockets: [{
                name: flow === 'power' ? 'PowerSocket' : 'PipeSocket', x: 100, y: -50, rotation: 135,
                ...(flow === 'power' ? {} : { pipeType: flow }),
            }] }] });
            const asset = generated.assets.fixture!;
            const overlays = renderFoxholeStructureSocketOverlays(asset, [], [], { 'foxhole.debug.structure.socketLabels': true }, { destroyed: false, packaged: false });
            const sourcePlan = { schemaVersion: 1 as const, root: { id: 'root', kind: 'group' as const, children: [{ id: 'body', kind: 'graphics' as const,
                commands: [{ op: 'rect' as const, x: -5, y: -5, width: 10, height: 10 }, { op: 'fill' as const, color: 0xffffff }] }, ...overlays] } };
            const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => PIXI.Texture.EMPTY });
            const angle = 135 * Math.PI / 180;
            const placement = { localX: 32, localY: -16, rotationRadians: angle, ancestorRotationRadians: 0.7 };
            const native = flow === 'power' ? createFoxholePowerSocketVisual(placement) : createFoxholePipeSocketVisual(placement, flow);
            const label = createFoxholeSocketLabel(flow === 'power' ? 'Power Socket' : 'Pipe Socket', flow === 'power' ? FOXHOLE_POWER_SOCKET_COLOR : resolveFoxholePipeSocketColor(flow), angle);
            native.addChild(label);
            try {
                const composed = composeNixieSceneV2RenderPlans(null, sourcePlan)!;
                const root = await host.replace(composed);
                host.syncWorldUpright(0.7);
                const excluded = host.getRenderAnnotations().boundsExcluded;
                assert.equal(excluded.length, 1);
                const bounds = getNixieSceneV2PresentationLocalBounds(root, excluded);
                assert.deepEqual([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY], [-5, -5, 5, 5]);
                const socket = excluded[0]!.children[0]!;
                assert.deepEqual([socket.x, socket.y, socket.rotation], [native.x, native.y, native.rotation]);
                const sdkLabel = socket.children.at(-1) as PIXI.Text;
                assert.deepEqual([sdkLabel.x, sdkLabel.y, sdkLabel.anchor.x, sdkLabel.anchor.y], [label.x, label.y, label.anchor.x, label.anchor.y]);
                for (const field of ['color', 'width', 'join', 'alpha'] as const) {
                    assert.equal(sdkLabel.style.stroke?.[field], label.style.stroke?.[field]);
                }
                assert.equal(sdkLabel.rotation, -0.7 - angle);
                const actualBounds = socket.children[0]!.getLocalBounds();
                const expectedBounds = native.children[0]!.getLocalBounds();
                assert.deepEqual([actualBounds.minX, actualBounds.minY, actualBounds.maxX, actualBounds.maxY],
                    [expectedBounds.minX, expectedBounds.minY, expectedBounds.maxX, expectedBounds.maxY]);
            } finally {
                host.destroy();
                native.destroy({ children: true });
            }
        }
    } finally {
        metrics.__canvas = oldCanvas;
        metrics.__context = oldContext;
        metrics.clearMetrics();
    }
});

test('SDK All Sockets status graphics and grouped labels retain Native layout, identifiers and colors', () => {
    const source = [{ name: 'FrontFortSocket', x: 100, y: 50, rotation: 90, socketTags: [] },
        { name: 'BackFortSocket', x: 100, y: 50, rotation: 90, socketTags: [] },
        { name: 'PowerSocket', x: -100, y: 20, rotation: 180, socketTags: [] }];
    const asset = createFoxholeSceneV2AssetMetadata({ assets: [{ id: 'artilleryait1', sprite: { width: 100, height: 100 }, buildSockets: source }] }).assets.artilleryait1!;
    const overlays = renderFoxholeStructureSocketOverlays(asset, [], [{ localSocketName: 'FrontFortSocket' }],
        { 'foxhole.debug.structure.allSockets': true, 'foxhole.debug.structure.socketLabels': true }, { destroyed: false, packaged: false }, 'artilleryait1');
    const group = overlays[0]!; assert.ok(group.kind === 'group');
    const native = resolveFoxholeStructureOverlaySockets(source, { x: 0, y: 0 }, 'fixture');
    const color = (socket: typeof native[number]) => socket.name === 'FrontFortSocket' ? 0x53D769 : 0xFF4D4D;
    for (const [index, socket] of native.entries()) {
        const expected = createFoxholeSocketAttachmentStatusVisual(socket, color(socket));
        const actual = group.children[index]!; assert.ok(actual.kind === 'group');
        assert.deepEqual([actual.x, actual.y, actual.rotation ?? 0], [expected.x, expected.y, expected.rotation]);
        const graphic = actual.children[0]!; assert.ok(graphic.kind === 'graphics');
        assert.equal(graphic.commands.find(c => c.op === 'fill')?.color, (expected.children[0] as PIXI.Graphics).context.instructions[0]!.data.style.color);
        expected.destroy({ children: true });
    }
    const labels = createFoxholeAllSocketsLabel(native.slice(0, 2), 'artilleryait1', color);
    const actual = group.children[0]!; assert.ok(actual.kind === 'group');
    assert.deepEqual(actual.children.filter(n => n.kind === 'text').map(n => [n.text, n.x, n.y, n.anchorX, n.anchorY, n.style?.fill]),
        (labels.children as PIXI.Text[]).map(n => [n.text, n.x, n.y, n.anchor.x, n.anchor.y, n.style.fill]));
    labels.destroy({ children: true });
});
