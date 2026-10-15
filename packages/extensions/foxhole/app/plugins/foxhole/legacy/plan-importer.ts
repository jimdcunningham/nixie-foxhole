import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import {
    buildFoxholeItemCatalog,
    buildFoxholeStructureCatalog,
} from '../nixie/catalog.ts';
import { getFoxholeManifest } from '../nixie/manifest.ts';
import { getFoxholeProductionIndex } from '../nixie/production/index.ts';
import { createFoxholeStructureAssetSnapshot } from '../nixie/structure-asset-snapshot.ts';
import type { FoxholeStructureState } from '../nixie/types.ts';
import { resolveLegacyPlanOrientationOffsetDeg } from './plan-orientation-map.ts';
import { resolveLegacyPlanPosition } from './plan-position.ts';
import { reconcileLegacyPlanConnectionPositions } from './plan-connection-positions.ts';
import { LegacyPlanArchiveReader } from './plan-archive.ts';
import { LegacyPlanCargoMapper } from './plan-cargo-mapper.ts';
import { LegacyPlanFacilityUpgradeResolver, listLegacyPlanParentPrefixes } from './plan-facility-upgrade.ts';
import { resolveLegacyPlanFacilityUpgradeCodeName } from './plan-facility-upgrade-codenames.ts';
import { LegacyPlanFieldInventory } from './plan-field-inventory.ts';
import { mapLegacyPlanIconEntity } from './plan-icon-mapper.ts';
import {
    collectLegacyPlanPendingImages,
    inspectLegacyPlanImageSources,
} from './plan-image-mapper.ts';
import { applyLegacyTintBrightness } from './plan-tint.ts';
import { mapLegacyPlanIdentitySettings } from './plan-identity-settings.ts';
import { mapLegacyPlanProjectSettings } from './plan-project-settings.ts';
import { LegacyPlanImportReport } from './plan-import-report.ts';
import { LEGACY_PLAN_SHAPE_ENTITY_TYPES, mapLegacyPlanShapeEntity } from './plan-shape-mapper.ts';
import { LegacyPlanSocketMapper } from './plan-socket-mapper.ts';
import { LegacyPlanSplineMapper } from './plan-spline-mapper.ts';
import type { LegacyPlanArchiveContents, LegacyPlanEntity, LegacyPlanLayer, LegacyPlanSave } from './plan-types.ts';
import { LegacyPlanSaveUpgrader } from './plan-upgrader.ts';

type FoxholeItemCatalog = import('../nixie/catalog.ts').FoxholeItemCatalog;
type FoxholeStructureCatalog = import('../nixie/catalog.ts').FoxholeStructureCatalog;
type LegacyPlanPendingImage = import('./plan-image-mapper.ts').LegacyPlanPendingImage;
type LegacyPlanMappedProjectSettings = import('./plan-project-settings.ts').LegacyPlanMappedProjectSettings;
type LegacyPlanSaveUpgraderOptions = import('./plan-upgrader.ts').LegacyPlanSaveUpgraderOptions;

export type LegacyPlanStubNode = {
    legacyId: number;
    legacyKey?: string;
    legacyType?: string;
    resolvedKey?: string | null;
    nodeId?: string;
    x: number;
    y: number;
    z: number;
    rotationDeg: number;
    layer?: number;
    locked?: boolean;
    name?: string;
    sortOffset?: number;
    /** Non-destructive bag of fields not yet ingested into Nixie. */
    legacyExtras: Record<string, unknown>;
};

export type LegacyPlanStubDocument = {
    name: string;
    legacyVersion: string;
    description?: string;
    credits?: string;
    tags?: string;
    projectSettings: LegacyPlanMappedProjectSettings;
    layers: LegacyPlanLayer[];
    nodes: LegacyPlanStubNode[];
};

