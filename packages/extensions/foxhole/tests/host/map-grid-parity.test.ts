import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import * as PIXI from 'pixi.js';
import maps from '../../../../../extensions/foxhole-planner/src/scene-v2-map-data-node.ts';
import { renderFoxholePlanningGrid } from '../../../../../extensions/foxhole-planner/src/scene-v2-map-grid.ts';
import { NixieExtensionRenderPlanHost } from '../../../../nixie/app/plugins/nixie/scene-v2/render-plan-host.ts';

const hook = registerHooks({ resolve(specifier, context, next) {
    const root = specifier.startsWith('#nixie/') ? '../../../../nixie/app/' : specifier.startsWith('#foxhole/') ? '../../app/' : null;
    return root ? { url: new URL(root + specifier.slice(specifier.indexOf('/') + 1), import.meta.url).href, shortCircuit: true } : next(specifier, context);
} });
const { FoxholeMapRenderer } = await import('../../app/plugins/foxhole/nixie/map/renderer.ts');
const { readFoxholeMapSettings } = await import('../../app/plugins/foxhole/nixie/map-settings.ts');
hook.deregister();

test('portable region/subcell grid geometry and sticky label positions match actual Native helpers across all regions', async () => {
    const scale = 32;
    const settings = readFoxholeMapSettings({ 'foxhole.map.enabled': true, 'foxhole.map.grid': true });
    let visible = { minX: -10000, minY: -10000, maxX: 10000, maxY: 10000 };
    const originalAdapter = PIXI.DOMAdapter.get();
    // Constructor-only shader capability probing does not require a GPU for these geometry checks.
    PIXI.DOMAdapter.set({ ...originalAdapter, createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement });
    const renderer = new FoxholeMapRenderer({ readMapSettings: () => settings, getAssetsBaseUrl: () => '/foxhole/assets/', getZoom: () => 1 / scale,
        viewport: { toWorld: (x: number, y: number) => ({ x: visible.minX + x * scale, y: visible.minY + y * scale }) },
    } as unknown as ConstructorParameters<typeof FoxholeMapRenderer>[0]);
    PIXI.DOMAdapter.set(originalAdapter);
    const native = renderer as unknown as {
        grid: PIXI.Container; gridLines: PIXI.Graphics; gridSublines: PIXI.Container; gridSublineLines: PIXI.Graphics;
        gridColumnLabels: Array<{ label: PIXI.Text; }>; gridRowLabels: Array<{ label: PIXI.Text; }>;
        regionViews: Array<{ container: PIXI.Container; }>;
        updateGridFollowTarget: (point: { x: number; y: number; }) => void;
        updateGridStickyLabels: () => void;
        mapModUnsubscribe: (() => void) | null;
        root: PIXI.Container;
    };
    const paths = (graphics: PIXI.Graphics) => graphics.context.instructions.map(instruction => ({ action: instruction.action,
        path: instruction.data.path.instructions, color: instruction.data.style.color, alpha: instruction.data.style.alpha, width: instruction.data.style.width }));
    let cases = 0;
    try {
        for (const region of maps.regions) {
            for (const offset of [{ x: 0, y: 0 }, { x: 2345, y: -3456 }, { x: -40000, y: -35000 }]) {
                const pointer = { x: region.x + offset.x, y: region.y + offset.y };
                visible = { minX: pointer.x - 8000, minY: pointer.y - 6000, maxX: pointer.x + 8000, maxY: pointer.y + 6000 };
                const container = new PIXI.Container({ x: region.x, y: region.y });
                native.regionViews = [{ container }];
                native.updateGridFollowTarget(pointer);
                native.updateGridStickyLabels();
                const plan = renderFoxholePlanningGrid({ contractVersion: 1, settings: { 'foxhole.map.enabled': true, 'foxhole.map.grid': true,
                    'foxhole.map.regionKeys': region.key }, viewport: { renderScale: scale, pointer, visibleBounds: visible }, theme: 'dark' });
                const host = new NixieExtensionRenderPlanHost({ loadTexture: async () => PIXI.Texture.EMPTY });
                try {
                    const root = await host.replace(plan.plan);
                    const grid = root.getChildByLabel('grid-region', true)!;
                    const subcells = root.getChildByLabel('grid-subcells', true)!;
                    assert.deepEqual([grid.x, grid.y, subcells.x, subcells.y], [native.grid.x, native.grid.y, native.gridSublines.x, native.gridSublines.y]);
                    assert.deepEqual(paths(root.getChildByLabel('grid-lines', true) as PIXI.Graphics), paths(native.gridLines));
                    assert.deepEqual(paths(root.getChildByLabel('grid-sublines', true) as PIXI.Graphics), paths(native.gridSublineLines));
                    for (const [index, entry] of native.gridColumnLabels.entries()) {
                        const label = root.getChildByLabel(`grid-column-${index + 1}`, true) as PIXI.Text;
                        assert.deepEqual([label.text, label.x, label.y, label.anchor.x, label.anchor.y], [entry.label.text, entry.label.x, entry.label.y, entry.label.anchor.x, entry.label.anchor.y]);
                    }
                    for (const [index, entry] of native.gridRowLabels.entries()) {
                        const label = root.getChildByLabel(`grid-row-${index}`, true) as PIXI.Text;
                        assert.deepEqual([label.text, label.x, label.y, label.anchor.x, label.anchor.y], [entry.label.text, entry.label.x, entry.label.y, entry.label.anchor.x, entry.label.anchor.y]);
                    }
                    const sublabels = native.gridSublines.children.filter(child => child instanceof PIXI.Text) as PIXI.Text[];
                    for (const [index, original] of sublabels.entries()) {
                        const row = Math.floor(index / 3), column = index % 3 + 1;
                        const label = root.getChildByLabel(`grid-subcell-${row}-${column}`, true) as PIXI.Text;
                        assert.deepEqual([label.text, label.x, label.y, label.anchor.x, label.anchor.y, label.alpha], [original.text, original.x, original.y, original.anchor.x, original.anchor.y, original.alpha]);
                    }
                    cases++;
                } finally {
                    host.destroy();
                    container.destroy();
                }
            }
        }
    } finally {
        native.mapModUnsubscribe?.();
        native.root.destroy({ children: true });
    }
    console.info(`Compared ${cases} Native grid/follow/sticky-label cases.`);
});
