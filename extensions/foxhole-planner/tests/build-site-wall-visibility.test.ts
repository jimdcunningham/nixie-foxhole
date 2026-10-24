import assert from 'node:assert/strict';
import test from 'node:test';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
const entity = (id: string, assetId: string): NixieExperimentalComponentEntitySnapshotV1 => ({ entityId: id, revision: 1, components: [
    { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId } },
] });
test('build-site neighbors do not remove structure layers in Scene V2', () => {
    for (const site of ['fortbuildsite', 'fortcornerbuildsite', 'trenchbuildsite', 'trenchintbuildsite', 'trenchempbuildsite', 'trenchconnectorbuildsite']) {
        for (const key of ['trencht1', 'trencht2', 'trencht3', 'fortt1', 'fortt2', 'fortt3']) {
            const self = entity('self', key), neighbor = entity('neighbor', site);
            const before = renderFoxholeSceneV2Entity(self, { contractVersion: 1, entities: [self, neighbor] });
            self.components.push({ ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments', version: 1, definitionAvailable: true,
                data: { attachments: [{ socketName: 'FrontSocket', targetEntityId: 'neighbor', targetSocketName: 'BackSocket' }] } });
            const after = renderFoxholeSceneV2Entity(self, { contractVersion: 1, entities: [self, neighbor] });
            const layers = (plan: typeof before) => plan.root.children.filter(node => node.id.startsWith('structure-layer-'));
            assert.ok(layers(before).length > 0, key);
            assert.deepEqual(layers(after), layers(before), key + ':' + site);
        }
    }
});
