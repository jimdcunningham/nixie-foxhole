import assert from 'node:assert/strict';
import test from 'node:test';
import { Texture } from 'pixi.js';
import { getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { resolveTrenchConnectorModifications } from '../app/plugins/foxhole/nixie/trench-connector-modifications.ts';
import { TrenchConnectorVisual } from '../app/plugins/foxhole/nixie/trench-connector-visual.ts';
import { createFoxholeSplineConnectorSnapshot } from '../app/plugins/foxhole/nixie/spline-connector-snapshot.ts';
import { buildFoxholeStructureModAvailabilityContext, filterAvailableModificationVariants, sanitizeFoxholeModificationSelections } from '../app/plugins/foxhole/nixie/structure-mod-availability.ts';
import { trenchRoofPolygon } from '../app/plugins/foxhole/nixie/trench-connector-pieces.ts';

const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
const start = { x: 0, y: 0, rotation: 0 };
const end = { x: 160, y: 0, rotation: 0 };
const options = (tier = 3) => ({ asset: catalog.assetByKey[`trenchconnectort${tier}`]!, start, end, nodeId: 'connector' });
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('wire barb spacing stays at native scale across lengths and handle angles for every tier', () => {
    for (const tier of [1, 2, 3]) for (const length of [80, 160, 256]) for (const rotation of [-0.6, 0, 0.6]) {
        const base = options(tier);
        const frame = base.asset.renderLayers.find(layer => layer.id === `piece-trenchbarbedwiret${tier}`)!;
        const pieces = resolveTrenchConnectorModifications({ ...base, end: { ...end, x: length, rotation }, selections: { LeftDefenseModSlot: 'barbedwire' } });
        assert.equal(pieces.filter(p => p.id.endsWith(':start') || p.id.endsWith(':end')).length, 2);
        const wires = pieces.filter(p => p.id.includes(':wire:'));
        assert.ok(wires.length > 0);
        for (const piece of wires) {
            for (let i = 0; i < piece.uvs.length; i += 2) for (let j = i + 2; j < piece.uvs.length; j += 2) {
                const expected = Math.hypot((piece.uvs[j]! - piece.uvs[i]!) * frame.width! / 2,
                    (piece.uvs[j + 1]! - piece.uvs[i + 1]!) * frame.height! / 2);
                near(Math.hypot(piece.positions[j]! - piece.positions[i]!, piece.positions[j + 1]! - piece.positions[i + 1]!), expected);
            }
        }
        if (length === 256) assert.ok(wires.length >= 2);
    }
});

test('connecting an endpoint keeps connector side defenses available and selected', () => {
    for (const tier of [1, 2, 3]) {
        const asset = options(tier).asset;
        const context = buildFoxholeStructureModAvailabilityContext({ nodeId: 'connector', asset,
            buildSockets: catalog.structureByKey[asset.foxholeKey]!.buildSockets,
            socketAttachments: { BackSocket: { nodeId: 'neighbor', socketName: 'FrontSocket' } },
            modificationVariantIds: { LeftDefenseModSlot: 'sandbags' }, sceneNodes: [] });
        const slot = asset.modificationSlotById.LeftDefenseModSlot!;
        assert.deepEqual(filterAvailableModificationVariants(slot, context).map(v => v.id).sort(), ['barbedwire', 'sandbags']);
        assert.equal(sanitizeFoxholeModificationSelections(asset, context.modificationVariantIds, context).LeftDefenseModSlot, 'sandbags');
        // The inherited mask still applies to an ordinary trench with this slot.
        assert.deepEqual(filterAvailableModificationVariants(slot, { ...context, asset: { ...asset, foxholeKey: 'trencht2' } }), []);
    }
});

for (const tier of [1, 2, 3]) test(`T${tier} side mods resolve independently using published textures`, () => {
    const base = options(tier);
    assert.deepEqual(resolveTrenchConnectorModifications(base), []);
    const mods = resolveTrenchConnectorModifications({ ...base, selections: { LeftDefenseModSlot: 'sandbags', RightDefenseModSlot: 'barbedwire' } });
    assert.ok(mods.length > 4);
    assert.ok(mods[0]!.textureUrl.includes('sandbags'));
    const left = mods.filter(p => p.id.includes('LeftDefense'));
    const right = mods.filter(p => p.id.includes('RightDefense'));
    assert.ok(right.every(p => p.textureUrl.includes('barbedwire')));
    assert.ok(left.every(p => p.positions.filter((_, i) => i % 2).every(y => y < 0)));
    assert.ok(right.every(p => p.positions.filter((_, i) => i % 2).every(y => y > 0)));
    const swapped = resolveTrenchConnectorModifications({ ...base, selections: { LeftDefenseModSlot: 'barbedwire', RightDefenseModSlot: 'sandbags' } });
    const mirrored = swapped.find(p => p.id.includes('RightDefense'))!;
    // Opposite-facing first pieces share the start inset, not opposite ends.
    near(mods[0]!.positions[0]! + mirrored.positions[0]!, 2 * (4.8 + 25.6));
    near(mods[0]!.positions[1]! + mirrored.positions[1]!, 0);
});

test('hover replaces only the hovered side and never changes the saved selections', () => {
    const selections = Object.freeze({ LeftDefenseModSlot: 'sandbags', RightDefenseModSlot: 'sandbags' });
    const hover = { nodeId: 'connector', slotId: 'LeftDefenseModSlot', variantId: 'barbedwire', mode: 'overlay' as const };
    const preview = resolveTrenchConnectorModifications({ ...options(), selections, hover });
    assert.ok(preview[0]!.textureUrl.includes('barbedwire'));
    assert.equal(preview[0]!.alpha, 0.65);
    assert.ok(preview.filter(p => p.id.includes('RightDefense')).every(p => p.textureUrl.includes('sandbags') && p.alpha === 1));
    const restored = resolveTrenchConnectorModifications({ ...options(), selections });
    assert.ok(restored.every(layer => layer.textureUrl.includes('sandbags') && layer.alpha === 1));
    assert.deepEqual(resolveTrenchConnectorModifications({ ...options(), selections, hover: { ...hover, nodeId: 'other' } }), restored);
});

test('T3 roof assembles native panels and trims and honors roof visibility', () => {
    const selections = { BPTrenchConnectorRoofModSlot: 'trenchroof', LeftDefenseModSlot: 'sandbags' };
    const a = { ...start, rotation: -0.4 }, b = { ...end, x: 256, rotation: 0.4 };
    const mods = resolveTrenchConnectorModifications({ ...options(), selections, start: a, end: b });
    const roof = mods.filter(p => p.id.includes('Roof'));
    assert.equal(roof.filter(p => p.id.includes(':panel')).length, 1, 'wide material bake avoids repeated narrow swatches');
    assert.ok(roof.some(p => p.id.includes(':trim')));
    assert.ok(roof.every(p => p.uvs.every(uv => uv >= -1e-6 && uv <= 1 + 1e-6)));
    assert.ok(resolveTrenchConnectorModifications({ ...options(), selections, hideRoofs: true }).every(p => !p.id.includes('Roof')));
    assert.ok(resolveTrenchConnectorModifications({ ...options(2), selections }).every(p => !p.id.includes('Roof')));
});

test('roof braces and surface texture are centred on their span', () => {
    for (const length of [100, 180, 256]) {
        const base = options();
        const roof = resolveTrenchConnectorModifications({ ...base, end: { ...end, x: length }, selections: { BPTrenchConnectorRoofModSlot: 'trenchroof' } });
        const braces = roof.filter(p => p.id.includes(':trim:'));
        const panel = roof.find(p => p.id.includes(':panel'))!;
        const us = panel.uvs.filter((_, i) => i % 2 === 0);
        near((Math.min(...us) + Math.max(...us)) / 2, 0.5);
        const origins = braces.map(p => {
            const frame = base.asset.renderLayers.find(f => f.textureUrl === p.textureUrl)!;
            const w = frame.width! / 2;
            const left = (frame.offsetX ?? 0) / 2 - w * (frame.anchorX ?? 0.5);
            return p.positions[0]! - left - p.uvs[0]! * w;
        });
        assert.ok(origins.length > 0);
        near((origins[0]! + origins.at(-1)!) / 2, length / 2);
    }
});

test('roof hover fades only roof meshes and survives rebuilds without replacing geometry', () => {
    const base = options();
    const selections = { BPTrenchConnectorRoofModSlot: 'trenchroof', LeftDefenseModSlot: 'sandbags', RightDefenseModSlot: 'barbedwire' };
    const visual = new TrenchConnectorVisual(async () => Texture.EMPTY);
    const render = (alpha: number) => visual.sync({ start, end, layers: base.asset.renderLayers,
        modifications: resolveTrenchConnectorModifications({ ...base, selections }), alpha, tint: 0xffffff, contactShadows: false });
    render(0.5);
    const pieces = visual.getElevatedRenderPieces();
    const roof = pieces.filter(piece => piece.id.includes('Roof'));
    const otherMeshes = visual.getSelectionMeshes().filter(mesh => !roof.some(piece => piece.mesh === mesh));
    assert.ok(roof.length > 0);
    assert.ok(otherMeshes.length > 0);
    const baseline = new Map(visual.getSelectionMeshes().map(mesh => [mesh, mesh.alpha]));
    visual.setRoofHoverAlpha(0.25);
    for (const piece of roof) near(piece.mesh.alpha, baseline.get(piece.mesh)! * 0.25);
    for (const mesh of otherMeshes) near(mesh.alpha, baseline.get(mesh)!);
    render(0.8);
    const rebuilt = visual.getElevatedRenderPieces().filter(piece => piece.id.includes('Roof'));
    assert.deepEqual(rebuilt.map(piece => piece.mesh), roof.map(piece => piece.mesh));
    for (const piece of rebuilt) near(piece.mesh.alpha, 0.8 * 0.25);
    visual.setRoofHoverAlpha(1);
    for (const piece of rebuilt) near(piece.mesh.alpha, 0.8);
    visual.destroy();
});

test('saved selections and endpoint rotations survive snapshot serialization and removal', () => {
    const snapshot = createFoxholeSplineConnectorSnapshot({ foxholeKey: 'trenchconnectort3', start, end: { ...end, rotation: 0.3 }, modificationVariantIds: { LeftDefenseModSlot: 'barbedwire', BPTrenchConnectorRoofModSlot: 'trenchroof' } });
    const restored = JSON.parse(JSON.stringify(snapshot)).state;
    const renderOptions = { ...options(), start: restored.start, end: restored.end, selections: restored.modificationVariantIds };
    const pieces = resolveTrenchConnectorModifications(renderOptions);
    assert.ok(pieces.length > 4);
    assert.equal(resolveTrenchConnectorModifications({ ...renderOptions, selections: {} }).length, 0);
    assert.deepEqual(resolveTrenchConnectorModifications(renderOptions), pieces);
});

test('native roof panels cover the entire polygon at minimum and maximum length and opposing handle angles', () => {
    const area = (points: { x: number; y: number }[]) => Math.abs(points.reduce((sum, p, i) => {
        const next = points[(i + 1) % points.length]!;
        return sum + p.x * next.y - p.y * next.x;
    }, 0) / 2);
    for (const length of [80, 256]) for (const rotationA of [-Math.PI / 4, 0, Math.PI / 4]) for (const rotationB of [-Math.PI / 4, 0, Math.PI / 4]) {
        const a = { ...start, rotation: rotationA }, b = { ...end, x: length, rotation: rotationB };
        const pieces = resolveTrenchConnectorModifications({ ...options(), start: a, end: b, selections: { BPTrenchConnectorRoofModSlot: 'trenchroof' } }).filter(p => p.id.includes(':panel'));
        const covered = pieces.reduce((sum, p) => sum + area(p.positions.filter((_, i) => i % 2 === 0).map((x, i) => ({ x, y: p.positions[i * 2 + 1]! }))), 0);
        assert.ok(covered > 5000);
        near(covered, area(trenchRoofPolygon(a, b)));
    }
});

test('mod switching releases old meshes, stale loads cannot repaint replacements, and drags reuse geometry', async () => {
    const pending: ((texture: Texture) => void)[] = [];
    const visual = new TrenchConnectorVisual(() => new Promise(resolve => pending.push(resolve)));
    const resolve = (variant: string) => resolveTrenchConnectorModifications({ ...options(), selections: { LeftDefenseModSlot: variant } });
    const state = { start, end, layers: [], alpha: 1, tint: 0xffffff };
    visual.sync({ ...state, modifications: resolve('sandbags') });
    const firstWireLoad = pending.length;
    const old = visual.children[0]!;
    visual.sync({ ...state, modifications: resolve('barbedwire') });
    assert.equal(old.destroyed, true);
    const current = visual.children[0]!;
    for (let i = 0; i < 100; i++) visual.sync({ ...state, modifications: resolveTrenchConnectorModifications({ ...options(), end: { ...end, rotation: i / 300 }, selections: { LeftDefenseModSlot: 'barbedwire' } }) });
    assert.equal(visual.children[0], current);
    assert.equal(pending.length, firstWireLoad + resolve('barbedwire').length);
    pending[0]!(Texture.WHITE);
    await Promise.resolve();
    assert.equal((current as import('pixi.js').Mesh).texture, Texture.EMPTY);
    pending[firstWireLoad]!(Texture.WHITE);
    await Promise.resolve();
    assert.equal((current as import('pixi.js').Mesh).texture, Texture.WHITE);
    visual.sync(state);
    assert.equal(current.destroyed, true);
    assert.equal(visual.children.length, 0);
    visual.destroy();
});
