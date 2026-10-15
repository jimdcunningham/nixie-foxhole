import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { findBestFoxholeSocketSnap } from '../app/plugins/foxhole/nixie/structure-socket-snapping.ts';
import { resolveFoxholeMoveSnapAttachments } from '../app/plugins/foxhole/nixie/types.ts';

type Attachment = { nodeId: string; socketName: string; };

function loadMoveScene() {
    const source = ts.createSourceFile('structure.ts', readFileSync(new URL('../app/plugins/nixie/board/types/foxhole-structure.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const nodeClass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'FoxholeStructureNode') as ts.ClassDeclaration;
    const names = ['getMoveSnapSceneState', 'getStationaryPowerlineLinks'];
    const methods = names.map(name => nodeClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name)!.getText(source));
    class Structure {
        boardId: string;
        sockets: unknown[];
        constructor(boardId: string, sockets: unknown[]) {
            this.boardId = boardId;
            this.sockets = sockets;
        }

        hasSnapSocketStructure() {
            return true;
        }

        collectSnapSocketPoints() {
            return this.sockets;
        }

        getNormalizedSocketAttachments() {
            return {};
        }
    }
    const code = ts.transpile(`let foxholeMoveSnapSceneCache; class Methods { ${methods.join('\n')} }; return Methods.prototype;`, { target: ts.ScriptTarget.ES2022 });
    const methodsPrototype = new Function('FoxholeStructureNode', 'isSplineConnectorSocketSnapHost', 'isBoardNodeMoveSnapStationaryCandidate', 'resolveFoxholeAlignedReciprocalSocketAttachments', 'isPowerlineConnector', 'resolveFoxholeMoveSnapAttachments', code)(
        Structure,
        (node: { collectSnapSocketPoints?: unknown; }) => typeof node.collectSnapSocketPoints === 'function' && !(node instanceof Structure),
        () => true,
        () => new Map(),
        (key: string) => key === 'powerline',
        resolveFoxholeMoveSnapAttachments,
    );
    const host = Object.assign(Object.create(methodsPrototype), {
        getConnectorOccupancyAttachments: (node: { boardState: { startAttachment: Attachment | null; endAttachment: Attachment | null; }; }) => ({ BackSocket: node.boardState.startAttachment, FrontSocket: node.boardState.endAttachment }),
        createMoveSnapTargetSocketSpatialIndex: (sockets: unknown[]) => ({ sockets }),
        buildMoveSnapOccupancyAttachmentsByNode: (nodes: { nodeId: string; attachments: Record<string, Attachment | null>; }[]) => new Map(nodes.map(node => [node.nodeId, node.attachments])),
    });
    return { Structure, host };
}

function socket(nodeId: string, socketName: string, x: number, rotation = 0) {
    return { nodeId, socketName, x, y: 0, rotation, socketTags: [{ category: 1n, mask: 1n }] };
}

function scene(endAttachment: { nodeId: string; socketName: string; } | null, extraSelected = false) {
    const { Structure, host } = loadMoveScene();
    const building = new Structure('building', [socket('building', 'PowerSocket', 0)]);
    const partner = new Structure('partner', [socket('partner', 'PowerSocket', 100)]);
    const connector = {
        boardId: 'cable',
        boardState: { foxholeKey: 'powerline', startSocketName: 'BackSocket', endSocketName: 'FrontSocket', startAttachment: { nodeId: 'partner', socketName: 'PowerSocket' }, endAttachment },
        collectSnapSocketPoints: () => [socket('cable', 'BackSocket', 100, Math.PI), socket('cable', 'FrontSocket', 0, Math.PI)],
    };
    const selectedNodes = extraSelected ? [building, partner] : [building];
    const context = {
        viewport: {}, selectedNodes, selectedNodeIds: selectedNodes.map(node => node.boardId), stationaryNodes: [connector],
        selectedWorldOrigins: new Map(selectedNodes.map(node => [node.boardId, { x: 0, y: 0 }])),
        selectedInitialRotations: new Map(selectedNodes.map(node => [node.boardId, 0])),
    };
    return host.getMoveSnapSceneState(context);
}

test('A carried powerline endpoint does not cancel a small building move', () => {
    const state = scene({ nodeId: 'building', socketName: 'PowerSocket' });
    const match = findBestFoxholeSocketSnap({ movingSockets: state.selectedSocketsByNode.get('building'), targetSockets: state.targetSocketSpatialIndex.sockets, moveX: 6, moveY: 6 });
    assert.equal(match, null, 'The attached cable must follow instead of snapping the building back');
    assert.deepEqual(state.targetSocketSpatialIndex.sockets.map((point: { socketName: string; }) => point.socketName), ['BackSocket'], 'The opposite endpoint remains stationary');
    assert.deepEqual(state.occupancyAttachmentsByNode.get('cable').FrontSocket, { nodeId: 'building', socketName: 'PowerSocket' }, 'Keep the carried attachment for preview and commit');
});

test('A free cable endpoint still snaps to the building', () => {
    const state = scene(null);
    const match = findBestFoxholeSocketSnap({ movingSockets: state.selectedSocketsByNode.get('building'), targetSockets: state.targetSocketSpatialIndex.sockets, moveX: 6, moveY: 6 });
    assert.equal(match?.targetSocketName, 'FrontSocket');
    assert.equal(match?.moveX, 0);
    assert.equal(match?.moveY, 0);
});

test('Both cable endpoints are carried when both attached buildings move', () => {
    const state = scene({ nodeId: 'building', socketName: 'PowerSocket' }, true);
    assert.deepEqual(state.targetSocketSpatialIndex.sockets, []);
    assert.equal(state.occupancyAttachmentsByNode.get('cable').BackSocket.nodeId, 'partner');
});
