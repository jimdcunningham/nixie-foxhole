import type { LegacyPlanEntity, LegacyPlanSave } from './plan-types.ts';
import { LEGACY_PLAN_CURRENT_VERSION } from './plan-types.ts';
import {
    LEGACY_CRANE_UPGRADE_OFFSET,
    LEGACY_PLAN_BUILDING_FLAGS,
    LEGACY_PLAN_MAPS,
    LEGACY_REGION_HEIGHT,
    LEGACY_REGION_WIDTH,

} from './plan-upgrade-data.ts';
import type { LegacyPlanBuildingUpgradeFlags, LegacyPlanMapData } from './plan-upgrade-data.ts';

export type LegacyPlanSaveUpgraderOptions = {
    buildingFlags?: Readonly<Record<string, LegacyPlanBuildingUpgradeFlags>>;
    maps?: Readonly<Record<string, LegacyPlanMapData>>;
};

export type LegacyPlanUpgradeWarning = {
    code: string;
    message: string;
    entityId?: number;
};

export type LegacyPlanUpgradeResult = {
    save: LegacyPlanSave;
    fromVersion: string | null;
    toVersion: string;
    warnings: LegacyPlanUpgradeWarning[];
};

function cloneJson<T>(value: T): T {
    return structuredClone(value);
}

function rad2deg(radians: number): number {
    return radians * (180 / Math.PI);
}

function angleNormalized(angle: number): number {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function extendPoint(
    point: { x?: number; y?: number; },
    distance: number,
    angle: number,
): { x: number; y: number; } {
    return {
        x: Math.round(Math.cos(angle) * distance + (point.x ?? 0)),
        y: Math.round(Math.sin(angle) * distance + (point.y ?? 0)),
    };
}

function scalePositionData(obj: Record<string, unknown>): void {
    for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (value !== null && typeof value === 'object') {
            scalePositionData(value as Record<string, unknown>);
        } else if (key === 'x' || key === 'y') {
            if (typeof value === 'number') {
                obj[key] = value / 1.056;
            }
        }
    }
}

/**
 * Pure port of game-kitchen `convertSaveVersion` (ceiling 1.0.5).
 * Always clones input — never mutates the caller's object.
 */
export class LegacyPlanSaveUpgrader {
    readonly buildingFlags: Readonly<Record<string, LegacyPlanBuildingUpgradeFlags>>;
    readonly maps: Readonly<Record<string, LegacyPlanMapData>>;

    constructor(options: LegacyPlanSaveUpgraderOptions = {}) {
        this.buildingFlags = options.buildingFlags ?? LEGACY_PLAN_BUILDING_FLAGS;
        this.maps = options.maps ?? LEGACY_PLAN_MAPS;
    }

    upgrade(input: LegacyPlanSave): LegacyPlanUpgradeResult {
        const save = cloneJson(input);
        const fromVersion = typeof save.version === 'string' ? save.version : null;
        const warnings: LegacyPlanUpgradeWarning[] = [];

        if (!save.entities) {
            save.entities = [];
        }

        if (!save.version) {
            this.upgradeMissingTo100(save);
            save.version = '1.0.0';
        }
        if (save.version === '1.0.0') {
            for (const entity of save.entities ?? []) {
                scalePositionData(entity as Record<string, unknown>);
            }
            save.version = '1.0.1';
        }
        if (save.version === '1.0.1') {
            this.upgrade101To102(save);
            save.version = '1.0.2';
        }
        if (save.version === '1.0.2') {
            this.upgrade102To103(save, warnings);
            save.version = '1.0.3';
        }
        if (save.version === '1.0.3') {
            this.upgrade103To104(save);
            save.version = '1.0.4';
        }
        if (save.version === '1.0.4') {
            this.upgrade104To105(save);
            save.version = '1.0.5';
        }

        if (save.version !== LEGACY_PLAN_CURRENT_VERSION) {
            warnings.push({
                code: 'unsupported_version',
                message: `Save version ${String(save.version)} is above or outside the supported ceiling ${LEGACY_PLAN_CURRENT_VERSION}`,
            });
        }

        return {
            save,
            fromVersion,
            toVersion: String(save.version ?? LEGACY_PLAN_CURRENT_VERSION),
            warnings,
        };
    }

