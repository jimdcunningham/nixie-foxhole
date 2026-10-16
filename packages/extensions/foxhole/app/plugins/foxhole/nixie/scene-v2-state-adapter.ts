import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixie/extension-sdk';
import type { NixieSceneV2StateAdapter, NixieSceneV2PlacementContext } from '#nixie/utils/nixie-scene-v2-state-adapter-registry.ts';
import { convertFoxholeSceneV1NodeToV2 } from './scene-v2-conversion.ts';
import { getFoxholeRangeMetrics, resolveFoxholeRangeState, normalizeFoxholeRangeState } from './range.ts';
import type { FoxholeRangeState } from './range.ts';
import { getFoxholeRangeSelectionLocalBounds } from '../../nixie/board/types/foxhole-range.ts';
import { getPolylineEditableLocalHandles, movePolylineLocalVertex } from '#nixie/plugins/nixie/board/utils/polyline-editing.ts';
import { getFoxholeTriangulationFit, resolveFoxholeTriangulationState } from './triangulation.ts';
import type { FoxholeTriangulationState } from './triangulation.ts';
import { getFoxholeTriangulationSelectionLocalBounds } from '../../nixie/board/types/foxhole-triangulation.ts';
import { resolveFoxholeSplinePlacementPreview, resolveFoxholeSplineEndpointSocketSnap } from './spline-connector-placement.ts';
import type { FoxholeSplinePlacementState } from './spline-connector-placement.ts';
import { normalizeFoxholeSplineConnectorState, resolveEffectiveConnectorPathStyle, getFoxholeSplineConnectorConstraints,
    isPowerlineConnector, worldRotationToEndpointLocal, resolveConnectorSocketSnapStemRotation, usesSplineConnectorSocketSnapping } from './spline-connector.ts';
import { allowsConnectorRotationHandles, resolveConnectorPathStyle } from './pipe-connector-path.ts';
import { adjustPipeCurveT, usesPipeCurveScale } from './pipe-spline-constraints.ts';
import { getFoxholeManifest } from './manifest.ts';
import { resolveFoxholeStockpileSelectionGroups, stockpileEntriesToSelections } from './stockpile-groups.ts';
import { reconcileFoxholeAssetCargoPatch } from './hold-profile.ts';
import { getFoxholeStructureCatalog } from './catalog.ts';
import { getFoxholeSelectedModificationSlotVariants, normalizeFoxholeModificationSelectionMap } from './modification-slots.ts';
import { isStructureReplacementModificationVariant } from './structure-modification-hover-preview.ts';
import { resolveFoxholeStructureDimensions, resolveFoxholeStructureSpriteOffset, FOXHOLE_BOARD_SPRITE_SCALE } from './structure-dimensions.ts';
import { buildFoxholeStructureSelectionGeometry } from '../../nixie/board/types/foxhole-structure-selection.ts';
import { resolveHitboxHostMetrics } from '#nixie/plugins/nixie/board/utils/hitbox-metrics.ts';
import { getFoxholeSplineLocalEditableHandles } from './spline-connector-handles.ts';
import { clampDraggedSplineEndpoint } from '#nixie/plugins/nixie/board/utils/spline-path.ts';
import { collectNixieSceneV2FoxholeSockets, isNixieSceneV2FoxholeSocketAvailable } from './scene-v2-socket-geometry.ts';
import { resolveHoveredFoxholePowerSocketPoint, resolveFoxholePowerlineSelectionQuad, resolveFoxholeConnectorEndpointSockets } from './connector.ts';
import { FOXHOLE_POWERLINE_CORE_WIDTH } from './powerline-stroke.ts';
import { FOXHOLE_SOCKET_SNAPPING_SETTING_ID, hasFoxholeSnapSocketTags } from './structure-socket-snapping.ts';
import { resolveFoxholeSplineDeleteMutation } from './spline-connector-delete.ts';
import { invertNixieSceneV2Point, nixieSceneV2TransformMatrix, readNixieSceneV2LocalTransform } from '#nixie/../desktop-extensions/scene-v2-transforms.ts';