export type LegacyPlanImportResult = {
    /** Original archive contents (or synthetic JSON wrapper). */
    archive: LegacyPlanArchiveContents;
    /** Upgraded clone of the save at 1.0.5 (or ceiling). */
    upgradedSave: LegacyPlanSave;
    /** Partial Nixie-shaped stub — does not write into live projects. */
    stubDocument: LegacyPlanStubDocument;
    /** Board-ready snapshots for resolved structures / splines / shapes / icons. */
    boardSnapshots: BoardNodeSnapshot[];
    /** Image entities that need project-asset offload before becoming sprites. */
    pendingImages: LegacyPlanPendingImage[];
    report: LegacyPlanImportReport;
};

export type LegacyPlanImporterOptions = {
    boundedArchive?: boolean;
    upgrader?: LegacyPlanSaveUpgraderOptions;
    structureCatalog?: FoxholeStructureCatalog;
    itemCatalog?: FoxholeItemCatalog;
    assetsBaseUrl?: string;
    fixtureName?: string;
};

const DEG_TO_RAD = Math.PI / 180;

// The legacy editor falls back to a bare point when a placed icon's asset is
// unavailable. The only observed Foxhole case is the removed pipematerials
// icon; it has no annotation payload and should not become a Nixie marker.
const LEGACY_MISSING_ASSET_POINT_KEYS = new Set(['pipematerials']);

const MAPPED_ENTITY_KEYS = new Set([
    'id',
    'type',
    'key',
    'x',
    'y',
    'z',
    'rotation',
    'layer',
    'locked',
    'name',
    'sortOffset',
    'connections',
    'bezier',
    'width',
    'height',
    'radius',
    'polygon',
    'points',
    'stroke',
    'label',
    'labelStyle',
    'shapeStyle',
    'modslots',
    'stockpileItems',
    'inventoryItems',
    'blueprint',
    'packaged',
    'textureFile',
    'textureData',
    'tint',
    'brightness',
    'disableProduction',
    'productionOrders',
    'selectedProduction',
    'baseProduction',
    'productionScale',
    'maintenanceFilters',
    'baseUpgrades',
    // Intentionally dropped: no train-on-track simulation in Nixie yet.
    'currentTrackId',
    'currentTrackT',
    'trackDirection',
    'trainCarId',
    'carriageType',
]);

type ResolvedBuildingEntity = {
    entity: LegacyPlanEntity;
    legacyId: number;
    legacyKey: string;
    nodeId: string;
    foxholeKey: string;
    modificationVariantIds: Record<string, string>;
    connections?: LegacyPlanEntity['connections'];
};

function degToRad(degrees: number): number {
    return Number(degrees) * DEG_TO_RAD;
}

function createLegacyNodeId(legacyId: number): string {
    return `legacy-${legacyId}`;
}

function isLegacyBuildingEntity(entity: LegacyPlanEntity): boolean {
    const type = String(entity.type ?? '').trim();
    // Locomotive bodies import as normal structures at baked pose.
    // locomotive_undercarriage stays skipped (no published FoxWatch asset).
    return Boolean(entity.key) && (!type || type === 'building' || type === 'locomotive');
}

/** Apply legacy blueprint / packaged / tint / brightness flags. */
function applyLegacyStructureFlags(
    state: FoxholeStructureState & {
        blueprint?: boolean;
        packaged?: boolean;
        tint?: number;
        brightness?: number;
    },
    entity: LegacyPlanEntity,
): void {
    if (entity.packaged === true) {
        state.packaged = true;
        state.blueprint = false;
    } else if (entity.blueprint === true) {
        state.blueprint = true;
    }
    applyLegacyTintBrightness(state, entity);
}

