import assert from 'node:assert/strict';
import test from 'node:test';
import { bindFoxholeContactShadows } from '../../../tools/foxwatch/catalog/contact-shadows.ts';
import { resolveFoxholeContactShadowProjection, resolveFoxholeContactShadowCenter } from '../src/contact-shadow.ts';
import { renderFoxholeContactShadows } from '../src/scene-v2-contact-shadows.ts';
import type { FoxholeSceneV2AssetMetadata } from '../src/scene-v2-asset-metadata.ts';
import type { NixieExtensionRenderNodeV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import assets from '../src/scene-v2-assets-node.ts';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import { parseNixieExtensionRenderPlanV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';

const source = '/foxhole/assets/types/structures/facilityrefinery2/facilityrefinery2.texture.webp';
// Synthetic padded geometry keeps these contract tests independent of game sidecar files.
const sidecar = {
    width: 658, height: 775, offsetX: 64, offsetY: 24,
    contactShadow: { profile: 'topdown-contact-v2', file: 'facilityrefinery2.shadow.webp', width: 786, height: 903, offsetX: 68, offsetY: 28 },
};
test('catalog compilation retains authored shadow geometry and publication dependencies', async () => {
    const generated = { assets: { facilityrefinery2: { renderLayers: { roof: { resourceId: 'foxhole.visual.roof' } } } as unknown as FoxholeSceneV2AssetMetadata }, visualResources: [{ id: 'roof', sourceUrl: source }], modificationResources: [] };
    const files = await bindFoxholeContactShadows(generated, [{ id: 'facilityrefinery2', sourceUrl: source }], async () => sidecar, async () => true);
    const projection = generated.assets.facilityrefinery2.contactShadows!['foxhole.asset.facilityrefinery2']!;
    assert.equal(projection.width, 786);
    assert.equal(projection.surfaceWidth, 658);
    assert.equal(projection.resourceId, 'foxhole.visual.contact-shadow-asset-facilityrefinery2');
    assert.ok(generated.assets.facilityrefinery2.contactShadows!['foxhole.visual.roof']);
    assert.ok(files.includes(source.replace('.webp', '.json')));
    assert.ok(files.includes(source.replace('.texture.webp', '.shadow.webp')));
});
test('SDK sprite shadows match V1 anchors, extents, offsets, rotation and alpha', () => {
    const projection = resolveFoxholeContactShadowProjection(source, sidecar)!;
    const surface: NixieExtensionRenderNodeV1 = { id: 'building', kind: 'sprite', resourceId: 'surface', x: 32, y: 12, width: 329, height: 387.5, anchorX: 0.2, anchorY: 0.8, rotation: Math.PI / 2, alpha: 0.4 };
    const nodes = renderFoxholeContactShadows([surface], { surface: { ...projection, resourceId: 'shadow' } });
    const shadow = nodes[0]!;
    assert.equal(shadow.kind, 'sprite');
    if (shadow.kind !== 'sprite') {
        return;
    }
    const center = resolveFoxholeContactShadowCenter(projection, 0.2, 0.8);
    assert.ok(Math.abs(shadow.x! - (32 - center.y * 0.5)) < 1e-8);
    assert.ok(Math.abs(shadow.y! - (12 + center.x * 0.5)) < 1e-8);
    assert.equal(shadow.width, 393);
    assert.equal(shadow.height, 451.5);
    assert.equal(shadow.alpha, 0.4);
    assert.equal(shadow.laneId, 'foxhole:structure:contact-shadow');
    assert.equal(shadow.experimentalPresentation?.excludeFromBounds, true);
    assert.equal(nodes[1], surface);
});
test('clipped wall shadows preserve cuts and remap UVs to their padded image', () => {
    const projection = resolveFoxholeContactShadowProjection(source, sidecar)!;
    const node: NixieExtensionRenderNodeV1 = { id: 'wall', kind: 'mesh', resourceId: 'surface', positions: [0, 0, 100, 0, 0, 100], uvs: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2] };
    const shadow = renderFoxholeContactShadows([node], { surface: { ...projection, resourceId: 'shadow' } })[0]!;
    assert.equal(shadow.kind, 'mesh');
    if (shadow.kind !== 'mesh') {
        return;
    }
    assert.equal(shadow.positions, node.positions);
    assert.equal(shadow.indices, node.indices);
    assert.ok(shadow.uvs[0]! > 0 && shadow.uvs[0]! < 0.1);
    assert.ok(shadow.uvs[2]! < 1);
    assert.deepEqual(node.uvs, [0, 0, 1, 0, 0, 1]);
});
test('optional missing or malformed shadows leave surfaces intact', async () => {
    const node: NixieExtensionRenderNodeV1 = { id: 'surface', kind: 'sprite', resourceId: 'surface' };
    const nodes = [node];
    assert.equal(renderFoxholeContactShadows(nodes, undefined), nodes);
    const generated = { assets: { facilityrefinery2: {} as FoxholeSceneV2AssetMetadata }, visualResources: [], modificationResources: [] };
    for (const document of [null, {}, { ...sidecar, contactShadow: { ...sidecar.contactShadow, file: '../escape.shadow.webp' } }]) {
        await bindFoxholeContactShadows(generated, [{ id: 'facilityrefinery2', sourceUrl: source }], async () => document, async () => true);
        assert.equal(generated.assets.facilityrefinery2.contactShadows, undefined);
    }
    await bindFoxholeContactShadows(generated, [{ id: 'facilityrefinery2', sourceUrl: source }], async () => sidecar, async () => false);
    assert.equal(generated.assets.facilityrefinery2.contactShadows, undefined);
});
test('the actual SDK entity renderer consumes compiled shadows and keeps them outside selection bounds', () => {
    const asset = assets.facilityrefinery2;
    const previous = asset.contactShadows;
    const { textureUrl, ...geometry } = resolveFoxholeContactShadowProjection(source, sidecar)!;
    asset.contactShadows = { 'foxhole.asset.facilityrefinery2': { ...geometry, resourceId: 'foxhole.visual.contact-shadow-refinery' } };
    const entity = { entityId: 'refinery-shadow', revision: 1, components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1,
        definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId: 'facilityrefinery2' } }] };
    try {
        const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity));
        const shadow = plan.root.children.find(node => node.id === 'building-texture-contact-shadow');
        assert.equal(shadow?.laneId, 'foxhole:structure:contact-shadow');
        assert.equal(shadow?.experimentalPresentation?.excludeFromBounds, true);
        assert.equal(shadow?.kind === 'sprite' && shadow.width, 393);
        assert.ok(plan.root.children.some(node => node.id === 'building-texture'));
        delete asset.contactShadows;
        assert.equal(renderFoxholeSceneV2Entity(entity).root.children.some(node => node.id.endsWith('-contact-shadow')), false);
    } finally {
        if (previous) {
            asset.contactShadows = previous;
        } else {
            delete asset.contactShadows;
        }
    }
});
test('scaled layers keep shadow dimensions inside a valid transformed group', () => {
    const projection = resolveFoxholeContactShadowProjection(source, sidecar)!;
    const surface: NixieExtensionRenderNodeV1 = { id: 'scaled-roof', kind: 'sprite', resourceId: 'surface', scaleX: 0.5, scaleY: 0.5, rotation: 0.3, anchorX: 0.5, anchorY: 0.5 };
    const children = renderFoxholeContactShadows([surface], { surface: { ...projection, resourceId: 'shadow' } });
    const plan = parseNixieExtensionRenderPlanV1({ schemaVersion: 1, root: { id: 'root', kind: 'group', children } });
    const shadow = plan.root.children[0]!;
    assert.equal(shadow.kind, 'group');
    if (shadow.kind !== 'group') {
        return;
    }
    assert.equal(shadow.scaleX, 0.5);
    assert.equal(shadow.rotation, 0.3);
    assert.equal(shadow.children[0]!.kind === 'sprite' && shadow.children[0].width, 786);
});
