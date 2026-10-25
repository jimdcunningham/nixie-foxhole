import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import * as PIXI from 'pixi.js';
import published from '../../public/foxhole/assets/manifest.v1.json' with { type: 'json' };
import { createFoxholeSceneV2AssetMetadata } from '../../../../../extensions/foxhole-planner/src/scene-v2-asset-metadata.ts';
import type { PublishedFoxholeAssetForSceneV2 } from '../../../../../extensions/foxhole-planner/src/scene-v2-asset-metadata.ts';
import { renderFoxholeStructureRange, renderFoxholeStructureRangeOverlays } from '../../../../../extensions/foxhole-planner/src/scene-v2-structure-range-overlays.ts';
import { isFoxholeStructureRangeVisible, FOXHOLE_STRUCTURE_RANGE_SETTING_IDS } from '../../../../../extensions/foxhole-planner/src/structure-range-settings.ts';
import { NixieExtensionRenderPlanHost } from '../../../../nixie/app/plugins/nixie/scene-v2/render-plan-host.ts';
import { getNixieSceneV2PresentationLocalBounds } from '../../../../nixie/app/plugins/nixie/scene-v2/render-presentation.ts';
import { renderDiagramNode } from '../../../../../extensions/scene-v2-diagram/src/scene-v2.ts';

const hook = registerHooks({ resolve(specifier, context, next) {
    const root = specifier.startsWith('#nixie/') ? '../../../../nixie/app/' : specifier.startsWith('#foxhole/') ? '../../app/' : null;
    return root ? { url: hostSourceUrl(root + specifier.slice(specifier.indexOf('/') + 1), import.meta.url).href, shortCircuit: true } : next(specifier, context);
} });
const { getFoxholeManifest } = await import('../../app/plugins/foxhole/nixie/manifest.ts');
const { createFoxholeStructureRangeVisual } = await import('../../app/plugins/foxhole/nixie/structure-range-visual.ts');
const { readFoxholeRangeSettings, isFoxholeRangeVisible } = await import('../../app/plugins/foxhole/nixie/range-settings.ts');
hook.deregister();

function instructions(graphic: PIXI.Graphics) {
    const shapes = (path: PIXI.GraphicsPath | undefined) => path?.shapePath.shapePrimitives.map(primitive => ({ shape: primitive.shape,
        transform: primitive.transform ? [primitive.transform.a, primitive.transform.b, primitive.transform.c, primitive.transform.d, primitive.transform.tx, primitive.transform.ty] : [1, 0, 0, 1, 0, 0] }));
    return graphic.context.instructions.map(instruction => ({ action: instruction.action, path: shapes(instruction.data.path),
        hole: shapes(instruction.data.hole),
        style: { color: instruction.data.style.color, alpha: instruction.data.style.alpha, width: instruction.data.style.width,
            alignment: instruction.data.style.alignment, cap: instruction.data.style.cap, join: instruction.data.style.join } }));
}

test('all published range metadata and visibility categories match Native selected/persistent/vehicle rules', () => {
    const generated = createFoxholeSceneV2AssetMetadata(published as unknown as { assets: PublishedFoxholeAssetForSceneV2[]; });
    let ranges = 0, cases = 0;
    for (const asset of getFoxholeManifest('/foxhole/assets/').assets) {
        const metadata = generated.assets[asset.id];
        if (!metadata) {
            continue;
        }
        assert.deepEqual(metadata.ranges.map(({ firingVolume, ...range }) => range), asset.ranges, asset.id);
        const sourceRanges = published.assets.find(source => source.id === asset.id)?.ranges ?? [];
        for (const [index, range] of metadata.ranges.entries()) {
            if (range.firingVolume) assert.deepEqual(range.firingVolume, (sourceRanges[index]?.firingVolume ?? sourceRanges[index]?.fv), asset.id + '/firing-volume');
        }
        for (const range of asset.ranges) {
            ranges++;
            for (const setting of [null, ...FOXHOLE_STRUCTURE_RANGE_SETTING_IDS]) {
                const values: Record<string, boolean> = setting ? { [setting]: true } : {};
                for (const selected of [false, true]) {
                    assert.equal(isFoxholeStructureRangeVisible(range, values, selected, asset.isVehicle === true),
                        isFoxholeRangeVisible(range, readFoxholeRangeSettings(values), selected, { isVehicle: asset.isVehicle === true }), `${asset.id}/${range.type}/${setting}/${selected}`);
                    cases++;
                }
            }
        }
    }
    assert.ok(ranges > 100);
    console.info(`Compared ${ranges} published ranges and ${cases} visibility cases.`);
});