function applyLegacyProductionState(
    state: FoxholeStructureState,
    entity: LegacyPlanEntity,
    structure: { id: string; parentStructureId?: string | null; },
    assetsBaseUrl: string,
): void {
    const index = getFoxholeProductionIndex(assetsBaseUrl);
    const rawOrders = Array.isArray(entity.productionOrders) && entity.productionOrders.length > 0
        ? entity.productionOrders
        : (typeof entity.selectedProduction === 'number'
            ? [{
                id: entity.selectedProduction,
                parent: entity.baseProduction === true,
                cycles: entity.productionScale,
                label: undefined,
            }]
            : []);
    const orders = rawOrders.flatMap(order => {
        const parent = order.parent === true;
        const sourceId = parent ? String(structure.parentStructureId ?? '').trim() : structure.id;
        const recipeId = `structure:${sourceId}:recipe:${Number(order.id)}`;
        if (!sourceId || !Number.isFinite(Number(order.id)) || !index.recipeById[recipeId]) {
            return [];
        }
        const cycles = Number(order.cycles);
        const label = typeof order.label === 'string' && order.label.trim() ? order.label.trim() : null;
        return [{
            recipeId,
            parent,
            cycles: Number.isFinite(cycles) && cycles > 0 ? cycles : null,
            label,
        }];
    });
    if (orders.length > 0) {
        state.productionOrders = orders;
    }
    state.disableProduction = entity.disableProduction === true;
    if (entity.maintenanceFilters && typeof entity.maintenanceFilters === 'object') {
        state.maintenanceFilters = structuredClone(entity.maintenanceFilters);
    }
    if (entity.baseUpgrades && typeof entity.baseUpgrades === 'object') {
        state.baseUpgrades = Object.fromEntries(Object.entries(entity.baseUpgrades)
            .filter(([, value]) => typeof value === 'string' && value.trim())
            .map(([key, value]) => [key, value.trim()]));
    }
}

/**
 * Non-destructive legacy `.plan` importer.
 * Orchestrates archive read → version upgrade → field inventory → board snapshots.
 */
export class LegacyPlanImporter {
    private readonly reader: LegacyPlanArchiveReader;
    private readonly inventory = new LegacyPlanFieldInventory();
    private readonly upgrader: LegacyPlanSaveUpgrader;
    private readonly structureCatalog: FoxholeStructureCatalog;
    private readonly itemCatalog: FoxholeItemCatalog;
    private readonly facilityResolver: LegacyPlanFacilityUpgradeResolver;
    private readonly socketMapper = new LegacyPlanSocketMapper();
    private readonly splineMapper = new LegacyPlanSplineMapper();
    private readonly cargoMapper: LegacyPlanCargoMapper;
    private readonly fixtureName?: string;

    constructor(options: LegacyPlanImporterOptions = {}) {
        this.reader = new LegacyPlanArchiveReader(options.boundedArchive);
        this.upgrader = new LegacyPlanSaveUpgrader(options.upgrader);
        const assetsBaseUrl = options.assetsBaseUrl ?? '/foxhole/assets/';
        const manifest = getFoxholeManifest(assetsBaseUrl);
        this.structureCatalog = options.structureCatalog ?? buildFoxholeStructureCatalog(manifest);
        this.itemCatalog = options.itemCatalog ?? buildFoxholeItemCatalog(manifest);
        this.facilityResolver = new LegacyPlanFacilityUpgradeResolver(this.structureCatalog);
        this.cargoMapper = new LegacyPlanCargoMapper(this.structureCatalog, this.itemCatalog);
        this.fixtureName = options.fixtureName;
    }

    async importArchive(source: ArrayBuffer | Uint8Array | Buffer, options: { fixtureName?: string; } = {}): Promise<LegacyPlanImportResult> {
        const archive = await this.reader.read(source);
        return this.importArchiveContents(archive, options);
    }

    async importSave(save: LegacyPlanSave, options: { fixtureName?: string; } = {}): Promise<LegacyPlanImportResult> {
        const archive = await this.reader.readFromJson(save);
        return this.importArchiveContents(archive, options);
    }

