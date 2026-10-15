import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { findBestFoxholeSocketSnap } from '../app/plugins/foxhole/nixie/structure-socket-snapping.ts';
import { areFoxholeSnapSocketsAvailableForAttachment, resolveFoxholeMoveSnapAttachments } from '../app/plugins/foxhole/nixie/types.ts';

const file = new URL('../app/plugins/nixie/board/types/foxhole-structure.ts', import.meta.url);
const source = ts.createSourceFile('structure.ts', readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(ts.isClassDeclaration)!;
const method = declaration.members.find(m => ts.isMethodDeclaration(m) && m.name.getText(source) === 'resolveStructureSocketMoveSnap')!;
const Host = new Function('findBestFoxholeSocketSnap', 'areFoxholeSnapSocketsAvailableForAttachment', `
    const isFoxholeRailCouplerSocket = () => false;
    const MAX_FOXHOLE_MOVE_SNAP_ROTATION_LEEWAY_RADIANS = Math.PI / 4;
    const FOXHOLE_MOVE_SNAP_POINTER_SOCKET_RADIUS = 16;
    const DEFAULT_FOXHOLE_SOCKET_SNAP_DISTANCE = 16;
    const FOXHOLE_STRUCTURE_SOCKET_SNAP_RESULT_KIND = 'structure-socket';
    ${ts.transpileModule(`class Host { ${method.getText(source)} } return Host;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}
`)(findBestFoxholeSocketSnap, areFoxholeSnapSocketsAvailableForAttachment);

function fixture(selected = new Set(['intersection']), occupiedTarget = false) {
    const occupancy = new Map([
        ['intersection', { BackSocket: { nodeId: 't2', socketName: 'FrontSocket' } }],
        ['t2', { FrontSocket: { nodeId: 'intersection', socketName: 'BackSocket' } }],
        ['t1', occupiedTarget ? { FrontSocket: { nodeId: 'other', socketName: 'BackSocket' } } : {}],
    ]);
    const socketTags = [{ mask: 103079216198n, category: 2n }];
    const moving = { nodeId: 'intersection', socketName: 'BackSocket', x: 0, y: 0, rotation: Math.PI, socketTags: [{ mask: 103079216134n, category: 34359738368n }] };
    const host = new Host();
    host.boardId = 'intersection';
    host.hasSnapSocketStructure = () => true;
    host.getMoveSnapSceneState = () => ({
        selectedSocketsByNode: new Map([['intersection', [moving]]]),
        occupancyAttachmentsByNode: occupancy,
        moveSnapAttachmentsByNode: resolveFoxholeMoveSnapAttachments(occupancy, selected),
    });
    host.getMoveSnapCandidateTargetSockets = () => [
        { nodeId: 't1', socketName: 'FrontSocket', x: 200, y: 0, rotation: 0, socketTags },
    ];
    return { host, occupancy };
}

test('an attached intersection can snap to another trench in the same drag', () => {
    const { host, occupancy } = fixture();
    const result = host.resolveStructureSocketMoveSnap({ moveX: 199, moveY: 0 });
    assert.equal(result?.data.match.targetNodeId, 't1');
    assert.equal(result?.moveX, 200);
    assert.equal(occupancy.get('intersection')?.BackSocket?.nodeId, 't2', 'drag-start state remains available for undo and preview');
});

test('transfer cannot steal a socket occupied by another stationary piece', () => {
    assert.equal(fixture(new Set(['intersection']), true).host.resolveStructureSocketMoveSnap({ moveX: 199, moveY: 0 }), null);
});

test('co-selected connections remain occupied while moving an assembly', () => {
    assert.equal(fixture(new Set(['intersection', 't2'])).host.resolveStructureSocketMoveSnap({ moveX: 199, moveY: 0 }), null);
});

test('release both sides of cross-selection links without mutating original attachments', () => {
    const { occupancy } = fixture();
    const result = resolveFoxholeMoveSnapAttachments(occupancy, new Set(['intersection']));
    assert.deepEqual(result.get('intersection'), {});
    assert.deepEqual(result.get('t2'), {});
    assert.ok(occupancy.get('t2')?.FrontSocket);
});
