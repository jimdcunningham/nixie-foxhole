import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import { foxholeSceneV2StateAdapter } from './scene-v2-state-adapter.ts';

/** Detached inputs for the existing Statistics UI. No live V1 board is created. */
export function projectFoxholeSceneStatistics(
    entities: readonly NixieExperimentalComponentEntitySnapshotV1[],
    selectedIds: readonly string[],
    activeLayerId: string | null,
): { scene: BoardNodeSnapshot[]; selection: BoardNodeSnapshot[]; layer: BoardNodeSnapshot[]; } {
    const parents = new Map(entities.map(entity => {
        const parent = entity.components.find(component => component.ownerId === 'nixie.core' && component.componentId === 'hierarchy')?.data.parentId;
        return [entity.entityId, typeof parent === 'string' ? parent : null] as const;
    }));
    const belongsTo = (id: string, roots: ReadonlySet<string>) => {
        const seen = new Set<string>();
        for (let current: string | null | undefined = id; current && !seen.has(current); current = parents.get(current)) {
            if (roots.has(current)) return true;
            seen.add(current);
        }
        return false;
    };
    const selected = new Set(selectedIds);
    const layer = new Set(activeLayerId ? [activeLayerId] : []);
    const result: ReturnType<typeof projectFoxholeSceneStatistics> = { scene: [], selection: [], layer: [] };
    for (const entity of entities) {
        if (entity.components.some(component => component.ownerId === 'nixie.foxhole-planner' && component.definitionAvailable === false)) continue;
        const projected = foxholeSceneV2StateAdapter.project(entity);
        if (!projected) continue;
        const snapshot: BoardNodeSnapshot = { id: entity.entityId, type: projected.type, state: projected.state, children: [] };
        result.scene.push(snapshot);
        if (belongsTo(entity.entityId, selected)) result.selection.push(snapshot);
        if (belongsTo(entity.entityId, layer)) result.layer.push(snapshot);
    }
    return result;
}
