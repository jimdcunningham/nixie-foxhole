import { hostSourceUrl } from "../host-source-url.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import * as PIXI from 'pixi.js';
import maps, { foxholeMapResources } from '../../../../../extensions/foxhole-planner/src/scene-v2-map-data-node.ts';
import { renderFoxholePlanningMapIcons } from '../../../../../extensions/foxhole-planner/src/scene-v2-map-icons.ts';
import { NixieExtensionRenderPlanHost } from '../../../../nixie/app/plugins/nixie/scene-v2/render-plan-host.ts';

const hook = registerHooks({ resolve(specifier, context, next) {
    const root = specifier.startsWith('#nixie/') ? '../../../../nixie/app/' : specifier.startsWith('#foxhole/') ? '../../app/' : null;
    return root ? { url: hostSourceUrl(root + specifier.slice(specifier.indexOf('/') + 1), import.meta.url).href, shortCircuit: true } : next(specifier, context);
} });
const { FoxholeMapRenderer } = await import('../../app/plugins/foxhole/nixie/map/renderer.ts');
const { FOXHOLE_MAP_REGIONS, FOXHOLE_MAP_ICONS } = await import('../../app/plugins/foxhole/nixie/map/constants.ts');
const { readFoxholeMapSettings } = await import('../../app/plugins/foxhole/nixie/map-settings.ts');
hook.deregister();

type Region = (typeof maps.regions)[number];
type NativeIconRenderer = {
    context: { readMapSettings: () => ReturnType<typeof readFoxholeMapSettings>; getZoom: () => number; getWarData: () => null; };
    pointerInteractionsEnabled: boolean;
    loadMapIconTexture: (id: string) => Promise<PIXI.Texture>;
    resolveMapIconHoverTooltipData: () => object;
    syncRegionIcons: (view: { region: object; liveIcons: PIXI.Container; liveIconsVersion?: number | null; }, icons: { version: number; items: []; }) => Promise<void>;
};

test('all map icon hover names, categories and declared preview resources match the actual bundled resolver', () => {
    const native = Object.create(FoxholeMapRenderer.prototype) as {
        context: { getAssetsBaseUrl: () => string; };
        structureHoverAssetByName: object; itemHoverAssetByName: object;
        buildStructureHoverAssetByName: () => object; buildItemHoverAssetByName: () => object;
        resolveMapIconHoverTooltipData: (icon: (typeof FOXHOLE_MAP_ICONS)[string]) => { iconName: string; categoryLabel: string; previewUrl: string | null; };
    };
    native.context = { getAssetsBaseUrl: () => '/foxhole/assets/' };
    native.structureHoverAssetByName = native.buildStructureHoverAssetByName();
    native.itemHoverAssetByName = native.buildItemHoverAssetByName();
    for (const [key, icon] of Object.entries(FOXHOLE_MAP_ICONS)) {
        const expected = native.resolveMapIconHoverTooltipData(icon);
        const actual = maps.icons[key]!;
        const preview = foxholeMapResources.find(resource => resource.id === actual.previewResourceId);
        assert.deepEqual([actual.name, actual.tooltipCategory, preview ? `/foxhole/assets/${preview.sourcePath}` : null],
            [expected.iconName, expected.categoryLabel, expected.previewUrl], key);
    }
});

test('published planning markers and synthetic icon families retain Native positions, scales, tints and victory circles', async () => {
    const texture = new PIXI.Texture({ source: new PIXI.TextureSource({ width: 64, height: 40 }) });
    const cases: Array<{ region: Region; settings: Record<string, boolean | string>; }> = maps.regions.map(region => ({ region, settings: {} }));
    const seedRegion = maps.regions[0]!;
    for (const key of Object.keys(maps.icons)) {
        for (const teamId of [undefined, 'COLONIALS', 'WARDENS']) {
            for (const flags of [0, 1, 16, 17]) {
                for (const colored of [false, true]) {
                    cases.push({ region: { ...seedRegion, staticIcons: [{ iconType: key, x: 0.25, y: 0.75, teamId, flags }] }, settings: { 'foxhole.map.coloredIcons': colored } });
                }
            }
        }
        for (const settings of [{ 'foxhole.map.icons': false }, { [`foxhole.map.iconCategories.${maps.icons[key]!.category}`]: false }, { 'foxhole.map.iconBlacklist': ` ${key} ` }]) {
            cases.push({ region: { ...seedRegion, staticIcons: [{ iconType: key, x: 0.25, y: 0.75 }] }, settings });
        }
    }
    let markers = 0;
    for (const { region, settings } of cases) {
        const values = { 'foxhole.map.enabled': true, ...settings };
        const native = Object.create(FoxholeMapRenderer.prototype) as NativeIconRenderer;
        Object.assign(native, { context: { readMapSettings: () => readFoxholeMapSettings(values), getZoom: () => 1 / 25, getWarData: () => null },
            presentationHoverData: new WeakMap(), pointerInteractionsEnabled: false, loadMapIconTexture: async () => texture, resolveMapIconHoverTooltipData: () => ({}) });
        const layer = new PIXI.Container();
        // Exercise the actual Native static-marker branch with a settled empty cached icon bucket.
        const view = { region: { ...FOXHOLE_MAP_REGIONS.find(value => value.key === region.key), staticIcons: region.staticIcons }, liveIcons: layer, liveIconsVersion: undefined };
        const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => texture });
        try {
            await native.syncRegionIcons(view, { version: 1, items: [] });
            const visible = layer.children.filter(child => child.visible);
            const nodes = renderFoxholePlanningMapIcons(maps, [region], settings, 25);
            const actual = await host.replace({ schemaVersion: 1, root: { id: 'root', kind: 'group', children: nodes } });
            assert.equal(actual.children.length, visible.length);
            for (const [index, expected] of visible.entries()) {
                const node = actual.children[index]!;
                assert.deepEqual([node.x, node.y, node.scale.x, node.scale.y], [region.x - maps.regionWidth / 2 + expected.x,
                    region.y - maps.regionHeight / 2 + expected.y, expected.scale.x, expected.scale.y]);
                const sprite = node.children.at(-1) as PIXI.Sprite;
                const original = expected.children.at(-1) as PIXI.Sprite;
                assert.deepEqual([sprite.anchor.x, sprite.anchor.y, sprite.width, sprite.height, sprite.tint],
                    [original.anchor.x, original.anchor.y, original.width, original.height, original.tint]);
                const circle = node.children.find(child => child instanceof PIXI.Graphics) as PIXI.Graphics | undefined;
                const originalCircle = expected.children.find(child => child instanceof PIXI.Graphics) as PIXI.Graphics | undefined;
                assert.equal(Boolean(circle), Boolean(originalCircle));
                if (circle && originalCircle) {
                    assert.equal(circle.alpha, originalCircle.alpha);
                    const instructions = (graphics: PIXI.Graphics) => graphics.context.instructions.map(item => ({ action: item.action,
                        shapes: item.data.path.shapePath.shapePrimitives.map(primitive => primitive.shape), color: item.data.style.color, width: item.data.style.width }));
                    assert.deepEqual(instructions(circle), instructions(originalCircle));
                }
                markers++;
            }
        } finally {
            host.destroy();
            layer.destroy({ children: true });
        }
    }
    texture.destroy(true);
    console.info(`Compared ${cases.length} Native settings/faction/flag cases and ${markers} materialized markers.`);
});
