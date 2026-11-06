import type { SceneSnapshotV1, SelectionSnapshotV1 } from '@nixiejs/extension-sdk';
import { decodeNixieExperimentalSceneV2SnapshotNodeV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/scene-v2';
import assets, { productionRecipesById, bunkerDestructionWeapons } from '#foxhole-scene-v2-assets';
import { aggregateFoxholeEcsProduction, FOXHOLE_STATISTICS_INTERVALS } from './production-statistics.ts';
import { aggregateFoxholeEcsResources } from './resource-statistics.ts';
import { resolveFoxholeEcsBunkerStatistics } from './bunker-statistics.ts';

export type StatisticsScope = 'auto' | 'selection' | 'layer' | 'scene';
const ownerId = 'nixie.foxhole-planner';

export function readStatisticsPreferences(scene: SceneSnapshotV1): { scope: StatisticsScope; intervalSeconds: number; intervalLabel: string; } {
    const context = scene.experimentalPanelContext;
    const values = context?.ownerId === ownerId && context.panelId === 'statistics' ? context.values : {};
    const requestedScope = values[`${ownerId}.stats.scope`];
    const scope: StatisticsScope = ['selection', 'layer', 'scene'].includes(String(requestedScope)) ? requestedScope as StatisticsScope : 'auto';
    const intervalId = values[`${ownerId}.stats.interval`];
    if (intervalId === 'custom') {
        const seconds = values[`${ownerId}.stats.customIntervalSeconds`];
        const intervalSeconds = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
            ? Math.max(1, Math.min(Math.round(seconds), 30 * 86400))
            : 3600;
        let remaining = intervalSeconds;
        const parts: string[] = [];
        for (const [unit, suffix] of [[86400, 'd'], [3600, 'h'], [60, 'm'], [1, 's']] as const) {
            const count = Math.floor(remaining / unit);
            if (count > 0) {
                parts.push(`${count}${suffix}`);
                remaining %= unit;
            }
        }
        return { scope, intervalSeconds, intervalLabel: `Custom (${parts.join(' ')})` };
    }
    const interval = FOXHOLE_STATISTICS_INTERVALS.find(candidate => candidate.id === intervalId);
    return { scope, intervalSeconds: interval?.seconds ?? 3600, intervalLabel: interval?.label ?? '1 Hour' };
}

export function readSceneStatistics(scene: SceneSnapshotV1, selection: SelectionSnapshotV1, requestedScope: StatisticsScope = 'auto', intervalSeconds = 3600) {
    if (scene.surface !== 'scene-v2' || scene.truncated || scene.nodes.length !== scene.totalCount) {
        throw new Error('Complete scene statistics are unavailable.');
    }
    const entities = scene.nodes.map(node => {
        const entity = decodeNixieExperimentalSceneV2SnapshotNodeV1(node);
        if (!entity) {
            throw new Error('This scene does not provide supported entity data.');
        }
        return entity;
    });
    if (new Set(entities.map(entity => entity.entityId)).size !== entities.length) {
        throw new Error('This scene contains duplicate entity data.');
    }
    const selectionEnabled = requestedScope === 'auto' || requestedScope === 'selection';
    if (selectionEnabled && selection.truncated) {
        throw new Error('Complete selection statistics are unavailable.');
    }
    const selected = new Set(selection.nodes.map(node => node.id));
    const parents = new Map(entities.map(entity => {
        const parent = entity.components.find(component => component.ownerId === 'nixie.core' && component.componentId === 'hierarchy')?.data.parentId;
        return [entity.entityId, typeof parent === 'string' ? parent : null];
    }));
    const belongsTo = (id: string, roots: ReadonlySet<string>): boolean => {
        const seen = new Set<string>();
        for (let current: string | null | undefined = id; current && !seen.has(current); current = parents.get(current)) {
            if (roots.has(current)) {
                return true;
            }
            seen.add(current);
        }
        return false;
    };
    const data = (entity: NixieExperimentalComponentEntitySnapshotV1, componentId: string) => entity.components.find(component =>
        component.ownerId === ownerId && component.componentId === componentId && component.definitionAvailable)?.data;
    const hasSelectedStructure = selectionEnabled && selected.size > 0 && entities.some(entity => {
        const assetId = data(entity, 'asset')?.assetId;
        const asset = typeof assetId === 'string' ? assets[assetId] : undefined;
        return !!asset && !asset.isItem && belongsTo(entity.entityId, selected);
    });
    const layerEnabled = requestedScope === 'auto' || requestedScope === 'layer';
    const scope: Exclude<StatisticsScope, 'auto'> = hasSelectedStructure ? 'selection' : layerEnabled ? 'layer' : 'scene';
    const roots = scope === 'selection' ? selected : new Set(scene.activeLayerId ? [scene.activeLayerId] : []);
    const scoped = scope === 'scene' ? entities : entities.filter(entity => belongsTo(entity.entityId, roots));
    const owned = scoped.filter(entity => entity.components.some(component => component.ownerId === ownerId && component.definitionAvailable));
    if (scoped.some(entity => entity.components.some(component => component.ownerId === ownerId && !component.definitionAvailable))) {
        throw new Error('Statistics are unavailable for unresolved components.');
    }
    const metrics = { 'Entities': owned.length, 'Assets': owned.filter(entity => !!data(entity, 'asset')).length,
        'Connectors': owned.filter(entity => !!data(entity, 'connector') || !!data(entity, 'spline-connector')).length,
        'Planning Shapes': owned.filter(entity => ['range', 'binocular-line', 'triangulation', 'tactical-line'].some(id => !!data(entity, id))).length,
        'Configured Orders': owned.reduce((total, entity) => {
            const orders = data(entity, 'production-order')?.orders;
            return total + (Array.isArray(orders) ? orders.length : 0);
        }, 0) };
    const production = aggregateFoxholeEcsProduction(owned, assets, productionRecipesById, intervalSeconds);
    return { scope, metrics, entities: owned, production,
        resources: aggregateFoxholeEcsResources(owned, assets, intervalSeconds, production.powerMwByEntityId),
        bunker: resolveFoxholeEcsBunkerStatistics(entities, owned.map(entity => entity.entityId), assets, bunkerDestructionWeapons, intervalSeconds) };
}
