import type { LegacyPlanEntity, LegacyPlanSave } from './plan-types.ts';

/** Top-level project keys recognized in legacy saves (post-upgrade). */
export const LEGACY_PLAN_PROJECT_FIELDS = new Set([
    'version',
    'name',
    'description',
    'authors',
    'tags',
    'properties',
    'faction',
    'projectSettings',
    'layers',
    'tilesets',
    'entities',
]);

/** Entity fields shared across kinds (from DraggableContainer + getSaveData). */
export const LEGACY_PLAN_ENTITY_BASE_FIELDS = new Set([
    'id',
    'type',
    'key',
    'x',
    'y',
    'z',
    'rotation',
    'locked',
    'name',
    'tint',
    'brightness',
    'layer',
    'sortOffset',
    'properties',
]);

/** Geometry / shape / text fields. */
export const LEGACY_PLAN_ENTITY_GEOMETRY_FIELDS = new Set([
    'width',
    'height',
    'radius',
    'polygon',
    'points',
    'stroke',
    'bezier',
    'label',
    'labelStyle',
    'shapeStyle',
    'textureFile',
    'tile',
    'tileset',
]);

/** Foxhole building extras from FoxholeStructure.onSave / onLoad. */
export const LEGACY_PLAN_ENTITY_BUILDING_FIELDS = new Set([
    'faction',
    'blueprint',
    'packaged',
    'disableProduction',
    'baseUpgrades',
    'productionOrders',
    'selectedProduction',
    'baseProduction',
    'productionScale',
    'inventoryItems',
    'stockpileItems',
    'maintenanceFilters',
    'postExtension',
    'modslots',
    'connections',
    'currentTrackId',
    'currentTrackT',
    'trackDirection',
    'trainCarId',
    'carriageType',
]);

/** Transitional / rarely-seen fields kept for non-destructive inventory. */
export const LEGACY_PLAN_ENTITY_TRANSITIONAL_FIELDS = new Set([
    'subtype',
    'handlePoint',
    'handlePoints',
    'railPoints',
    'textureData',
    'upgrading',
    'mode',
    'preset',
    'dataFile',
]);

export const LEGACY_PLAN_ALL_KNOWN_ENTITY_FIELDS = new Set([
    ...LEGACY_PLAN_ENTITY_BASE_FIELDS,
    ...LEGACY_PLAN_ENTITY_GEOMETRY_FIELDS,
    ...LEGACY_PLAN_ENTITY_BUILDING_FIELDS,
    ...LEGACY_PLAN_ENTITY_TRANSITIONAL_FIELDS,
]);

/**
 * Fields the stub importer currently maps into a Nixie-shaped result.
 * Everything else is treated as not-yet-ingested (intentional test failures).
 */
export const LEGACY_PLAN_MAPPED_PROJECT_FIELDS = new Set([
    'version',
    'name',
    'description',
    'authors',
    'tags',
    'projectSettings',
    'layers',
    'entities',
]);

/**
 * Known project fields deliberately not imported. Faction is a Nixie user-level
 * asset-browser filter, so a legacy plan must not overwrite a user's preference.
 */
export const LEGACY_PLAN_DROPPED_PROJECT_FIELDS = new Set([
    'faction',
]);

export const LEGACY_PLAN_MAPPED_ENTITY_FIELDS = new Set([
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
]);

/**
 * Known entity fields the importer intentionally drops (no Nixie board state yet).
 * Treated as accounted-for so migration status does not flag them as soft gaps.
 */
export const LEGACY_PLAN_DROPPED_ENTITY_FIELDS = new Set([
    'faction',
    'currentTrackId',
    'currentTrackT',
    'trackDirection',
    'trainCarId',
    'carriageType',
]);

export type LegacyPlanFieldFinding = {
    scope: 'project' | 'entity';
    field: string;
    entityId?: number;
    entityKey?: string;
    entityType?: string;
    sample?: unknown;
};

export type LegacyPlanFieldInventoryResult = {
    unknownProjectFields: LegacyPlanFieldFinding[];
    unknownEntityFields: LegacyPlanFieldFinding[];
    /** Fields present on entities that are known but not yet mapped by the stub importer. */
    unmappedEntityFields: LegacyPlanFieldFinding[];
    unmappedProjectFields: LegacyPlanFieldFinding[];
    entityKindCounts: Record<string, number>;
    buildingKeys: string[];
};

function entityKind(entity: LegacyPlanEntity): string {
    if (entity.type) {
        return String(entity.type);
    }
    if (entity.key) {
        return 'building';
    }
    return 'unknown';
}

/**
 * Walks an upgraded legacy save and classifies every key against known / mapped sets.
 */
export class LegacyPlanFieldInventory {
    inspect(save: LegacyPlanSave): LegacyPlanFieldInventoryResult {
        const unknownProjectFields: LegacyPlanFieldFinding[] = [];
        const unmappedProjectFields: LegacyPlanFieldFinding[] = [];
        const unknownEntityFields: LegacyPlanFieldFinding[] = [];
        const unmappedEntityFields: LegacyPlanFieldFinding[] = [];
        const entityKindCounts: Record<string, number> = {};
        const buildingKeySet = new Set<string>();

        for (const field of Object.keys(save)) {
            if (!LEGACY_PLAN_PROJECT_FIELDS.has(field)) {
                unknownProjectFields.push({
                    scope: 'project',
                    field,
                    sample: save[field],
                });
            } else if (
                !LEGACY_PLAN_MAPPED_PROJECT_FIELDS.has(field)
                && !LEGACY_PLAN_DROPPED_PROJECT_FIELDS.has(field)
            ) {
                unmappedProjectFields.push({
                    scope: 'project',
                    field,
                    sample: save[field],
                });
            }
        }

        for (const entity of save.entities ?? []) {
            const kind = entityKind(entity);
            entityKindCounts[kind] = (entityKindCounts[kind] ?? 0) + 1;
            const entityType = String(entity.type ?? '').trim();
            if (entity.key && (!entityType || entityType === 'building' || entityType === 'locomotive')) {
                buildingKeySet.add(String(entity.key));
            }

            for (const field of Object.keys(entity)) {
                if (!LEGACY_PLAN_ALL_KNOWN_ENTITY_FIELDS.has(field)) {
                    unknownEntityFields.push({
                        scope: 'entity',
                        field,
                        entityId: entity.id,
                        entityKey: entity.key,
                        entityType: entity.type,
                        sample: entity[field],
                    });
                } else if (
                    !LEGACY_PLAN_MAPPED_ENTITY_FIELDS.has(field)
                    && !LEGACY_PLAN_DROPPED_ENTITY_FIELDS.has(field)
                ) {
                    unmappedEntityFields.push({
                        scope: 'entity',
                        field,
                        entityId: entity.id,
                        entityKey: entity.key,
                        entityType: entity.type,
                        sample: entity[field],
                    });
                }
            }
        }

        return {
            unknownProjectFields,
            unknownEntityFields,
            unmappedEntityFields,
            unmappedProjectFields,
            entityKindCounts,
            buildingKeys: [...buildingKeySet].sort(),
        };
    }
}
