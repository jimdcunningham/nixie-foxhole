import assert from 'node:assert/strict';
import test from 'node:test';
import { Texture } from 'pixi.js';
import { nativePiece, stripPieces } from '../app/plugins/foxhole/nixie/trench-connector-pieces.ts';
import { trenchContactShadow } from '../app/plugins/foxhole/nixie/trench-connector-shadow.ts';
import { TrenchConnectorVisual } from '../app/plugins/foxhole/nixie/trench-connector-visual.ts';

const frame = { id: 'wall', textureUrl: '/wall.texture.webp', width: 100, height: 40, offsetX: 0, offsetY: 0, anchorX: 0.5, anchorY: 0.5 };
const projection = { textureUrl: '/wall.shadow.webp', width: 140, height: 80, offsetX: 0, offsetY: 0,
    surfaceWidth: 100, surfaceHeight: 40, surfaceOffsetX: 0, surfaceOffsetY: 0 };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('padded contact shadows follow native piece rotation without inflating the surface', () => {
    const surface = nativePiece(frame, 'wall:0', { x: 10, y: 20 }, Math.PI / 2, 0.65);
    const shadow = trenchContactShadow(surface, projection)!;
    near(shadow.positions[0]!, 30);
    near(shadow.positions[1]!, -15);
    near(shadow.positions[4]!, -10);
    near(shadow.positions[5]!, 55);
    assert.equal(shadow.alpha, 0.65);
    near(Math.hypot(surface.positions[2]! - surface.positions[0]!, surface.positions[3]! - surface.positions[1]!), 50);
});

test('remainder shadow uses the native transform and respects the wall cut', () => {
    const last = stripPieces(frame, 'wall', { x: 0, y: 0 }, { x: 125, y: 0 }).at(-1)!;
    const shadow = trenchContactShadow(last, projection)!;
    near(Math.max(...shadow.positions.filter((_, i) => i % 2 === 0)), 125);
    near(Math.min(...shadow.positions.filter((_, i) => i % 2 === 0)), 90);
    near(Math.max(...shadow.positions.filter((_, i) => i % 2)), 20);
});

test('late metadata uses latest geometry; shadows draw below surfaces and never expand hit testing', async () => {
    let finish!: (value: typeof projection) => void;
    const visual = new TrenchConnectorVisual(async () => Texture.WHITE, () => new Promise(resolve => { finish = resolve; }));
    const start = { x: 0, y: 0, rotation: 0 }, end = { x: 160, y: 0, rotation: 0 };
    const state = { start, end, layers: [], alpha: 1, tint: 0xffffff };
    const piece = nativePiece(frame, 'mod:side:sandbags:0', { x: 0, y: 0 }, 0);
    visual.sync({ ...state, modifications: [piece] });
    const moved = nativePiece(frame, piece.id, { x: 100, y: 0 }, 0);
    visual.sync({ ...state, modifications: [moved] });
    finish(projection);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(visual.children.length, 2);
    const shadow = visual.children[0] as import('pixi.js').Mesh;
    near((shadow.geometry as import('pixi.js').MeshGeometry).positions[0]!, 65);
    const selection = visual.getSelectionMeshes();
    assert.equal(selection.length, 1);
    assert.equal(selection[0], visual.children[1]);
    const selectionPositions = (selection[0]!.geometry as import('pixi.js').MeshGeometry).positions;
    near(Math.min(...selectionPositions.filter((_, i) => i % 2 === 0)), 75);
    near(Math.max(...selectionPositions.filter((_, i) => i % 2 === 0)), 125);
    assert.equal(visual.containsLocalPoint({ x: 68, y: 0 }), false);
    assert.equal(visual.containsLocalPoint({ x: 80, y: 0 }), true);
    visual.sync({ ...state, modifications: [moved], contactShadows: false });
    assert.equal(shadow.destroyed, true);
    visual.sync({ ...state, modifications: [moved] });
    assert.equal(visual.children.length, 2);
    visual.sync(state);
    assert.equal(visual.children.length, 0);
    visual.destroy();
});

test('metadata finishing after destruction cannot recreate a shadow', async () => {
    let finish!: (value: typeof projection) => void;
    const visual = new TrenchConnectorVisual(async () => Texture.WHITE, () => new Promise(resolve => { finish = resolve; }));
    const start = { x: 0, y: 0, rotation: 0 };
    visual.sync({ start, end: { ...start, x: 160 }, layers: [], alpha: 1, tint: 0xffffff,
        modifications: [nativePiece(frame, 'mod:side:sandbags:0', start, 0)] });
    visual.destroy(); finish(projection); await Promise.resolve();
    assert.equal(visual.destroyed, true);
});

test('roof panels receive trim shadows before the trim surfaces render', async () => {
    const textures = new Map<string, Texture>();
    const visual = new TrenchConnectorVisual(async url => {
        if (!textures.has(url)) textures.set(url, new Texture());
        return textures.get(url)!;
    }, async () => projection);
    const start = { x: 0, y: 0, rotation: 0 };
    const panel = nativePiece({ ...frame, textureUrl: '/panel' }, 'mod:Roof:trenchroof:panel:0', start, 0);
    const trim = nativePiece(frame, 'mod:Roof:trenchroof:trim:0', start, 0);
    visual.sync({ start, end: { ...start, x: 160 }, layers: [], alpha: 1, tint: 0xffffff, modifications: [panel, trim] });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(visual.children.map(child => (child as import('pixi.js').Mesh).texture),
        [textures.get('/panel'), textures.get(projection.textureUrl), textures.get(frame.textureUrl)]);
    visual.destroy();
    for (const texture of textures.values()) texture.destroy();
});
