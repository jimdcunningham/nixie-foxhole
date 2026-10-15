import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFoxholeAssistantAction, foxholeAssistantNodeLabel } from '../app/utils/assistant-client-actions.ts';
test('Planner action normalization retains qualified scene writes and rejects invalid targets', () => {
    const action = { type: 'foxhole.scene.mutate', sceneId: 'scene_1', ops: [{ op: 'placeStructure', foxholeKey: 'facilitypowerdiesel', x: 10, y: 20 }] };
    assert.deepEqual(normalizeFoxholeAssistantAction(action), action);
    assert.equal(normalizeFoxholeAssistantAction({ ...action, sceneId: '' }), null);
    assert.equal(normalizeFoxholeAssistantAction({ ...action, ops: [{ op: 'connectPower', fromNodeId: '' }] }), null);
    assert.equal(normalizeFoxholeAssistantAction({ ...action, type: 'scene.mutate' }), null);
    assert.equal(foxholeAssistantNodeLabel('foxholeStructure', { foxholeKey: 'facilitypipe' }), 'facilitypipe');
    assert.equal(foxholeAssistantNodeLabel('text', { foxholeKey: 'facilitypipe' }), null);
});
