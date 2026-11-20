import { foxholeRailContactPorts, poseFoxholeRailBogies } from './rail-vehicle-snapping.ts';
import { parseNixieRenderPresentationV1 } from '@nixiejs/extension-sdk';
import { resolveFoxholeEntityStructureSockets } from './effective-structure-sockets.ts';
import { readFoxholeSceneV2CoreTransform } from './scene-v2-core-transforms.ts';
import { renderFoxholeContactShadows } from './scene-v2-contact-shadows.ts';
import { renderFoxholeHitboxOverlays } from './scene-v2-hitbox-overlays.ts';
import { renderFoxholeVehicleSeatOverlays } from './scene-v2-vehicle-seat-overlays.ts';
import { renderFoxholeStructureVolumeOverlays } from './scene-v2-structure-volume-overlays.ts';
import { renderFoxholeDebugSpotlightOverlays } from './scene-v2-spotlight-overlays.ts';
import { renderFoxholeModificationSlotOverlays } from './scene-v2-modification-overlays.ts';
import { foxholeConnectorGeometryHandles, foxholeConnectorGeometryWheel } from './connector-gesture-policy.ts';
import { normalizeFoxholeBuildSocketName } from './bunker-statistics-sockets.ts';
import { getFoxholeSceneV2ModelComponentData } from './scene-v2-models.ts';
import { foxholeAquaticWaterline } from './aquatic-placement.ts';
import { resolveFoxholeTrenchSelectionBounds } from './structure-selection-bounds.ts';
import { canFoxholeSocketConnectionOpenWalls } from './socket-wall-visibility.ts';
import type { FoxholeModelLayerMetadata } from './model-layer-nodes.ts';
import { structuralModelClips, occupiedTrenchDirtNodes } from './scene-v2-structural-clips.ts';
import { structuralGroundCutouts } from './scene-v2-ground-cutouts.ts';
import { renderFoxholeSpatialConnector } from './scene-v2-spatial-connectors.ts';
import { renderPlanarTrench } from './scene-v2-planar-trench.ts';
import { isTrenchConnector } from './trench-connector.ts';
import { trenchEndRotationTarget } from './trench-end-rotation.ts';
import { readRailPathSocket } from './rail-path-sockets.ts';
import { resolveFoxholeSpatialSplineAttachments } from './scene-v2-spatial-attachments.ts';
import { foxholeRailCouplerPlacementPorts } from './rail-coupler-placement.ts';
import { foxholeBlackBoltEffects, foxholeBlackBoltValveGear, foxholeRailLinkages, foxholeRailRollingEffect, foxholeRailVehicleBogies, foxholeRailWheelRoll } from './rail-vehicle-rigs.ts';
import { FOXHOLE_BOARD_UNITS_PER_METRE } from './scene-v2-footprints.ts';
import { findFoxholePowerlineObstructions } from './powerline-clearance.ts';
import {
    FOXHOLE_PLACEMENT_WARNING_SETTING_ID,
    renderFoxholeStructurePlacementOverlay,
    renderFoxholeStructurePlacementSpatialOverlay,
    resolveFoxholeStructurePlacement,
} from './structure-placement.ts';
import { createFoxholeBarbedWireSplineGeometry, createFoxholeSandbagSplineGeometry } from './modification-spline.ts';
import { resolveFoxholeConnectorSelectionGeometry } from './connector-selection-geometry.ts';
import { renderFoxholeStructureRangeOverlays, renderFoxholeStructureFiringVolumes } from './scene-v2-structure-range-overlays.ts';
import { resolveFoxholeBunkerSpotlightLights, showFoxholeBunkerSpotlightGlow } from './bunker-spotlights.ts';
import { createFoxholeSpotlightBeamGraphics } from './spotlight-beam.ts';
import { renderFoxholeConnectorGuides } from './scene-v2-connector-guides.ts';
import { renderFoxholeConnectorSocketOverlays, renderFoxholeConnectorSpatialMarkers } from './scene-v2-connector-socket-overlays.ts';
import { renderFoxholeStructureSocketOverlays, renderFoxholeSpatialSocketMarkers, resolveFoxholeSocketDisplayKind, resolveOccupiedSockets } from './scene-v2-socket-overlays.ts';
import type {
    NixieComponentEntitySnapshotV1,
    NixieComponentJsonObjectV1,
    NixieEntityRendererContextV1,
    NixieExtensionRenderNodeV1,
    NixieExtensionRenderPlanV1,
    NixieSpatialMarkerV1,
} from '@nixiejs/extension-sdk/scene-v2';
import { FOXHOLE_STRUCTURE_RENDER_LANES, FOXHOLE_MODIFICATION_TEXTURE_LAYER_LANES, foxholeRenderLane, resolveFoxholeStructureDirtRenderLane, resolveFoxholeStructurePrimaryRenderLane, resolveFoxholeAssetHeightLane, resolveFoxholeAssetComponentLane } from './render-lanes.ts';
import { compareFoxholeModificationRenderOrder, isFoxholeRoofModification, resolveFoxholeModificationTextureLayer } from './modification-render-order.ts';
import { filterFoxholeSameWallInfrastructureSelections } from './modification-wall-conflicts.ts';
import { createFoxholeStructureFloorMaskPoints, createFoxholeCornerWallMaskPoints,
    createFoxholeTrenchEmplacementMaskPolygons, isFoxholeTrenchEmplacementCodeName } from './structure-floor-mask.ts';
import { isFoxholeBunkerSocketUnbreachable, isFoxholeBreachIndicatorSocket } from './breach-indicators.ts';
import { isFoxholeEcsBunkerMember } from './bunker-statistics.ts';
import { buildFoxholeModelLightOverrides, shouldEnableFoxholePoweredModelLights } from './model-light-presentation.ts';
import {buildFoxholeModelTextureTransforms, FOXHOLE_SCENE_FACTION_SETTING_ID} from './model-texture-presentation.ts';
import foxholeSceneV2Assets, { productionOutputsByRecipeId, modelLightHintsByResourceId, flagAtlasesByResourceId } from '#foxhole-scene-v2-assets';
import type {
    FoxholeSceneV2AssetMetadata,
    FoxholeSceneV2ModificationSlotMetadata,
    FoxholeSceneV2ModificationVariantMetadata,
    FoxholeSceneV2VisualMetadata,
} from './scene-v2-asset-metadata.ts';
import { isFoxholeFloorRenderLayer, orderFoxholeStructureRenderLayers, resolveFoxholeOccupiedSocketTags, resolveFoxholeStructureRenderLane,
    shouldCompositeFoxholeStructureBaseTexture, shouldShowFoxholeStructureRenderLayer } from './structure-render-layer-visibility.ts';
import {
    renderFoxholeSceneV2TacticalLine,
} from './scene-v2-tactical-lines.ts';
import {
    renderFoxholeSceneV2Connector,
} from './scene-v2-connectors.ts';
import {
    renderFoxholeSceneV2Range, resolveFoxholeRangeSelectionGeometry,
} from './scene-v2-ranges.ts';
import {
    renderFoxholeSceneV2BinocularLine,
} from './scene-v2-binocular-lines.ts';
import {
    renderFoxholeSceneV2Triangulation, resolveFoxholeTriangulationSelectionGeometry,
} from './scene-v2-triangulations.ts';
import {
    renderFoxholeSceneV2SplineConnector,
} from './scene-v2-spline-connectors.ts';
import { FOXHOLE_POWER_POLE_LAMP, POWER_POLE_LAMP_STOPS, powerPoleLampFootprint, showFoxholePowerPoleLamp } from './power-pole-lamps.ts';
import { renderFoxholeSceneV2Cargo } from './scene-v2-cargo.ts';
import {
    resolveFoxholeSceneV2ConnectorAttachments,
    resolveFoxholeSceneV2SplineAttachments,
} from './scene-v2-attachments.ts';

type FoxholeSceneV2TacticalLineData = Parameters<typeof renderFoxholeSceneV2TacticalLine>[0];
type FoxholeSceneV2ConnectorData = Parameters<typeof renderFoxholeSceneV2Connector>[0];
type FoxholeSceneV2RangeData = Parameters<typeof renderFoxholeSceneV2Range>[0];
type FoxholeSceneV2BinocularLineData = Parameters<typeof renderFoxholeSceneV2BinocularLine>[0];
type FoxholeSceneV2TriangulationData = Parameters<typeof renderFoxholeSceneV2Triangulation>[0];
type FoxholeSceneV2SplineConnectorData = Parameters<typeof renderFoxholeSceneV2SplineConnector>[0];

