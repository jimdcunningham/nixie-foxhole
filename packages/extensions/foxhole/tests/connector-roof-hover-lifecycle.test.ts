import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { nextTick, reactive, shallowRef, watch } from 'vue';
import * as networks from '../app/plugins/foxhole/nixie/structure-socket-networks.ts';

test('a connector-only scene installs roof hover, fades its host, and releases listeners on unmount', async () => {
    const settings = reactive(new Map([['hover', true]]));
    const listeners = new Map<string, unknown>();
    const tickerCallbacks = new Set<unknown>();
    class Container {
        destroyed = false; parent: Container | null = null;
        on() {}
        off() {}
    }
    class Point {
        x: number; y: number; constructor(x: number, y: number) {
            this.x = x;
            this.y = y;
        }
    }
    class Canvas {
        getBoundingClientRect() {
            return { left: 0, top: 0, width: 100, height: 100 };
        }
    }
    const canvas = new Canvas();
    const viewport = Object.assign(new Container(), { screenWidth: 100, screenHeight: 100, scale: { x: 1 }, toWorld: (point: Point) => point });
    const calls: Array<[boolean, boolean | undefined]> = [];
    let key = 'trenchconnectort2';
    const host = Object.assign(new Container(), {
        boardId: 'connector', parent: viewport,
        getBunkerRoofHoverNetworkNode: () => ({ nodeId: 'connector', foxholeKey: key, profileType: 'Trench', buildSockets: [], socketAttachments: {} }),
        containsWorldPoint: () => true,
        setBunkerRoofHoverFaded: (faded: boolean, immediate?: boolean) => {
            calls.push([faded, immediate]);
            return !immediate;
        },
        advanceBunkerRoofHoverFade: () => false,
    });
    const source = readFileSync(new URL('../app/plugins/foxhole/nixie/structure-overlay-sync.ts', import.meta.url), 'utf8');
    const code = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS });
    const exports = {};
    const module = { exports };
    const load = (name: string) => {
        if (name === 'pixi.js') {
            return { Container, Point, Ticker: { shared: {
                add: (callback: unknown) => tickerCallbacks.add(callback), remove: (callback: unknown) => tickerCallbacks.delete(callback),
            } } };
        }
        if (name === 'vue') {
            return { watch };
        }
        if (name.endsWith('shared-state.ts')) {
            return { activeNixieViewport: shallowRef(viewport), activeNixiePlacementPreviewTransforms: shallowRef({}), activeNixieStructureModificationHoverPreview: shallowRef(null) };
        }
        if (name.endsWith('structure-debug-settings.ts')) {
            return { FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS: { hideRoofsOnHover: 'hover' } };
        }
        if (name.endsWith('settings.ts')) {
            return { useNixieSettingsStore: () => ({ getValueOr: (id: string, fallback: unknown) => settings.has(id) ? settings.get(id) : fallback }) };
        }
        if (name.endsWith('nixie-board-perf.ts')) {
            return { boardPerfMeasure: (_label: string, action: () => void) => action() };
        }
        if (name.endsWith('structure-socket-networks.ts')) {
            return networks;
        }
        throw new Error(`Unexpected import: ${name}`);
    };
    const runtime = new Function('require', 'exports', 'module', 'window', 'document', 'HTMLCanvasElement', 'requestAnimationFrame', 'cancelAnimationFrame',
        `${code}\nreturn { ...module.exports, move: onBunkerRoofPointerMove, flush: updateBunkerRoofHover };`)(
        load, exports, module,
        { addEventListener: (name: string, callback: unknown) => listeners.set(name, callback), removeEventListener: (name: string) => listeners.delete(name) },
        { elementFromPoint: () => canvas }, Canvas, () => 1, () => {},
    );
    runtime.registerFoxholeRoofHoverHost(host);
    assert.ok(listeners.has('pointermove'));
    runtime.move({ target: canvas, buttons: 0, clientX: 40, clientY: 40 });
    runtime.flush();
    assert.deepEqual(calls, [], 'T2 has no roof to fade');
    key = 'trenchconnectort3';
    runtime.invalidateFoxholeRoofHoverNetwork();
    runtime.flush();
    assert.deepEqual(calls, [[true, undefined]]);
    assert.equal(tickerCallbacks.size, 1);
    settings.delete('hover');
    await nextTick();
    assert.equal(listeners.size, 0, 'retiring settings releases roof hover listeners');
    settings.set('hover', true);
    await nextTick();
    assert.ok(listeners.has('pointermove'), 're-registration restores roof hover');
    runtime.unregisterFoxholeRoofHoverHost(host);
    assert.deepEqual(calls.at(-1), [false, true]);
    assert.equal(tickerCallbacks.size, 0);
    assert.equal(listeners.size, 0);
});
