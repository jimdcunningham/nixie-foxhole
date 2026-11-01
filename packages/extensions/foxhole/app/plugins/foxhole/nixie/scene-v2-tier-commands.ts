import type { NixieSceneV2EditorRuntimeController } from '#nixie/utils/nixie-scene-v2-editor-runtime.ts';
import { buildNixieSceneV2InspectorSelectionUpdates, projectNixieSceneV2InspectorDetails } from '#nixie/utils/nixie-scene-v2-inspector.ts';
import { getFoxholeLegacyStructureCatalog } from './legacy-asset-catalog.ts';
import { resolveFoxholeStructureTierMutation } from './structure-tier-actions.ts';
import type { FoxholeStructureTierDirection } from './structure-tier-actions.ts';

/** Use the same projected state and finalized edit path as the native Inspector. */
export function buildFoxholeSceneV2SelectionTierUpdates(controller: NixieSceneV2EditorRuntimeController, direction: FoxholeStructureTierDirection) {
    const entries = projectNixieSceneV2InspectorDetails(controller.entities, controller.selection.ids, { snapshotChildren: false })
        .flatMap(detail => {
            const snapshot = detail.snapshot;
            if (snapshot.type !== 'foxholeAsset' || snapshot.state.destroyed === true || snapshot.state.packaged === true) {
                return [];
            }
            const mutation = resolveFoxholeStructureTierMutation(getFoxholeLegacyStructureCatalog(), snapshot.state, direction);
            return mutation ? [{ detail, mutation }] : [];
        });
    if (entries.some(entry => entry.detail.effectiveLocked)) {
        return [];
    }
    return entries.flatMap(({ detail, mutation }) => buildNixieSceneV2InspectorSelectionUpdates(controller, [detail.id], mutation.patch as Record<string, unknown>));
}
