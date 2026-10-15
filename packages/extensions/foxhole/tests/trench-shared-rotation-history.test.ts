import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as PIXI from 'pixi.js';
import { resolveTrenchSharedRotation } from '../app/plugins/foxhole/nixie/trench-shared-rotation.ts';
import { isTrenchConnector } from '../app/plugins/foxhole/nixie/trench-connector.ts';

// Exercise the actual editor transaction methods with an in-memory board host;
// the full board module requires Nuxt stores and a mounted browser viewport.
const source = ts.createSourceFile('connector.ts', readFileSync(new URL('../app/plugins/nixie/board/types/foxhole-spline-connector.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'FoxholeSplineConnectorNode') as ts.ClassDeclaration;
const methods = new Set(['applyEditableHandleDrag', 'startEditableHandleDrag', 'buildEditableHandleCommit', 'getSharedTrenchRotationCommit', 'cancelEditableHandleDrag']);
const bodies = declaration.members.filter(member => ts.isMethodDeclaration(member) && methods.has(member.name.getText(source)))
    .map(member => member.getText(source)).join('\n');
const script = ts.transpileModule(`class FoxholeSplineConnectorNode extends PIXI.Container {
    ${bodies}
    getResolvedPathStyle() { return 'trench'; }
    getNormalizedEndpointAttachment(value) { return value; }
    getNormalizedSocketAttachments() { return this.boardState.socketAttachments ?? {}; }
    getTrenchEndAttachment(role) { return this.boardState[role + 'Attachment']; }
    getTrenchRotationPartner() { return this.partner ? { node: this.partner, role: 'start' } : null; }
    findBoardNodeById(id) { return this.partner?.boardId === id ? this.partner : null; }
    usesSocketSnapping() { return true; }
    restoreLiveAttachmentPreview() {}
    patchBoardState(patch) { Object.assign(this.boardState, patch); }
}
return FoxholeSplineConnectorNode;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const Node = new Function('PIXI', 'isTrenchConnector', 'resolveTrenchSharedRotation', 'cloneEndpoint', 'resolveRotationFromWorldPointer', 'isPowerlineConnector', script)(
    PIXI, isTrenchConnector, resolveTrenchSharedRotation, (value: object) => ({ ...value }),
    (_node: unknown, _endpoint: unknown, pointer: { rotation: number }) => pointer.rotation, () => false);

test('shared handle preview commits both ends as one reversible edit and cancel restores both', () => {
    const left = new Node(), right = new Node();
    left.boardId = 'left'; right.boardId = 'right'; left.partner = right;
    left.boardState = { foxholeKey: 'trenchconnectort3', start: { x: -160, y: 0, rotation: 0 }, end: { x: 0, y: 0, rotation: 0 },
        endAttachment: { nodeId: 'right', socketName: 'BackSocket' } };
    right.boardState = { foxholeKey: 'trenchconnectort2', start: { x: 0, y: 0, rotation: 0 }, end: { x: 160, y: 0, rotation: 0 },
        startAttachment: { nodeId: 'left', socketName: 'FrontSocket' } };
    const session = left.startEditableHandleDrag({ id: 'end-rotation' });
    assert.equal(left.applyEditableHandleDrag(session, { rotation: 0.4 }, {}), true);
    assert.equal(left.boardState.end.rotation, 0.4);
    assert.ok(Math.abs(right.boardState.start.rotation - 0.4) < 1e-7);
    assert.equal(left.boardState.endAttachment.nodeId, 'right');
    const commit = left.buildEditableHandleCommit(session);
    assert.equal(commit.extraPatches.length, 1);
    assert.equal(commit.extraPatches[0].nodeId, 'right');
    left.patchBoardState(commit.inversePatch);
    right.patchBoardState(commit.extraPatches[0].inversePatch);
    assert.equal(left.boardState.end.rotation, 0);
    assert.equal(right.boardState.start.rotation, 0);
    left.patchBoardState(commit.patch);
    right.patchBoardState(commit.extraPatches[0].patch);
    assert.ok(Math.abs(right.boardState.start.rotation - left.boardState.end.rotation) < 1e-7);
    left.cancelEditableHandleDrag(session);
    assert.equal(left.boardState.end.rotation, 0);
    assert.equal(right.boardState.start.rotation, 0);
    left.partner = null;
    assert.equal(left.applyEditableHandleDrag(session, { rotation: 0.3 }, {}), false, 'an occupied non-connector end cannot rotate');
    left.destroy(); right.destroy();
});
