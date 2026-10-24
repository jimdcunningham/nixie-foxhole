import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { createFoxholeSceneV2AssetMetadata } from '../src/scene-v2-asset-metadata.ts';
import { renderFoxholeStructureSocketOverlays, renderFoxholeSpatialSocketMarkers, resolveFoxholeStructureDisplaySockets, resolveFoxholeSocketDisplayKind } from '../src/scene-v2-socket-overlays.ts';

const generated = createFoxholeSceneV2AssetMetadata({ assets: [{ id: 'socket-fixture', sprite: { width: 256, height: 256 }, buildSockets: [
    { name: 'PowerSocket', x: 100, y: 200, rotation: 45 },
    { name: 'PipeInput', x: -100, y: 20, pipeType: 'input' },
    { name: 'PipeOutput', x: 100, y: 20, pipeType: 'output' },
    { name: 'GenericSocket', x: 50, y: 50 },
    { name: 'LandscapeCheckSocket1', x: 0, y: 0 },
] }] });
const asset = generated.assets['socket-fixture']!;

test('model socket markers retain height, selected upgrade sockets and occupancy rules', () => {
    const elevated = { ...asset, overlaySockets: asset.overlaySockets!.map(socket => ({ ...socket, z: 250 })) };
    const markers = renderFoxholeSpatialSocketMarkers(elevated, [], [], {}, { destroyed: false, packaged: false });
    assert.ok(markers.length > 0);
    assert.equal(markers[0]!.point[2], 80);
    const hidden = renderFoxholeSpatialSocketMarkers(elevated, [], [{ localSocketName: 'PowerSocket' }], {}, { destroyed: false, packaged: false });
    assert.ok(hidden.every(marker => marker.label !== 'PowerSocket'));
    assert.doesNotThrow(() => parseNixieExtensionRenderPlanV1({ schemaVersion: 1, root: { id: 'root', kind: 'group', children: [] },
        experimentalSpatial: { contractVersion: 1, supplementModel: true, nodes: [], markers } }));
});

test('multi-connection power sockets remain targetable until capacity is exhausted', () => {
    const multiple = { ...asset, powerSocketMaxConnections: 3 };
    const row = { localSocketName: 'PowerSocket' };
    const render = (attachments: unknown[]) => renderFoxholeSpatialSocketMarkers(multiple, [], attachments, {}, { destroyed: false, packaged: false });
    assert.ok(render([row]).some(marker => marker.label === 'PowerSocket'));
    assert.ok(render([row, row]).some(marker => marker.label === 'PowerSocket'));
    assert.ok(render([row, row, row]).every(marker => marker.label !== 'PowerSocket'));
});

test('socket display retains Native positions, occupancy exclusions and independent saved visibility settings', () => {
    const before = structuredClone(asset);
    const sockets = resolveFoxholeStructureDisplaySockets(asset, [], new Set(['PowerSocket']), {});
    assert.deepEqual(sockets.map(entry => [entry.socket.name, entry.kind, entry.x, entry.y, entry.flow]), [
        ['PipeInput', 'pipe', -32, 6.4, 'input'], ['PipeOutput', 'pipe', 32, 6.4, 'output'],
    ]);
    assert.equal(resolveFoxholeStructureDisplaySockets(asset, [], new Set(), { 'foxhole.debug.structure.pipeSockets': false }).length, 1);
    assert.equal(resolveFoxholeStructureDisplaySockets(asset, [], new Set(), { 'foxhole.debug.structure.pipeSockets': false, 'foxhole.debug.structure.powerSockets': false }).length, 0);
    assert.deepEqual(asset, before);
    const children = renderFoxholeStructureSocketOverlays(asset, [], [], { 'foxhole.debug.structure.socketLabels': true }, { destroyed: false, packaged: false });
    assert.equal(children.length, 1);
    assert.deepEqual(children[0]?.experimentalPresentation, { contractVersion: 1, excludeFromBounds: true });
    assert.doesNotThrow(() => parseNixieExtensionRenderPlanV1({ schemaVersion: 1, root: { id: 'root', kind: 'group', children } }));
    assert.equal(renderFoxholeStructureSocketOverlays(asset, [], [], {}, { destroyed: true, packaged: false }).length, 0);
    assert.equal(renderFoxholeStructureSocketOverlays(asset, [], [], {}, { destroyed: false, packaged: true }).length, 0);
});

