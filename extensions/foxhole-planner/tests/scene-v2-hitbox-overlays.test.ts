import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/scene-v2';
import { createFoxholeSceneV2AssetMetadata } from '../src/scene-v2-asset-metadata.ts';
import { renderFoxholeHitboxOverlays } from '../src/scene-v2-hitbox-overlays.ts';

const setting = { 'foxhole.debug.structure.hitboxes': true };
const subject = { entityId: 'host', revision: 1, components: [] } as NixieExperimentalComponentEntitySnapshotV1;
const sourceShape = [2.085, -1.015, 2.07, 0.993, 1.038, 2.329, -2.372, 2.303, -2.336, -2.413, 1.055, -2.387];
const asset = createFoxholeSceneV2AssetMetadata({ assets: [{ id: 'atgunait2', sprite: { width: 128, height: 64 },
    lineOfSightPolygons: [{ shape: sourceShape }, { shape: [1, 2, 3] }] }] }).assets.atgunait2!;
function child(parentId: string, points: number[], basisWidth = 64, basisHeight = 32): NixieExperimentalComponentEntitySnapshotV1 {
    return { entityId: 'child', revision: 1, components: [
        { ownerId: 'nixie.core', componentId: 'hierarchy', version: 1, definitionAvailable: true, data: { parentId } },
        { ownerId: 'nixie.core', componentId: 'hitbox', version: 1, definitionAvailable: true, data: { points, basisWidth, basisHeight } },
    ] } as NixieExperimentalComponentEntitySnapshotV1;
}
function polygon(result: ReturnType<typeof renderFoxholeHitboxOverlays>) {
    const group = result[0];
    assert.equal(group?.kind, 'group');
    if (group?.kind !== 'group') throw Error('expected group');
    const graphics = group.children[0];
    assert.equal(graphics?.kind, 'graphics');
    if (graphics?.kind !== 'graphics') throw Error('expected graphics');
    const command = graphics.commands[0];
    assert.equal(command?.op, 'polygon');
    if (command?.op !== 'polygon') throw Error('expected polygon');
    assert.equal(group.experimentalPresentation?.excludeFromBounds, true);
    assert.doesNotThrow(() => parseNixieExtensionRenderPlanV1({ schemaVersion: 1, root: group }));
    return command.points;
}
test('real AT gun extracted hitbox is retained and drawn in board pixels', () => {
    assert.deepEqual(asset.lineOfSightPolygons, [{ shape: sourceShape }]);
    assert.deepEqual(renderFoxholeHitboxOverlays(subject, asset, [], [], {}), []);
    assert.deepEqual(polygon(renderFoxholeHitboxOverlays(subject, asset, [], [], setting))[0], { x: 2.085 * 32, y: -1.015 * 32 });
});
test('authored child wins and scales from its basis; other hosts and invalid children do not', () => {
    const points = [1, 2, 3, 4, 5, 6];
    const result = renderFoxholeHitboxOverlays(subject, asset, [], [child('other', [9, 9, 10, 10, 11, 11]), child('host', points)], setting);
    assert.deepEqual(polygon(result)[0], { x: asset.width / 64, y: 2 * asset.height / 32 });
    assert.deepEqual(polygon(renderFoxholeHitboxOverlays(subject, asset, [], [child('host', [1, 2, 3])], setting))[0], { x: 2.085 * 32, y: -1.015 * 32 });
});
test('selected modification polygon supersedes base polygon', () => {
    const variant = { resourceId: 'x', width: 1, height: 1, anchorX: 0, anchorY: 0, offsetX: 0, offsetY: 0, isUpgrade: false,
        lineOfSightPolygons: [{ shape: [1, 2, 3, 4, 5, 6] }] };
    assert.deepEqual(polygon(renderFoxholeHitboxOverlays(subject, asset, [variant], [], setting))[0], { x: 32, y: 64 });
});
