import assert from 'node:assert/strict';
import test from 'node:test';
import assets from '../src/scene-v2-assets-node.ts';
import { resolveFoxholeEntityStructureSockets } from '../src/effective-structure-sockets.ts';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';

const positions = { BackModSlot: [-299.42903, -147.27136, 180], FrontModSlot: [299.42903, 147.27136, 0],
    LeftModSlot: [147.27136, -299.42903, -90], RightModSlot: [-147.27136, 299.42903, 90] };
function entity(selections: Array<{slotId: string; variantId: string}>): NixieExperimentalComponentEntitySnapshotV1 {
    return { entityId: 'engine', revision: 1, components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'modification',
        version: 1, definitionAvailable: true, data: { selections } }] };
}
for (const id of ['engineroomt2', 'engineroomt3']) {
    test(id + ' has no placeholder power socket without a connection modification', () => {
        assert.equal(resolveFoxholeEntityStructureSockets(entity([]), assets[id]).some(s => s.name.includes('PowerSocket')), false);
    });
    for (const [slotId, [x, y, yaw]] of Object.entries(positions)) {
        test(id + ' follows the source connection socket on ' + slotId, () => {
            const sockets = resolveFoxholeEntityStructureSockets(entity([{ slotId, variantId: 'powerconnection' }]), assets[id]);
            const power = sockets.filter(s => s.socketTags?.some(t => t.mask === 131072));
            assert.equal(power.length, 1);
            assert.ok(Math.abs(power[0]!.x - x! * .32) < .002);
            assert.ok(Math.abs(power[0]!.y - y! * .32) < .002);
            assert.ok(Math.abs(power[0]!.z! - 62.74524 * .32) < .002);
            assert.ok(Math.abs(Math.sin(power[0]!.rotation - yaw! * Math.PI / 180)) < .00001);
        });
    }
}

for (const id of ['engineroomt2', 'engineroomt3']) {
    test(id + ' resolves older conflicting selections consistently to a single real socket', () => {
        const subject = entity([{ slotId: 'BackModSlot', variantId: 'powerconnection' }, { slotId: 'FrontModSlot', variantId: 'powerconnection' }]);
        const before = structuredClone(subject);
        const sockets = resolveFoxholeEntityStructureSockets(subject, assets[id]).filter(s => s.socketTags?.some(t => t.mask === 131072));
        assert.equal(sockets.length, 1);
        assert.ok(sockets[0]!.x < 0);
        assert.deepEqual(subject, before);
    });
}
