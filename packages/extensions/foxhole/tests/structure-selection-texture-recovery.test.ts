import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as PIXI from 'pixi.js';
import { loadBoardUrlTexture } from '../../../nixie/app/plugins/nixie/board/utils/url-texture.ts';
import { setActiveNixieSelectionIds, subscribeToNixieSelectionState } from '../../../nixie/app/plugins/nixie/runtime/shared-state.ts';

// Exercise the real node methods without constructing the unrelated socket/LOS scene.
// This matches the method-host harness used by the attachment and preview tests.
const source = ts.createSourceFile('foxhole-structure.ts', readFileSync(new URL(
    '../app/plugins/nixie/board/types/foxhole-structure.ts', import.meta.url,
), 'utf8'), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(node => ts.isClassDeclaration(node)
    && node.name?.text === 'FoxholeStructureNode') as ts.ClassDeclaration;
const names = ['bindDebugOverlaySettings', 'ensureTextureLoaded', 'applyResolvedSpriteVisualState'];
const methods = declaration.members.filter(member => ts.isMethodDeclaration(member)
    && names.includes(member.name.getText(source))).map(member => member.getText(source)).join('\n');
const code = ts.transpileModule(`class Host { ${methods.replaceAll('import.meta.dev', 'false')} } return Host;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const Host = new Function('PIXI', 'watch', 'subscribeToNixieSelectionState', 'loadFoxholeTexture', code)(
    PIXI, () => () => {}, subscribeToNixieSelectionState, loadBoardUrlTexture,
);

function setup(id: string) {
    const node = new Host();
    node.boardId = id;
    node.boardState = Object.freeze({ foxholeKey: 'tree', x: 123, y: 456, rotation: 0, alpha: 1 });
    node.boardDefinition = {};
    node.spriteObject = new PIXI.Sprite(PIXI.Texture.EMPTY);
    node.position = { x: 321, y: 654 }; // A live transform must survive texture recovery.
    node.rotation = 0.75;
    node.isUsingStructureRenderLayers = () => false;
    node.isCompositingBaseTextureWithRenderLayers = () => false;
    node.getResolvedTextureKey = () => 'foxhole:structure:tree:default';
    node.getResolvedDirectTextureUrl = () => null;
    node.getResolvedTextureUrl = () => `https://textures.test/${id}.webp`;
    node.getResolvedDimensions = () => ({ width: 279, height: 256 });
    node.getResolvedSpriteOffset = () => ({ x: 8.452, y: 7.7715 });
    node.applyStructureTextureVisualState = () => {};
    node.syncRangeOverlay = node.syncHitboxDebugOverlay = () => {};
    node.syncSpriteFromState = () => assert.fail('selection recovery must not sync the saved transform');
    const acquisitions: Promise<void>[] = [];
    const ensure = node.ensureTextureLoaded.bind(node);
    node.ensureTextureLoaded = () => {
        const acquisition = ensure();
        acquisitions.push(acquisition);
        return acquisition;
    };
    node.bindDebugOverlaySettings();
    return { node, acquisitions, cleanup() {
        node.selectionStateWatcher();
        setActiveNixieSelectionIds([]);
        node.spriteObject.destroy();
    } };
}

test('selecting a sprite after terminal load failure reacquires and installs without editing its state or live pose', async t => {
    const host = setup('selected-after-failure');
    t.after(() => host.cleanup());
    let attempts = 0;
    t.mock.method(PIXI.Assets, 'load', async () => {
        attempts += 1;
        throw new Error('[Loader.load] Failed to load https://textures.test/selected-after-failure.webp.\nTypeError: Failed to fetch');
    });
    await host.node.ensureTextureLoaded();
    assert.equal(attempts, 3);
    assert.equal(host.node.spriteObject.texture, PIXI.Texture.EMPTY);
    assert.equal(host.acquisitions.length, 1, 'settling a failure does not spin another chain');
    const before = JSON.stringify(host.node.boardState);
    t.mock.method(PIXI.Assets, 'load', async () => { attempts += 1; return PIXI.Texture.WHITE; });
    setActiveNixieSelectionIds([host.node.boardId]);
    assert.equal(host.acquisitions.length, 2, 'the selection transition must request recovery');
    await host.acquisitions[1];
    assert.equal(attempts, 4);
    assert.equal(host.node.spriteObject.texture, PIXI.Texture.WHITE);
    assert.equal(host.node.spriteObject.width, 279);
    assert.equal(host.node.spriteObject.height, 256);
    assert.equal(host.node.spriteObject.x, 8.452);
    assert.equal(host.node.spriteObject.y, 7.7715);
    assert.equal(JSON.stringify(host.node.boardState), before);
    assert.deepEqual(host.node.position, { x: 321, y: 654 });
    assert.equal(host.node.rotation, 0.75);
    setActiveNixieSelectionIds([]);
    setActiveNixieSelectionIds([host.node.boardId]);
    setActiveNixieSelectionIds([host.node.boardId]);
    assert.equal(host.acquisitions.length, 2, 'healthy selection and unchanged selection do no acquisition work');
});

test('selection installs an already-resolved texture with its native dimensions and offset without fetching', async t => {
    const host = setup('selected-cached');
    t.after(() => host.cleanup());
    host.node.boardDefinition.textureResolver = () => PIXI.Texture.WHITE;
    const load = t.mock.method(PIXI.Assets, 'load', async () => assert.fail('cached texture must not fetch'));
    setActiveNixieSelectionIds([host.node.boardId]);
    assert.equal(host.acquisitions.length, 1);
    await host.acquisitions[0];
    assert.equal(host.node.spriteObject.texture, PIXI.Texture.WHITE);
    assert.equal(host.node.spriteObject.width, 279);
    assert.equal(host.node.spriteObject.height, 256);
    assert.equal(host.node.spriteObject.x, 8.452);
    assert.equal(host.node.spriteObject.y, 7.7715);
    assert.equal(load.mock.callCount(), 0);
});

test('deselection and destroyed nodes do not acquire; layer-only visuals keep the base sprite empty', async t => {
    const host = setup('selected-layer-only');
    t.after(() => host.cleanup());
    const load = t.mock.method(PIXI.Assets, 'load', async () => assert.fail('layer-only or destroyed selection must not fetch'));
    host.node.isUsingStructureRenderLayers = () => true;
    setActiveNixieSelectionIds([host.node.boardId]);
    await Promise.all(host.acquisitions);
    assert.equal(host.node.spriteObject.texture, PIXI.Texture.EMPTY);
    const count = host.acquisitions.length;
    setActiveNixieSelectionIds([]);
    assert.equal(host.acquisitions.length, count);
    host.node.destroyed = true;
    setActiveNixieSelectionIds([host.node.boardId]);
    assert.equal(host.acquisitions.length, count);
    assert.equal(load.mock.callCount(), 0);
});

test('a selection recovery result cannot install after the resolved asset changes', async t => {
    const host = setup('selected-stale');
    t.after(() => host.cleanup());
    let resolve!: (texture: PIXI.Texture) => void;
    t.mock.method(PIXI.Assets, 'load', () => new Promise<PIXI.Texture>(done => { resolve = done; }));
    setActiveNixieSelectionIds([host.node.boardId]);
    for (let index = 0; index < 16; index += 1) await Promise.resolve();
    assert.equal(typeof resolve, 'function');
    host.node.getResolvedTextureKey = () => 'foxhole:structure:changed:default';
    resolve(PIXI.Texture.WHITE);
    await Promise.all(host.acquisitions);
    assert.equal(host.node.spriteObject.texture, PIXI.Texture.EMPTY);
});
