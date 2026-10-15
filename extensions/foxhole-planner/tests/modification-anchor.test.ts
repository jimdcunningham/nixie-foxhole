import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolveFoxholeModificationTextureAnchor, resolveFoxholeModificationTexturePosition } from '../src/modification-anchor.ts';

test('authored modification positions use V1 board scale and selection centre', () => {
    assert.deepEqual(resolveFoxholeModificationTextureAnchor({ name: 'FrontDefenseModSlot', x: 500, y: 206 },
        { minX: -161, minY: -161, maxX: 161, maxY: 161 }), { x: 160, y: 65.92 });
    assert.deepEqual(resolveFoxholeModificationTextureAnchor({ name: 'BridgeModSlot', x: 0, y: 0 },
        { minX: -198, minY: -94, maxX: 194, maxY: 93 }), { x: 2, y: 0.5 });
});

test('omitted zero axes retain authored positions instead of using outward socket offsets', () => {
    const bounds = { minX: -80, minY: -80, maxX: 80, maxY: 80 };
    assert.deepEqual(resolveFoxholeModificationTextureAnchor({ name: 'BackInfraModSlot', x: -250, y: null,
        linkedSocketNames: ['BackSocket'] }, bounds, [{ name: 'BackSocket', x: -250, rotation: 180 }]), { x: -80, y: 0 });
    assert.deepEqual(resolveFoxholeModificationTextureAnchor({ name: 'LeftInfraModSlot', y: -250 }, bounds), { x: 0, y: -80 });
});

test('Z-only fort stairs use the authored origin before the baked crop offset', () => {
    const bounds = { minX: -80, minY: -80, maxX: 80, maxY: 80 };
    const slots = [
        { name: 'FrontFortStairsModSlot', z: -160, rotation: 0, linkedSocketNames: ['FrontFortSocket'] },
        { name: 'BackFortStairsModSlot', z: -160, rotation: -180, linkedSocketNames: ['BackFortSocket'] },
        { name: 'LeftFortStairsModSlot', z: -160, rotation: -90, linkedSocketNames: ['LeftFortSocket'] },
        { name: 'RightFortStairsModSlot', z: -160, rotation: 90, linkedSocketNames: ['RightFortSocket'] },
    ];
    for (const slot of slots) {
        const sockets = [{ name: slot.linkedSocketNames[0], x: 250, rotation: slot.rotation }];
        assert.deepEqual(resolveFoxholeModificationTextureAnchor(slot, bounds, sockets), { x: 0, y: 0 });
        const position = resolveFoxholeModificationTexturePosition(slot, bounds, sockets,
            { offsetX: 220.965, offsetY: 0, rotationDegrees: slot.rotation });
        assert.ok(Math.abs(Math.hypot(position.x, position.y) - 110.4825) < 1e-9);
    }
});

test('published bunker furniture retains its inward projection offset on all four walls', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../packages/extensions/foxhole/public/foxhole/assets/manifest.v1.json', import.meta.url), 'utf8'));
    const bounds = { minX: -80, minY: -80, maxX: 80, maxY: 80 };
    for (const assetId of ['fortt2', 'fortt3']) {
        const asset = manifest.assets.find((entry: { id: string }) => entry.id === assetId);
        const slots = asset.modifications.filter((slot: { name: string }) => slot.name.endsWith('InfraModSlot'));
        assert.equal(slots.length, 4);
        for (const slot of slots) {
            for (const variantId of ['bunkbed', 'desk', 'kitchen']) {
                const sprite = manifest.shared.modifications[slot.variants[variantId].sharedModificationId].sprite;
                const position = resolveFoxholeModificationTexturePosition(slot, bounds, [], {
                    ...sprite, rotationDegrees: slot.rotation,
                });
                const anchor = resolveFoxholeModificationTextureAnchor(slot, bounds);
                const radius = Math.hypot(position.x, position.y);
                assert.ok(radius < Math.hypot(anchor.x, anchor.y) - 10, `${assetId}/${slot.name}/${variantId} must sit inward`);
                const rotation = Number(slot.rotation ?? 0) * Math.PI / 180;
                const halfWidth = (Math.abs(Math.cos(rotation)) * sprite.width + Math.abs(Math.sin(rotation)) * sprite.height) * 0.25;
                const halfHeight = (Math.abs(Math.sin(rotation)) * sprite.width + Math.abs(Math.cos(rotation)) * sprite.height) * 0.25;
                const outerEdge = anchor.x !== 0 ? Math.abs(position.x) + halfWidth : Math.abs(position.y) + halfHeight;
                assert.ok(outerEdge < 81, `${assetId}/${slot.name}/${variantId} protrudes through its attachment wall`);
            }
        }
    }
});

test('cropping offsets rotate around an asymmetric host selection centre', () => {
    const position = resolveFoxholeModificationTexturePosition({ name: 'BridgeModSlot', x: 0, y: 0 },
        { minX: -198, minY: -94, maxX: 194, maxY: 93 }, [], { offsetX: 20, offsetY: -40, rotationDegrees: 90 });
    assert.ok(Math.abs(position.x - 22) < 1e-12);
    assert.ok(Math.abs(position.y - 10.5) < 1e-12);
});

test('linked sockets use native outward offsets and qualified socket names', () => {
    const bounds = { minX: -80, minY: -80, maxX: 80, maxY: 80 };
    const sockets = [{ name: 'Blueprint:BackSocket', x: -250, y: 0, rotation: 180 }];
    const anchor = resolveFoxholeModificationTextureAnchor({ name: 'BackFortStairsModSlot', linkedSocketNames: ['BackSocket'] }, bounds, sockets);
    assert.equal(anchor.x, -98);
    assert.ok(Math.abs(anchor.y) < 1e-12);
    const end = resolveFoxholeModificationTextureAnchor({ name: 'BackEndModSlot', linkedSocketNames: ['BackSocket'] }, bounds, sockets);
    assert.equal(end.x, -108);
    assert.deepEqual(resolveFoxholeModificationTextureAnchor({ name: 'Unlinked' }, bounds, sockets), { x: 0, y: 0 });
});
