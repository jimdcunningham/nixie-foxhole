import type { NixieExtensionConnection, SceneSnapshotV1, SelectionSnapshotV1 } from '@nixie/extension-sdk';
import { decodeNixieExperimentalSceneV2SnapshotNodeV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixie/extension-sdk/experimental/scene-v2';
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
    const interval = FOXHOLE_STATISTICS_INTERVALS.find(candidate => candidate.id === values[`${ownerId}.stats.interval`]);
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
    return { scope, metrics, entities: owned, production: aggregateFoxholeEcsProduction(owned, assets, productionRecipesById, intervalSeconds),
        resources: aggregateFoxholeEcsResources(owned, assets, intervalSeconds),
        bunker: resolveFoxholeEcsBunkerStatistics(entities, owned.map(entity => entity.entityId), assets, bunkerDestructionWeapons, intervalSeconds) };
}

export function mountSceneStatistics(connection: NixieExtensionConnection): () => void {
    const root = document.createElement('main');
    const style = document.createElement('style');
    style.textContent = 'body{margin:0;padding:16px;background:#111319;color:#e8ebef;font:14px system-ui}label{display:flex;align-items:center;justify-content:space-between;gap:12px}select{padding:7px;background:#20232a;color:inherit;border:1px solid #3d4149;border-radius:6px}p{font-size:12px;color:#a4abb7}dl{margin:16px 0}dl>div{display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #292d34}dd{margin:0;font-variant-numeric:tabular-nums}';
    style.textContent += 'label+label{margin-top:12px}section{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}th{text-align:left;color:#a4abb7}td,th{padding:6px 4px;border-bottom:1px solid #292d34}td:last-child,th:last-child{text-align:right}h3{font-size:14px;margin-top:24px}';
    document.head.append(style);
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const list = document.createElement('dl');
    const productionList = document.createElement('section');
    root.append(status, list, productionList);
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
        list.replaceChildren();
        productionList.replaceChildren();
        try {
            const preferences = readStatisticsPreferences(scene);
            const summary = readSceneStatistics(scene, selection, preferences.scope, preferences.intervalSeconds);
            status.textContent = summary.scope === 'selection' ? 'Current selection and its descendants.' : summary.scope === 'layer' ? 'Current layer and its descendants.' : 'Whole scene.';
            for (const [name, value] of Object.entries({ ...summary.metrics, 'Active Orders': summary.production.activeOrderCount,
                'Production Power (MW)': summary.production.powerMw,
                'Liquid Capacity (L)': summary.resources.liquid.total, 'Silo Capacity (L)': summary.resources.liquid.silo,
                'Pipeline Capacity (L)': summary.resources.liquid.pipeline, 'Power Produced (MW)': summary.resources.power.producedMw,
                'Power Consumed (MW)': summary.resources.power.consumedMw, 'Net Facility Power (MW)': summary.resources.power.netMw,
                'Maintenance Supplies': summary.resources.maintenanceSupplies, 'Missing Construction Costs': summary.resources.missingCostCount,
                'Repair Cost': summary.resources.repairCost, 'Inventory Slots': summary.resources.inventorySlots, 'Fuel Capacity': summary.resources.fuelCapacity })) {
                const row = document.createElement('div');
                const title = document.createElement('dt');
                title.textContent = name;
                const amount = document.createElement('dd');
                amount.textContent = value.toLocaleString('en-US', { maximumFractionDigits: 4 });
                row.append(title, amount);
                list.append(row);
            }
            if (summary.bunker) {
                const health = summary.bunker.health;
                const heading = document.createElement('h3');
                heading.textContent = 'Bunker Health';
                productionList.append(heading);
                const details = document.createElement('dl');
                for (const [name, value] of Object.entries({ 'Pieces': health.pieceCount, 'Effective Health': health.effectiveHealth,
                    'Repair Cost': health.repairCost, 'Repair Rate': Math.floor(health.repairRate), 'Breachable Health': health.breachableHealth,
                    'Integrity (%)': health.structuralIntegrityPercent })) {
                    const row = document.createElement('div');
                    const title = document.createElement('dt');
                    title.textContent = name;
                    const amount = document.createElement('dd');
                    amount.textContent = value.toLocaleString('en-US', { maximumFractionDigits: 4 });
                    row.append(title, amount);
                    details.append(row);
                }
                productionList.append(details);
                const destruction = summary.bunker.destruction;
                if (destruction?.weapons.length) {
                    const destructionHeading = document.createElement('h3');
                    destructionHeading.textContent = 'Bunker Destruction';
                    productionList.append(destructionHeading);
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
                    productionList.append(table);
                }
            }
            const costTitle = document.createElement('h3');
            costTitle.textContent = 'Construction Cost';
            productionList.append(costTitle);
            if (summary.resources.costs.length) {
                const table = document.createElement('table');
                table.setAttribute('aria-label', 'Construction Cost');
                const header = table.createTHead().insertRow();
                for (const name of ['Resource', 'Quantity']) {
                    const cell = document.createElement('th');
                    cell.textContent = name;
                    header.append(cell);
                }
                const rows = table.createTBody();
                for (const resource of summary.resources.costs) {
                    const asset = Object.values(assets).find(candidate => candidate.codeName.toLowerCase() === resource.resourceId.toLowerCase());
                    const row = rows.insertRow();
                    row.insertCell().textContent = asset?.label ?? resource.resourceId;
                    row.insertCell().textContent = resource.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 });
                }
                productionList.append(table);
            } else {
                const empty = document.createElement('p');
                empty.textContent = 'No published construction costs.';
                productionList.append(empty);
            }
            for (const [heading, resources] of [['Net Inputs', summary.production.inputs], ['Net Outputs', summary.production.outputs]] as const) {
                const title = document.createElement('h3');
                title.textContent = heading;
                productionList.append(title);
                if (!resources.length) {
                    const empty = document.createElement('p');
                    empty.textContent = 'No resources in this interval.';
                    productionList.append(empty);
                    continue;
                }
                const table = document.createElement('table');
                table.setAttribute('aria-label', heading);
                const header = table.createTHead().insertRow();
                for (const text of ['Resource', 'Channel', 'Quantity']) {
                    const cell = document.createElement('th');
                    cell.textContent = text;
                    header.append(cell);
                }
                const rows = table.createTBody();
                for (const resource of resources) {
                    const row = rows.insertRow();
                    const asset = Object.values(assets).find(candidate => candidate.codeName.toLowerCase() === resource.resourceId.toLowerCase());
                    for (const text of [asset?.label ?? resource.resourceId, resource.channel === 'item' ? 'Item' : resource.channel === 'crate' ? 'Crate' : 'Liquid',
                        resource.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })]) {
                        row.insertCell().textContent = text;
                    }
                }
                productionList.append(table);
            }
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
            list.replaceChildren();
            productionList.replaceChildren();
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