test('selected modification socket sources are normalized/deduplicated and exact-key base precedence is retained', () => {
    const variant = { resourceId: 'test', width: 1, height: 1, anchorX: 0.5, anchorY: 0.5,
        offsetX: 0, offsetY: 0, isUpgrade: true, overlaySockets: [{ name: 'PowerSocket', x: 100, y: 200, rotation: 45, socketTags: [] },
            { name: 'AddedPipelineSocket', x: 300, y: 0, pipeType: 'bidirectional', socketTags: [] }] };
    const sockets = resolveFoxholeStructureDisplaySockets(asset, [variant], new Set(), {});
    assert.equal(sockets.filter(entry => entry.socket.name === 'PowerSocket').length, 1);
    assert.equal(sockets.find(entry => entry.socket.name === 'AddedPipelineSocket')?.x, 96);
    assert.equal(resolveFoxholeSocketDisplayKind({ name: 'ByTag', socketTags: [{ category: 1, mask: 131072 }] }), 'power');
    assert.equal(resolveFoxholeSocketDisplayKind({ name: 'ByTag', socketTags: [{ category: 2048, mask: 16795648 }] }), 'pipe');
});

test('generic bunker socket markers follow All Sockets independently of power and pipe overlays', () => {
    const generic = { name: 'WallSocket', x: 100, y: 50, z: 250, socketTags: [{ category: 4, mask: 1 }] };
    const bunker = { ...asset, overlaySockets: [...asset.overlaySockets!, generic] };
    const render = (settings: Record<string, boolean>) => renderFoxholeSpatialSocketMarkers(bunker, [], [], settings,
        { destroyed: false, packaged: false });
    assert.ok(!render({}).some(marker => marker.label === generic.name));
    assert.ok(!render({ 'foxhole.debug.structure.allSockets': false }).some(marker => marker.label === generic.name));
    assert.ok(render({ 'foxhole.debug.structure.allSockets': true }).some(marker => marker.label === generic.name && marker.point[2] === 80));
    for (const all of [false, true]) {
        const markers = render({ 'foxhole.debug.structure.allSockets': all, 'foxhole.debug.structure.powerSockets': false,
            'foxhole.debug.structure.pipeSockets': false });
        assert.deepEqual(markers.map(marker => marker.label), all ? [generic.name] : []);
    }
});

test('all-socket SDK output includes occupied and generic terminals, grouped legacy labels and stable empty declarations', () => {
    const shared = { name: 'FrontFortSocket', x: 100, y: 50, rotation: 90, socketTags: [] };
    const fixture = { ...asset, overlaySockets: [shared, { ...shared, name: 'BackFortSocket' },
        { ...shared, name: 'PowerSocket', x: 200 }] };
    const overlays = renderFoxholeStructureSocketOverlays(fixture, [], [{ localSocketName: 'FrontFortSocket' }],
        { 'foxhole.debug.structure.allSockets': true, 'foxhole.debug.structure.socketLabels': true,
            'foxhole.debug.structure.powerSockets': false, 'foxhole.debug.structure.pipeSockets': false },
        { destroyed: false, packaged: false }, 'artilleryait1');
    const group = overlays[0]!;
    assert.ok(group.kind === 'group'); assert.equal(group.children.length, 3);
    const first = group.children[0]!; assert.ok(first.kind === 'group');
    const status = first.children[0]!; assert.ok(status.kind === 'graphics');
    assert.ok(status.commands.some(c => c.op === 'fill' && c.color === 0x53D769));
    const labels = first.children.filter(n => n.kind === 'text');
    assert.deepEqual(labels.map(n => n.text), ['2 — Front', '0 — Back']);
    assert.deepEqual(labels.map(n => n.y), [18, 34]);
    assert.ok(labels.every(n => n.experimentalPresentation?.worldUpright === true));
    assert.doesNotThrow(() => parseNixieExtensionRenderPlanV1({ schemaVersion: 1, root: { id: 'root', kind: 'group', children: overlays } }));
    const hidden = renderFoxholeStructureSocketOverlays(fixture, [], [], { 'foxhole.debug.structure.powerSockets': false,
        'foxhole.debug.structure.pipeSockets': false }, { destroyed: false, packaged: false });
    assert.ok(hidden[0]?.kind === 'group' && hidden[0].children.length === 0);
});