export const FOXHOLE_SCENE_V2_ENTITY_RENDERER_SYSTEM_ID = 'render.entity';

// These upgrades place their defining geometry under the roof.
const interiorBunkerUpgrade = /^(?:engineroom|ammoroom|fortflame|fortfirepit|medicalroom|fortartilleryshelter)t[123]$/i;

const assetMetadataById = foxholeSceneV2Assets as Record<string, FoxholeSceneV2AssetMetadata>;
const previouslyPlanarReferences = new Set([
    'crate', 'excavation', 'flamebackpackammo', 'oilfield', 'prototypekit', 'reservepower', 'shippable',
]);
const itemAssetIdByCodeName = new Map(Object.entries(assetMetadataById).flatMap(([assetId, metadata]) => (
    metadata.codeName ? [[metadata.codeName.toLocaleLowerCase(), assetId] as const] : []
)));
const stockpileAssetIdsByCodeName = new Map(Object.entries(assetMetadataById).flatMap(([id, asset]) => asset.codeName
    ? [[`${asset.isItem ? 'Items' : asset.isVehicle ? 'Vehicles' : 'Structures'}:${asset.codeName.toLowerCase()}`, id] as const] : []));

interface ResolvedFoxholeSceneV2Modification {
    slotId: string;
    variantId: string;
    slot: FoxholeSceneV2ModificationSlotMetadata;
    variant: FoxholeSceneV2ModificationVariantMetadata;
}

interface FoxholeSceneV2Appearance {
    faction?: 'c' | 'w';
    colorHex?: string;
    destroyed: boolean;
    packaged: boolean;
    blueprint: boolean;
    tint?: number;
    brightness?: number;
    anchorX?: number;
    anchorY?: number;
}

function readFoxholeSceneV2Appearance(
    entity: NixieComponentEntitySnapshotV1,
): FoxholeSceneV2Appearance {
    const appearance = entity.components.find(component => (
        component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'appearance'
        && component.definitionAvailable
    ))?.data;
    const faction = appearance?.faction === 'c' || appearance?.faction === 'w'
        ? appearance.faction
        : undefined;
    const colorHexValue = typeof appearance?.colorHex === 'string'
        ? appearance.colorHex.trim().replace(/^#/u, '').toLowerCase()
        : '';
    const colorHex = /^[a-f0-9]{6}$/u.test(colorHexValue) ? colorHexValue : undefined;
    const number = (value: unknown, minimum: number, maximum: number): number | undefined => (
        typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
            ? value
            : undefined
    );
    return {
        ...(faction ? { faction } : {}),
        ...(colorHex ? { colorHex } : {}),
        destroyed: appearance?.destroyed === true,
        packaged: appearance?.packaged === true,
        blueprint: appearance?.blueprint === true && appearance?.destroyed !== true && appearance?.packaged !== true,
        ...(number(appearance?.tint, 0, 0xFFFFFF) === undefined ? {} : { tint: number(appearance?.tint, 0, 0xFFFFFF) }),
        ...(number(appearance?.brightness, 0, 4) === undefined ? {} : { brightness: number(appearance?.brightness, 0, 4) }),
        ...(number(appearance?.anchorX, -10, 10) === undefined ? {} : { anchorX: number(appearance?.anchorX, -10, 10) }),
        ...(number(appearance?.anchorY, -10, 10) === undefined ? {} : { anchorY: number(appearance?.anchorY, -10, 10) }),
    };
}

function baseFoxholeSceneV2Visual(
    assetId: string,
    metadata: FoxholeSceneV2AssetMetadata,
): FoxholeSceneV2VisualMetadata {
    return {
        resourceId: `foxhole.asset.${assetId}`,
        width: metadata.width,
        height: metadata.height,
        anchorX: 0.5,
        anchorY: 0.5,
        offsetX: metadata.x,
        offsetY: metadata.y,
    };
}

function resolveFoxholeSceneV2Visual(
    assetId: string,
    metadata: FoxholeSceneV2AssetMetadata,
    appearance: FoxholeSceneV2Appearance,
): FoxholeSceneV2VisualMetadata {
    const base = baseFoxholeSceneV2Visual(assetId, metadata);
    if (appearance.packaged) {
        return metadata.packaged?.structure
            ?? (appearance.colorHex ? metadata.colorVariants[appearance.colorHex] : undefined)
            ?? (appearance.faction ? metadata.factionVariants[appearance.faction] : undefined)
            ?? base;
    }
    if (appearance.destroyed) {
        return metadata.destroyed ?? base;
    }
    return (appearance.colorHex ? metadata.colorVariants[appearance.colorHex] : undefined)
        ?? (appearance.faction ? metadata.factionVariants[appearance.faction] : undefined)
        ?? base;
}

function applyFoxholeSceneV2Appearance(
    nodes: NixieExtensionRenderNodeV1[],
    appearance: FoxholeSceneV2Appearance,
    canBlueprint: boolean,
): { nodes: NixieExtensionRenderNodeV1[]; brightness?: number; } {
    const blueprint = appearance.blueprint && canBlueprint;
    const tint = blueprint ? 0x335CFF : appearance.tint;
    const brightness = blueprint ? 2.15 : appearance.brightness;
    return {
        nodes: nodes.map(node => node.id.startsWith('structure-layer-')
            ? node
            : ({ ...node, ...((node.kind === 'sprite' || node.kind === 'mesh') && tint !== undefined ? { tint } : {}),
                ...(brightness === undefined || brightness === 1 ? {} : { brightness }) })),
        ...(brightness === undefined || brightness === 1 ? {} : { brightness }),
    };
}

function selectedFoxholeSceneV2Modifications(
    entity: NixieComponentEntitySnapshotV1,
    assetMetadata: FoxholeSceneV2AssetMetadata,
): ResolvedFoxholeSceneV2Modification[] {
    const modification = entity.components.find(component => (
        component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'modification'
        && component.definitionAvailable
    ));
    const selections = modification?.data.selections;
    if (!Array.isArray(selections)) {
        return [];
    }
    const validSelections = selections.flatMap(selection => {
        if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
            return [];
        }
        const slotId = typeof selection.slotId === 'string' ? selection.slotId : '';
        const variantId = typeof selection.variantId === 'string' ? selection.variantId : '';
        const slot = assetMetadata.modifications[slotId];
        const variant = slot?.variants[variantId];
        return slot && variant ? [{ slotId, variantId, slot, variant }] : [];
    });
    return filterFoxholeSameWallInfrastructureSelections(assetMetadata.modifications, validSelections);
}

export function resolveFoxholeSceneV2HitboxFrame(entity: NixieComponentEntitySnapshotV1, assetId: string,
    asset: FoxholeSceneV2AssetMetadata) {
    const appearance = readFoxholeSceneV2Appearance(entity);
    const visual = resolveFoxholeSceneV2Visual(assetId, asset, appearance);
    const replacement = !appearance.destroyed && !appearance.packaged
        ? selectedFoxholeSceneV2Modifications(entity, asset).find(entry => entry.variant.isUpgrade)?.variant
        : undefined;
    return {
        width: Math.max(1, replacement?.width ?? visual.width ?? asset.width),
        height: Math.max(1, replacement?.height ?? visual.height ?? asset.height),
        anchorX: appearance.anchorX ?? 0.5,
        anchorY: appearance.anchorY ?? 0.5,
    };
}

