import type { NixieExtensionConnection, SceneSnapshotV1, SelectionSnapshotV1 } from '@nixiejs/extension-sdk';
import { decodeNixieExperimentalSceneV2SnapshotNodeV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import assets, { productionRecipesById, bunkerDestructionWeapons } from '#foxhole-scene-v2-assets';
import { aggregateFoxholeEcsProduction, FOXHOLE_STATISTICS_INTERVALS } from './production-statistics.ts';
import { aggregateFoxholeEcsResources } from './resource-statistics.ts';
import { resolveFoxholeEcsBunkerStatistics } from './bunker-statistics.ts';

export type StatisticsScope = 'auto' | 'selection' | 'layer' | 'scene';
const ownerId = 'nixie.foxhole-planner';

export function readStatisticsPreferences(scene: SceneSnapshotV1): { scope: StatisticsScope; intervalSeconds: number; } {
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
        return { scope, intervalSeconds };
    }
    const interval = FOXHOLE_STATISTICS_INTERVALS.find(candidate => candidate.id === intervalId);
    return { scope, intervalSeconds: interval?.seconds ?? 3600 };
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
    const scope = requestedScope === 'auto' ? selection.totalCount > 0 ? 'selection' : scene.activeLayerId ? 'layer' : 'scene' : requestedScope;
    if (scope === 'selection' && selection.truncated) {
        throw new Error('Complete selection statistics are unavailable.');
    }
    const roots = new Set(scope === 'selection' ? selection.nodes.map(node => node.id) : scope === 'layer' && scene.activeLayerId ? [scene.activeLayerId] : []);
    const parents = new Map(entities.map(entity => {
        const parent = entity.components.find(component => component.ownerId === 'nixie.core' && component.componentId === 'hierarchy')?.data.parentId;
        return [entity.entityId, typeof parent === 'string' ? parent : null];
    }));
    const included = (id: string): boolean => {
        if (scope === 'scene') {
            return true;
        }
        const seen = new Set<string>();
        for (let current: string | null | undefined = id; current && !seen.has(current); current = parents.get(current)) {
            if (roots.has(current)) {
                return true;
            }
            seen.add(current);
        }
        return false;
    };
    const owned = entities.filter(entity => included(entity.entityId) && entity.components.some(component => component.ownerId === ownerId && component.definitionAvailable));
    if (entities.some(entity => included(entity.entityId) && entity.components.some(component => component.ownerId === ownerId && !component.definitionAvailable))) {
        throw new Error('Statistics are unavailable for unresolved components.');
    }
    const data = (entity: NixieExperimentalComponentEntitySnapshotV1, componentId: string) => entity.components.find(component =>
        component.ownerId === ownerId && component.componentId === componentId && component.definitionAvailable)?.data;
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

export function mountBunkerDestructionStatistics(connection: NixieExtensionConnection): () => void {
    const root = document.createElement('main');
    const style = document.createElement('style');
    style.textContent = 'body{margin:0;padding:16px;background:#111319;color:#e8ebef;font:14px system-ui}p{font-size:12px;color:#a4abb7}table{border-collapse:collapse;width:100%;font-size:12px}th{text-align:left;color:#a4abb7}td,th{padding:6px 4px;border-bottom:1px solid #292d34}td:last-child,th:last-child{text-align:right}h3{font-size:14px;margin-top:24px}';
    document.head.append(style);
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const destructionContent = document.createElement('section');
    root.append(status, destructionContent);
    document.body.append(root);
    let active = true;
    let sceneRevision = 0;
    let selectionRevision = 0;
    let scene: SceneSnapshotV1 = { protocolVersion: 1, totalCount: 0, truncated: false, nodes: [] };
    let selection: SelectionSnapshotV1 = { protocolVersion: 1, totalCount: 0, truncated: false, nodes: [] };
    const render = () => {
        if (!active) {
            return;
        }
        status.textContent = '';
        destructionContent.replaceChildren();
        try {
            const preferences = readStatisticsPreferences(scene);
            const destruction = readSceneStatistics(scene, selection, preferences.scope, preferences.intervalSeconds).bunker?.destruction;
            if (!destruction?.weapons.length) {
                return;
            }
            const destructionHeading = document.createElement('h3');
            destructionHeading.textContent = 'Bunker Destruction';
            destructionContent.append(destructionHeading);
            const table = document.createElement('table');
            table.setAttribute('aria-label', 'Bunker Destruction');
            const wet = destruction.weapons.some(weapon => weapon.shots.t3wet !== null);
            const header = table.createTHead().insertRow();
            for (const columnLabel of ['Weapon', 'T1', 'T2', ...(wet ? ['T3 Wet', 'T3 Dry'] : ['T3'])]) {
                const cell = document.createElement('th');
                cell.textContent = columnLabel;
                header.append(cell);
            }
            const rows = table.createTBody();
            for (const weapon of destruction.weapons) {
                const row = rows.insertRow();
                const localized = Object.values(assets).find(asset => asset.codeName.toLowerCase() === weapon.codeName.toLowerCase());
                const named = weapon.name && ![weapon.codeName, weapon.id].some(value => value.toLowerCase() === weapon.name.toLowerCase());
                row.insertCell().textContent = named ? weapon.name : localized?.label ?? weapon.name;
                for (const count of [weapon.shots.t1, weapon.shots.t2, ...(wet ? [weapon.shots.t3wet, weapon.shots.t3] : [weapon.shots.t3])]) {
                    row.insertCell().textContent = count === null ? '—' : count.toLocaleString('en-US');
                }
            }
            destructionContent.append(table);
        } catch (error) {
            status.textContent = error instanceof Error ? error.message : 'Statistics are unavailable.';
        }
    };
    const disposers = [
        connection.editor.onSceneChanged(next => {
            sceneRevision += 1;
            scene = next;
            render();
        }),
        connection.editor.onSelectionChanged(next => {
            selectionRevision += 1;
            selection = next;
            render();
        }),
        connection.onDisconnected(() => {
            destructionContent.replaceChildren();
            status.textContent = 'Statistics are unavailable.';
        }),
    ];
    void connection.editor.getScene().then(next => {
        if (sceneRevision === 0) {
            scene = next;
        }
        render();
    }).catch(() => {
        status.textContent = 'Scene access is unavailable.';
    });
    void connection.editor.getSelection().then(next => {
        if (selectionRevision === 0) {
            selection = next;
        }
        render();
    }).catch(() => {
        status.textContent = 'Selection access is unavailable.';
    });
    render();
    return () => {
        active = false;
        disposers.forEach(dispose => dispose());
        root.remove();
        style.remove();
    };
}