test('materialized circles, annular/partial ranges, overlap and reach bands retain exact Native drawing instructions', async () => {
    const fixtures = getFoxholeManifest('/foxhole/assets/').assets.flatMap(asset => asset.ranges);
    for (const range of [...fixtures, { type: 'garrison', max: 30 }, { type: 'garrison', min: 10, max: 30 },
        { type: 'killbox', min: 10, max: 30, arc: 45, x: 2, y: -3, rotation: 30 },
        { type: 'killboxArty', max: 50, arc: 60, reach: 70 }, { type: 'overlap', overlap: 20 },
        { type: 'crane', max: 30, overlap: 15, reach: 40 }, { type: 'intel' }]) {
        const native = createFoxholeStructureRangeVisual(range);
        const node = renderFoxholeStructureRange(range, 'range');
        assert.equal(Boolean(node), Boolean(native));
        if (!node || !native) {
            continue;
        }
        const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => PIXI.Texture.EMPTY });
        try {
            const root = await host.replace({ schemaVersion: 1, root: { id: 'root', kind: 'group', children: [node] } });
            const nativeGraphics = native.visual.children.filter(child => child instanceof PIXI.Graphics);
            const actualGraphics = root.children[0]!.children.filter(child => child instanceof PIXI.Graphics);
            assert.equal(actualGraphics.length, nativeGraphics.length);
            actualGraphics.forEach((graphic, index) => assert.deepEqual(instructions(graphic as PIXI.Graphics), instructions(nativeGraphics[index] as PIXI.Graphics)));
            if (native.label) {
                const label = root.children[0]!.children.at(-1) as PIXI.Text;
                assert.deepEqual([label.text, label.x, label.y, label.anchor.x, label.anchor.y, label.visible],
                    [native.label.text, native.label.x, native.label.y, native.label.anchor.x, native.label.anchor.y, native.label.visible]);
            }
        } finally {
            host.destroy();
            native.visual.destroy({ children: true });
        }
    }
});

test('host cuts preserve genuine holes for Planner and neutral activity rings while overlay bounds stay authored', async () => {
    const asset = createFoxholeSceneV2AssetMetadata({ assets: [{ id: 'fixture', sprite: { width: 100, height: 100 }, ranges: [{ type: 'garrison', min: 10, max: 20 }] }] }).assets.fixture!;
    const overlays = renderFoxholeStructureRangeOverlays(asset, { 'foxhole.ranges.garrison': true }, { destroyed: false, packaged: false });
    const diagram = renderDiagramNode({ entityId: 'diagram', revision: 1, components: [{ ownerId: 'example.scene-v2-diagram', componentId: 'node', version: 1,
        definitionAvailable: true, data: { kind: 'process', label: 'Process', color: 0x52c7e8 } }] });
    const rings = [overlays[0]!, diagram.root.children.find(child => child.id === 'activity-ring')!];
    for (const ring of rings) {
        const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => PIXI.Texture.EMPTY });
        try {
            const root = await host.replace({ schemaVersion: 1, root: { id: 'root', kind: 'group', children: [{ id: 'body', kind: 'graphics',
                commands: [{ op: 'rect', x: -5, y: -5, width: 10, height: 10 }, { op: 'fill', color: 0xffffff }] }, ring] } });
            const graphics: PIXI.Graphics[] = [];
            const visit = (target: PIXI.Container) => {
                if (target instanceof PIXI.Graphics) {
                    graphics.push(target);
                }
                target.children.forEach(visit);
            };
            visit(root);
            assert.ok(graphics.some(graphic => graphic.context.instructions.some(instruction => instruction.data.hole?.instructions.length)));
            if (host.getRenderAnnotations().boundsExcluded.length) {
                const bounds = getNixieSceneV2PresentationLocalBounds(root, host.getRenderAnnotations().boundsExcluded);
                assert.deepEqual([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY], [-5, -5, 5, 5]);
            }
        } finally {
            host.destroy();
        }
    }
});