function renderFoxholeSceneV2Asset(
    entity: NixieComponentEntitySnapshotV1,
    assetId: string,
    assetMetadata: FoxholeSceneV2AssetMetadata,
    settings: Record<string, boolean> = {},
    entities: readonly NixieComponentEntitySnapshotV1[] = [],
    railPose?: ReturnType<typeof poseFoxholeRailBogies>,
): NixieExtensionRenderNodeV1[] {
    const appearance = readFoxholeSceneV2Appearance(entity);
    const modifications = selectedFoxholeSceneV2Modifications(entity, assetMetadata);
    const operational = !appearance.destroyed && !appearance.packaged;
    const replacement = operational
        ? modifications.find(entry => entry.variant.isUpgrade)?.variant
        : undefined;
    const visual = resolveFoxholeSceneV2Visual(assetId, assetMetadata, appearance);
    const layers = orderFoxholeStructureRenderLayers(Object.entries(assetMetadata.renderLayers)
        .filter(([id]) => !planarRailPartIds.has(id)).map(([id, layer]) => ({ id, ...layer })), assetMetadata.codeName);
    const useLayers = operational && !replacement && layers.length > 0 && settings['foxhole.structure.useStaticRender'] !== true;
    const layerOptions = { profileType: assetMetadata.profileType, useStructureRenderLayers: useLayers };
    const orderSelection = (entry: ResolvedFoxholeSceneV2Modification) => ({ slot: { ...entry.slot, id: entry.slot.id ?? '', name: entry.slot.name ?? '' }, variant: { id: entry.variant.id ?? '' } });
    const base: NixieExtensionRenderNodeV1 = {
        id: 'building-texture',
        kind: 'sprite',
        ...foxholeRenderLane(resolveFoxholeAssetHeightLane(replacement?.id)
            ?? resolveFoxholeStructurePrimaryRenderLane(assetId, assetMetadata.isRailVehicle, assetMetadata.isVehicle)),
        resourceId: replacement?.resourceId ?? visual.resourceId,
        anchorX: appearance.anchorX ?? replacement?.anchorX ?? visual.anchorX,
        anchorY: appearance.anchorY ?? replacement?.anchorY ?? visual.anchorY,
        x: replacement?.offsetX ?? visual.offsetX,
        y: replacement?.offsetY ?? visual.offsetY,
        width: replacement?.width ?? visual.width,
        height: replacement?.height ?? visual.height,
    };
    const overlays = modifications
        .filter(entry => operational && !entry.variant.isUpgrade)
        .filter(entry => settings['foxhole.structure.hideRoofs'] !== true || !isFoxholeRoofModification(entry.variant))
        .sort((a, b) => compareFoxholeModificationRenderOrder(orderSelection(a), orderSelection(b), layerOptions))
        .map((entry, index): NixieExtensionRenderNodeV1 => {
            const cosine = Math.cos(entry.slot.rotation);
            const sine = Math.sin(entry.slot.rotation);
            if ((entry.variant.id === 'barbedwire' || entry.variant.id === 'sandbags') && entry.slot.splineEnd) {
                const panel = entry.variant;
                const geometry = entry.variant.id === 'sandbags'
                    ? createFoxholeSandbagSplineGeometry(entry.slot, entry.slot.splineEnd, panel)
                    : createFoxholeBarbedWireSplineGeometry(entry.slot, entry.slot.splineEnd, entry.slot.rotation, panel);
                return { id: `modification-${index + 1}`, kind: 'mesh', resourceId: panel.resourceId,
                    ...foxholeRenderLane(FOXHOLE_MODIFICATION_TEXTURE_LAYER_LANES[resolveFoxholeModificationTextureLayer(entry.slot, { id: entry.variant.id }, layerOptions)]),
                    ...geometry };
            }
            return {
                id: `modification-${index + 1}`,
                kind: 'sprite',
                ...foxholeRenderLane(FOXHOLE_MODIFICATION_TEXTURE_LAYER_LANES[resolveFoxholeModificationTextureLayer(entry.slot, { id: entry.variant.id ?? '' }, layerOptions)]),
                resourceId: entry.variant.resourceId,
                anchorX: entry.variant.anchorX,
                anchorY: entry.variant.anchorY,
                x: entry.slot.x + entry.variant.offsetX * cosine - entry.variant.offsetY * sine,
                y: entry.slot.y + entry.variant.offsetX * sine + entry.variant.offsetY * cosine,
                rotation: entry.slot.rotation,
                width: entry.variant.width,
                height: entry.variant.height,
            };
        });
    const pallet = appearance.packaged && assetMetadata.packaged?.pallet
        ? [{
            id: 'packaged-pallet',
            kind: 'sprite' as const,
            ...foxholeRenderLane(FOXHOLE_STRUCTURE_RENDER_LANES.floor),
            resourceId: assetMetadata.packaged.pallet.resourceId,
            anchorX: assetMetadata.packaged.pallet.anchorX,
            anchorY: assetMetadata.packaged.pallet.anchorY,
            x: assetMetadata.packaged.pallet.offsetX,
            y: assetMetadata.packaged.pallet.offsetY,
            rotation: assetMetadata.packaged.pallet.rotation,
            width: assetMetadata.packaged.pallet.width,
            height: assetMetadata.packaged.pallet.height,
        }]
        : [];
    const occupiedTags = resolveStructureOccupiedTags(entity, assetMetadata, entities);
    const layerNodes = useLayers
        ? layers
            .filter(layer => shouldShowFoxholeStructureRenderLayer(layer, occupiedTags, { structureCodeName: assetMetadata.codeName,
                hideRoofs: settings['foxhole.structure.hideRoofs'], hideFloors: settings['foxhole.structure.hideFloors'],
                hideWalls: settings['foxhole.structure.hideWalls'], hideDirt: settings['foxhole.structure.hideDirt'], hideCorners: settings['foxhole.structure.hideCorners'] }))
            .flatMap((layer): NixieExtensionRenderNodeV1[] => {
                const outline = isFoxholeFloorRenderLayer(layer, assetMetadata.codeName)
                    ? createFoxholeStructureFloorMaskPoints(assetMetadata.codeName, layer, 160, occupiedTags)
                    : createFoxholeCornerWallMaskPoints(assetMetadata.codeName, layer, 160, occupiedTags);
                const emplacement = isFoxholeTrenchEmplacementCodeName(assetMetadata.codeName);
                const polygons = emplacement
                    ? createFoxholeTrenchEmplacementMaskPolygons(assetMetadata.codeName, layer, 160,
                        isFoxholeFloorRenderLayer(layer, assetMetadata.codeName) ? 'floor' : 'walls', occupiedTags)
                    : outline.length ? [outline] : [];
                if (polygons.length > 0) {
                    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
                    for (const polygon of polygons) {
                        const center = { x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
                            y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length };
                        const points = [center, ...polygon];
                        const offset = positions.length / 2;
                        positions.push(...points.flatMap(point => [point.x, point.y]));
                        uvs.push(...points.flatMap(point => [(point.x - layer.offsetX) / layer.width + 0.5, (point.y - layer.offsetY) / layer.height + 0.5]));
                        indices.push(...Array.from({ length: polygon.length }, (_, index) => [offset, offset + index + 1,
                            offset + (index + 1) % polygon.length + 1]).flat());
                    }
                    const lane = resolveFoxholeStructureRenderLane(layer, assetMetadata.codeName);
                    return [{ id: `structure-layer-${layer.id}`, kind: 'mesh', ...foxholeRenderLane(lane === 'floor' ? FOXHOLE_STRUCTURE_RENDER_LANES.floor : lane === 'corners' ? FOXHOLE_STRUCTURE_RENDER_LANES.corners : FOXHOLE_STRUCTURE_RENDER_LANES.base), resourceId: layer.resourceId,
                        positions, uvs, indices }];
                }
                if (emplacement) {
                    return [];
                }
                return [{ id: `structure-layer-${layer.id}`, kind: 'sprite',
                    ...(resolveFoxholeStructureRenderLane(layer, assetMetadata.codeName) === 'dirt'
                        ? foxholeRenderLane(resolveFoxholeStructureDirtRenderLane(assetMetadata.codeName))
                        : foxholeRenderLane(FOXHOLE_STRUCTURE_RENDER_LANES[resolveFoxholeStructureRenderLane(layer, assetMetadata.codeName) === 'walls' ? 'base' : resolveFoxholeStructureRenderLane(layer, assetMetadata.codeName) as 'floor' | 'dirt' | 'roof' | 'corners' | 'spotlight'])), resourceId: layer.resourceId,
                    anchorX: 0.5, anchorY: 0.5, x: layer.offsetX, y: layer.offsetY, scaleX: 0.5, scaleY: 0.5 }];
            })
        : [];
    const lamp = assetMetadata.renderLayers.topmesh;
    const lights = !replacement && showFoxholeBunkerSpotlightGlow(assetMetadata.codeName, id => settings[id], appearance)
        ? resolveFoxholeBunkerSpotlightLights(assetMetadata.spotlights, lamp) : [];
    const glow: NixieExtensionRenderNodeV1[] = lights.length
        ? [{ id: 'bunker-spotlight-glow', kind: 'group', ...foxholeRenderLane(FOXHOLE_STRUCTURE_RENDER_LANES.spotlight),
            presentation: { contractVersion: 1, excludeFromBounds: true },
            children: lights.map((light, index) => ({ id: `bunker-light-${index}`, kind: 'group',
                x: light.x, y: light.y, rotation: light.rotation,
                children: createFoxholeSpotlightBeamGraphics(light.beam).map(node => ({ ...node, id: `${node.id}-${index}` })),
            })) }]
        : [];
    const poleLamp: NixieExtensionRenderNodeV1[] = showFoxholePowerPoleLamp(assetMetadata.codeName,
        modifications.map(entry => entry.variant.id ?? ''), id => settings[id], appearance)
        ? [{ id: 'power-pole-lamp-glow', kind: 'graphics', ...foxholeRenderLane(FOXHOLE_STRUCTURE_RENDER_LANES.floorDetail),
            x: FOXHOLE_POWER_POLE_LAMP.x, y: FOXHOLE_POWER_POLE_LAMP.y,
            presentation: { contractVersion: 1, excludeFromBounds: true },
            commands: [{ op: 'polygon', close: true, points: powerPoleLampFootprint() },
                { op: 'fill-radial-gradient', center: { x: 0, y: 0 }, outerRadius: FOXHOLE_POWER_POLE_LAMP.radius,
                    colorStops: POWER_POLE_LAMP_STOPS }],
        }] : [];
    const height = resolveFoxholeAssetHeightLane(assetId);
    const bodyLayers = layerNodes.map(node => {
        if (!height) {
            return node;
        }
        const componentLane = Object.values(FOXHOLE_STRUCTURE_RENDER_LANES).find(lane => lane.laneId === node.laneId)
            ?? { laneId: node.laneId ?? 'default', laneOrder: node.laneOrder ?? 0, label: '' };
        return { ...node, ...foxholeRenderLane(resolveFoxholeAssetComponentLane(assetId, componentLane)) };
    });
    const railParts = operational && !replacement && settings['foxhole.structure.useStaticRender'] !== true
        ? renderFoxholePlanarRailParts(assetId, assetMetadata, railPose, settings['nixie.scene.planarModelMotion'] === true) : null;
    if (railParts) {
        const shadows = renderFoxholeContactShadows([base], assetMetadata.contactShadows).filter(node => node !== base);
        return [...shadows, ...poleLamp, ...railParts, ...overlays, ...glow];
    }
    return renderFoxholeContactShadows([...poleLamp, ...(useLayers && !shouldCompositeFoxholeStructureBaseTexture(layers) ? [] : [base]), ...pallet, ...bodyLayers, ...overlays, ...glow], assetMetadata.contactShadows);
}

