import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as PIXI from 'pixi.js';
import { resolveFoxholeModificationTextureAnchor, resolveFoxholeModificationTexturePosition } from '../app/plugins/foxhole/nixie/modification-anchor.ts';
import { createFoxholeBarbedWireSplineGeometry, createFoxholeSandbagSplineGeometry, resolveFoxholeEmplacementModificationSplineEnd } from '../app/plugins/foxhole/nixie/modification-spline.ts';
import { resolveFoxholeContactShadowCenter } from '../app/plugins/foxhole/nixie/contact-shadow.ts';
import { sampleTextureMesh } from '../../../../extensions/foxhole-planner/tests/helpers/sample-texture-mesh.ts';

// Exercise the actual Native renderer with real Pixi transforms, without needing
// Vue, a GPU, or a persisted project to construct the full board node.
const source = ts.createSourceFile('structure.ts', readFileSync(new URL('../app/plugins/nixie/board/types/foxhole-structure.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const nodeClass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'FoxholeStructureNode') as ts.ClassDeclaration;
const methods = ['createModificationTextureVisual', 'createModificationSplineTextureVisual', 'syncContactShadowVisuals'].map(name =>
    nodeClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name)!.getText(source));
const code = ts.transpile(`class Methods { ${methods.join('\n')} }; return Methods.prototype;`, { target: ts.ScriptTarget.ES2022 });
const prototype = new Function('PIXI', 'FOXHOLE_BOARD_SPRITE_SCALE', 'resolveFoxholeModificationTextureAnchor',
    'resolveFoxholeModificationTexturePosition', 'createFoxholeBarbedWireSplineGeometry', 'createFoxholeSandbagSplineGeometry', 'resolveFoxholeEmplacementModificationSplineEnd', 'resolveFoxholeContactShadowCenter', code)(
    PIXI, 0.5, resolveFoxholeModificationTextureAnchor, resolveFoxholeModificationTexturePosition,
    createFoxholeBarbedWireSplineGeometry, createFoxholeSandbagSplineGeometry, resolveFoxholeEmplacementModificationSplineEnd, resolveFoxholeContactShadowCenter);
const manifest = JSON.parse(readFileSync(new URL('../public/foxhole/assets/manifest.v1.json', import.meta.url), 'utf8'));

for (const variantId of ['barbedwire', 'sandbags']) {
    test(`Native committed and hover ${variantId} panels connect both endpoints with matching alpha and shadows`, () => {
        for (const tier of [1, 2, 3]) {
            const asset = manifest.assets.find((entry: { id: string; }) => entry.id === `trenchempt${tier}`);
            const bounds = { minX: -155, minY: -164, maxX: 165, maxY: 156 };
            const sockets = asset.buildSockets.map((socket: { n: string; x?: number; y?: number; }) => ({ ...socket, name: socket.n }));
            for (const slot of asset.modifications) {
                for (const alpha of [1, 0.65]) {
                    const host = Object.assign(Object.create(prototype), {
                        boardDefinition: { textureResolver: () => PIXI.Texture.EMPTY },
                        boardState: {}, modificationTextureAlphas: new WeakMap(), contactShadowVisuals: new Map(), modificationSplineVisuals: new WeakMap(),
                        getResolvedRenderStructure: () => asset, getResolvedBuildSockets: () => sockets,
                        getResolvedTextureUrl: () => '',
                        trackContactShadow: () => {}, ensureModificationVisualTextureLoaded: () => {},
                    });
                    const variant = slot.variants[variantId];
                    const sprite = variant.sprite ?? manifest.shared.modifications[variant.sharedModificationId].sprite;
                    const visual = { ...sprite, offsetX: sprite.offsetX ?? 0, offsetY: sprite.offsetY ?? 0, anchorX: 0.5, anchorY: 0.5,
                        variantId, textureKey: variantId, rotationDegrees: slot.rotation };
                    const surface = host.createModificationTextureVisual(slot, visual, bounds, alpha) as PIXI.Mesh<PIXI.MeshGeometry>;
                    assert.ok(surface instanceof PIXI.Mesh);
                    new PIXI.Container().addChild(surface);
                    surface.updateLocalTransform();
                    const at = (x: number, y: number) => sampleTextureMesh({ positions: surface.geometry.positions,
                        uvs: surface.geometry.uvs, indices: surface.geometry.indices },
                    0.5 + (x - visual.offsetX) / visual.width, 0.5 + (y - visual.offsetY) / visual.height);
                    const endY = variantId === 'barbedwire' ? 0.64 : 0;
                    const start = at(0, 0), end = at(211.2, endY);
                    const expectedStart = resolveFoxholeModificationTextureAnchor(slot, bounds);
                    const expectedEnd = resolveFoxholeEmplacementModificationSplineEnd(asset.id, slot, bounds, sockets)!;
                    assert.ok(Math.hypot(start.x - expectedStart.x, start.y - expectedStart.y) < 1e-5);
                    assert.ok(Math.hypot(end.x - expectedEnd.x, end.y - expectedEnd.y) < 1e-5);
                    assert.equal(surface.alpha, alpha);
                    assert.equal(host.modificationTextureAlphas.get(surface), alpha);
                    const endSlot = asset.modifications.find((candidate: { x: number; y: number; }) => {
                        const anchor = resolveFoxholeModificationTextureAnchor({ ...candidate, name: '' }, bounds);
                        return Math.hypot(anchor.x - expectedEnd.x, anchor.y - expectedEnd.y) < 1e-5;
                    });
                    if (variantId === 'barbedwire') {
                        const endTip = at(211.2, 20.64), rotation = endSlot.rotation * Math.PI / 180;
                        assert.ok(Math.abs(endTip.x - end.x + Math.sin(rotation) * 10) < 1e-5);
                        assert.ok(Math.abs(endTip.y - end.y - Math.cos(rotation) * 10) < 1e-5);
                    } else {
                        const midpoint = at(105.6, 0);
                        assert.ok(Math.hypot(midpoint.x - (start.x + end.x) / 2, midpoint.y - (start.y + end.y) / 2) < 1e-5);
                    }
                    const projection = { surfaceWidth: visual.width, surfaceHeight: visual.height,
                        surfaceOffsetX: visual.offsetX, surfaceOffsetY: visual.offsetY,
                        width: visual.width + 128, height: visual.height + 128,
                        offsetX: visual.offsetX + 10, offsetY: visual.offsetY + 6 };
                    const shadow = host.createModificationSplineTextureVisual(projection, host.modificationSplineVisuals.get(surface), PIXI.Texture.EMPTY) as PIXI.Mesh<PIXI.MeshGeometry>;
                    host.contactShadowVisuals.set(surface, { sprite: shadow, projection });
                    host.syncContactShadowVisuals();
                    const shadowEnd = sampleTextureMesh({ positions: shadow.geometry.positions, uvs: shadow.geometry.uvs, indices: shadow.geometry.indices },
                        0.5 + (211.2 - projection.offsetX) / projection.width, 0.5 + (endY - projection.offsetY) / projection.height);
                    assert.ok(Math.hypot(shadowEnd.x - end.x, shadowEnd.y - end.y) < 1e-5);
                    shadow.updateLocalTransform();
                    assert.ok(Math.abs(shadow.localTransform.a - surface.localTransform.a) < 1e-6);
                    assert.ok(Math.abs(shadow.localTransform.b - surface.localTransform.b) < 1e-6);
                    assert.equal(shadow.alpha, alpha);
                    shadow.destroy();
                    surface.parent!.destroy({ children: true });
                }
            }
        }
    });
}

test('missing sockets and non-emplacement modifications retain their existing placement', () => {
    const slot = { name: 'FrontDefenseModSlot', x: 500, y: 206, linkedSocketNames: ['FrontSocket'] };
    const bounds = { minX: -160, minY: -160, maxX: 160, maxY: 160 };
    assert.equal(resolveFoxholeEmplacementModificationSplineEnd('trenchempt1', slot, bounds, []), null);
    assert.equal(resolveFoxholeEmplacementModificationSplineEnd('trencht1', slot, bounds, [{ name: 'FrontSocket', x: 500 }]), null);
    assert.equal(resolveFoxholeEmplacementModificationSplineEnd('trenchempt1', { ...slot, name: 'Roof' }, bounds, [{ name: 'FrontSocket', x: 500 }]), null);
});