    private upgradeMissingTo100(save: LegacyPlanSave): void {
        for (const entity of save.entities ?? []) {
            const subtype = String(entity.subtype ?? '');
            if (!entity.connections || !(
                subtype === 'fortcornert1'
                || subtype === 'fortcornert2'
                || subtype === 'fortcornert3'
            )) {
                continue;
            }

            const remapSocketIdTo = (prevSocketId: string | number, newSocketId: string | number) => {
                const prevKey = String(prevSocketId);
                const newKey = String(newSocketId);
                const connections = entity.connections;
                if (!connections?.[prevKey]) {
                    return;
                }
                connections[newKey] = connections[prevKey];
                delete connections[prevKey];
                for (const e2 of save.entities ?? []) {
                    for (const [entityId, socketId] of Object.entries(connections[newKey] ?? {})) {
                        if (e2.id == Number(entityId) && e2.connections?.[String(socketId)]) {
                            e2.connections[String(socketId)][String(entity.id)] = Number(newKey);
                        }
                    }
                }
            };

            remapSocketIdTo(1, 6);
            remapSocketIdTo(2, 3);
        }
    }

    private upgrade101To102(save: LegacyPlanSave): void {
        for (const entity of save.entities ?? []) {
            if (entity.type === 'building' && entity.subtype === 'crane') {
                const position = extendPoint(
                    entity,
                    LEGACY_CRANE_UPGRADE_OFFSET,
                    angleNormalized((entity.rotation ?? 0) + Math.PI),
                );
                entity.x = position.x;
                entity.y = position.y;
            }
        }
    }

    private upgrade102To103(save: LegacyPlanSave, warnings: LegacyPlanUpgradeWarning[]): void {
        for (const entity of save.entities ?? []) {
            if (entity.rotation !== undefined && typeof entity.rotation === 'number') {
                entity.rotation = rad2deg(entity.rotation);
            }

            if (entity.railPoints) {
                const buildingFlags = this.lookupBuildingFlags(entity.subtype);
                if (entity.type === 'building' && buildingFlags?.isBezier) {
                    const bezierPoints = [...entity.railPoints];
                    bezierPoints[0] = {
                        x: 0,
                        y: 0,
                        rotation: 180,
                    };
                    for (let i = 1; i < bezierPoints.length; i++) {
                        const point = bezierPoints[i];
                        if (point.rotation !== undefined) {
                            point.rotation = rad2deg(point.rotation);
                        }
                    }
                    entity.bezier = bezierPoints;
                } else {
                    const handlePoint = entity.railPoints[1];
                    if (handlePoint) {
                        const { rotation: _rotation, ...rest } = handlePoint;
                        entity.handlePoint = rest;
                    }
                }
                delete entity.railPoints;
            }

            if (entity.handlePoint) {
                if (entity.type === 'shape') {
                    if (entity.subtype === 'circle') {
                        entity.radius = entity.handlePoint.x;
                    } else {
                        entity.width = entity.handlePoint.x;
                        entity.height = entity.handlePoint.y;
                    }
                    delete entity.handlePoint;
                } else if (entity.type === 'building' || entity.type === undefined) {
                    const buildingFlags = this.lookupBuildingFlags(entity.subtype);
                    if (buildingFlags?.isBezier) {
                        entity.bezier = [
                            { x: 0, y: 0, rotation: 180 },
                            {
                                x: entity.handlePoint.x ?? 0,
                                y: entity.handlePoint.y ?? 0,
                                rotation: rad2deg(entity.handlePoint.rotation ?? Math.PI),
                            },
                        ];
                        delete entity.handlePoint;
                    } else if (buildingFlags?.hasHandle) {
                        entity.width = entity.handlePoint.x;
                        delete entity.handlePoint;
                    } else {
                        warnings.push({
                            code: 'unresolved_handle_point',
                            message: `Could not resolve handlePoint for entity subtype ${String(entity.subtype)}`,
                            entityId: entity.id,
                        });
                    }
                } else {
                    warnings.push({
                        code: 'invalid_handle_point',
                        message: `Invalid handlePoint for entity type ${String(entity.type)}`,
                        entityId: entity.id,
                    });
                }
            }

            if (entity.handlePoints) {
                if (entity.type === 'shape') {
                    const points: number[] = [];
                    for (const point of entity.handlePoints) {
                        points.push(point.x);
                        points.push(point.y);
                    }
                    entity.polygon = points;
                    delete entity.handlePoints;
                } else {
                    warnings.push({
                        code: 'invalid_handle_points',
                        message: `Invalid handlePoints for entity type ${String(entity.type)}`,
                        entityId: entity.id,
                    });
                }
            }

            if (entity.type === 'shape' && entity.subtype === 'image' && entity.textureData) {
                // Inline texture data cannot be re-hosted here; keep as textureData for the report.
                warnings.push({
                    code: 'inline_texture_data',
                    message: 'Entity has inline textureData that was not converted to an asset file',
                    entityId: entity.id,
                });
            }

            if (entity.type === 'shape') {
                entity.type = entity.subtype;
            } else if (entity.type !== 'text') {
                delete entity.type;
                if (entity.subtype !== undefined) {
                    entity.key = `${entity.subtype}`;
                }
            }
            delete entity.subtype;
        }
    }

