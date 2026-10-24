import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';

test('Scene V2 opens each emplacement wall independently and retains its floor and corner posts', () => {
    for (const tier of [1, 2, 3]) {
        for (const direction of ['Front', 'FrontRight', 'Right', 'BackRight', 'Back', 'BackLeft', 'Left', 'FrontLeft']) {
            const subject: NixieExperimentalComponentEntitySnapshotV1 = {
                entityId: 'emplacement', revision: 1, components: [
                    { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1,
                        definitionAvailable: true, data: { catalogId: 'foxhole.structures', assetId: `trenchempt${tier}` } },
                    { ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments', version: 1,
                        definitionAvailable: true, data: { attachments: [{ socketName: `TrenchEmpCommonSockets:${direction}Socket`,
                            targetEntityId: 'neighbor', targetSocketName: 'BackSocket' }] } },
                ],
            };
            const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(subject));
            const layers = plan.root.children.filter(node => node.id.startsWith('structure-layer-'));
            assert.equal(layers.some(node => node.id === `structure-layer-${direction.toLowerCase()}wall`), false);
            assert.equal(layers.some(node => node.id === `structure-layer-dirt${direction.toLowerCase()}`), false);
            assert.equal(layers.filter(node => node.id.endsWith('wall')).length, 7);
            assert.equal(layers.filter(node => /^structure-layer-corner\d+$/.test(node.id)).length, 8);
            assert.equal(layers.some(node => node.id.startsWith('structure-layer-dirt')), false);
            for (const node of layers) {
                assert.equal(node.kind, 'mesh', `${tier} ${node.id} needs the clipped silhouette`);
                if (node.kind === 'mesh') {
                    assert.ok(node.uvs.every(uv => uv >= -1e-6 && uv <= 1 + 1e-6), 'The cut must sample only its own texture');
                    if (/^structure-layer-corner\d+$/.test(node.id)) {
                        assert.equal(node.laneId, 'foxhole:structure:corners');
                    }
                }
            }
            assert.ok(layers.some(node => node.id === 'structure-layer-floor'));
            assert.equal(plan.root.children.some(node => node.id === 'building-texture'), false, 'The closed static wall ring must not cover the opening');
        }
    }
});
