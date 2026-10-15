import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

test('wheel zoom keeps roof hover and rechecks the stationary pointer after viewport changes', () => {
    const source = ts.createSourceFile('sync.ts', readFileSync(new URL('../app/plugins/foxhole/nixie/structure-overlay-sync.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const names = ['clearBunkerRoofHover', 'updateBunkerRoofHover', 'queueBunkerRoofHoverUpdate', 'onBunkerRoofWheel'];
    const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name!.text)).map(node => node.getText(source));
    class Canvas {
        getBoundingClientRect() {
            return { left: 0, top: 0, width: 100, height: 100 };
        }
    }
    class Point {
        x: number;
        y: number;
        constructor(x: number, y: number) {
            this.x = x;
            this.y = y;
        }
    }
    const canvas = new Canvas();
    let underPointer: object = canvas;
    let faded = true;
    const frames = new Map<number, () => void>();
    let nextFrame = 0;
    const viewport = { screenWidth: 100, screenHeight: 100, scale: { x: 1 }, toWorld: (point: Point) => ({ x: point.x / viewport.scale.x, y: point.y / viewport.scale.x }) };
    const structure = { parent: viewport, destroyed: false, containsWorldPoint: (point: Point) => point.x < 100 && point.y < 100 };
    const code = ts.transpile(`
        let bunkerHoverPoint = { canvas, x: 50, y: 50 };
        let bunkerHoverFrame = 0;
        let bunkerNetworkDirty = false;
        const bunkerNetworkIndex = { unionIdByNodeId: new Map([['bunker', 'network']]) };
        const roofHoverHostsById = new Map([['bunker', structure]]);
        const fadedBunkerRoofIds = new Set(['bunker']);
        ${functions.join('\n')}
        return { wheel: onBunkerRoofWheel, queue: queueBunkerRoofHoverUpdate, point: () => bunkerHoverPoint };
    `, { target: ts.ScriptTarget.ES2022 });
    const loop = new Function('canvas', 'structure', 'HTMLCanvasElement', 'document', 'activeNixieViewport', 'PIXI', 'requestAnimationFrame', 'cancelAnimationFrame', 'setBunkerRoofHoverFaded', 'resolveFoxholeSocketNetworkUnionForNode', code)(
        canvas, structure, Canvas, { elementFromPoint: () => underPointer }, { value: viewport }, { Point },
        (callback: () => void) => {
            frames.set(++nextFrame, callback);
            return nextFrame;
        },
        (id: number) => frames.delete(id), (_id: string, value: boolean) => {
            faded = value;
        },
        () => ({ memberNodeIds: ['bunker'] }),
    );
    const flush = () => {
        const queued = [...frames.values()];
        frames.clear();
        queued.forEach(callback => callback());
    };
    loop.wheel({ target: canvas, clientX: 50, clientY: 50 });
    assert.equal(faded, true, 'wheel must not restore roofs before the viewport updates');
    viewport.scale.x = 2;
    loop.queue();
    assert.equal(frames.size, 1, 'viewport motion coalesces with the wheel update');
    flush();
    assert.equal(faded, true);
    viewport.scale.x = 0.1;
    loop.queue();
    flush();
    assert.equal(faded, false, 'restore roofs if zoom moves the bunker away from the pointer');
    underPointer = {};
    loop.wheel({ target: underPointer, clientX: 50, clientY: 50 });
    assert.equal(loop.point(), null);
});