    private upgrade103To104(save: LegacyPlanSave): void {
        let offsetX = 0;
        let offsetY = 0;
        const projectSettings = save.projectSettings;
        if (projectSettings) {
            const regionKey = typeof projectSettings.regionKey === 'string'
                ? projectSettings.regionKey.toLowerCase()
                : '';
            let map: LegacyPlanMapData | undefined;
            for (const mapData of Object.values(this.maps)) {
                if (regionKey && regionKey === mapData.key.toLowerCase()) {
                    map = mapData;
                    break;
                }
            }
            if (!map) {
                projectSettings.showWorldRegion = false;
                if (projectSettings.regionCrop) {
                    delete projectSettings.regionCrop;
                }
            } else {
                projectSettings.regionKeys = [map.key];
                offsetX = map.gridCoord.x * ((LEGACY_REGION_WIDTH / 2048) * (2048 * 0.75)) - 5000;
                offsetY = (map.gridCoord.y * LEGACY_REGION_HEIGHT) + (map.gridCoord.x * (LEGACY_REGION_HEIGHT / 2)) - 5000;
                if (projectSettings.regionCrop) {
                    projectSettings.regionCrop.x = (projectSettings.regionCrop.x ?? 0) + offsetX;
                    projectSettings.regionCrop.y = (projectSettings.regionCrop.y ?? 0) + offsetY;
                }
            }
            delete projectSettings.regionKey;
        }

        let backgroundLayer: { id: number; name: string; visible: boolean; locked: boolean; zIndex: number; } | undefined;
        for (const entity of save.entities ?? []) {
            entity.x = (entity.x ?? 0) + offsetX;
            entity.y = (entity.y ?? 0) + offsetY;
            if (entity.shapeStyle) {
                if ((entity.type === 'rectangle' || entity.type === 'circle')
                    && entity.shapeStyle.border
                    && entity.shapeStyle.fill === undefined) {
                    entity.shapeStyle.fill = false;
                }
                if (entity.shapeStyle.sendToBackground && entity.layer === undefined) {
                    if (!backgroundLayer) {
                        if (!save.layers || !save.layers.length) {
                            save.layers = [{
                                id: 0,
                                name: 'Base Layer',
                                visible: true,
                                locked: false,
                                zIndex: 0,
                            }];
                        }
                        let layerId = 0;
                        for (const layer of save.layers) {
                            if (layerId <= layer.id) {
                                layerId = layer.id + 1;
                            }
                            if (layer.zIndex !== undefined) {
                                layer.zIndex++;
                            }
                        }
                        backgroundLayer = {
                            id: layerId,
                            name: 'Background',
                            visible: true,
                            locked: false,
                            zIndex: 0,
                        };
                        save.layers.unshift(backgroundLayer);
                    }
                    entity.layer = backgroundLayer.id;
                }
                delete entity.shapeStyle.sendToBackground;
            }
        }
    }

    private upgrade104To105(save: LegacyPlanSave): void {
        for (const entity of save.entities ?? []) {
            if (entity.key === 'townbase3') {
                entity.key = 'townbase1';
            }
        }
    }

    private lookupBuildingFlags(subtype: unknown): LegacyPlanBuildingUpgradeFlags | undefined {
        if (typeof subtype !== 'string' || !subtype) {
            return undefined;
        }
        return this.buildingFlags[subtype];
    }
}

export function isLegacyPlanBuildingEntity(entity: LegacyPlanEntity): boolean {
    return Boolean(entity.key) && (!entity.type || entity.type === 'building');
}