    importArchiveContents(archive: LegacyPlanArchiveContents, options: { fixtureName?: string; } = {}): LegacyPlanImportResult {
        const upgradeResult = this.upgrader.upgrade(archive.projectJson);
        const inventoryResult = this.inventory.inspect(upgradeResult.save);
        const report = new LegacyPlanImportReport();
        report.fixtureName = options.fixtureName ?? this.fixtureName;
        report.fromVersion = upgradeResult.fromVersion;
        report.toVersion = upgradeResult.toVersion;
        report.entityCount = upgradeResult.save.entities?.length ?? 0;
        report.inventory = inventoryResult;
        report.upgradeWarnings = upgradeResult.warnings;

        const unresolvedBuildingKeys: string[] = [];
        const unresolvedFacilityUpgrades: string[] = [];
        const unmatchedModslots: string[] = [];
        const unresolvedCargoKeys: string[] = [];
        const unresolvedIconKeys: string[] = [];
        const skippedEntityTypes: Record<string, number> = {};
        const importedShapeCounts: Record<string, number> = {};
        const nodes: LegacyPlanStubNode[] = [];
        const resolvedBuildings: ResolvedBuildingEntity[] = [];
        const nodeIdByLegacyId = new Map<number, string>();

        for (const entity of upgradeResult.save.entities ?? []) {
            const mapped = this.mapEntity(entity, {
                unresolvedBuildingKeys,
                unresolvedFacilityUpgrades,
                unmatchedModslots,
                resolvedBuildings,
                nodeIdByLegacyId,
            });
            nodes.push(mapped.stub);
        }

        const socketResult = this.socketMapper.mapConnections({
            entities: resolvedBuildings.map(entry => ({
                legacyId: entry.legacyId,
                legacyKey: entry.legacyKey,
                foxholeKey: entry.foxholeKey,
                connections: entry.connections,
            })),
        });
        report.unresolvedSocketFindings = socketResult.findings;
        report.unresolvedSocketIds = [...new Set(
            socketResult.findings
                .filter(finding => finding.reason === 'unresolved_local_socket' || finding.reason === 'unresolved_peer_socket')
                .map(finding => finding.legacySocketId),
        )].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));

        const attachmentMaps = this.socketMapper.buildAttachmentMaps({
            links: socketResult.links,
            nodeIdByLegacyId,
        });

        const boardSnapshots: BoardNodeSnapshot[] = [];
        for (const resolved of resolvedBuildings) {
            const asset = this.structureCatalog.assetByKey[resolved.foxholeKey] ?? null;
            const structure = this.structureCatalog.structureByKey[resolved.foxholeKey] ?? null;
            if (!asset || !structure) {
                unresolvedBuildingKeys.push(resolved.entity.key ? String(resolved.entity.key) : resolved.foxholeKey);
                continue;
            }

            const rotationOffsetDeg = resolveLegacyPlanOrientationOffsetDeg(resolved.foxholeKey);
            const rotationRad = degToRad(Number(resolved.entity.rotation ?? 0) + rotationOffsetDeg);
            const label = typeof resolved.entity.name === 'string' && resolved.entity.name.trim()
                ? resolved.entity.name.trim()
                : (asset.name || resolved.foxholeKey);
            const socketAttachments = attachmentMaps.get(resolved.legacyId);
            const cargo = this.cargoMapper.mapEntityCargo({
                foxholeKey: resolved.foxholeKey,
                stockpileItems: resolved.entity.stockpileItems,
                inventoryItems: resolved.entity.inventoryItems,
            });
            if (cargo.unresolvedItemKeys.length) {
                unresolvedCargoKeys.push(...cargo.unresolvedItemKeys);
            }

            let snapshot: BoardNodeSnapshot;
            if (this.splineMapper.canMapAsSpline(structure)) {
                snapshot = this.splineMapper.createSnapshot({
                    id: resolved.nodeId,
                    entity: resolved.entity,
                    foxholeKey: resolved.foxholeKey,
                    structure,
                    label,
                    modificationVariantIds: resolved.modificationVariantIds,
                    socketAttachments,
                    rotationRad,
                });
            } else {
                const variantSprite = Object.entries(resolved.modificationVariantIds)
                    .map(([slotId, variantId]) => structure.modificationSlots
                        ?.find(slot => slot.name === slotId)?.variants?.[variantId]?.sprite)
                    .find(sprite => sprite != null);
                const legacyPosition = resolved.entity.packaged
                    ? { x: Number(resolved.entity.x ?? 0), y: Number(resolved.entity.y ?? 0) }
                    : resolveLegacyPlanPosition(
                        resolved.legacyKey,
                        resolved.foxholeKey,
                        structure.sprite,
                        Number(resolved.entity.x ?? 0),
                        Number(resolved.entity.y ?? 0),
                        Number(resolved.entity.rotation ?? 0),
                        variantSprite,
                    );
                snapshot = createFoxholeStructureAssetSnapshot({
                    asset,
                    structure,
                    label,
                    modificationVariantIds: resolved.modificationVariantIds,
                    x: legacyPosition.x,
                    y: legacyPosition.y,
                    z: resolved.entity.z != null ? Number(resolved.entity.z) : undefined,
                });
                snapshot.id = resolved.nodeId;
                const state = snapshot.state as FoxholeStructureState;
                state.rotation = rotationRad;
                state.locked = resolved.entity.locked === true;
                if (resolved.modificationVariantIds && Object.keys(resolved.modificationVariantIds).length) {
                    state.modificationVariantIds = { ...resolved.modificationVariantIds };
                }
                state.socketAttachments = socketAttachments && Object.keys(socketAttachments).length
                    ? { ...socketAttachments }
                    : {};
                applyLegacyStructureFlags(state, resolved.entity);
                applyLegacyProductionState(state, resolved.entity, structure, '/foxhole/assets/');
                if (cargo.markedItemCodenames.length) {
                    state.markedItemCodenames = cargo.markedItemCodenames;
                }
            }

            if (this.splineMapper.canMapAsSpline(structure)) {
                const state = snapshot.state as FoxholeStructureState & {
                    markedItemCodenames?: string[];
                    blueprint?: boolean;
                    packaged?: boolean;
                    tint?: number;
                    brightness?: number;
                };
                if (cargo.markedItemCodenames.length) {
                    state.markedItemCodenames = cargo.markedItemCodenames;
                }
                applyLegacyStructureFlags(state, resolved.entity);
                applyLegacyProductionState(state, resolved.entity, structure, '/foxhole/assets/');
            }

            boardSnapshots.push(snapshot);
        }

        report.unresolvedSocketFindings.push(...reconcileLegacyPlanConnectionPositions({
            snapshots: boardSnapshots,
            links: socketResult.links,
            catalog: this.structureCatalog,
        }));

        for (const entity of upgradeResult.save.entities ?? []) {
            if (isLegacyBuildingEntity(entity)) {
                continue;
            }
            const type = String(entity.type ?? '').trim();
            const key = String(entity.key ?? '').trim().toLowerCase();
            if (type === 'point' && LEGACY_MISSING_ASSET_POINT_KEYS.has(key)) {
                continue;
            }
            if (LEGACY_PLAN_SHAPE_ENTITY_TYPES.has(type)) {
                const mapped = mapLegacyPlanShapeEntity(entity);
                if (mapped.snapshot) {
                    boardSnapshots.push(mapped.snapshot);
                    importedShapeCounts[type] = (importedShapeCounts[type] ?? 0) + 1;
                }
                continue;
            }
            if (type === 'icon') {
                const mapped = mapLegacyPlanIconEntity(entity, this.itemCatalog, this.structureCatalog);
                if (mapped.unresolvedKey) {
                    unresolvedIconKeys.push(mapped.unresolvedKey);
                }
                if (mapped.snapshot) {
                    boardSnapshots.push(mapped.snapshot);
                    importedShapeCounts.icon = (importedShapeCounts.icon ?? 0) + 1;
                }
                continue;
            }
            if (type === 'image') {
                // Deferred: bytes live in archive.assets / textureData and are
                // uploaded into the Nixie project during importLegacyPlanFile.
                continue;
            }
            if (type) {
                skippedEntityTypes[type] = (skippedEntityTypes[type] ?? 0) + 1;
            }
        }

        const pendingImages = collectLegacyPlanPendingImages(upgradeResult.save.entities);
        const imageInspection = inspectLegacyPlanImageSources(pendingImages, archive.assets);

        report.unresolvedBuildingKeys = [...new Set(unresolvedBuildingKeys)].sort();
        report.unresolvedFacilityUpgrades = [...new Set(unresolvedFacilityUpgrades)].sort();
        report.unmatchedModslots = [...new Set(unmatchedModslots)].sort();
        report.unresolvedCargoKeys = [...new Set(unresolvedCargoKeys)].sort();
        report.unresolvedIconKeys = [...new Set(unresolvedIconKeys)].sort();
        report.unresolvedImageKeys = imageInspection.unresolvedTextureFiles;
        report.skippedEntityTypes = skippedEntityTypes;
        report.importedShapeCounts = importedShapeCounts;

        const identity = mapLegacyPlanIdentitySettings(upgradeResult.save);
        const projectSettings = mapLegacyPlanProjectSettings(upgradeResult.save.projectSettings);
        const stubDocument: LegacyPlanStubDocument = {
            name: typeof upgradeResult.save.name === 'string' && upgradeResult.save.name.trim()
                ? upgradeResult.save.name.trim()
                : 'Imported Legacy Plan',
            legacyVersion: upgradeResult.toVersion,
            ...identity,
            projectSettings,
            layers: structuredClone(upgradeResult.save.layers ?? []),
            nodes,
        };

        return {
            archive,
            upgradedSave: upgradeResult.save,
            stubDocument,
            boardSnapshots,
            pendingImages,
            report,
        };
    }

    private mapEntity(
        entity: LegacyPlanEntity,
        context: {
            unresolvedBuildingKeys: string[];
            unresolvedFacilityUpgrades: string[];
            unmatchedModslots: string[];
            resolvedBuildings: ResolvedBuildingEntity[];
            nodeIdByLegacyId: Map<number, string>;
        },
    ): { stub: LegacyPlanStubNode; } {
        const legacyExtras: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(entity)) {
            if (!MAPPED_ENTITY_KEYS.has(key) && value !== undefined) {
                legacyExtras[key] = structuredClone(value);
            }
        }

        const isBuilding = isLegacyBuildingEntity(entity);
        let resolvedKey: string | null | undefined;
        let nodeId: string | undefined;

        if (isBuilding && entity.key) {
            const resolution = this.facilityResolver.resolve(String(entity.key));
            if (!resolution) {
                const looksLikeFacilityUpgrade = listLegacyPlanParentPrefixes(String(entity.key)).length > 0
                    || Boolean(resolveLegacyPlanFacilityUpgradeCodeName(String(entity.key)));
                if (looksLikeFacilityUpgrade) {
                    context.unresolvedFacilityUpgrades.push(String(entity.key));
                }
                context.unresolvedBuildingKeys.push(String(entity.key));
                resolvedKey = null;
            } else {
                resolvedKey = resolution.foxholeKey;
                nodeId = createLegacyNodeId(entity.id);
                context.nodeIdByLegacyId.set(entity.id, nodeId);

                let modificationVariantIds = { ...resolution.modificationVariantIds };
                if (entity.modslots && typeof entity.modslots === 'object') {
                    const mappedSlots = this.facilityResolver.mapModslots(
                        resolution.foxholeKey,
                        entity.modslots as Record<string, string | null | undefined>,
                        modificationVariantIds,
                    );
                    modificationVariantIds = mappedSlots.modificationVariantIds;
                    context.unmatchedModslots.push(...mappedSlots.unmatchedSlots);
                }

                context.resolvedBuildings.push({
                    entity,
                    legacyId: entity.id,
                    legacyKey: String(entity.key),
                    nodeId,
                    foxholeKey: resolution.foxholeKey,
                    modificationVariantIds,
                    connections: entity.connections,
                });
            }
        }

        return {
            stub: {
                legacyId: entity.id,
                legacyKey: entity.key,
                legacyType: entity.type,
                resolvedKey,
                nodeId,
                x: Number(entity.x ?? 0),
                y: Number(entity.y ?? 0),
                z: Number(entity.z ?? 0),
                rotationDeg: Number(entity.rotation ?? 0) + (
                    resolvedKey ? resolveLegacyPlanOrientationOffsetDeg(resolvedKey) : 0
                ),
                layer: entity.layer,
                locked: entity.locked,
                name: entity.name,
                sortOffset: entity.sortOffset,
                legacyExtras,
            },
        };
    }
}
