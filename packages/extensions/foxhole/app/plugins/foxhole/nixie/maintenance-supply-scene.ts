import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk';
import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import { multiplyNixieSceneV2Matrices, nixieSceneV2TransformMatrix, resolveNixieSceneV2Transforms, NIXIE_SCENE_V2_IDENTITY_MATRIX } from '#nixie/../desktop-extensions/scene-v2-transforms.ts';
import type { NixieSceneV2Matrix } from '#nixie/../desktop-extensions/scene-v2-transforms.ts';
import { foxholeSceneV2StateAdapter } from './scene-v2-state-adapter.ts';
import { resolveFoxholeMaintenanceSupplyDrain } from './maintenance-supplies.ts';
import type { getFoxholeStructureCatalog } from './catalog.ts';
import type { FoxholeMaintenanceCandidate } from './maintenance-supply.ts';

type Catalog = ReturnType<typeof getFoxholeStructureCatalog>;
function candidate(id: string, type: string, state: Record<string, unknown>, world: NixieSceneV2Matrix, catalog: Catalog): FoxholeMaintenanceCandidate | null {
    if (type !== 'foxholeAsset') {
        return null;
    }
    const key = String(state.foxholeKey ?? '');
    const asset = catalog.assetByKey[key];
    const structure = catalog.structureByKey[key];
    if (!asset || !structure) {
        return null;
    }
    return { id, assetId: key, category: asset.categoryKey, x: world.tx, y: world.ty,
        drain: resolveFoxholeMaintenanceSupplyDrain(structure), operational: state.destroyed !== true && state.packaged !== true };
}

export function projectFoxholeMaintenanceSceneV2(entities: readonly NixieExperimentalComponentEntitySnapshotV1[], catalog: Catalog): FoxholeMaintenanceCandidate[] {
    const transforms = resolveNixieSceneV2Transforms(entities);
    return entities.flatMap(entity => {
        const snapshot = foxholeSceneV2StateAdapter.project(entity);
        const resolved = transforms.get(entity.entityId);
        const result = snapshot && resolved?.hierarchyResolved ? candidate(entity.entityId, snapshot.type, snapshot.state, resolved.world, catalog) : null;
        return result ? [result] : [];
    });
}

export function projectFoxholeMaintenanceSceneV1(roots: readonly BoardNodeSnapshot[], catalog: Catalog): FoxholeMaintenanceCandidate[] {
    const results: FoxholeMaintenanceCandidate[] = [];
    function walk(nodes: readonly BoardNodeSnapshot[], parent: NixieSceneV2Matrix): void {
        for (const node of nodes) {
            const state = node.state;
            const finite = (key: string, fallback: number) => typeof state[key] === 'number' && Number.isFinite(state[key]) ? state[key] as number : fallback;
            const world = multiplyNixieSceneV2Matrices(parent, nixieSceneV2TransformMatrix({
                x: finite('x', 0), y: finite('y', 0), rotation: finite('rotation', 0), scaleX: finite('scaleX', 1), scaleY: finite('scaleY', 1),
            }));
            const result = candidate(String(node.id), node.type, state, world, catalog);
            if (result) {
                results.push(result);
            }
            walk(node.children, world);
        }
    }
    walk(roots, NIXIE_SCENE_V2_IDENTITY_MATRIX);
    return results;
}