const planarRailPartIds = new Set(['rail-body', 'rail-bogie-front', 'rail-bogie-rear']);
const planarModelMotionSupported = (() => {
    try {
        // The SDK validates output inside the extension before it reaches Studio.
        parseNixieRenderPresentationV1({ contractVersion: 1,
            simulationModelNode: { nodeName: 'rail-bogie-front', unitsPerMetre: 32, restX: 0, restY: 0 } });
        return true;
    } catch {
        return false;
    }
})();

function renderFoxholePlanarRailParts(
    assetId: string,
    metadata: FoxholeSceneV2AssetMetadata,
    pose: ReturnType<typeof poseFoxholeRailBogies>,
    animateBogies: boolean,
): NixieExtensionRenderNodeV1[] | null {
    if (assetId !== 'trainlrartillery' && assetId !== 'trainhospital') {
        return null;
    }
    const parts = [...foxholeRailVehicleBogies[assetId]!, { nodeName: 'rail-body', pivot: 0 }];
    if (parts.some(part => !metadata.renderLayers[part.nodeName])) {
        return null;
    }
    const bodyLane = foxholeRenderLane(resolveFoxholeAssetHeightLane(assetId)
        ?? resolveFoxholeStructurePrimaryRenderLane(assetId, metadata.isRailVehicle, metadata.isVehicle));
    const bogieLane = foxholeRenderLane(FOXHOLE_STRUCTURE_RENDER_LANES.railBogie);
    const units = FOXHOLE_BOARD_UNITS_PER_METRE;
    return parts.map(({ nodeName, pivot }) => {
        const isBogie = nodeName !== 'rail-body';
        const lane = isBogie ? bogieLane : bodyLane;
        const layer = metadata.renderLayers[nodeName]!;
        const transform = pose?.find(node => node.nodeName === nodeName);
        const rotation = transform ? -transform.rotation[1] : 0;
        const pivotX = pivot * units;
        const x = layer.offsetX - pivotX;
        const y = layer.offsetY;
        const posedX = pivotX + (transform?.translation[0] ?? 0) * units;
        const posedY = (transform?.translation[2] ?? 0) * units;
        const sprite = { kind: 'sprite' as const, resourceId: layer.resourceId, anchorX: .5, anchorY: .5, width: layer.width, height: layer.height };
        if (animateBogies && planarModelMotionSupported && isBogie) {
            const presentation = { contractVersion: 1 as const,
                simulationModelNode: { nodeName, unitsPerMetre: units, restX: pivotX, restY: 0 } };
            return { ...lane, id: nodeName, kind: 'group', x: posedX, y: posedY, rotation, presentation,
                children: [{ ...sprite, id: nodeName + '-texture', x, y }] };
        }
        return { ...lane, ...sprite, id: nodeName, rotation,
            x: posedX + x * Math.cos(rotation) - y * Math.sin(rotation),
            y: posedY + x * Math.sin(rotation) + y * Math.cos(rotation) };
    });
}

function resolveBreachIndicators(entity: NixieComponentEntitySnapshotV1, metadata: FoxholeSceneV2AssetMetadata,
    context: NixieEntityRendererContextV1): NixieSpatialMarkerV1[] {
    const appearance = readFoxholeSceneV2Appearance(entity);
    if (context.settings?.['foxhole.structure.breachIndicators'] !== true || appearance.destroyed || appearance.packaged) {
        return [];
    }
    const attachments = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'socket-attachments' && component.definitionAvailable)?.data.attachments;
    const socketKey = (name: unknown) => normalizeFoxholeBuildSocketName(name).toLowerCase();
    const rows = Array.isArray(attachments) ? attachments.filter((entry): entry is NixieComponentJsonObjectV1 => entry !== null && typeof entry === 'object' && !Array.isArray(entry)) : [];
    return metadata.buildSockets.filter(socket => isFoxholeBreachIndicatorSocket(metadata, socket)).map((socket, index) => {
        const attachment = rows.find(entry => (entry.localSocketName ?? entry.socketName) === socket.name)
            ?? rows.find(entry => socketKey(entry.localSocketName ?? entry.socketName) === socketKey(socket.name));
        const neighbor = attachment ? context.entities.find(candidate => candidate.entityId === attachment.targetEntityId) : undefined;
        const neighborAssetId = neighbor?.components.find(component => component.ownerId === 'nixie.foxhole-planner'
            && component.componentId === 'asset' && component.definitionAvailable)?.data.assetId;
        const neighborMetadata = typeof neighborAssetId === 'string' ? assetMetadataById[neighborAssetId] : undefined;
        const targetSocket = socketKey(attachment?.targetSocketName);
        // A bunker upgrade can seal an adjacent wall even when it has no breach faces of its own.
        const bunkerUpgradeSocket = neighborMetadata?.isUpgrade === true && neighborMetadata.isBunker === true
            && neighborMetadata.bunker && isFoxholeEcsBunkerMember(neighborMetadata.codeName, neighborMetadata.bunker)
            && neighborMetadata.buildSockets.some(candidate => socketKey(candidate.name) === targetSocket
                && candidate.integrityBonus !== false && candidate.socketTags?.some(tag => tag.category === 4 && (BigInt(tag.mask) & ~8n) !== 0n));
        const neighborAppearance = neighbor ? readFoxholeSceneV2Appearance(neighbor) : undefined;
        const sealed = Boolean(attachment) && isFoxholeBunkerSocketUnbreachable({
            selfBreachable: metadata.breachable === true, selfStructuralGarrison: metadata.structuralGarrison === true,
            selfExposed: metadata.codeName.toLowerCase() === 'fortbuildsite',
            neighborBreachable: neighborMetadata?.breachable === true || bunkerUpgradeSocket === true,
            neighborStructuralGarrison: neighborMetadata?.structuralGarrison === true,
            neighborExposed: neighborMetadata?.codeName.toLowerCase() === 'fortbuildsite' || neighborMetadata?.isDestroyed === true
                || neighborMetadata?.isBreached === true || neighborAppearance?.destroyed === true || neighborAppearance?.packaged === true,
            connectionCount: 1,
        });
        return {
            id: `breach-${index}`,
            point: [socket.x, socket.y, socket.z ?? 0],
            color: sealed ? 0x53D769 : 0xFF4D4D,
        };
    });
}

