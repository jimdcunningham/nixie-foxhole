import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const selectionSource = readFileSync(
    new URL('../../../../nixie/app/plugins/nixie/contributions/tools/selection.contrib.ts', import.meta.url),
    'utf8',
);
const presenceSource = readFileSync(
    new URL('../../../../nixie/app/plugins/nixie/services/presence.ts', import.meta.url),
    'utf8',
);
const nodeSource = readFileSync(
    new URL('../../../../nixie/app/plugins/nixie/board/types/node.ts', import.meta.url),
    'utf8',
);
const foxholeStructureSource = readFileSync(
    new URL('../../app/plugins/nixie/board/types/foxhole-structure.ts', import.meta.url),
    'utf8',
);

test('editable handle drags publish their mutation patch in selection presence', () => {
    assert.match(
        selectionSource,
        /collectRealtimeEditableSelectionPreviews\(\)[\s\S]*?buildEditableHandleCommit\(state\.session\)[\s\S]*?patch: this\.clonePreviewPatch\(mutation\.patch\)/,
    );
    assert.match(
        selectionSource,
        /publishTransformPreview[\s\S]*?editableNodes:[\s\S]*?collectRealtimeEditableSelectionPreviews\(\)/,
    );
    assert.match(
        selectionSource,
        /endTransformPreview[\s\S]*?editableNodes[\s\S]*?payload: this\.buildSelectionPreviewPayload[\s\S]*?editableNodes/,
    );
});

test('custom asset placement publishes live editable previews until commit or cancel', () => {
    assert.match(
        selectionSource,
        /beginSelectionPlacement[\s\S]*?updatePlacementSession\(session, placementContext\)[\s\S]*?presence\.beginPreview\([\s\S]*?buildCustomPlacementPreviewPayload/,
    );
    assert.match(
        selectionSource,
        /onPointerMove[\s\S]*?customPlacementState\.provider\.updatePlacementSession[\s\S]*?publishCustomPlacementPreview\(customPlacementState/,
    );
    assert.match(
        selectionSource,
        /buildCustomPlacementPreviewPayload[\s\S]*?mode: 'custom-placement'[\s\S]*?provider\.toBoardSnapshot\(\)\.state/,
    );
    assert.match(
        selectionSource,
        /result === 'complete'[\s\S]*?presence\.endPreview\([\s\S]*?persist: true[\s\S]*?commitEditableMutation/,
    );
    assert.match(
        selectionSource,
        /options\.cancel && customPlacementState[\s\S]*?cancelPlacementSession[\s\S]*?presence\.endPreview\([\s\S]*?clear: true/,
    );
});

test('socket attachment changes ride the transient move preview channel', () => {
    assert.match(
        nodeSource,
        /collectMoveLivePreviewPatches\?\(\): BoardNodeMoveSnapPatch\[\]/,
    );
    assert.match(
        foxholeStructureSource,
        /collectMoveLivePreviewPatches\(\): BoardNodeMoveSnapPatch\[\][\s\S]*?patch: \{ socketAttachments \}/,
    );
    assert.match(
        selectionSource,
        /mode === 'move' \|\| mode === 'move-axis' \|\| mode === 'rotate'[\s\S]*?collectRealtimeMoveLivePreviews\(\)[\s\S]*?nextPayload\.editableNodes/,
    );
    assert.match(
        selectionSource,
        /publishTransformPreview[\s\S]*?editableNodes:[\s\S]*?collectRealtimeMoveLivePreviews\(\)/,
    );
});

test('remote editable previews apply transiently and cannot revert a newer commit', () => {
    assert.match(
        presenceSource,
        /parseSelectionPreviewEditableNodes[\s\S]*?payload\.editableNodes/,
    );
    assert.match(
        presenceSource,
        /syncRemoteEditablePreview[\s\S]*?reason: 'selection-remote-editable-preview'[\s\S]*?source: 'remote'[\s\S]*?recordHistory: false/,
    );
    assert.match(
        presenceSource,
        /restoreNodeEditablePreview[\s\S]*?node\.boardRevision\.value !== preview\.appliedRevision[\s\S]*?selection-remote-editable-preview-revert/,
    );
    assert.match(
        presenceSource,
        /persistedPreviewKey[\s\S]*?authoritative revision after our transient patch supersedes[\s\S]*?isSelectionPreviewPatchCommitted[\s\S]*?settledRemoteEditablePreviewKeys\.set/,
    );
    assert.match(
        presenceSource,
        /this\.syncRemoteEditablePreview\(remoteSession\);[\s\S]*?Apply transient transforms last[\s\S]*?this\.syncRemoteSelectionPreview\(remoteSession\);/,
    );
});