const OWNER = 'nixie.foxhole-planner';
const NODE_COMPONENTS = {
    'tactical-line': 'foxholeTacticalLine',
    'range': 'foxholeRange',
    'binocular-line': 'foxholeBinocularLine',
    'triangulation': 'foxholeTriangulation',
    'connector': 'foxholeConnector',
    'spline-connector': 'foxholeSplineConnector',
} as const;

function data(entity: NixieExperimentalComponentEntitySnapshotV1, id: string) {
    return entity.components.find(component => component.ownerId === OWNER && component.componentId === id && component.definitionAvailable)?.data;
}

function editablePoints(entity: NixieExperimentalComponentEntitySnapshotV1) {
    const range = data(entity, 'range');
    if (range) {
        return { field: 'points', points: resolveFoxholeRangeState(range as Partial<FoxholeRangeState>).points,
            range, options: { canDeleteVertex: () => false } };
    }
    for (const id of ['tactical-line', 'binocular-line']) {
        const line = data(entity, id);
        if (line && Array.isArray(line.points)) {
            return { field: 'points', points: line.points as number[], options: {} };
        }
    }
    const triangulation = data(entity, 'triangulation');
    if (triangulation) {
        const state = resolveFoxholeTriangulationState(triangulation as Partial<FoxholeTriangulationState>);
        return { field: 'edgePoints', points: state.edgePoints, triangulation: state,
            options: { idPrefix: 'edge', minimumPointCount: 3 } };
    }
    return null;
}

function attachment(value: Record<string, unknown>, prefix: 'start' | 'end') {
    const nodeId = value[`${prefix}AttachmentNodeId`];
    return typeof nodeId === 'string' ? { nodeId, socketName: value[`${prefix}AttachmentSocketName`] } : null;
}

function editableSpline(entity: NixieExperimentalComponentEntitySnapshotV1) {
    if (!data(entity, 'spline-connector')) {
        return null;
    }
    const projected = project(entity)!;
    const state = normalizeFoxholeSplineConnectorState(projected.state);
    const connector = getFoxholeManifest('/foxhole/assets/').assets.find(asset => asset.id === state.foxholeKey)?.connector;
    return { state, pathStyle: resolveEffectiveConnectorPathStyle(resolveConnectorPathStyle(connector), state.foxholeKey),
        maxArcAngleDeg: Number.isFinite(state.maxArcAngleDeg) ? state.maxArcAngleDeg : connector?.maxArcAngleDeg };
}

function project(entity: NixieExperimentalComponentEntitySnapshotV1) {
    const asset = data(entity, 'asset');
    const drawing = Object.entries(NODE_COMPONENTS).find(([id]) => data(entity, id));
    if (!asset && !drawing) {
        return null;
    }
    const state: Record<string, unknown> = {};
    let type = asset?.catalogId === 'foxhole.icons' ? 'nixieIcon' : 'foxholeAsset';
    if (asset) {
        state.foxholeKey = asset.assetId;
    }
    if (drawing) {
        type = drawing[1];
        const drawingData = data(entity, drawing[0])!;
        Object.assign(state, drawingData);
        if (drawing[0] === 'spline-connector') {
            for (const end of ['start', 'end'] as const) {
                state[end] = { x: drawingData[`${end}X`], y: drawingData[`${end}Y`], rotation: drawingData[`${end}Rotation`],
                    ...(drawingData[`${end}HandleLength`] === undefined ? {} : { handleLength: drawingData[`${end}HandleLength`] }) };
            }
            state.maxArcAngleDeg = drawingData.maxArcAngleDeg ?? -1;
            state.startAttachment = attachment(drawingData, 'start');
            state.endAttachment = attachment(drawingData, 'end');
        }
    }
    if (asset?.catalogId === 'foxhole.structures' || drawing?.[0] === 'spline-connector') {
        const appearance = { destroyed: false, packaged: false, blueprint: false, tint: 0xFFFFFF, brightness: 1,
            anchorX: 0.5, anchorY: 0.5, faction: null, colorHex: null, ...state, ...data(entity, 'appearance') };
        Object.assign(state, appearance);
        const selections = data(entity, 'modification')?.selections;
        state.modificationVariantIds = Object.fromEntries(Array.isArray(selections)
            ? selections.flatMap(selection =>
                selection && typeof selection === 'object' && !Array.isArray(selection) && typeof selection.slotId === 'string'
                    ? [[selection.slotId, selection.variantId]]
                    : [])
            : []);
        const sockets = data(entity, 'socket-attachments')?.attachments;
        state.socketAttachments = Object.fromEntries(Array.isArray(sockets)
            ? sockets.flatMap(socket =>
                socket && typeof socket === 'object' && !Array.isArray(socket) && typeof socket.localSocketName === 'string'
                    ? [[socket.localSocketName, { nodeId: socket.targetEntityId, socketName: socket.targetSocketName }]]
                    : [])
            : []);
    }
    if (asset?.catalogId === 'foxhole.structures') {
        state.markedItemCodenames = data(entity, 'cargo')?.items ?? [];
        if (Array.isArray(data(entity, 'cargo')?.stockpileItems)) {
            state.markedStockpileItems = stockpileEntriesToSelections(
                resolveFoxholeStockpileSelectionGroups(getFoxholeManifest('/foxhole/assets/').assets.find(candidate => candidate.id === asset.assetId)?.stockpiles),
                data(entity, 'cargo')?.stockpileItems,
            );
        }
        state.productionOrders = data(entity, 'production-order')?.orders ?? [];
        state.disableProduction = data(entity, 'production-order')?.disabled === true;
    }
    return { type, state };
}