function renderPlanarBreachIndicator(marker: NixieSpatialMarkerV1): NixieExtensionRenderNodeV1 {
    return {
        id: marker.id, kind: 'graphics', laneId: 'nixie:scene:overlay', laneOrder: FOXHOLE_STRUCTURE_RENDER_LANES.hitboxDebug.laneOrder,
        presentation: { contractVersion: 1, excludeFromBounds: true },
        x: marker.point[0], y: marker.point[1],
        commands: [
            { op: 'rect', x: -6, y: -6, width: 12, height: 12 },
            { op: 'fill', color: marker.color, alpha: 0.95 },
            { op: 'stroke', color: 0x081018, alpha: 0.95, width: 2 },
        ],
    };
}

export function resolveFoxholeSceneV2StructureSelectionGeometry(entity: NixieComponentEntitySnapshotV1, assetMetadata: FoxholeSceneV2AssetMetadata) {
    const appearance = readFoxholeSceneV2Appearance(entity);
    const modifications = !appearance.destroyed && !appearance.packaged ? selectedFoxholeSceneV2Modifications(entity, assetMetadata) : [];
    const replacement = !appearance.destroyed && !appearance.packaged ? modifications.find(entry => entry.variant.isUpgrade)?.variant : undefined;
    const pallet = appearance.packaged ? assetMetadata.packaged?.pallet : undefined;
    const alternative = appearance.packaged ? assetMetadata.selectionPackaged : appearance.destroyed ? assetMetadata.selectionDestroyed : undefined;
    const visual = pallet ?? replacement ?? alternative ?? { width: assetMetadata.width, height: assetMetadata.height,
        offsetX: assetMetadata.x, offsetY: assetMetadata.y, anchorX: 0.5, anchorY: 0.5 };
    const polygons = pallet
        ? []
        : modifications.find(entry => entry.variant.selectionPolygons?.length)?.variant.selectionPolygons
            ?? (appearance.destroyed ? assetMetadata.selectionDestroyed?.selectionPolygons : undefined) ?? assetMetadata.selectionPolygons ?? [];
    const shapes = polygons.filter(polygon => polygon.shape.length >= 6 && polygon.shape.length % 2 === 0 && polygon.shape.every(Number.isFinite));
    const points = shapes.length
        ? shapes.flatMap(polygon => Array.from({ length: polygon.shape.length / 2 }, (_, index) => ({
            x: polygon.shape[index * 2]! * 32, y: polygon.shape[index * 2 + 1]! * 32,
        })))
        : (() => {
            const centerX = visual.offsetX + visual.width * (0.5 - (pallet ? pallet.anchorX : appearance.anchorX ?? 0.5));
            const centerY = visual.offsetY + visual.height * (0.5 - (pallet ? pallet.anchorY : appearance.anchorY ?? 0.5));
            const x = -visual.width / 2;
            const y = -visual.height / 2;
            const angle = pallet?.rotation ?? 0;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            return [[x, y], [x + visual.width, y], [x + visual.width, y + visual.height], [x, y + visual.height]].map(([px, py]) => ({
                x: centerX + px! * cos - py! * sin, y: centerY + px! * sin + py! * cos,
            }));
        })();
    const spriteBounds = { minX: Math.min(...points.map(point => point.x)), minY: Math.min(...points.map(point => point.y)),
        maxX: Math.max(...points.map(point => point.x)), maxY: Math.max(...points.map(point => point.y)) };
    const trenchBounds = !shapes.length && !appearance.destroyed && !appearance.packaged && !replacement && /^trencht[12]$/i.test(assetMetadata.codeName)
        ? resolveFoxholeTrenchSelectionBounds(spriteBounds, Object.values(assetMetadata.renderLayers)) : null;
    const powerPorts = new Map<string, { id: string; local: { x: number; y: number; z?: number; }; }>();
    if (!appearance.destroyed && !appearance.packaged && !assetMetadata.isDestroyed) {
        const attachments = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
            && component.componentId === 'socket-attachments' && component.definitionAvailable)?.data.attachments;
        const occupied = resolveOccupiedSockets(assetMetadata, modifications.map(entry => entry.variant), attachments);
        for (const socket of resolveFoxholeEntityStructureSockets(entity, assetMetadata)) {
            const id = socket.name.toLowerCase();
            if (!occupied.has(socket.name) && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(id) && id.length <= 128
                && resolveFoxholeSocketDisplayKind({ ...socket, socketTags: socket.socketTags ?? [] }) === 'power') {
                powerPorts.set(id, { id, local: { x: socket.x, y: socket.y, ...(socket.z === undefined ? {} : { z: socket.z }) } });
            }
        }
    }
    return { contractVersion: 1 as const, localBounds: trenchBounds ?? spriteBounds, transformOrigin: { x: 0, y: 0 }, showTransformGizmo: true,
        ...(powerPorts.size ? { connectionPorts: { toolId: 'powerline', quickStart: true, points: [...powerPorts.values()].slice(0, 32) } } : {}) };
}

