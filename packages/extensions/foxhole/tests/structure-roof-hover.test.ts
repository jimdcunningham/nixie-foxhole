import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { isFoxholeRoofModification } from '../app/plugins/foxhole/nixie/modification-render-order.ts';

function createRoofHoverHost() {
    const source = ts.createSourceFile('structure.ts', readFileSync(new URL('../app/plugins/nixie/board/types/foxhole-structure.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const nodeClass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'FoxholeStructureNode') as ts.ClassDeclaration;
    const names = ['createModificationTextureVisual', 'getStructureTextureVisualAlpha', 'applyBunkerRoofHoverAlpha'];
    const methods = names.map(name => nodeClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name)!.getText(source));
    class Sprite {
        alpha = 1;
        anchor = { set() {} };
        scale = { set() {} };
        position = { set() {} };
    }
    const code = ts.transpile(`class Methods { ${methods.join('\n')} }; return Methods.prototype;`, { target: ts.ScriptTarget.ES2022 });
    const prototype = new Function('PIXI', 'FOXHOLE_BOARD_SPRITE_SCALE', 'isFoxholeRoofModification', 'resolveFoxholeModificationTexturePosition', code)(
        { Sprite, Texture: { EMPTY: {} } }, 1, isFoxholeRoofModification, () => ({ x: 0, y: 0 }),
    );
    return Object.assign(Object.create(prototype), {
        structureRoofTextureOverlay: { alpha: 1 },
        roofModificationTextureOverlay: { alpha: 1 },
        offLaneRoofSprites: new Set(),
        offLaneRoofModificationSprites: new Set(),
        modificationTextureAlphas: new WeakMap(),
        boardDefinition: { textureResolver: () => ({ destroyed: false }) },
        trackContactShadow() {},
        getResolvedTextureUrl: () => '/roof.webp',
        getResolvedBuildSockets: () => [],
        getResolvedStructureTextureAlpha: () => 0.5,
        resolveModificationTextureLayer: (_slot: unknown, variant: { id: string; }) => variant.id === 'ladder' ? 'roof' : 'upper',
    });
}

test('trench roof fades in its upper render lane while bridge opacity stays unchanged', () => {
    const host = createRoofHoverHost();
    const roof = host.createModificationTextureVisual({}, { variantId: 'trenchroof', textureKey: 'roof' }, {});
    const bridge = host.createModificationTextureVisual({}, { variantId: 'bridge', textureKey: 'bridge' }, {});
    host.applyBunkerRoofHoverAlpha(0.02);
    assert.equal(roof.alpha, 0.01);
    assert.equal(host.getStructureTextureVisualAlpha(bridge), 0.5);
    host.applyBunkerRoofHoverAlpha(1);
    assert.equal(roof.alpha, 0.5);
});

test('new roof visuals inherit an active fade and retain preview and blueprint opacity', () => {
    const host = createRoofHoverHost();
    host.applyBunkerRoofHoverAlpha(0.02);
    const roof = host.createModificationTextureVisual({}, { variantId: 'trenchroof', textureKey: 'roof' }, {}, 0.65);
    assert.equal(roof.alpha, 0.5 * 0.65 * 0.02);
    const ladder = host.createModificationTextureVisual({}, { variantId: 'ladder', textureKey: 'ladder' }, {}, 0.65);
    assert.equal(host.offLaneRoofModificationSprites.has(ladder), false, 'roof-lane children must not be faded twice');
    assert.equal(host.roofModificationTextureOverlay.alpha, 0.02);
});
