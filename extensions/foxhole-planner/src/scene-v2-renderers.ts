import { getFoxholeSceneV2ModelComponentData } from './scene-v2-models.ts';
import { resolveFoxholeTrenchSelectionBounds } from './structure-selection-bounds.ts';
import { canFoxholeSocketConnectionOpenWalls } from './socket-wall-visibility.ts';
import type { FoxholeModelLayerMetadata } from './model-layer-nodes.ts';
import { structuralModelClips } from './scene-v2-structural-clips.ts';
import { structuralGroundCutouts } from './scene-v2-ground-cutouts.ts';
import { renderFoxholeSpatialConnector } from './scene-v2-spatial-connectors.ts';
import { resolveFoxholeSpatialSplineAttachments } from './scene-v2-spatial-attachments.ts';
import { findFoxholePowerlineObstructions } from './powerline-clearance.ts';
import {
    FOXHOLE_PLACEMENT_WARNING_SETTING_ID,
    renderFoxholeStructurePlacementOverlay,
    renderFoxholeStructurePlacementSpatialOverlay,
    resolveFoxholeStructurePlacement,
} from './structure-placement.ts';
import { createFoxholeBarbedWireSplineGeometry, createFoxholeSandbagSplineGeometry } from './modification-spline.ts';
import { resolveFoxholeConnectorSelectionGeometry } from './connector-selection-geometry.ts';
import { renderFoxholeStructureRangeOverlays } from './scene-v2-structure-range-overlays.ts';
import { resolveFoxholeBunkerSpotlightLights, showFoxholeBunkerSpotlightGlow } from './bunker-spotlights.ts';
import { createFoxholeSpotlightBeamGraphics } from './spotlight-beam.ts';
import { renderFoxholeConnectorGuides } from './scene-v2-connector-guides.ts';
import { renderFoxholeConnectorSocketOverlays, renderFoxholeConnectorSpatialMarkers } from './scene-v2-connector-socket-overlays.ts';
import { renderFoxholeStructureSocketOverlays, renderFoxholeSpatialSocketMarkers } from './scene-v2-socket-overlays.ts';
import type {
    NixieExperimentalComponentEntitySnapshotV1,
    NixieExperimentalEntityRendererContextV1,
    NixieExtensionRenderNodeV1,
    NixieExtensionRenderPlanV1,
} from '@nixie/extension-sdk/experimental/scene-v2';
import { FOXHOLE_STRUCTURE_RENDER_LANES, FOXHOLE_MODIFICATION_TEXTURE_LAYER_LANES, foxholeRenderLane, resolveFoxholeStructureDirtRenderLane, resolveFoxholeStructurePrimaryRenderLane, resolveFoxholeAssetHeightLane, resolveFoxholeAssetComponentLane } from './render-lanes.ts';
import { compareFoxholeModificationRenderOrder, isFoxholeRoofModification, resolveFoxholeModificationTextureLayer } from './modification-render-order.ts';
import { filterFoxholeSameWallInfrastructureSelections } from './modification-wall-conflicts.ts';
import { createFoxholeStructureFloorMaskPoints, createFoxholeCornerWallMaskPoints,
    createFoxholeTrenchEmplacementMaskPolygons, isFoxholeTrenchEmplacementCodeName } from './structure-floor-mask.ts';
import { isFoxholeBunkerSocketUnbreachable, isFoxholeBreachIndicatorSocket } from './breach-indicators.ts';
import foxholeSceneV2Assets, { productionOutputsByRecipeId } from '#foxhole-scene-v2-assets';
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

const assetMetadataById = foxholeSceneV2Assets as Record<string, FoxholeSceneV2AssetMetadata>;
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
    entity: NixieExperimentalComponentEntitySnapshotV1,
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
    entity: NixieExperimentalComponentEntitySnapshotV1,
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

