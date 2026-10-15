import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as PIXI from 'pixi.js';
import * as spline from '../app/plugins/foxhole/nixie/spline-connector.ts';
import * as pipe from '../app/plugins/foxhole/nixie/pipe-connector-path.ts';
import * as placement from '../app/plugins/foxhole/nixie/spline-connector-placement.ts';
import * as pipeConstraints from '../app/plugins/foxhole/nixie/pipe-spline-constraints.ts';
import * as geometry from '../../../nixie/app/plugins/nixie/board/utils/spline-path.ts';
import { resolveFoxholeSplinePathConstraints } from '../app/plugins/foxhole/nixie/spline-connector-guides.ts';
import { isReferenceRoadSplineKey, isWorldRoadEditCandidateValid } from '../app/plugins/foxhole/nixie/world-road-edit-validity.ts';
import { normalizeFoxholeStructureSocketAttachmentMap } from '../app/plugins/foxhole/nixie/types.ts';
import { isTrenchConnector } from '../app/plugins/foxhole/nixie/trench-connector.ts';
import { shouldLockFoxholeConnectorEndpointToSocketAxis, resolveFoxholeConnectorEndpointSockets } from '../app/plugins/foxhole/nixie/connector.ts';
import { getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { materializeFoxholeAppearancePatchDefaults } from '../app/plugins/foxhole/nixie/appearance-state.ts';

const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
const captured = JSON.parse(readFileSync(new URL('./fixtures/world-road-exact-bend.json', import.meta.url), 'utf8'));
// Execute real node methods with a small state/viewport host, as in the existing selection recovery harness.
const source = ts.createSourceFile('foxhole-spline-connector.ts', readFileSync(
    process.env.FOXHOLE_ROAD_TEST_SOURCE ?? new URL('../app/plugins/nixie/board/types/foxhole-spline-connector.ts', import.meta.url),
    'utf8',
), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(node => ts.isClassDeclaration(node)
    && node.name?.text === 'FoxholeSplineConnectorNode') as ts.ClassDeclaration;
const methodNames = [
    'getInteractiveRoadKey', 'isInteractiveRoadCandidateValid', 'patchInteractiveEndpoints', 'getPathConstraints',
    'startEditableHandleDrag', 'applyEditableHandleDrag', 'buildEditableHandleCommit', 'cancelEditableHandleDrag',
    'applySocketSnappingEditableHandleDrag', 'updatePlacementSession', 'confirmPlacementSession', 'buildPlacementCommit',
    'cancelPlacementSession', 'reconcilePlacementSocketAttachments', 'captureInitialTargetAttachments',
    'applyLiveAttachmentPreview', 'restoreLiveAttachmentPreview',
    'patchBoardState', 'replaceBoardState',
];
const functionNames = ['cloneEndpoint', 'getNodeRotation', 'toBoardWorldPoint', 'snapWorldRotation',
    'resolveRotationFromWorldPointer', 'resolvePlacementStartPositionAlongAxis'];
const methods = declaration.members.filter(member => ts.isMethodDeclaration(member)
    && methodNames.includes(member.name.getText(source))).map(member => member.getText(source)).join('\n');
const functions = source.statements.filter(node => ts.isFunctionDeclaration(node)
    && functionNames.includes(node.name?.text ?? '')).map(node => node.getText(source)).join('\n');
class StateHost {
    boardState: Record<string, unknown> = {};
    patches = 0;
    patchBoardState(patch: object | ((state: Record<string, unknown>) => void)) {
        this.patches++;
        const next = structuredClone(this.boardState);
        if (typeof patch === 'function') patch(next);
        else Object.assign(next, structuredClone(patch));
        this.boardState = next;
    }
    replaceBoardState(state: Record<string, unknown>) { this.boardState = structuredClone(state); }
}
const bindings = { ...spline, ...pipe, ...placement, ...pipeConstraints, ...geometry, PIXI, StateHost,
    resolveFoxholeSplinePathConstraints, isReferenceRoadSplineKey, isWorldRoadEditCandidateValid,
    isTrenchConnector, shouldLockFoxholeConnectorEndpointToSocketAxis, resolveFoxholeConnectorEndpointSockets,
    normalizeFoxholeStructureSocketAttachmentMap, materializeFoxholeAppearancePatchDefaults };
const code = ts.transpileModule(`${functions}\nclass Host extends StateHost { ${methods} } return Host;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const Host = new Function(...Object.keys(bindings), code)(...Object.values(bindings));
const viewport = { toLocal: (p: PIXI.Point) => p, toGlobal: (p: PIXI.Point) => p };
const context = { viewport, world: new PIXI.Point(160, 0), snapRotation: false };

function setup(key = 'greatmarchroad', snapped = false, initial = captured.before.state) {
    const node = new Host();
    node.boardId = 'road';
    node.boardState = structuredClone({ ...initial, foxholeKey: key });
    node.rotation = 0;
    node.toLocal = node.toGlobal = (p: PIXI.Point) => new PIXI.Point(p.x, p.y);
    node.getResolvedAsset = () => catalog.assetByKey[key];
    node.getResolvedStructure = () => catalog.structureByKey[key];
    node.getResolvedConnector = () => catalog.structureByKey[key]?.connector;
    node.getResolvedRenderLayers = () => catalog.assetByKey[key]?.renderLayers ?? [];
    node.getResolvedPathStyle = () => 'spline';
    node.getResolvedMaxArcAngleDeg = () => undefined;
    node.usesSocketSnapping = () => snapped;
    node.getTrenchEndAttachment = () => undefined;
    node.getNormalizedEndpointAttachment = (value: unknown) => value || undefined;
    node.getNormalizedSocketAttachments = () => structuredClone(node.boardState.socketAttachments ?? {});
    node.getSharedTrenchRotationCommit = () => [];
    node.restorePartnerEndpointAttachmentsFromOwnSocketMap = () => {};
    node.syncConnectorTargetEndpointAttachmentsFromOccupancy = () => {};
    node.resolveOwnSocketAttachmentsFromTargetReciprocals = () => ({});
    let targetPatches = 0;
    const target = { boardState: { socketAttachments: { prior: { nodeId: 'old', socketName: 'x' } } },
        patchBoardState(patch: object) { targetPatches++; Object.assign(this.boardState, structuredClone(patch)); } };
    const targets = () => [{ nodeId: 'target', node: target, sockets: [], attachments: structuredClone(target.boardState.socketAttachments) }];
    node.getSnapTargetsForViewport = targets;
    node.findBoardNodeById = () => target;
    node.collectSnapSocketPoints = () => [];
    node.collectMovingEndpointSocketsFromState = () => [];
    node.snapSplineConnectorHandleLocal = (_role: string, point: PIXI.Point) => ({ local: point });
    node.reconcileAttachmentsAgainstTargets = () => ({ endAttachment: { nodeId: 'target', socketName: 'dock' },
        targetAttachmentsByNode: new Map([['target', { dock: { nodeId: 'road', socketName: 'FrontSocket' } }]]) });
    return { node, target, counts: () => ({ patches: node.patches, targetPatches }) };
}

function rotationPointer(node: InstanceType<typeof Host>, role: 'start' | 'end', rotation: number) {
    const endpoint = node.boardState[role];
    const angle = role === 'end' && !spline.usesSocketFacingEndRotation(node.boardState.foxholeKey) ? rotation - Math.PI : rotation;
    return new PIXI.Point(endpoint.x + Math.cos(angle) * 36, endpoint.y + Math.sin(angle) * 36);
}

test('captured rotation gesture is consumed without geometry or reciprocal writes', () => {
    for (const key of ['greatmarchroad', 'worldroad']) {
        const { node, target, counts } = setup(key, true);
        const session = node.startEditableHandleDrag({ id: 'end-rotation' });
        const before = JSON.stringify(node.boardState), targetBefore = JSON.stringify(target.boardState);
        assert.equal(node.applyEditableHandleDrag(session, rotationPointer(node, 'end', -1.047), context), true);
        assert.equal(JSON.stringify(node.boardState), before);
        assert.equal(JSON.stringify(target.boardState), targetBefore);
        assert.deepEqual(counts(), { patches: 0, targetPatches: 0 });
        assert.equal(node.buildEditableHandleCommit(session), null);
    }
});

test('both endpoint and tangent edits keep the last accepted geometry on invalid input', () => {
    for (const role of ['start', 'end'] as const) {
        const { node } = setup();
        const session = node.startEditableHandleDrag({ id: role });
        const validPoint = new PIXI.Point(role === 'start' ? -640 : 800, 0);
        node.applyEditableHandleDrag(session, validPoint, context);
        const accepted = JSON.stringify(node.boardState);
        node.applyEditableHandleDrag(session, new PIXI.Point(80, 200), context);
        assert.equal(JSON.stringify(node.boardState), accepted);
        const rotation = node.startEditableHandleDrag({ id: `${role}-rotation` });
        node.applyEditableHandleDrag(rotation, rotationPointer(node, role, Math.PI / 2), context);
        assert.equal(JSON.stringify(node.boardState), accepted);
    }
});

test('invalid snapped candidates preserve prior local and target attachment previews atomically', () => {
    for (const role of ['start', 'end'] as const) {
        const { node, target } = setup('greatmarchroad', true);
        const session = node.startEditableHandleDrag({ id: role });
        node.applyEditableHandleDrag(session, new PIXI.Point(role === 'start' ? -640 : 800, 0), context);
        assert.equal(target.boardState.socketAttachments.dock.nodeId, 'road', 'valid snap writes the real reciprocal preview');
        const state = JSON.stringify(node.boardState), targetState = JSON.stringify(target.boardState);
        const preview = JSON.stringify([...session.previewTargetAttachmentsByNode]);
        node.snapSplineConnectorHandleLocal = () => ({ local: new PIXI.Point(role === 'start' ? 0 : 160, 0), rotation: Math.PI / 2 });
        node.applyEditableHandleDrag(session, new PIXI.Point(), context);
        assert.equal(JSON.stringify(node.boardState), state);
        assert.equal(JSON.stringify(target.boardState), targetState);
        assert.equal(JSON.stringify([...session.previewTargetAttachmentsByNode]), preview);
        node.cancelEditableHandleDrag(session);
        assert.deepEqual(node.boardState.start, captured.before.state.start);
        assert.deepEqual(node.boardState.end, captured.before.state.end);
        assert.deepEqual(target.boardState.socketAttachments, { prior: { nodeId: 'old', socketName: 'x' } });
    }
});

test('loaded invalid state survives neutral patches, can be repaired, and remains the exact undo target', () => {
    const { node } = setup('greatmarchroad', false, captured.after.state);
    // Run the real replacement/remote state entry point too; it must not apply the edit guard.
    node.replaceBoardState(node.boardState, { source: 'remote' });
    const original = structuredClone(node.boardState);
    node.patchBoardState({ blueprint: true }); // Normal non-geometry state flow has no guard.
    node.patchBoardState({ blueprint: false });
    assert.deepEqual(node.boardState, original);
    const session = node.startEditableHandleDrag({ id: 'end-rotation' });
    assert.deepEqual(node.boardState, original, 'beginning a gesture does not normalize loaded geometry');
    node.applyEditableHandleDrag(session, rotationPointer(node, 'end', 0), context);
    const commit = node.buildEditableHandleCommit(session);
    assert(commit);
    assert.equal(commit.patch.end.rotation, 0);
    assert.deepEqual(commit.inversePatch.end, original.end);
    node.patchBoardState(commit.inversePatch); // The same unguarded history patch path.
    assert.deepEqual(node.boardState, original);
    node.patchBoardState(commit.patch);
    assert.equal(node.boardState.end.rotation, 0);
    node.cancelEditableHandleDrag(session);
    assert.deepEqual(node.boardState, original);
});

test('commit-time road validation restores local and reciprocal preview state if metadata changes', () => {
    const { node, target } = setup('greatmarchroad', true);
    const before = structuredClone(node.boardState);
    const session = node.startEditableHandleDrag({ id: 'end' });
    node.applyEditableHandleDrag(session, new PIXI.Point(800, 0), context);
    node.getResolvedRenderLayers = () => []; // A formerly valid candidate can no longer be verified.
    assert.equal(node.buildEditableHandleCommit(session), null);
    assert.deepEqual(node.boardState.start, before.start);
    assert.deepEqual(node.boardState.end, before.end);
    assert.deepEqual(target.boardState.socketAttachments, { prior: { nodeId: 'old', socketName: 'x' } });
});

function placementSession(node: InstanceType<typeof Host>) {
    return { phase: 'pick-end', removeOnCancel: true, initialX: node.boardState.x, initialY: node.boardState.y,
        initialStart: structuredClone(node.boardState.start), initialEnd: structuredClone(node.boardState.end),
        manualStartRotation: false, manualEndRotation: false };
}

test('placement rejects folded snapped geometry before writes and cannot confirm or commit it', () => {
    const { node, target, counts } = setup('greatmarchroad', true);
    const session = placementSession(node);
    const initial = JSON.stringify(node.boardState), targetInitial = JSON.stringify(target.boardState), flags = JSON.stringify(session);
    node.snapSplineConnectorHandleLocal = () => ({ local: new PIXI.Point(160, 0), rotation: -1.047 });
    assert.equal(node.updatePlacementSession(session, context), false);
    assert.equal(JSON.stringify(session), flags, 'rejected placement flags are rolled back too');
    assert.deepEqual(counts(), { patches: 0, targetPatches: 0 });
    assert.equal(node.confirmPlacementSession(session, context), 'continue');
    assert.equal(JSON.stringify(node.boardState), initial);
    assert.equal(node.buildPlacementCommit(session, context), null);
    assert.equal(JSON.stringify(node.boardState), initial);
    assert.equal(JSON.stringify(target.boardState), targetInitial);
});

test('valid placement commits exact geometry and cancel restores reciprocal state', () => {
    const { node, target } = setup('greatmarchroad', true);
    const session = placementSession(node);
    const ctx = { ...context, world: new PIXI.Point(800, 0) };
    assert.equal(node.confirmPlacementSession(session, ctx), 'complete');
    const commit = node.buildPlacementCommit(session, ctx);
    assert(commit);
    assert.deepEqual(commit.patch.end, { x: 800, y: 0, rotation: 0 });
    assert.deepEqual(commit.inversePatch.end, captured.before.state.end);
    assert.equal(commit.extraPatches[0].nodeId, 'target');
    node.cancelPlacementSession(session);
    assert.deepEqual(node.boardState.end, captured.before.state.end);
    assert.deepEqual(target.boardState.socketAttachments, { prior: { nodeId: 'old', socketName: 'x' } });
});

test('pipe and rail edits keep the existing freeform path without road validation', () => {
    for (const key of ['facilitypipe', 'railtrackspline']) {
        const { node } = setup(key);
        node.isInteractiveRoadCandidateValid = () => assert.fail('unrelated candidate must bypass the road geometry validator');
        const session = node.startEditableHandleDrag({ id: 'end-rotation' });
        node.applyEditableHandleDrag(session, rotationPointer(node, 'end', -1.047), context);
        assert(Math.abs(node.boardState.end.rotation + 1.047) < 1e-10, key);
    }
});
