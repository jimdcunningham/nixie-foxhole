import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import { createFoxholeSceneV2AssetMetadata, normalizeFoxholeSceneV2StructureVolumes } from '../src/scene-v2-asset-metadata.ts';
import { FOXHOLE_STRUCTURE_VOLUME_SETTING_IDS, renderFoxholeStructureVolumeOverlays } from '../src/scene-v2-structure-volume-overlays.ts';

const fixture = createFoxholeSceneV2AssetMetadata({ assets: [{ id: 'volume-fixture', sprite: { width: 128, height: 128 },
    structureVolumes: [
        { n: 'KillVolume', l: 'Kill Volume', g: 'killVolume', c: 'BoxComponent', x: -25, z: 159.5, w: 233.5, d: 250, h: 316 },
        { n: 'BuildFootprintBox1', l: 'Footprint', g: 'footprint', x: -25, w: 233.5, d: 250, r: 90 },
        { n: 'BlockBuildSiteMovement', w: 300, d: 300 },
    ] }] }).assets['volume-fixture']!;

test('FoxWatch normalizes real compact volume fields and independent category toggles', () => {
    assert.equal(fixture.structureVolumes?.length, 3);
    assert.deepEqual(fixture.structureVolumes?.[0], { category: 'killVolume', label: 'Kill Volume', x: -25, y: 0, width: 233.5, length: 250, rotation: 0 });
    const off = renderFoxholeStructureVolumeOverlays(fixture, {}, { destroyed: false, packaged: false });
    assert.deepEqual(off, []);
    const on = renderFoxholeStructureVolumeOverlays(fixture, { 'foxhole.debug.structure.volume.footprint': true },
        { destroyed: false, packaged: false });
    const root = on[0]; assert.ok(root && root.kind === 'group');
    assert.equal(root.experimentalPresentation?.excludeFromBounds, true);
    assert.equal(root.children.length, 1);
    const child = root.children[0]; assert.ok(child && child.kind === 'group');
    assert.equal(child.x, -8); assert.equal(child.y, 0); assert.equal(child.rotation, Math.PI / 2);
    assert.doesNotThrow(() => parseNixieExtensionRenderPlanV1({ schemaVersion: 1, root: { id: 'root', kind: 'group', children: on } }));
    assert.equal(renderFoxholeStructureVolumeOverlays(fixture, Object.fromEntries(FOXHOLE_STRUCTURE_VOLUME_SETTING_IDS.map(id => [id, true])),
        { destroyed: false, packaged: false })[0]?.kind, 'group');
    assert.deepEqual(renderFoxholeStructureVolumeOverlays(fixture, { 'foxhole.debug.structure.volume.footprint': true },
        { destroyed: true, packaged: false }), []);
});

test('invalid or oversized component values are excluded from bounded catalog metadata', () => {
    assert.deepEqual(normalizeFoxholeSceneV2StructureVolumes([{ w: -1, d: 10 }, { w: 1, d: Infinity },
        { w: 20, d: 10, x: 1000001 }, { w: 0, d: 5 }]), []);
    assert.equal(normalizeFoxholeSceneV2StructureVolumes(Array.from({ length: 130 }, () => ({ w: 20, d: 10 }))).length, 128);
});