function renderFoxholeSceneV2Asset(
    entity: NixieExperimentalComponentEntitySnapshotV1,
    assetId: string,
    assetMetadata: FoxholeSceneV2AssetMetadata,
    settings: Record<string, boolean> = {},
    entities: readonly NixieExperimentalComponentEntitySnapshotV1[] = [],
): NixieExtensionRenderNodeV1[] {
    const appearance = readFoxholeSceneV2Appearance(entity);
    const modifications = selectedFoxholeSceneV2Modifications(entity, assetMetadata);
    const operational = !appearance.destroyed && !appearance.packaged;
    const replacement = operational
        ? modifications.find(entry => entry.variant.isUpgrade)?.variant
        : undefined;
    const visual = resolveFoxholeSceneV2Visual(assetId, assetMetadata, appearance);
    const layers = orderFoxholeStructureRenderLayers(Object.entries(assetMetadata.renderLayers).map(([id, layer]) => ({ id, ...layer })), assetMetadata.codeName);
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
            experimentalPresentation: { contractVersion: 1, excludeFromBounds: true },
            children: lights.map((light, index) => ({ id: `bunker-light-${index}`, kind: 'group',
                x: light.x, y: light.y, rotation: light.rotation,
                children: createFoxholeSpotlightBeamGraphics(light.beam).map(node => ({ ...node, id: `${node.id}-${index}` })),
            })) }]
        : [];
    const poleLamp: NixieExtensionRenderNodeV1[] = showFoxholePowerPoleLamp(assetMetadata.codeName,
        modifications.map(entry => entry.variant.id ?? ''), id => settings[id], appearance)
        ? [{ id: 'power-pole-lamp-glow', kind: 'graphics', ...foxholeRenderLane(FOXHOLE_STRUCTURE_RENDER_LANES.floorDetail),
            x: FOXHOLE_POWER_POLE_LAMP.x, y: FOXHOLE_POWER_POLE_LAMP.y,
            experimentalPresentation: { contractVersion: 1, excludeFromBounds: true },
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
    return [...poleLamp, ...(useLayers && !shouldCompositeFoxholeStructureBaseTexture(layers) ? [] : [base]), ...pallet, ...bodyLayers, ...overlays, ...glow];
}

function renderBreachIndicators(entity: NixieExperimentalComponentEntitySnapshotV1, metadata: FoxholeSceneV2AssetMetadata,
    context: NixieExperimentalEntityRendererContextV1): NixieExtensionRenderNodeV1[] {
    const appearance = readFoxholeSceneV2Appearance(entity);
    if (context.settings?.['foxhole.structure.breachIndicators'] !== true || appearance.destroyed || appearance.packaged) {
        return [];
    }
    const attachments = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'socket-attachments' && component.definitionAvailable)?.data.attachments;
    return metadata.buildSockets.filter(socket => isFoxholeBreachIndicatorSocket(metadata, socket)).map((socket, index) => {
        const attachment = Array.isArray(attachments)
            ? attachments.find(entry => entry && typeof entry === 'object'
                && !Array.isArray(entry) && (entry.localSocketName ?? entry.socketName) === socket.name)
            : null;
        const neighbor = attachment && typeof attachment === 'object' && !Array.isArray(attachment)
            ? context.entities.find(candidate => candidate.entityId === attachment.targetEntityId)
            : undefined;
        const neighborAssetId = neighbor?.components.find(component => component.ownerId === 'nixie.foxhole-planner'
            && component.componentId === 'asset' && component.definitionAvailable)?.data.assetId;
        const neighborMetadata = typeof neighborAssetId === 'string' ? assetMetadataById[neighborAssetId] : undefined;
        const sealed = Boolean(attachment) && isFoxholeBunkerSocketUnbreachable({
            selfBreachable: metadata.breachable === true, selfStructuralGarrison: metadata.structuralGarrison === true,
            selfExposed: metadata.codeName.toLowerCase() === 'fortbuildsite',
            neighborBreachable: neighborMetadata?.breachable === true, neighborStructuralGarrison: neighborMetadata?.structuralGarrison === true,
            neighborExposed: neighborMetadata?.codeName.toLowerCase() === 'fortbuildsite', connectionCount: 1,
        });
        return { id: `breach-${index}`, kind: 'graphics', ...foxholeRenderLane(FOXHOLE_STRUCTURE_RENDER_LANES.hitboxDebug), x: socket.x, y: socket.y,
            commands: [{ op: 'rect', x: -6, y: -6, width: 12, height: 12 },
                { op: 'fill', color: sealed ? 0x53D769 : 0xFF4D4D, alpha: 0.95 },
                { op: 'stroke', color: 0x081018, alpha: 0.95, width: 2 }] };
    });
}

export function resolveFoxholeSceneV2StructureSelectionGeometry(entity: NixieExperimentalComponentEntitySnapshotV1, assetMetadata: FoxholeSceneV2AssetMetadata) {
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
    return { contractVersion: 1 as const, localBounds: trenchBounds ?? spriteBounds, transformOrigin: { x: 0, y: 0 }, showTransformGizmo: true };
}

export function renderFoxholeSceneV2Entity(
    entity: NixieExperimentalComponentEntitySnapshotV1,
    context: NixieExperimentalEntityRendererContextV1 = { contractVersion: 1, entities: [entity] },
): NixieExtensionRenderPlanV1 {
    const plan = renderFoxholeSceneV2EntityPlan(entity, context);
    const asset = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'asset' && component.definitionAvailable);
    const spline = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'spline-connector' && component.definitionAvailable);
    const metadata = assetMetadataById[String(asset?.data.assetId ?? spline?.data.foxholeKey ?? '')];
    const appearance = readFoxholeSceneV2Appearance(entity);
    if (metadata?.canBlueprint && !metadata.isDestroyed && !appearance.destroyed && !appearance.packaged
        && (appearance.blueprint || spline?.data.blueprint === true)) {
        plan.experimentalSpatial = {
            ...(plan.experimentalSpatial ?? { contractVersion: 1, supplementModel: true, nodes: [] }),
            modelMaterial: { color: 0x4f79c6, roughness: 0.6, metallic: 0 },
        };
    }
    return plan;
}

