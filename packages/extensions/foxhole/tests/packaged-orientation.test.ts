import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Container, Texture } from 'pixi.js';
import { NixieSceneV2ComponentHost } from '../../../nixie/desktop-extensions/scene-v2-component-host.ts';
import { NIXIE_SCENE_V2_CORE_COMPONENTS } from '../../../nixie/desktop-extensions/scene-v2-core-components.ts';
import { convertNixieSceneV1ToV2 } from '../../../nixie/desktop-extensions/scene-v2-conversion.ts';
import { buildNixieSceneV2InspectorPatches } from '../../../nixie/app/utils/nixie-scene-v2-inspector.ts';
import { registerNixieSceneV2StateAdapter } from '../../../nixie/app/utils/nixie-scene-v2-state-adapter-registry.ts';
import { NixieExtensionRenderPlanHost } from '../../../nixie/app/plugins/nixie/scene-v2/render-plan-host.ts';
import { applyTransform } from '../../../nixie/app/plugins/nixie/board/types/primitives/shared.ts';
import { convertFoxholeSceneV1NodeToV2 } from '../app/plugins/foxhole/nixie/scene-v2-conversion.ts';
import { foxholeSceneV2StateAdapter } from '../app/plugins/foxhole/nixie/scene-v2-state-adapter.ts';
import { createFoxholeSceneV2AssetMetadata } from '../../../../extensions/foxhole-planner/src/scene-v2-asset-metadata.ts';
import assets from '../../../../extensions/foxhole-planner/src/scene-v2-assets-node.ts';
import { renderFoxholeSceneV2Entity } from '../../../../extensions/foxhole-planner/src/scene-v2-renderers.ts';

const owner = 'nixie.foxhole-planner';
const manifest = JSON.parse(readFileSync(new URL('../../../../extensions/foxhole-planner/nixie.extension.json', import.meta.url), 'utf8'));

function aircraft(rotation: number) {
    const converted = convertNixieSceneV1ToV2([{ id: 'aircraft', type: 'foxholeAsset', state: {
        foxholeKey: 'aircraftscoutc', x: 123, y: -47, rotation, scaleX: 1.25, scaleY: 0.75,
    }, children: [] }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });
    const host = new NixieSceneV2ComponentHost();
    host.registerExtension('nixie.core', NIXIE_SCENE_V2_CORE_COMPONENTS);
    host.registerExtension(owner, manifest.contributes.experimentalComponents);
    host.replaceDocument(converted.content);
    return { host, id: converted.content.entities[0]!.entityId };
}

function near(actual: number, expected: number) {
    assert.ok(Math.abs(actual - expected) < 0.0001, `${actual} differs from ${expected}`);
}

for (const degrees of [0, 90, 37]) {
    test(`aircraft packaging Inspector edits preserve identity and transform at ${degrees} degrees through undo and redo`, () => {
        registerNixieSceneV2StateAdapter(owner, foxholeSceneV2StateAdapter);
        const { host, id } = aircraft(degrees * Math.PI / 180);
        const before = host.exportDocument();
        const initial = host.readEntity(id);
        const retained = initial.components.filter(component => component.componentId !== 'appearance');
        const normalPlan = renderFoxholeSceneV2Entity(initial);
        const edit = (packaged: boolean) => {
            const updates = buildNixieSceneV2InspectorPatches(host.readEntity(id), { packaged });
            assert.ok(updates.length > 0);
            host.applyEditorComponentPatches(updates.map(update => ({ ...update, entityId: id })));
            const current = host.readEntity(id);
            assert.equal(current.entityId, initial.entityId);
            assert.deepEqual(current.components.filter(component => component.componentId !== 'appearance'), retained);
            assert.equal(foxholeSceneV2StateAdapter.project(current)!.state.packaged === true, packaged);
            return current;
        };
        const packaged = edit(true);
        const packagedPlan = renderFoxholeSceneV2Entity(packaged);
        const body = packagedPlan.root.children.find(node => node.id === 'building-texture');
        assert.ok(body?.kind === 'sprite');
        assert.equal(body.rotation ?? 0, 0, 'the package must not add a local heading correction');
        assert.equal(packagedPlan.root.rotation ?? 0, 0);
        assert.ok(packagedPlan.root.children.some(node => node.id === 'packaged-pallet'));
        edit(false);
        assert.deepEqual(renderFoxholeSceneV2Entity(host.readEntity(id)), normalPlan);
        host.undo();
        assert.equal(foxholeSceneV2StateAdapter.project(host.readEntity(id))!.state.packaged, true);
        host.undo();
        assert.deepEqual(host.exportDocument(), before);
        host.redo();
        assert.deepEqual(renderFoxholeSceneV2Entity(host.readEntity(id)), packagedPlan);
        assert.deepEqual(host.readEntity(id).components.filter(component => component.componentId !== 'appearance'), retained);
    });
}

