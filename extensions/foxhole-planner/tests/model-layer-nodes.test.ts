import assert from 'node:assert/strict';
import test from 'node:test';
import { readFoxholeGeneratedModel } from './generated-models.ts';
import assets from '../src/scene-v2-assets-node.ts';
import type { FoxholeModelLayerMetadata } from '../src/model-layer-nodes.ts';
import { bindFoxholeModelLayerNodes } from '../src/model-layer-nodes.ts';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import type { NixieExperimentalComponentEntitySnapshotV1, NixieExperimentalComponentJsonValueV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';

test('packed foundation borders follow the same socket visibility as flat layers', () => {
    const metadata = assets.foundation012x2t3 as FoxholeModelLayerMetadata;
    bindFoxholeModelLayerNodes(metadata, readFoxholeGeneratedModel('foundation012x2t3'));
    assert.equal(Object.entries(metadata.modelLayerNodes!).filter(([id]) => id !== 'floor').flatMap(([,names]) => names).length, 12);
    const make = (attachments: NixieExperimentalComponentJsonValueV1[]): NixieExperimentalComponentEntitySnapshotV1 => ({ entityId: 'foundation', revision: 1, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId: 'foundation012x2t3' } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments', version: 1, definitionAvailable: true,
            data: { attachments } },
    ] });
    const connected = make(['FrontSocket0', 'FrontSocket1'].map(localSocketName => ({ localSocketName,
        targetEntityId: 'neighbor', targetSocketName: 'BackSocket0' })));
    const plan = renderFoxholeSceneV2Entity(connected);
    assert.equal(plan.experimentalSpatial?.hiddenModelNodes?.length, 4);
    assert.deepEqual(new Set(plan.experimentalSpatial?.hiddenModelNodes), new Set(['frontborder0', 'frontborder1', 'frontleftpillar', 'frontrightpillar'].flatMap(id => metadata.modelLayerNodes![id]!)));
    const detached = renderFoxholeSceneV2Entity(make([]));
    assert.equal(detached.experimentalSpatial?.hiddenModelNodes, undefined);
});