export function renderFoxholeSceneV2Entity(
    entity: NixieComponentEntitySnapshotV1,
    context: NixieEntityRendererContextV1 = { contractVersion: 1, entities: [entity] },
): NixieExtensionRenderPlanV1 {
    const asset = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'asset' && component.definitionAvailable);
    const spline = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'spline-connector' && component.definitionAvailable);
    const metadata = assetMetadataById[String(asset?.data.assetId ?? spline?.data.foxholeKey ?? '')];
    const previewInterior = context.settings?.['nixie.scene.inspectorPreview'] === true && metadata
        && (interiorBunkerUpgrade.test(metadata.codeName)
            || selectedFoxholeSceneV2Modifications(entity, metadata).some(({ slot, variant }) =>
                !variant.isUpgrade && (variant.id === 'interiorfiringport'
                    || resolveFoxholeModificationTextureLayer(slot, { id: variant.id ?? '' },
                        { profileType: metadata.profileType }) === 'base')));
    const hoverEnabled = !previewInterior && context.settings?.['foxhole.structure.hideRoofsOnHover'] === true
        && context.settings?.['foxhole.structure.hideRoofs'] !== true;
    const effectiveContext = hoverEnabled || previewInterior ? { ...context, settings: { ...context.settings,
        'foxhole.structure.useStaticRender': false, ...(previewInterior ? { 'foxhole.structure.hideRoofs': true } : {}) } } : context;
    const plan = renderFoxholeSceneV2EntityPlan(entity, effectiveContext);
    const appearance = readFoxholeSceneV2Appearance(entity);
    if (hoverEnabled && metadata && !metadata.isDestroyed && !metadata.isBreached && !appearance.destroyed && !appearance.packaged) {
        const roofless = renderFoxholeSceneV2EntityPlan(entity, { ...effectiveContext,
            settings: { ...effectiveContext.settings, 'foxhole.structure.hideRoofs': true } });
        const ids = (node: NixieExtensionRenderNodeV1): string[] => [node.id, ...(node.kind === 'group' ? node.children.flatMap(ids) : [])];
        const retainedNodes = new Set(ids(roofless.root));
        const retainedModels = new Set(plan.spatial?.hiddenModelNodes ?? []);
        const retainedPaths = new Set(roofless.spatial?.nodes.map(node => node.id) ?? []);
        const bunker = (candidate: FoxholeSceneV2AssetMetadata) => !candidate.isDestroyed && !candidate.isBreached
            && !/destroyed|breached|buildsite/i.test(candidate.codeName)
            && (candidate.isBunker === true || /^fort/i.test(candidate.profileType ?? '')
                || /^(?:fort|observationbunker|rifleai|mgai|atgunai|artilleryai)/i.test(candidate.codeName));
        const attachments = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
            && component.componentId === 'socket-attachments' && component.definitionAvailable)?.data.attachments;
        const relatedEntityIds = bunker(metadata) && Array.isArray(attachments)
            ? [...new Set(attachments.flatMap(attachment => {
                if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)
                    || typeof attachment.localSocketName !== 'string' || typeof attachment.targetEntityId !== 'string') {
                    return [];
                }
                const socket = metadata.buildSockets.find(candidate => candidate.name === attachment.localSocketName)
                    ?? metadata.buildSockets.find(candidate => normalizeFoxholeBuildSocketName(candidate.name).toLowerCase()
                        === normalizeFoxholeBuildSocketName(attachment.localSocketName).toLowerCase());
                if (!socket?.socketTags?.some(tag => tag.category === 4 && (BigInt(Math.trunc(tag.mask)) & ~8n) !== 0n)) {
                    return [];
                }
                const neighbor = context.entities.find(candidate => candidate.entityId === attachment.targetEntityId);
                const neighborId = neighbor?.components.find(component => component.ownerId === 'nixie.foxhole-planner'
                    && component.componentId === 'asset' && component.definitionAvailable)?.data.assetId;
                const neighborAsset = typeof neighborId === 'string' ? assetMetadataById[neighborId] : undefined;
                return neighborAsset && bunker(neighborAsset) ? [attachment.targetEntityId] : [];
            }))]
            : [];
        const hover = { contractVersion: 1 as const, opacity: 0, fadeDurationMs: 110, relatedEntityIds,
            hiddenNodeIds: ids(plan.root).filter(id => !retainedNodes.has(id)),
            hiddenModelNodes: (roofless.spatial?.hiddenModelNodes ?? []).filter(name => !retainedModels.has(name)),
            hiddenSpatialNodeIds: (plan.spatial?.nodes ?? []).filter(node => !retainedPaths.has(node.id)).map(node => node.id) };
        if (bunker(metadata) || hover.hiddenNodeIds.length || hover.hiddenModelNodes.length || hover.hiddenSpatialNodeIds.length) {
            plan.hover = hover;
        }
    }
    if (metadata?.canBlueprint && !metadata.isDestroyed && !appearance.destroyed && !appearance.packaged
        && (appearance.blueprint || spline?.data.blueprint === true)) {
        plan.spatial = {
            ...(plan.spatial ?? { contractVersion: 1, supplementModel: true, nodes: [] }),
            modelMaterial: { color: 0x4f79c6, roughness: 0.6, metallic: 0 },
        };
    }
    if (metadata?.model && (!plan.spatial || plan.spatial.supplementModel === true)) {
        const railAssetId = String(asset?.data.assetId ?? '');
        const wheelRoll = foxholeRailWheelRoll[railAssetId];
        const linkages = foxholeRailLinkages[railAssetId];
        const engine = railAssetId === 'trainengine';
        const rolling = foxholeRailRollingEffect(railAssetId, context.settings);
        const latchEffects = foxholeRailContactPorts(railAssetId).map(({ effect, point }) => ({
            id: effect, point, trigger: 'latch' as const,
            sound: { resourceId: 'foxhole.audio.coupler-clank', gain: .7, range: 3200 },
        }));
        plan.spatial = { contractVersion: 1, supplementModel: true, nodes: [], ...plan.spatial,
            ...(wheelRoll ? { modelDistanceRotations: wheelRoll } : {}),
            ...(linkages ? { modelDistanceLinkages: linkages } : {}),
            ...(engine ? { modelDistancePoseCycles: foxholeBlackBoltValveGear } : {}),
            ...(engine || rolling || latchEffects.length ? { simulationEffects: [
                ...(engine ? foxholeBlackBoltEffects(context.settings) : []), ...(rolling ? [rolling] : []), ...latchEffects,
            ] } : {}),
            modelLights: context.settings?.['foxhole.structure.modelLights'] === true,
            modelLightOverrides: buildFoxholeModelLightOverrides(plan.spatial?.model === null ? undefined : plan.spatial?.model?.resourceId ?? metadata.model.resourceId,
                modelLightHintsByResourceId, shouldEnableFoxholePoweredModelLights(context.settings)),
            modelTextureTransforms: buildFoxholeModelTextureTransforms(plan.spatial?.model === null ? undefined : plan.spatial?.model?.resourceId ?? metadata.model.resourceId,
                flagAtlasesByResourceId, context.settings?.[FOXHOLE_SCENE_FACTION_SETTING_ID]) };
    }
    return plan;
}