test('published off-center pallet metadata renders aligned with its aircraft and rotates selection bounds with the parent', async () => {
    const id = 'packagedorientationfixture';
    const generated = createFoxholeSceneV2AssetMetadata({
        shared: { packaging: { aircraft: { textureUrl: '/foxhole/assets/packaged-pallets/aircraft.texture.webp',
            width: 160, height: 320, anchorX: 0.5, anchorY: 0.5, offsetX: 4, offsetY: -8 } } },
        assets: [{ id, codeName: 'AircraftScoutC', isVehicle: true,
            sprite: { source: `/foxhole/assets/types/vehicles/${id}/${id}.texture.webp`, width: 600, height: 220, offsetX: 14, offsetY: -28 },
            packaged: { shippableType: 'aircraft', palletOffset: { x: 14, y: -10, rotationDegrees: -90 },
                sprite: { source: `/foxhole/assets/types/vehicles/${id}/${id}.packaged.texture.webp`, width: 580, height: 190, offsetX: 22, offsetY: -36 } } }],
    });
    assert.equal(Object.hasOwn(assets, id), false);
    assets[id] = generated.assets[id]!;
    try {
        for (const degrees of [0, 90, 37]) {
            const { host, id: entityId } = aircraft(degrees * Math.PI / 180);
            const entity = host.readEntity(entityId);
            const subject = { ...entity, components: entity.components.map(component => component.componentId === 'asset'
                ? { ...component, data: { catalogId: 'foxhole.structures', assetId: id } }
                : component).concat([
                { ownerId: owner, componentId: 'appearance', version: 1, definitionAvailable: true, data: { packaged: true } },
            ]) };
            const plan = renderFoxholeSceneV2Entity(subject);
            for (const [key, expected] of Object.entries({ minX: -71, minY: -49, maxX: 89, maxY: 31 })) {
                near(plan.experimentalSelectionGeometry!.localBounds[key as 'minX' | 'minY' | 'maxX' | 'maxY'], expected);
            }
            const packagedBody = plan.root.children.find(node => node.id === 'building-texture');
            assert.ok(packagedBody?.kind === 'sprite');
            assert.equal(packagedBody.resourceId, `foxhole.visual.${id}-packaged`);
            assert.equal(packagedBody.width, 290);
            assert.equal(packagedBody.height, 95);
            const renderHost = new NixieExtensionRenderPlanHost({ loadTexture: async () => Texture.EMPTY });
            const parent = new Container();
            try {
                applyTransform(parent, { x: 123, y: -47, rotation: degrees * Math.PI / 180,
                    scaleX: 1.25, scaleY: 0.75, visible: true, alpha: 1 });
                const root = await renderHost.replace(plan);
                parent.addChild(root);
                const body = root.getChildByLabel('building-texture')!;
                const pallet = root.getChildByLabel('packaged-pallet')!;
                near(body.x, 11);
                near(body.y, -18);
                near(pallet.x, 9);
                near(pallet.y, -9);
                near(pallet.rotation, -Math.PI / 2);
                const bodyOrigin = body.toGlobal({ x: 0, y: 0 });
                const bodyForward = body.toGlobal({ x: 1, y: 0 });
                const palletOrigin = pallet.toGlobal({ x: 0, y: 0 });
                const palletForward = pallet.toGlobal({ x: 0, y: 1 });
                const bodyAngle = Math.atan2(bodyForward.y - bodyOrigin.y, bodyForward.x - bodyOrigin.x);
                const palletAngle = Math.atan2(palletForward.y - palletOrigin.y, palletForward.x - palletOrigin.x);
                near(bodyAngle, degrees * Math.PI / 180);
                near(palletAngle, bodyAngle);
                const local = plan.experimentalSelectionGeometry!.localBounds;
                const corners = [{ x: local.minX, y: local.minY }, { x: local.maxX, y: local.minY },
                    { x: local.maxX, y: local.maxY }, { x: local.minX, y: local.maxY }].map(point => parent.toGlobal(point));
                const bounds = pallet.getBounds();
                near(bounds.minX, Math.min(...corners.map(point => point.x)));
                near(bounds.minY, Math.min(...corners.map(point => point.y)));
                near(bounds.maxX, Math.max(...corners.map(point => point.x)));
                near(bounds.maxY, Math.max(...corners.map(point => point.y)));
            } finally {
                renderHost.destroy();
                parent.destroy({ children: true });
            }
        }
    } finally {
        Reflect.deleteProperty(assets, id);
    }
});
