import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadLeaderCheck() {
    const source = ts.createSourceFile('structure.ts', readFileSync(new URL('../app/plugins/nixie/board/types/foxhole-structure.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const nodeClass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'FoxholeStructureNode') as ts.ClassDeclaration;
    const method = nodeClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'isMoveAttachmentPreviewLeader')!;
    let checks = 0;
    class Structure {
        boardId: string;
        eligible: boolean;
        constructor(boardId: string, eligible = true) { this.boardId = boardId; this.eligible = eligible; }
        hasSnapSocketStructure() { checks++; return this.eligible; }
    }
    const code = ts.transpile(`class Leader { ${method.getText(source)} }; return Leader.prototype.isMoveAttachmentPreviewLeader;`, { target: ts.ScriptTarget.ES2022 });
    const check = new Function('FoxholeStructureNode', 'foxholeMoveAttachmentPreviewLeaderCache', code)(Structure, new WeakMap());
    return { Structure, check, getChecks: () => checks };
}

test('Dense attachment previews resolve one shared leader per pointer update', () => {
    const { Structure, check, getChecks } = loadLeaderCheck();
    const nodes = Array.from({ length: 112 }, (_, i) => new Structure(String(i).padStart(3, '0'))).reverse();
    const context = { selectedNodes: nodes };
    const leaders = nodes.filter(node => check.call(node, context));
    assert.deepEqual(leaders.map(node => node.boardId), ['000']);
    assert.equal(getChecks(), nodes.length, 'Do not rescan every selected structure for every provider');
});

test('New pointer contexts re-evaluate eligibility and empty selections have no leader', () => {
    const { Structure, check } = loadLeaderCheck();
    const first = new Structure('a');
    const second = new Structure('b');
    assert.equal(check.call(first, { selectedNodes: [first, second] }), true);
    first.eligible = false;
    const context = { selectedNodes: [first, second, {}] };
    assert.equal(check.call(first, context), false);
    assert.equal(check.call(second, context), true);
    assert.equal(check.call(first, { selectedNodes: [] }), false);
});

test('Cancellation only clears docking targets touched by this move', () => {
    const source = ts.createSourceFile('structure.ts', readFileSync(new URL('../app/plugins/nixie/board/types/foxhole-structure.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const nodeClass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'FoxholeStructureNode') as ts.ClassDeclaration;
    const methods = ['clearRailCouplerDockZones', 'syncRailCouplerDockZonesForMove'].map(name => nodeClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name)!.getText(source));
    class Structure {
        destroyed = false;
        railCouplerDockZonePreviewNodes: Structure[] = [];
        changes: unknown[] = [];
        hasRailCouplerStructure() { return true; }
        syncRailCouplerDockZoneOverlay(moving: unknown) { this.changes.push(moving); }
        getTopBoardContainer() { throw new Error('Cancellation must not scan the scene'); }
    }
    const code = ts.transpile(`class Methods { ${methods.join('\n')} }; return Methods.prototype;`, { target: ts.ScriptTarget.ES2022 });
    const methodsPrototype = new Function('FoxholeStructureNode', code)(Structure);
    const moving = new Structure();
    const target = new Structure();
    const unrelated = new Structure();
    methodsPrototype.clearRailCouplerDockZones.call(moving);
    methodsPrototype.syncRailCouplerDockZonesForMove.call(moving, { selectedNodes: [moving], stationaryNodes: [target] });
    assert.equal(target.changes.at(-1), moving);
    methodsPrototype.clearRailCouplerDockZones.call(moving);
    assert.equal(target.changes.at(-1), null);
    assert.equal(unrelated.changes.length, 0);
    const count = target.changes.length;
    methodsPrototype.clearRailCouplerDockZones.call(moving);
    assert.equal(target.changes.length, count, 'Repeated cancellation does no work');
});