function renderFoxholeSceneV2EntityPlan(
    entity: NixieExperimentalComponentEntitySnapshotV1,
    context: NixieExperimentalEntityRendererContextV1 = { contractVersion: 1, entities: [entity] },
): NixieExtensionRenderPlanV1 {
    const renderScale = context.viewport?.renderScale ?? 1;
    const tacticalLine = entity.components.find(component => (
        component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'tactical-line'
        && component.definitionAvailable
    ));
    if (tacticalLine) {
        const rotation = entity.components.find(component => (
            component.ownerId === 'nixie.core'
            && component.componentId === 'transform'
            && component.definitionAvailable
        ))?.data.rotation;
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
        const spatial = !appearance.destroyed ? renderFoxholeSpatialConnector(entity, spatialResolved, splineAsset, context.settings ?? {}) : undefined;
        if (spatial) {
            spatial.markers = renderFoxholeConnectorSpatialMarkers(spatialResolved, splineAsset, attachments, context.settings ?? {});
        }
        return {
            schemaVersion: 1,
            experimentalSelectionGeometry: resolveFoxholeConnectorSelectionGeometry(resolved),
            ...(spatial ? { experimentalSpatial: spatial } : {}),
            root: { id: 'root', kind: 'group', children: [...renderFoxholeSceneV2SplineConnector(destroyedAsset ? { ...rendered, ...appearance } : rendered,
                splineAsset, destroyedAsset), ...renderFoxholeConnectorGuides(resolved,
                assetMetadataById[String(splineConnector.data.foxholeKey ?? '')]), ...renderFoxholeConnectorSocketOverlays(resolved,
                assetMetadataById[String(splineConnector.data.foxholeKey ?? '')], attachments, context.settings ?? {})] },
        };
    }

    const range = entity.components.find(component => (
        component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'range'
        && component.definitionAvailable
    ));
    if (range) {
        const rotation = entity.components.find(component => (
            component.ownerId === 'nixie.core'
            && component.componentId === 'transform'
            && component.definitionAvailable
        ))?.data.rotation;
        return {
            schemaVersion: 1,
            experimentalSelectionGeometry: resolveFoxholeRangeSelectionGeometry(range.data as unknown as FoxholeSceneV2RangeData),
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
        const rotation = entity.components.find(component => (
            component.ownerId === 'nixie.core'
            && component.componentId === 'transform'
            && component.definitionAvailable
        ))?.data.rotation;
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
        const rotation = entity.components.find(component => (
            component.ownerId === 'nixie.core'
            && component.componentId === 'transform'
            && component.definitionAvailable
        ))?.data.rotation;
        return {
            schemaVersion: 1,
            experimentalSelectionGeometry: resolveFoxholeTriangulationSelectionGeometry(triangulation.data as unknown as FoxholeSceneV2TriangulationData, renderScale),
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
    const selectionGeometry = resolveFoxholeSceneV2StructureSelectionGeometry(entity, assetMetadata);
    const appearance = readFoxholeSceneV2Appearance(entity);
    const rendered = renderFoxholeSceneV2Asset(entity, assetId, assetMetadata, context.settings, context.entities);
    const structural = assetMetadata.model?.structuralProfile;
    const spatialRendered = structural ? renderFoxholeSceneV2Asset(entity, assetId, assetMetadata,
        {...context.settings, 'foxhole.structure.useStaticRender': false}, context.entities) : rendered;
    const renderedLayers = new Set(spatialRendered.map(node => node.id));
    const hiddenModelNodes = !structural && renderedLayers.has('building-texture') ? [] : Object.entries((assetMetadata as FoxholeModelLayerMetadata).modelLayerNodes ?? {})
        .flatMap(([layerId, names]) => renderedLayers.has(`structure-layer-${layerId}`) ? [] : names);
    if (structural?.modifications) {
        const active = !appearance.destroyed && !appearance.packaged ? selectedFoxholeSceneV2Modifications(entity,assetMetadata)
            .filter(entry=>!entry.variant.isUpgrade && (context.settings?.['foxhole.structure.hideRoofs']!==true || !isFoxholeRoofModification(entry.variant))) : [];
        for (const part of structural.modifications) {
            const selected=active.some(entry=>entry.slotId===part.slotId&&entry.variantId===part.variantId);
            const blocked=part.replacesLayers.some(id=>!renderedLayers.has('structure-layer-'+id));
            if(!selected||blocked)hiddenModelNodes.push(...part.nodeNames);
            if(selected)for(const id of part.replacesLayers)hiddenModelNodes.push(...structural.layers[id]??[]);
        }
    }
    const visualState = applyFoxholeSceneV2Appearance(rendered, appearance, assetMetadata.canBlueprint && !assetMetadata.isDestroyed);
    const placement = context.settings?.[FOXHOLE_PLACEMENT_WARNING_SETTING_ID] === true
        ? resolveFoxholeStructurePlacement(entity, context, assetMetadataById)
        : null;
    let placementSpatial = placement ? renderFoxholeStructurePlacementSpatialOverlay(entity, assetMetadata, placement) : undefined;
    if (placement) visualState.nodes.push(...renderFoxholeStructurePlacementOverlay(assetMetadata, placement));
    visualState.nodes.push(...renderBreachIndicators(entity, assetMetadata, context));
    visualState.nodes.push(...renderFoxholeStructureRangeOverlays(assetMetadata, context.settings ?? {}, appearance));
    const socketAttachments = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'socket-attachments' && component.definitionAvailable)?.data.attachments;
    const markers = renderFoxholeSpatialSocketMarkers(assetMetadata,
        selectedFoxholeSceneV2Modifications(entity, assetMetadata).map(entry => entry.variant), socketAttachments, context.settings ?? {}, appearance);
    if (markers.length) {
        placementSpatial = { contractVersion: 1, supplementModel: true, nodes: placementSpatial?.nodes ?? [], markers };
    }
    if (hiddenModelNodes.length) {
        placementSpatial = { contractVersion: 1, supplementModel: true, nodes: placementSpatial?.nodes ?? [],
            ...(placementSpatial?.markers ? { markers: placementSpatial.markers } : {}), hiddenModelNodes: [...new Set(hiddenModelNodes)] };
    }
    const modelClips = structuralModelClips(assetMetadata, resolveStructureOccupiedTags(entity, assetMetadata, context.entities ?? []));
    if (modelClips.length) placementSpatial = { contractVersion: 1, supplementModel: true, nodes: placementSpatial?.nodes ?? [],
        ...placementSpatial, modelClips };
    const groundCutouts = appearance.packaged ? [] : structuralGroundCutouts(assetMetadata, resolveStructureOccupiedTags(entity, assetMetadata, context.entities ?? []));
    if (groundCutouts.length) placementSpatial = { contractVersion: 1, supplementModel: true, nodes: [], ...placementSpatial, groundCutouts };
    // Older inspector edits changed the asset without updating its saved model.
    const boundModel = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'model' && component.definitionAvailable);
    if (boundModel && boundModel.data.resourceId !== assetMetadata.model?.resourceId) {
        placementSpatial = { contractVersion: 1, supplementModel: true, nodes: [], ...placementSpatial,
            model: assetMetadata.model ? getFoxholeSceneV2ModelComponentData(assetMetadata.model) : null };
    }
    if (appearance.destroyed && !appearance.packaged) {
        const destroyedModel = assetMetadata.destroyedAssetId ? assetMetadataById[assetMetadata.destroyedAssetId]?.model : undefined;
        placementSpatial = { contractVersion: 1, supplementModel: true, nodes: [],
            model: destroyedModel ? getFoxholeSceneV2ModelComponentData(destroyedModel) : null };
    }
    visualState.nodes.push(...renderFoxholeStructureSocketOverlays(assetMetadata,
        selectedFoxholeSceneV2Modifications(entity, assetMetadata).map(entry => entry.variant), socketAttachments, context.settings ?? {}, appearance));
    const rotation = entity.components.find(component => (
        component.ownerId === 'nixie.core'
        && component.componentId === 'transform'
        && component.definitionAvailable
    ))?.data.rotation;
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
    const cargoNode = context.settings?.['foxhole.structure.markedCargo'] === false
        ? null
        : renderFoxholeSceneV2Cargo({
            cargoData: cargo?.data,
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
            experimentalSelectionGeometry: selectionGeometry,
            ...(placementSpatial ? { experimentalSpatial: placementSpatial } : {}),
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
        experimentalSelectionGeometry: selectionGeometry,
        ...(placementSpatial ? { experimentalSpatial: placementSpatial } : {}),
        root: {
            id: 'root',
            kind: 'group',
            children: [...renderedNodes, cargoNode],
        },
    };
}

function resolveStructureOccupiedTags(entity: NixieExperimentalComponentEntitySnapshotV1, assetMetadata: FoxholeSceneV2AssetMetadata, entities: readonly NixieExperimentalComponentEntitySnapshotV1[]) {
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
    return resolveFoxholeOccupiedSocketTags(assetMetadata.buildSockets, occupiedKeys, entity.entityId);
}