function structureGeometry(entity: NixieExperimentalComponentEntitySnapshotV1) {
    const asset = data(entity, 'asset');
    if (asset?.catalogId !== 'foxhole.structures' || typeof asset.assetId !== 'string') {
        return null;
    }
    const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
    const structure = catalog.assetByKey[asset.assetId];
    if (!structure) {
        return null;
    }
    const state = project(entity)!.state;
    const packaged = state.packaged === true ? structure.packaged : null;
    const destroyed = !packaged && state.destroyed === true ? structure.destroyed : null;
    const variants = !packaged && state.destroyed !== true
        ? getFoxholeSelectedModificationSlotVariants(structure.modificationSlots,
            normalizeFoxholeModificationSelectionMap(state.modificationVariantIds))
        : [];
    const replacement = variants.find(selection => isStructureReplacementModificationVariant(selection.variant))?.variant;
    const dimensions = resolveFoxholeStructureDimensions(structure, packaged ?? destroyed, replacement);
    return { catalog, structure, state, packaged, destroyed, variants, replacement, dimensions,
        manifest: catalog.structureByKey[destroyed && structure.destroyedStructureId ? structure.destroyedStructureId : asset.assetId] };
}

export const foxholeSceneV2StateAdapter: NixieSceneV2StateAdapter = {
    hitboxHostMetrics(entity) {
        const geometry = structureGeometry(entity);
        if (!geometry) {
            return null;
        }
        const { state, dimensions } = geometry;
        return resolveHitboxHostMetrics(state, { width: dimensions.width ?? 0, height: dimensions.height ?? 0,
            frameWidth: 0, frameHeight: 0 });
    },
    deletionUpdates(entity, deletedEntityIds) {
        const projected = project(entity);
        if (!projected || !['foxholeAsset', 'foxholeSplineConnector', 'foxholeConnector'].includes(projected.type)) {
            return [];
        }
        const { patch } = resolveFoxholeSplineDeleteMutation(normalizeFoxholeSplineConnectorState(projected.state), deletedEntityIds);
        return Object.keys(patch).length ? this.patch(entity, patch).updates : [];
    },
    startPlacement(entity) {
        const projected = project(entity);
        if (projected?.type !== 'foxholeSplineConnector') {
            return null;
        }
        let state = normalizeFoxholeSplineConnectorState(projected.state);
        const connector = getFoxholeManifest('/foxhole/assets/').assets.find(asset => asset.id === state.foxholeKey)?.connector;
        const pathStyle = resolveEffectiveConnectorPathStyle(resolveConnectorPathStyle(connector), state.foxholeKey);
        const maxArcAngleDeg = Number.isFinite(state.maxArcAngleDeg) ? state.maxArcAngleDeg : connector?.maxArcAngleDeg;
        const session: FoxholeSplinePlacementState = { phase: 'pick-start', manualStartRotation: false, manualEndRotation: false };
        const source = data(entity, 'spline-connector')!;
        const initialTransform = readNixieSceneV2LocalTransform(entity);
        const updates = () => {
            // Native anchors an attached start at the structure socket. Keep the
            // session's pointer basis fixed while projecting that same saved TRS.
            const origin = session.phase === 'pick-end' && state.startAttachment ? state.start : { x: 0, y: 0 };
            const localMatrix = nixieSceneV2TransformMatrix(initialTransform);
            const x = initialTransform.x + localMatrix.a * origin.x + localMatrix.c * origin.y;
            const y = initialTransform.y + localMatrix.b * origin.x + localMatrix.d * origin.y;
            const fields = { startX: state.start.x - origin.x, startY: state.start.y - origin.y, startRotation: state.start.rotation,
                endX: state.end.x - origin.x, endY: state.end.y - origin.y, endRotation: state.end.rotation, curveT: state.curveT,
                startAttachmentNodeId: state.startAttachment?.nodeId, startAttachmentSocketName: state.startAttachment?.socketName,
                endAttachmentNodeId: state.endAttachment?.nodeId, endAttachmentSocketName: state.endAttachment?.socketName };
            const set = Object.fromEntries(Object.entries(fields).filter(([key, value]) => value !== undefined && source[key] !== value));
            const unset = Object.keys(fields).filter(key => fields[key as keyof typeof fields] === undefined && key in source);
            return [{ ownerId: OWNER, componentId: 'spline-connector', set, ...(unset.length ? { unset } : {}) },
                ...(x !== initialTransform.x || y !== initialTransform.y ? [{ ownerId: 'nixie.core', componentId: 'transform', set: { x, y } }] : [])];
        };
        const update = (point: { x: number; y: number; }, rotate = false, context?: NixieSceneV2PlacementContext) => {
            const role = session.phase === 'pick-start' ? 'start' : 'end';
            const matrix = context?.worldTransforms.get(entity.entityId);
            const sockets = context && matrix && usesSplineConnectorSocketSnapping(state.foxholeKey)
                && context.isSettingEnabled(FOXHOLE_SOCKET_SNAPPING_SETTING_ID)
                ? collectNixieSceneV2FoxholeSockets(context)
                : [];
            const socket = context && matrix && isPowerlineConnector(state.foxholeKey)
                && context.isSettingEnabled(FOXHOLE_SOCKET_SNAPPING_SETTING_ID)
                ? resolveHoveredFoxholePowerSocketPoint(context.worldPoint,
                    sockets.filter(candidate => context.hoveredEntityIds.includes(candidate.nodeId)),
                    role === 'start' ? state.endAttachment : state.startAttachment,
                    candidate => isNixieSceneV2FoxholeSocketAvailable(context, candidate, entity.entityId, String(state[`${role}SocketName`] ?? '')))
                : null;
            const local = socket && matrix ? invertNixieSceneV2Point(matrix, socket) : null;
            let snapped = socket && local && matrix
                ? { local,
                    rotation: worldRotationToEndpointLocal(socket.rotation - (role === 'end' ? Math.PI : 0), Math.atan2(matrix.b, matrix.a)),
                    attachment: { nodeId: socket.nodeId, socketName: socket.socketName } }
                : null;
            const structure = getFoxholeManifest('/foxhole/assets/').assets.find(asset => asset.id === state.foxholeKey);
            const endpointSocket = structure && resolveFoxholeConnectorEndpointSockets(structure, state)[role];
            if (!snapped && context && matrix && endpointSocket && hasFoxholeSnapSocketTags(endpointSocket.socketTags) && sockets.length) {
                const nodeRotation = Math.atan2(matrix.b, matrix.a);
                const result = resolveFoxholeSplineEndpointSocketSnap({ state, role, local: point, world: context.worldPoint,
                    nodeRotation, movingSocket: { nodeId: entity.entityId, socketName: String(state[`${role}SocketName`] ?? ''),
                        ...context.worldPoint, rotation: resolveConnectorSocketSnapStemRotation(role, state[role].rotation, nodeRotation, state.foxholeKey),
                        socketTags: endpointSocket.socketTags }, targetSockets: sockets,
                    toLocal: target => invertNixieSceneV2Point(matrix, target),
                    isAvailable: (moving, target) => isNixieSceneV2FoxholeSocketAvailable(context, target, moving.nodeId, moving.socketName) });
                if (result.rotation !== undefined && result.attachment) {
                    snapped = { local: result.local, rotation: result.rotation, attachment: result.attachment };
                }
            }
            state = { ...state, ...resolveFoxholeSplinePlacementPreview(state, session, point,
                { pathStyle, maxArcAngleDeg, rotateActiveEndpoint: rotate, snapped, startAttached: !!state.startAttachment }),
            ...(usesSplineConnectorSocketSnapping(state.foxholeKey)
                ? { [`${role}Attachment`]: snapped?.attachment }
                : {}) };
            return updates();
        };
        return {
            removeOnCancel: true,
            update,
            confirm(point, context) {
                update(point, false, context);
                const complete = session.phase === 'pick-end';
                if (!complete) {
                    session.phase = 'pick-end';
                    session.lockedStartPosition = undefined;
                    session.lockedEndPosition = undefined;
                    session.manualEndRotation = false;
                    if (allowsConnectorRotationHandles(pathStyle, state.foxholeKey, { maxArcAngleDeg })) {
                        session.manualStartRotation = true;
                    }
                }
                return { complete, updates: updates() };
            },
            secondaryDown() {
                if (!allowsConnectorRotationHandles(pathStyle, state.foxholeKey, { maxArcAngleDeg })) {
                    return;
                }
                if (session.phase === 'pick-start') {
                    session.lockedStartPosition = { ...state.start };
                    session.manualStartRotation = true;
                } else {
                    session.lockedEndPosition = { ...state.end };
                    session.manualEndRotation = true;
                }
            },
            wheel(delta) {
                if (!usesPipeCurveScale(pathStyle, state.foxholeKey)) {
                    return null;
                }
                state = { ...state, curveT: adjustPipeCurveT(state.curveT, delta) };
                return updates();
            },
        };
    },
    curveScaleUpdates(entity, delta) {
        const spline = editableSpline(entity);
        if (!spline || !Number.isFinite(delta) || !usesPipeCurveScale(spline.pathStyle, spline.state.foxholeKey)) {
            return null;
        }
        const curveT = adjustPipeCurveT(spline.state.curveT, delta);
        return curveT === spline.state.curveT ? [] : [{ ownerId: OWNER, componentId: 'spline-connector', set: { curveT } }];
    },
    editableHandles(entity) {
        const spline = editableSpline(entity);
        if (spline) {
            return getFoxholeSplineLocalEditableHandles(spline.state, spline.pathStyle, spline.maxArcAngleDeg);
        }
        const source = editablePoints(entity);
        return source ? getPolylineEditableLocalHandles(source.points, source.options) : [];
    },
    editableHandlePatch(entity, handleId, localPoint, committed) {
        const spline = editableSpline(entity);
        if (spline && (handleId === 'start' || handleId === 'end')) {
            const { state, pathStyle } = spline;
            const next = clampDraggedSplineEndpoint(handleId, { ...state.start, ...(handleId === 'start' ? localPoint : {}) },
                { ...state.end, ...(handleId === 'end' ? localPoint : {}) }, getFoxholeSplineConnectorConstraints(state, pathStyle));
            return { start: next.start, end: next.end };
        }
        if (spline && (handleId === 'start-rotation' || handleId === 'end-rotation')) {
            const role = handleId === 'start-rotation' ? 'start' : 'end';
            const endpoint = spline.state[role];
            const handles = getFoxholeSplineLocalEditableHandles(spline.state, spline.pathStyle, spline.maxArcAngleDeg);
            const handle = handles.find(candidate => candidate.id === handleId);
            if (!handle) {
                return null;
            }
            const offset = Math.atan2(handle.local.y - endpoint.y, handle.local.x - endpoint.x) - endpoint.rotation;
            const rotation = Math.atan2(localPoint.y - endpoint.y, localPoint.x - endpoint.x) - offset;
            return { [role]: { ...endpoint, rotation: Math.atan2(Math.sin(rotation), Math.cos(rotation)) } };
        }
        const source = editablePoints(entity);
        const handle = this.editableHandles?.(entity).find(candidate => candidate.id === handleId);
        if (!source || !handle) {
            return null;
        }
        const points = movePolylineLocalVertex(source.points, handle.index, localPoint);
        if (!points || (source.triangulation && !getFoxholeTriangulationFit({ ...source.triangulation, edgePoints: points }))) {
            return null;
        }
        if (!committed || !source.range) {
            return { [source.field]: points };
        }
        const transform = entity.components.find(component => component.ownerId === 'nixie.core'
            && component.componentId === 'transform' && component.definitionAvailable)?.data;
        if (!transform) {
            return null;
        }
        // V1 reanchors points when serializing the accepted edit.
        const normalized = normalizeFoxholeRangeState({ ...source.range, ...transform, points } as Partial<FoxholeRangeState>);
        return { points: normalized.points, x: normalized.x, y: normalized.y };
    },
    selectionLocalQuad(entity) {
        const spline = editableSpline(entity);
        return spline && isPowerlineConnector(spline.state.foxholeKey)
            ? resolveFoxholePowerlineSelectionQuad(spline.state.start, spline.state.end, FOXHOLE_POWERLINE_CORE_WIDTH)
            : null;
    },
    selectionFrameAngleLocal(entity) {
        const spline = editableSpline(entity);
        return spline && isPowerlineConnector(spline.state.foxholeKey)
            ? Math.atan2(spline.state.end.y - spline.state.start.y, spline.state.end.x - spline.state.start.x)
            : null;
    },
    selectionLocalBounds(entity, renderScale) {
        // Spline products also carry asset identity, whose sprite bounds describe
        // only the undeformed source segment. Measure their rendered path instead.
        if (data(entity, 'spline-connector')) {
            return null;
        }
        const geometry = structureGeometry(entity);
        if (geometry) {
            const { state, structure, manifest, dimensions, packaged, destroyed, replacement, variants, catalog } = geometry;
            const offset = resolveFoxholeStructureSpriteOffset(manifest?.sprite, packaged ?? destroyed, replacement);
            const pallet = packaged?.shippableType ? catalog.packagedPalletByShippableType[packaged.shippableType] : null;
            const palletOffset = packaged?.palletOffset;
            return buildFoxholeStructureSelectionGeometry({ structure: pallet ? undefined : manifest,
                selectionPolygons: pallet ? [] : variants.find(selection => selection.variant.selectionPolygons.length)?.variant.selectionPolygons ?? manifest?.selectionPolygons,
                renderLayers: !packaged && state.destroyed !== true && !replacement && /^trencht[12]$/i.test(structure.codeName)
                    ? structure.renderLayers : [],
                sprite: pallet
                    ? { width: (pallet.width ?? 0) * FOXHOLE_BOARD_SPRITE_SCALE, height: (pallet.height ?? 0) * FOXHOLE_BOARD_SPRITE_SCALE,
                        anchorX: pallet.anchorX, anchorY: pallet.anchorY,
                        offsetX: ((pallet.offsetX ?? 0) + (palletOffset?.x ?? 0)) * FOXHOLE_BOARD_SPRITE_SCALE,
                        offsetY: ((pallet.offsetY ?? 0) + (palletOffset?.y ?? 0)) * FOXHOLE_BOARD_SPRITE_SCALE,
                        rotationRadians: (palletOffset?.rotationDegrees ?? 0) * Math.PI / 180 }
                    : { ...dimensions, anchorX: Number(state.anchorX), anchorY: Number(state.anchorY), offsetX: offset.x, offsetY: offset.y },
                pixelsPerUnit: 32 })?.bounds ?? null;
        }
        const range = data(entity, 'range');
        if (range) {
            return getFoxholeRangeSelectionLocalBounds(resolveFoxholeRangeState(range as Partial<FoxholeRangeState>), renderScale);
        }
        const triangulation = data(entity, 'triangulation');
        if (!triangulation) {
            return null;
        }
        const transform = entity.components.find(component => component.ownerId === 'nixie.core'
            && component.componentId === 'transform' && component.definitionAvailable)?.data;
        return getFoxholeTriangulationSelectionLocalBounds(
            resolveFoxholeTriangulationState({ ...triangulation, ...transform } as Partial<FoxholeTriangulationState>), renderScale);
    },
    selectionTransformOriginLocal(entity) {
        const spline = editableSpline(entity);
        if (spline) {
            return { x: (spline.state.start.x + spline.state.end.x) / 2, y: (spline.state.start.y + spline.state.end.y) / 2 };
        }
        if (data(entity, 'asset')?.catalogId === 'foxhole.structures') {
            return { x: 0, y: 0 };
        }
        const range = data(entity, 'range');
        if (!range) {
            return null;
        }
        const metrics = getFoxholeRangeMetrics(resolveFoxholeRangeState(range as Partial<FoxholeRangeState>));
        return { x: metrics.centerX, y: metrics.centerY };
    },
    requestsTransformGizmo(entity) {
        return data(entity, 'asset')?.catalogId === 'foxhole.structures';
    },
    project,
    patch(entity, patch) {
        const projected = project(entity);
        if (!projected || !Object.keys(patch).length || projected.type === 'nixieIcon') {
            return { handledKeys: [], updates: [] };
        }
        const reconciledPatch = projected.type === 'foxholeAsset'
            ? reconcileFoxholeAssetCargoPatch(getFoxholeStructureCatalog('/foxhole/assets/'), projected.state, patch)
            : patch;
        const merged = { ...projected.state, ...reconciledPatch };
        const convert = (state: Record<string, unknown>) => convertFoxholeSceneV1NodeToV2({ entityId: entity.entityId,
            node: { id: entity.entityId, type: projected.type, state, children: [] }, nodePath: 'inspector', resolveEntityId: id => id });
        const baselineIssues = new Set(convert(projected.state)?.issues?.map(issue => issue.message));
        const converted = convertFoxholeSceneV1NodeToV2({ entityId: entity.entityId,
            node: { id: entity.entityId, type: projected.type, state: merged, children: [] }, nodePath: 'inspector', resolveEntityId: id => id });
        const handledKeys = Object.keys(patch).filter(key => !['maintenanceFilters', 'baseUpgrades'].includes(key) && converted?.handledStateKeys?.includes(key));
        if (!handledKeys.length) {
            return { handledKeys: [], updates: [] };
        }
        const newIssues = converted?.issues?.filter(issue => !baselineIssues.has(issue.message));
        if (!converted?.supported || newIssues?.length) {
            throw new Error(newIssues?.map(issue => issue.message).join(' ') || 'This Foxhole edit is unavailable.');
        }
        const components = new Set<string>();
        for (const key of handledKeys) {
            if (key === 'modificationVariantIds') {
                components.add('modification');
            } else if (key === 'socketAttachments') {
                components.add('socket-attachments');
            } else if (key === 'markedItemCodenames' || key === 'markedStockpileItems') {
                components.add('cargo');
            } else if (['productionOrders', 'disableProduction'].includes(key)) {
                components.add('production-order');
            } else if (projected.type === 'foxholeAsset' && key === 'foxholeKey') {
                components.add('asset');
                if ('markedItemCodenames' in reconciledPatch) {
                    components.add('cargo');
                }
            } else if (projected.type === 'foxholeAsset') {
                components.add('appearance');
            } else {
                components.add(Object.entries(NODE_COMPONENTS).find(([, type]) => type === projected.type)![0]);
            }
        }
        const updates = [...components].flatMap(componentId => {
            const current = data(entity, componentId);
            const next = converted.components?.find(component => component.componentId === componentId)?.data ?? {};
            const set = Object.fromEntries(Object.entries(next).filter(([key, value]) => JSON.stringify(current?.[key]) !== JSON.stringify(value)));
            const unset = Object.keys(current ?? {}).filter(key => !(key in next));
            return Object.keys(set).length || unset.length ? [{ ownerId: OWNER, componentId, set, unset, createIfMissing: !current }] : [];
        });
        return { handledKeys, updates };
    },
};
