import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { buildFoxholeStructureCatalog, getFoxholeStructureAsset } from '../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import { normalizeFoxholeStructureSocketAttachmentMap } from '../app/plugins/foxhole/nixie/types.ts';
import { replaceFoxholeModificationSelectionMap } from '../app/plugins/foxhole/nixie/modification-slots.ts';
import { sanitizeFoxholeModificationSelections } from '../app/plugins/foxhole/nixie/structure-mod-availability.ts';

function loadMethods() {
    const source = ts.createSourceFile('structure.ts', readFileSync(new URL('../app/plugins/nixie/board/types/foxhole-structure.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const nodeClass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'FoxholeStructureNode') as ts.ClassDeclaration;
    const methods = ['patchBoardState', 'buildSocketAttachmentPatch', 'sanitizeModificationVariantSelections'].map(name =>
        nodeClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name)!.getText(source));
    class Base {
        patchBoardState(patch: Record<string, unknown>) { Object.assign((this as any).boardState, patch); }
    }
    const noOp = () => {};
    const code = ts.transpile(`class Methods extends Base { ${methods.join('\n')} }; return Methods.prototype;`, { target: ts.ScriptTarget.ES2022 });
    return new Function('Base', 'BoardNodeBase', 'materializeFoxholeAppearancePatchDefaults', 'omitPersistedSize',
        'normalizeFoxholeStructureSocketAttachmentMap', 'replaceFoxholeModificationSelectionMap', 'isPlainRecord',
        'queueLiveAttachmentPreviewVisualSync', 'invalidateFoxholeSocketOverlaySceneCache', 'sanitizeFoxholeModificationSelections', code)(
        Base, Base, (value: unknown) => value, (value: unknown) => value,
        normalizeFoxholeStructureSocketAttachmentMap, replaceFoxholeModificationSelectionMap,
        (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value), noOp, noOp, sanitizeFoxholeModificationSelections);
}

const methods = loadMethods();
const catalog = buildFoxholeStructureCatalog(getFoxholeManifest('/foxhole/assets/'));
const asset = getFoxholeStructureAsset('fortt3', '/foxhole/assets/')!;
const structure = buildFoxholeStructureCatalog(getFoxholeManifest('/foxhole/assets/')).structureByKey.fortt3;
const previousAttachments = { BackFortSocket: { nodeId: 'neighbor', socketName: 'FrontFortSocket' } };
const nextAttachments = { RightFortSocket: { nodeId: 'neighbor', socketName: 'FrontFortSocket' } };

function createNode() {
    const node = {
        boardId: 'bunker',
        boardState: { socketAttachments: previousAttachments, modificationVariantIds: { RightInfraModSlot: 'kitchen' } },
        getNormalizedSocketAttachments() { return this.boardState.socketAttachments; },
        getResolvedModificationSelections() { return { ...this.boardState.modificationVariantIds }; },
        sanitizeModificationVariantSelections(selections: Record<string, string>, socketAttachments: typeof previousAttachments) {
            return sanitizeFoxholeModificationSelections(asset, selections, {
                nodeId: 'bunker', buildSockets: structure.buildSockets, socketAttachments,
                sceneNodes: [{ nodeId: 'neighbor', foxholeKey: 'fortt3', buildSockets: structure.buildSockets, socketAttachments: {} }],
            });
        },
        invalidateSelectionGeometry() {}, syncHitboxOverlay() {}, ensureTextureLoaded() {},
    };
    return node;
}

test('attachment previews and cancellation preserve modifications outside history', () => {
    const node = createNode();
    methods.patchBoardState.call(node, { socketAttachments: nextAttachments }, { reason: 'foxhole-structure-move-attachment-preview', recordHistory: false });
    assert.deepEqual(node.boardState.modificationVariantIds, { RightInfraModSlot: 'kitchen' });
    methods.patchBoardState.call(node, { socketAttachments: previousAttachments }, { reason: 'foxhole-structure-move-attachment-revert', recordHistory: false });
    assert.deepEqual(node.boardState.modificationVariantIds, { RightInfraModSlot: 'kitchen' });
});

test('rotation attachment commit removes the mod and undo/redo restores both states', () => {
    const node = createNode();
    methods.patchBoardState.call(node, { socketAttachments: nextAttachments }, { reason: 'foxhole-structure-move-attachment-preview', recordHistory: false });
    const change = methods.buildSocketAttachmentPatch.call(node, node, nextAttachments, previousAttachments);
    assert.deepEqual(change.patch.modificationVariantIds, {});
    assert.deepEqual(change.inversePatch.modificationVariantIds, { RightInfraModSlot: 'kitchen' });
    methods.patchBoardState.call(node, change.patch, { reason: 'move-commit' });
    assert.deepEqual(node.boardState.modificationVariantIds, {});
    methods.patchBoardState.call(node, change.inversePatch, { reason: 'undo' });
    assert.deepEqual(node.boardState.socketAttachments, previousAttachments);
    assert.deepEqual(node.boardState.modificationVariantIds, { RightInfraModSlot: 'kitchen' });
    methods.patchBoardState.call(node, change.patch, { reason: 'redo' });
    assert.deepEqual(node.boardState.socketAttachments, nextAttachments);
    assert.deepEqual(node.boardState.modificationVariantIds, {});
});

test('conversion undo validates restored mods against the incoming bunker type', () => {
    const node = Object.assign(createNode(), {
        boardState: { foxholeKey: 'fortt3', socketAttachments: previousAttachments, modificationVariantIds: { FrontInfraModSlot: 'pantry' } },
        boardDefinition: {
            assetResolver: (key: string) => catalog.assetByKey[key],
            structureResolver: (key: string) => catalog.structureByKey[key],
        },
        resolveModificationAvailabilitySceneNodes: () => [],
        sanitizeModificationVariantSelections: methods.sanitizeModificationVariantSelections,
    });
    const conversion = { foxholeKey: 'engineroomt3', modificationVariantIds: {} };
    const restored = { foxholeKey: 'fortt3', modificationVariantIds: { FrontInfraModSlot: 'pantry' } };
    for (let cycle = 0; cycle < 3; cycle++) {
        methods.patchBoardState.call(node, conversion, { reason: 'redo' });
        assert.equal(node.boardState.foxholeKey, 'engineroomt3');
        assert.deepEqual(node.boardState.modificationVariantIds, {});
        methods.patchBoardState.call(node, restored, { reason: 'undo' });
        assert.equal(node.boardState.foxholeKey, 'fortt3');
        assert.deepEqual(node.boardState.modificationVariantIds, { FrontInfraModSlot: 'pantry' });
    }
});