function renderFoxholeSceneV2EntityPlan(
    entity: NixieComponentEntitySnapshotV1,
    context: NixieEntityRendererContextV1 = { contractVersion: 1, entities: [entity] },
): NixieExtensionRenderPlanV1 {
    const settings: Record<string, boolean> = Object.fromEntries(Object.entries(context.settings ?? {}).flatMap(([id, value]) => typeof value === 'boolean' ? [[id, value]] : []));
    const renderScale = context.viewport?.renderScale ?? 1;
    const tacticalLine = entity.components.find(component => (
        component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'tactical-line'
        && component.definitionAvailable
    ));
    if (tacticalLine) {
        const rotation = readFoxholeSceneV2CoreTransform(entity)?.rotation.z;
        return {
            schemaVersion: 1,
            root: {
                id: 'root',
                kind: 'group',
                children: renderFoxholeSceneV2TacticalLine(
                    tacticalLine.data as unknown as FoxholeSceneV2TacticalLineData,
                    typeof rotation === 'number' ? rotation : 0,
                    renderScale,
                ),
            },
        };
    }
    const connector = entity.components.find(component => (
        component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'connector'
        && component.definitionAvailable
    ));
    if (connector) {
        return {
            schemaVersion: 1,
            root: {
                id: 'root',
                kind: 'group',
                children: renderFoxholeSceneV2Connector(
                    resolveFoxholeSceneV2ConnectorAttachments(
                        entity,
                        connector.data as unknown as FoxholeSceneV2ConnectorData & Record<string, unknown>,
                        context,
                        assetMetadataById,
                    ),
                ),
            },
        };
    }
    const splineConnector = entity.components.find(component => (
        component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'spline-connector'
        && component.definitionAvailable
    ));
    if (splineConnector) {
        const resolved = resolveFoxholeSceneV2SplineAttachments(entity,
            splineConnector.data as unknown as FoxholeSceneV2SplineConnectorData & Record<string, unknown>, context, assetMetadataById);
        const attachments = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner' && component.componentId === 'socket-attachments'
            && component.definitionAvailable)?.data.attachments;
        const appearance = readFoxholeSceneV2Appearance(entity);
        const splineAsset = assetMetadataById[String(splineConnector.data.foxholeKey ?? '')];
        const destroyedAsset = appearance.destroyed && splineAsset?.destroyedAssetId
            ? assetMetadataById[splineAsset.destroyedAssetId]
            : undefined;
        const powerlineObstructions = findFoxholePowerlineObstructions(entity, resolved, context, assetMetadataById);
        const rendered = powerlineObstructions.length ? { ...resolved, powerlineObstructed: true } : resolved;
        const spatialResolved = resolveFoxholeSpatialSplineAttachments(entity, rendered, context, assetMetadataById);
        const spatial = !appearance.destroyed ? renderFoxholeSpatialConnector(entity, spatialResolved, splineAsset, settings ?? {}, context.entities) : undefined;
        if (spatial) {
            spatial.markers = renderFoxholeConnectorSpatialMarkers(spatialResolved, splineAsset, attachments, settings ?? {});
        }
        const geometryHandles = foxholeConnectorGeometryHandles(resolved, splineAsset).filter(handle => {
            if (handle.id !== 'start-rotation' && handle.id !== 'end-rotation') return true;
            const role = handle.id === 'start-rotation' ? 'start' : 'end';
            if (readRailPathSocket(resolved[`${role}AttachmentSocketName`] ?? '')) return false;
            const attachment = trenchEndRotationTarget(entity, role, context.entities);
            return !attachment || Boolean(attachment.connector);
        });
        const wheel = foxholeConnectorGeometryWheel(resolved, splineAsset);
        const content = splineAsset && isTrenchConnector(rendered.foxholeKey) && !destroyedAsset
            ? renderPlanarTrench(entity, rendered, splineAsset,
                assetMetadataById[rendered.foxholeKey === 'trenchconnectort3' ? 'trencht3' : 'trencht1']?.renderLayers.floor, settings)
            : renderFoxholeSceneV2SplineConnector(destroyedAsset ? { ...rendered, ...appearance } : rendered, splineAsset, destroyedAsset);
        return {
            schemaVersion: 1,
            selectionGeometry: { ...resolveFoxholeConnectorSelectionGeometry(resolved, splineAsset, content), geometryHandles,
                ...(wheel ? { geometryWheelControl: wheel } : {}) },
            ...(spatial ? { spatial: spatial } : {}),
            root: { id: 'root', kind: 'group', children: [...content, ...renderFoxholeConnectorGuides(resolved,
                splineAsset, geometryHandles), ...renderFoxholeConnectorSocketOverlays(resolved,
                assetMetadataById[String(splineConnector.data.foxholeKey ?? '')], attachments, settings ?? {})] },
        };
    }

    const range = entity.components.find(component => (
        component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'range'
        && component.definitionAvailable
    ));
    if (range) {
        const rotation = readFoxholeSceneV2CoreTransform(entity)?.rotation.z;
        return {
            schemaVersion: 1,
            selectionGeometry: resolveFoxholeRangeSelectionGeometry(range.data as unknown as FoxholeSceneV2RangeData),
            root: {
                id: 'root',
                kind: 'group',
                children: renderFoxholeSceneV2Range(
                    range.data as unknown as FoxholeSceneV2RangeData,
                    typeof rotation === 'number' ? rotation : 0,
                    renderScale,
                ),
            },
        };
    }
    const binocularLine = entity.components.find(component => (
        component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'binocular-line'
        && component.definitionAvailable
    ));
    if (binocularLine) {
        const rotation = readFoxholeSceneV2CoreTransform(entity)?.rotation.z;
        return {
            schemaVersion: 1,
            root: {
                id: 'root',
                kind: 'group',
                children: renderFoxholeSceneV2BinocularLine(
                    binocularLine.data as unknown as FoxholeSceneV2BinocularLineData,
                    typeof rotation === 'number' ? rotation : 0,
                    renderScale,
                ),
            },
        };
    }
    const triangulation = entity.components.find(component => (
        component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'triangulation'
        && component.definitionAvailable
    ));
    if (triangulation) {
        const rotation = readFoxholeSceneV2CoreTransform(entity)?.rotation.z;
        return {
            schemaVersion: 1,
            selectionGeometry: resolveFoxholeTriangulationSelectionGeometry(triangulation.data as unknown as FoxholeSceneV2TriangulationData, renderScale),
            root: {
                id: 'root',
                kind: 'group',
                children: renderFoxholeSceneV2Triangulation(
                    triangulation.data as unknown as FoxholeSceneV2TriangulationData,
                    typeof rotation === 'number' ? rotation : 0,
                    renderScale,
                ),
            },
        };
    }
    const asset = entity.components.find(component => (
        component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'asset'
        && component.definitionAvailable
    ));
    const assetId = typeof asset?.data.assetId === 'string' ? asset.data.assetId : '';
    const assetMetadata = assetMetadataById[assetId];
    if (asset?.data.catalogId === 'foxhole.icons' && assetMetadata) {
        const icon = entity.components.find(component => (
            component.ownerId === 'nixie.core'
            && component.componentId === 'icon'
            && component.definitionAvailable
        ));
        if (!icon) {
            throw new Error('The Foxhole icon renderer requires the Nixie icon component.');
        }
        if (typeof icon.data.catalogSourceId === 'string' && typeof icon.data.catalogAssetId === 'string') {
            return { schemaVersion: 1, root: { id: 'root', kind: 'group', children: [] } };
        }
        const frameWidth = typeof icon.data.frameWidth === 'number' ? icon.data.frameWidth : 96;
        const frameHeight = typeof icon.data.frameHeight === 'number' ? icon.data.frameHeight : 96;
        const padding = typeof icon.data.padding === 'number' ? icon.data.padding : 14;
        const tint = typeof icon.data.iconTint === 'number' ? icon.data.iconTint : 0xFFFFFF;
        return {
            schemaVersion: 1,
            root: {
                id: 'root',
                kind: 'group',
                children: [{
                    id: 'icon-texture',
                    kind: 'sprite',
                    laneId: 'structure',
                    resourceId: `foxhole.icon.${assetId}`,
                    anchorX: 0.5,
                    anchorY: 0.5,
                    width: Math.max(1, frameWidth - padding),
                    height: Math.max(1, frameHeight - padding),
                    tint,
                }],
            },
        };
    }
    if (asset?.data.catalogId !== 'foxhole.structures' || !assetMetadata) {
        throw new Error('The Foxhole Scene V2 renderer does not support this entity.');
    }
    const appearance = readFoxholeSceneV2Appearance(entity);
    const ports = settings['nixie.scene.productPlacementPorts'] === true && settings['foxhole.viewport.socketSnapping'] !== false
        && assetMetadata.isRailVehicle && !appearance.destroyed && !appearance.packaged
        ? foxholeRailCouplerPlacementPorts(assetId, assetMetadataById) : [];
    const selectionGeometry = { ...resolveFoxholeSceneV2StructureSelectionGeometry(entity, assetMetadata),
        ...(ports.length ? { productPlacementPorts: ports } : {}) };
    const splitRail = (assetId === 'trainlrartillery' || assetId === 'trainhospital')
        && !!assetMetadata.renderLayers['rail-body'] && settings['foxhole.structure.useStaticRender'] !== true;
    const railPose = (splitRail || settings['nixie.scene.modelNodeTransforms'] === true) && !appearance.destroyed && !appearance.packaged
        ? poseFoxholeRailBogies(entity, assetId, context, assetMetadataById) : undefined;
    const rendered = renderFoxholeSceneV2Asset(entity, assetId, assetMetadata, settings, context.entities, railPose);
    const structural = assetMetadata.model?.structuralProfile;
    const spatialRendered = structural ? renderFoxholeSceneV2Asset(entity, assetId, assetMetadata,
        {...settings, 'foxhole.structure.useStaticRender': false}, context.entities) : rendered;
    const renderedLayers = new Set(spatialRendered.map(node => node.id));
    const occupiedTags = resolveStructureOccupiedTags(entity, assetMetadata, context.entities ?? []);
    const hiddenModelNodes = !structural && renderedLayers.has('building-texture') ? [] : Object.entries((assetMetadata as FoxholeModelLayerMetadata).modelLayerNodes ?? {})
        .flatMap(([layerId, names]) => renderedLayers.has(`structure-layer-${layerId}`) ? [] : names);
    hiddenModelNodes.push(...occupiedTrenchDirtNodes(assetMetadata.codeName, occupiedTags));
    if (structural?.modifications) {
        const active = !appearance.destroyed && !appearance.packaged ? selectedFoxholeSceneV2Modifications(entity,assetMetadata)
            .filter(entry=>!entry.variant.isUpgrade && (settings?.['foxhole.structure.hideRoofs']!==true || !isFoxholeRoofModification(entry.variant))) : [];
        for (const part of structural.modifications) {
            const selected=active.some(entry=>entry.slotId===part.slotId&&entry.variantId===part.variantId);
            const blocked=part.replacesLayers.some(id=>!renderedLayers.has('structure-layer-'+id));
            if(!selected||blocked)hiddenModelNodes.push(...part.nodeNames);
            if(selected)for(const id of part.replacesLayers)hiddenModelNodes.push(...structural.layers[id]??[]);
        }
    }
    const visualState = applyFoxholeSceneV2Appearance(rendered, appearance, assetMetadata.canBlueprint && !assetMetadata.isDestroyed);
    const placement = settings?.[FOXHOLE_PLACEMENT_WARNING_SETTING_ID] === true
        ? resolveFoxholeStructurePlacement(entity, context, assetMetadataById)
        : null;
    let placementSpatial = placement ? renderFoxholeStructurePlacementSpatialOverlay(entity, assetMetadata, placement) : undefined;
    if (placement) visualState.nodes.push(...renderFoxholeStructurePlacementOverlay(assetMetadata, placement));
    const breachIndicators = resolveBreachIndicators(entity, assetMetadata, context);
    visualState.nodes.push(...breachIndicators.map(renderPlanarBreachIndicator));
    visualState.nodes.push(...renderFoxholeStructureRangeOverlays(assetMetadata, settings ?? {}, appearance, entity.components.find(component =>
        component.ownerId === 'nixie.foxhole-planner' && component.componentId === 'maintenance-supply' && component.definitionAvailable)?.data));
    const socketAttachments = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'socket-attachments' && component.definitionAvailable)?.data.attachments;
    const socketMarkers = renderFoxholeSpatialSocketMarkers(assetMetadata,
        selectedFoxholeSceneV2Modifications(entity, assetMetadata).map(entry => entry.variant), socketAttachments, settings ?? {}, appearance);
    const markers = [...breachIndicators, ...socketMarkers].slice(0, 128);
    if (markers.length) {
        placementSpatial = { contractVersion: 1, supplementModel: true, nodes: [], ...placementSpatial, markers };
    }
    if (hiddenModelNodes.length) {
        placementSpatial = { contractVersion: 1, supplementModel: true, nodes: placementSpatial?.nodes ?? [],
            ...(placementSpatial?.markers ? { markers: placementSpatial.markers } : {}), hiddenModelNodes: [...new Set(hiddenModelNodes)] };
    }
    if (settings['nixie.scene.modelNodeTransforms'] === true && railPose) {
        placementSpatial = { contractVersion: 1, supplementModel: true, nodes: [], ...placementSpatial, modelNodeTransforms: railPose };
    }
    const modelClips = structuralModelClips(assetMetadata, occupiedTags);
    if (modelClips.length) placementSpatial = { contractVersion: 1, supplementModel: true, nodes: placementSpatial?.nodes ?? [],
        ...placementSpatial, modelClips };
    const groundCutouts = appearance.packaged ? [] : structuralGroundCutouts(assetMetadata, occupiedTags);
    if (!appearance.packaged && !appearance.destroyed && assetMetadata.waterStencils?.length) {
        const origin = assetMetadata.model?.blueprintOrigin;
        const waterline = foxholeAquaticWaterline(assetMetadata);
        const waterStencils = assetMetadata.waterStencils.map(triangle => triangle.map((value, index) => {
            if (index % 3 === 0) return value + (origin?.x ?? 0);
            if (index % 3 === 1) return value + (origin?.y ?? 0);
            // Boats use the same buoyancy reference for their water mask and placement.
            return waterline ?? value + (origin?.z ?? 0);
        }));
        placementSpatial = { contractVersion: 1, supplementModel: true, nodes: [], ...placementSpatial, waterStencils };
    }
    if (groundCutouts.length) placementSpatial = { contractVersion: 1, supplementModel: true, nodes: [], ...placementSpatial, groundCutouts };
    // A saved asset may predate its model or have an obsolete model from a tier change.
    const boundModel = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'model' && component.definitionAvailable);
    const baseModel = assetMetadata.model && getFoxholeSceneV2ModelComponentData(assetMetadata.model);
    const needsBaseModel = boundModel ? boundModel.data.resourceId !== baseModel?.resourceId
        : baseModel && previouslyPlanarReferences.has(assetId) && !appearance.packaged;
    // Shipped Transfer Point assemblies identify the complete insulated mesh as an add-on.
    const insulatedTransferPoint = assetId === 'facilitypipetransfer' && !appearance.destroyed && !appearance.packaged
        && selectedFoxholeSceneV2Modifications(entity, assetMetadata)
            .some(({ variantId, variant }) => variantId === 'insulation' && variant.isUpgrade);
    if (baseModel && insulatedTransferPoint) {
        placementSpatial = { contractVersion: 1, supplementModel: true, nodes: [], ...placementSpatial,
            model: { ...baseModel, resourceId: baseModel.resourceId + '.upgrade.insulation' } };
    } else if (needsBaseModel) {
        placementSpatial = { contractVersion: 1, supplementModel: true, nodes: [], ...placementSpatial, model: baseModel ?? null };
    }
    if (appearance.destroyed && !appearance.packaged) {
        const destroyedModel = assetMetadata.destroyedAssetId ? assetMetadataById[assetMetadata.destroyedAssetId]?.model : undefined;
        placementSpatial = { contractVersion: 1, supplementModel: true, nodes: [],
            model: destroyedModel ? getFoxholeSceneV2ModelComponentData(destroyedModel) : null };
    }
    const firingVolumes = renderFoxholeStructureFiringVolumes(assetMetadata, settings ?? {}, appearance);
    if (firingVolumes.length) {
        placementSpatial = { contractVersion: 1, supplementModel: true, nodes: [], ...placementSpatial, volumes: firingVolumes };
    }
    visualState.nodes.push(...renderFoxholeModificationSlotOverlays(assetMetadata, settings ?? {}, appearance));
    visualState.nodes.push(...renderFoxholeStructureVolumeOverlays(assetMetadata, settings ?? {}, appearance));
    visualState.nodes.push(...renderFoxholeHitboxOverlays(entity, assetMetadata,
        selectedFoxholeSceneV2Modifications(entity, assetMetadata).map(entry => entry.variant), context.entities ?? [], settings ?? {}));
    visualState.nodes.push(...renderFoxholeVehicleSeatOverlays(assetMetadata, settings ?? {}, appearance));
    visualState.nodes.push(...renderFoxholeDebugSpotlightOverlays(assetMetadata, settings ?? {}, appearance));
    visualState.nodes.push(...renderFoxholeStructureSocketOverlays(assetMetadata,
        selectedFoxholeSceneV2Modifications(entity, assetMetadata).map(entry => entry.variant), socketAttachments, settings ?? {}, appearance, assetId));
    const rotation = readFoxholeSceneV2CoreTransform(entity)?.rotation.z;
    const cargo = entity.components.find(component => (
        component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'cargo'
        && component.definitionAvailable
    ));
    const production = entity.components.find(component => (
        component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'production-order'
        && component.definitionAvailable
    ));
    const cargoNode = settings?.['foxhole.structure.markedCargo'] === false
        ? null
        : renderFoxholeSceneV2Cargo({
            cargoData: cargo?.data,
            developmentPreview: context.developmentPreview,
            productionData: production?.data,
            productionOutputsByRecipeId,
            asset: assetMetadata,
            assetIdByCodeName: itemAssetIdByCodeName,
            stockpileAssetIds: stockpileAssetIdsByCodeName,
            rotation: typeof rotation === 'number' ? rotation : 0,
            destroyed: appearance.destroyed,
            packaged: appearance.packaged,
        });
    if (!cargoNode) {
        return {
            schemaVersion: 1,
            selectionGeometry: selectionGeometry,
            ...(placementSpatial ? { spatial: placementSpatial } : {}),
            root: {
                id: 'root',
                kind: 'group',
                children: visualState.nodes,
            },
        };
    }
    const renderedNodes = visualState.nodes;
    return {
        schemaVersion: 1,
        selectionGeometry: selectionGeometry,
        ...(placementSpatial ? { spatial: placementSpatial } : {}),
        root: {
            id: 'root',
            kind: 'group',
            children: [...renderedNodes, cargoNode],
        },
    };
}

function resolveStructureOccupiedTags(entity: NixieComponentEntitySnapshotV1, assetMetadata: FoxholeSceneV2AssetMetadata, entities: readonly NixieComponentEntitySnapshotV1[]) {
    const attachments = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'socket-attachments' && component.definitionAvailable)?.data.attachments;
    const occupiedKeys = new Set<string>();
    if (Array.isArray(attachments)) {
        for (const attachment of attachments) {
            if (attachment && typeof attachment === 'object' && !Array.isArray(attachment)
                && typeof (attachment.localSocketName ?? attachment.socketName) === 'string') {
                const neighbor = entities.find(candidate => candidate.entityId === attachment.targetEntityId);
                const neighborAsset = neighbor?.components.find(component => component.ownerId === 'nixie.foxhole-planner'
                    && component.componentId === 'asset' && component.definitionAvailable)?.data.assetId;
                const neighborConnector = neighbor?.components.find(component => component.ownerId === 'nixie.foxhole-planner'
                    && component.componentId === 'spline-connector' && component.definitionAvailable)?.data.foxholeKey;
                if (canFoxholeSocketConnectionOpenWalls(assetMetadata.codeName,
                    typeof neighborAsset === 'string' ? assetMetadataById[neighborAsset]?.codeName ?? neighborAsset : neighborConnector)) {
                    occupiedKeys.add(`${entity.entityId}:${attachment.localSocketName ?? attachment.socketName}`);
                }
            }
        }
    }
    return resolveFoxholeOccupiedSocketTags(assetMetadata.buildSockets, occupiedKeys, entity.entityId, assetMetadata.codeName);
}
