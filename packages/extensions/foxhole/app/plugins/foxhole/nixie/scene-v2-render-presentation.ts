import type { NixieSceneV2RenderPresentationAdapter } from '#nixie/plugins/nixie/scene-v2/render-presentation.ts';
import { resolveFoxholeRangeState } from './range.ts';
import type { FoxholeRangeState } from './range.ts';
import { renderFoxholeRangeVisuals, getFoxholeRangeLabelTextStyle } from '../../nixie/board/types/foxhole-range.ts';
import { renderFoxholeTacticalLineGraphics } from '../../nixie/board/types/foxhole-tactical-line.ts';
import { applyFoxholeTacticalLinePreset } from './tactical-line.ts';
import type { FoxholeTacticalLineState } from './tactical-line.ts';
import { prepareBoardTextFonts } from '#nixie/plugins/nixie/board/utils/board-text-markup.ts';
import { NIXIE_DEFAULT_RENDER_LANE, FOXHOLE_STRUCTURE_RENDER_LANES, FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE, resolveFoxholeConnectorRenderLane } from './render-lanes.ts';
import { getFoxholeManifest } from './manifest.ts';
import { resolveFoxholeEffectiveBuildSockets } from './structure-socket-resolution.ts';
import { createFoxholePowerSocketVisual, createFoxholePipeSocketVisual, createFoxholeSocketLabel, resolveFoxholePipeSocketFlow, resolveFoxholePipeSocketColor, FOXHOLE_POWER_SOCKET_COLOR } from './structure-socket-visuals.ts';
import { FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS } from './structure-debug-settings.ts';
import { Graphics } from 'pixi.js';
import type { Container } from 'pixi.js';
import { normalizeFoxholeSplineConnectorState, resolveEffectiveConnectorPathStyle, isPowerlineConnector } from './spline-connector.ts';
import { allowsConnectorRotationHandles, resolveConnectorPathStyle, resolveConnectorSpanCrossHalfWidth } from './pipe-connector-path.ts';
import { resolveFoxholeSplinePathConstraints, resolveFoxholeSplineGuidePath, drawFoxholeSplinePathGuide, drawFoxholeSplineEndpointGizmo } from './spline-connector-guides.ts';
import { FOXHOLE_RANGE_SETTING_KEYS, FOXHOLE_RANGE_DEBUG_SETTING_KEYS, readFoxholeRangeSettingsFromGetter, isFoxholeRangeVisible } from './range-settings.ts';
import { createFoxholeStructureRangeVisual } from './structure-range-visual.ts';
import { FOXHOLE_NIGHT_RANGE_SETTING_IDS, resolveFoxholeNightVisionRadius } from './night-ranges.ts';
import { getFoxholeStructureCatalog } from './catalog.ts';
import { resolveFoxholeSplineConnectorRenderLayers } from './spline-connector-upgrade-layers.ts';
import { resolveFoxholeSplineConnectorSockets, populateFoxholeSplineConnectorSocketOverlay } from './spline-connector-sockets.ts';
import { resolveFoxholeStructureOverlaySockets, createFoxholeSocketAttachmentStatusVisual, createFoxholeAllSocketsLabel, getFoxholeSocketLabelPositionKey, getFoxholeSocketDebugLabel } from './structure-socket-overlay.ts';
import { syncUprightBoardOverlayChildren } from './upright-overlay-sync.ts';

export const FOXHOLE_SCENE_V2_PRESENTATION_SETTING_IDS = [
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.allSockets,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.powerSockets,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.pipeSockets,
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.socketLabels,
    ...Object.values(FOXHOLE_RANGE_SETTING_KEYS),
    ...FOXHOLE_NIGHT_RANGE_SETTING_IDS,
    ...Object.values(FOXHOLE_RANGE_DEBUG_SETTING_KEYS),
    'nixie.debug.overlay',
] as const;

const OWNER = 'nixie.foxhole-planner';
function componentData(entity: Parameters<NixieSceneV2RenderPresentationAdapter>[0], id: string) {
    return entity.components.find(component => component.ownerId === OWNER && component.componentId === id
        && component.version === 1 && component.definitionAvailable)?.data;
}

function prepareStructureSocketPresentation(...[entity, plan, , settings]: Parameters<NixieSceneV2RenderPresentationAdapter>) {
    // Empty SDK groups deliberately declare a handled overlay with no visible sockets.
    if (plan.root.children.some(node => node.id === 'structure-socket-presentation' && node.experimentalPresentation?.excludeFromBounds === true)) return null;
    const asset = componentData(entity, 'asset');
    if (asset?.catalogId !== 'foxhole.structures' || typeof asset.assetId !== 'string') {
        return null;
    }
    const structure = getFoxholeManifest('/foxhole/assets/').assets.find(candidate => candidate.id === asset.assetId);
    if (!structure) {
        return null;
    }
    const appearance = componentData(entity, 'appearance');
    const selections = componentData(entity, 'modification')?.selections;
    const selectedVariants = Array.isArray(selections)
        ? selections.flatMap(selection => {
            if (!selection || typeof selection !== 'object' || Array.isArray(selection)
                || typeof selection.slotId !== 'string' || typeof selection.variantId !== 'string') {
                return [];
            }
            const variant = structure.modificationSlots.find(slot => slot.name === selection.slotId)?.variants[selection.variantId];
            return variant ? [variant] : [];
        })
        : [];
    const attachments = componentData(entity, 'socket-attachments')?.attachments;
    const occupied = new Set(Array.isArray(attachments)
        ? attachments.flatMap(attachment =>
            attachment && typeof attachment === 'object' && !Array.isArray(attachment) && typeof attachment.localSocketName === 'string'
                ? [attachment.localSocketName]
                : [])
        : []);
    const showAll = settings[FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.allSockets] === true;
    const showLabels = settings[FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.socketLabels] === true;
    const sockets = appearance?.destroyed === true || appearance?.packaged === true
        ? []
        : resolveFoxholeStructureOverlaySockets(resolveFoxholeEffectiveBuildSockets(structure.buildSockets, selectedVariants, structure.railCouplers),
            { x: 0, y: 0 }, entity.entityId).filter(socket => {
            return showAll || (!occupied.has(String(socket.name ?? '').trim())
                && ((socket.kind === 'power' && settings[FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.powerSockets] === true)
                    || (socket.kind === 'pipe' && settings[FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.pipeSockets] === true)));
        });
    if (sockets.length === 0) {
        return null;
    }
    const transform = entity.components.find(component => component.ownerId === 'nixie.core' && component.componentId === 'transform'
        && component.version === 1 && component.definitionAvailable)?.data;
    const layerId = 'native-socket-indicators';
    return {
        boundsExcludedNodeIds: [layerId],
        plan: { ...plan, root: { ...plan.root, children: [...plan.root.children.filter(node => node.id !== 'structure-socket-overlays'),
            { id: layerId, kind: 'group' as const, laneId: FOXHOLE_STRUCTURE_RENDER_LANES.hitboxDebug.laneId,
                laneOrder: FOXHOLE_STRUCTURE_RENDER_LANES.hitboxDebug.laneOrder, children: [] }] } },
        apply(resolveNode: Parameters<NonNullable<ReturnType<NixieSceneV2RenderPresentationAdapter>>['apply']>[0]) {
            const layer = resolveNode(layerId);
            if (!layer) {
                return;
            }
            const groups = new Map<string, typeof sockets>();
            if (showAll && showLabels) {
                for (const socket of sockets) {
                    const key = getFoxholeSocketLabelPositionKey(socket);
                    groups.set(key, [...groups.get(key) ?? [], socket]);
                }
            }
            const statusColor = (socket: typeof sockets[number]) => occupied.has(String(socket.name ?? '').trim()) ? 0x53D769 : 0xFF4D4D;
            for (const socket of sockets) {
                if (showAll) {
                    const visual = createFoxholeSocketAttachmentStatusVisual(socket, statusColor(socket));
                    const group = groups.get(getFoxholeSocketLabelPositionKey(socket)) ?? [socket];
                    if (showLabels && group[0] === socket) {
                        visual.addChild(createFoxholeAllSocketsLabel(group, structure.id, statusColor));
                    }
                    layer.addChild(visual);
                    continue;
                }
                const placement = { localX: socket.localX, localY: socket.localY, rotationRadians: socket.rotationRadians,
                    ancestorRotationRadians: typeof transform?.rotation === 'number' ? transform.rotation : 0 };
                const visual = socket.kind === 'power'
                    ? createFoxholePowerSocketVisual(placement)
                    : createFoxholePipeSocketVisual(placement, socket.socket.pipeType);
                if (showLabels) {
                    const color = socket.kind === 'power' ? FOXHOLE_POWER_SOCKET_COLOR : resolveFoxholePipeSocketColor(resolveFoxholePipeSocketFlow(socket.socket.pipeType));
                    visual.addChild(createFoxholeSocketLabel(getFoxholeSocketDebugLabel(socket), color, socket.rotationRadians));
                }
                layer.addChild(visual);
            }
            syncUprightBoardOverlayChildren(typeof transform?.rotation === 'number' ? transform.rotation : 0, layer);
        },
    };
}

function prepareStructurePresentation(...args: Parameters<NixieSceneV2RenderPresentationAdapter>) {
    const [entity, plan, , settings] = args;
    const sockets = prepareStructureSocketPresentation(...args);
    if (plan.root.children.some(node => (node.id === 'structure-ranges' || node.id === 'selected-structure-ranges')
        && (node.experimentalPresentation?.groundOverlay === true
            || (node.kind === 'group' && node.children.length > 0
                && node.children.every(child => typeof child.experimentalPresentation?.groundOverlay === 'boolean'))))) {
        return sockets;
    }

    const asset = componentData(entity, 'asset');
    const appearance = componentData(entity, 'appearance');
    const structure = asset?.catalogId === 'foxhole.structures'
        ? getFoxholeManifest('/foxhole/assets/').assets.find(candidate => candidate.id === asset.assetId)
        : null;
    if (!structure || appearance?.destroyed === true || appearance?.packaged === true || !structure.ranges.length) {
        return sockets;
    }
    const rangeSettings = readFoxholeRangeSettingsFromGetter(id => settings[id]);
    const ranges = structure.ranges.filter(range => isFoxholeRangeVisible(range, rangeSettings, true, { isVehicle: structure.isVehicle === true }));
    if (!ranges.length) {
        return sockets;
    }
    const alwaysId = 'native-structure-ranges';
    const selectedId = 'native-selected-structure-ranges';
    const transform = entity.components.find(component => component.ownerId === 'nixie.core' && component.componentId === 'transform'
        && component.version === 1 && component.definitionAvailable)?.data;
    const sourcePlan = sockets?.plan ?? plan;
    return {
        selectionOnlyNodeId: selectedId,
        boundsExcludedNodeIds: [...sockets?.boundsExcludedNodeIds ?? [], alwaysId, selectedId],
        plan: { ...sourcePlan, root: { ...sourcePlan.root, children: [...sourcePlan.root.children.filter(node => node.id !== 'structure-ranges' && node.id !== 'selected-structure-ranges'),
            ...[alwaysId, selectedId].map(id => ({ id, kind: 'group' as const, laneId: NIXIE_DEFAULT_RENDER_LANE.laneId,
                laneOrder: NIXIE_DEFAULT_RENDER_LANE.laneOrder, children: [] }))] } },
        apply(resolveNode: Parameters<NonNullable<ReturnType<NixieSceneV2RenderPresentationAdapter>>['apply']>[0]) {
            sockets?.apply(resolveNode);
            for (const range of ranges) {
                const visual = createFoxholeStructureRangeVisual(range, false, resolveFoxholeNightVisionRadius(structure, range, id => settings[id]));
                if (!visual) {
                    continue;
                }
                const layer = resolveNode(isFoxholeRangeVisible(range, rangeSettings, false, { isVehicle: structure.isVehicle === true }) ? alwaysId : selectedId);
                if (!layer) {
                    visual.visual.destroy({ children: true });
                    continue;
                }
                if (visual.label) {
                    visual.label.visible = settings['nixie.debug.overlay'] === true;
                    visual.label.rotation = -(typeof transform?.rotation === 'number' ? transform.rotation : 0);
                }
                layer.addChild(visual.visual);
            }
        },
    };
}

export const prepareFoxholeSceneV2RenderPresentation: NixieSceneV2RenderPresentationAdapter = (entity, plan, renderScale, settings = {}, toolColors = () => ({ stem: 0x8BE9FF, handle: 0xD8F7FF })) => {
    const spline = componentData(entity, 'spline-connector');
    if (spline) {
        const portableGuides = plan.root.children.some(node => node.id === 'spline-connector-guides' && node.experimentalPresentation?.selectionOnly === true);
        const portableSockets = plan.root.children.some(node => node.id === 'spline-connector-socket-presentation' && node.experimentalPresentation?.excludeFromBounds === true);
        if (portableGuides && portableSockets) return null;
        const state = normalizeFoxholeSplineConnectorState({ ...spline,
            start: { x: Number(spline.startX), y: Number(spline.startY), rotation: Number(spline.startRotation) },
            end: { x: Number(spline.endX), y: Number(spline.endY), rotation: Number(spline.endRotation) } });
        const renderLane = resolveFoxholeConnectorRenderLane(state.foxholeKey, FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE);
        const structure = getFoxholeManifest('/foxhole/assets/').assets.find(asset => asset.id === state.foxholeKey);
        const connector = structure?.connector;
        const pathStyle = resolveEffectiveConnectorPathStyle(resolveConnectorPathStyle(connector), state.foxholeKey);
        const constraints = resolveFoxholeSplinePathConstraints(state, pathStyle, connector?.maxBufferCm ?? connector?.minLengthCm ?? 0);
        const rotationHandles = allowsConnectorRotationHandles(pathStyle, state.foxholeKey, { maxArcAngleDeg: state.maxArcAngleDeg });
        const layerId = 'native-spline-guides';
        const socketLayerId = 'native-spline-sockets';
        const transform = entity.components.find(component => component.ownerId === 'nixie.core' && component.componentId === 'transform'
            && component.version === 1 && component.definitionAvailable)?.data;
        const selections = componentData(entity, 'modification')?.selections;
        const variants = Object.fromEntries(Array.isArray(selections)
            ? selections.flatMap(selection =>
                selection && typeof selection === 'object' && !Array.isArray(selection)
                && typeof selection.slotId === 'string' && typeof selection.variantId === 'string'
                    ? [[selection.slotId, selection.variantId]]
                    : [])
            : []);
        const layers = resolveFoxholeSplineConnectorRenderLayers({ asset: getFoxholeStructureCatalog('/foxhole/assets/').assetByKey[state.foxholeKey],
            modificationVariantIds: variants });
        const spanLayer = layers.find(layer => layer.id.toLowerCase() === 'span') ?? layers.find(layer => layer.id.toLowerCase() === 'underlay');
        const sockets = structure
            ? resolveFoxholeSplineConnectorSockets({ structure, state, constraints, pathStyle,
                lateralOffset: resolveConnectorSpanCrossHalfWidth(spanLayer, 0.5), visualRotations: true })
            : [];
        const attachments = componentData(entity, 'socket-attachments')?.attachments;
        const occupied = new Set(Array.isArray(attachments)
            ? attachments.flatMap(attachment =>
                attachment && typeof attachment === 'object' && !Array.isArray(attachment) && typeof attachment.localSocketName === 'string'
                    ? [attachment.localSocketName]
                    : [])
            : []);
        let path: Graphics | null = null;
        let handles: Graphics | null = null;
        const redraw = () => {
            if (!path || !handles || path.destroyed || handles.destroyed) {
                return;
            }
            const colors = toolColors();
            if (!isPowerlineConnector(state.foxholeKey)) {
                drawFoxholeSplinePathGuide(path, resolveFoxholeSplineGuidePath(state, constraints, pathStyle).points, 1, colors.stem);
            }
            handles.clear();
            drawFoxholeSplineEndpointGizmo(handles, state.start, 'start', state.foxholeKey, rotationHandles, 1, colors.handle);
            drawFoxholeSplineEndpointGizmo(handles, state.end, 'end', state.foxholeKey, rotationHandles, 1, colors.handle);
        };
        return {
            selectionOnlyNodeId: layerId,
            boundsExcludedNodeIds: [socketLayerId],
            refresh: redraw,
            plan: { ...plan, root: { ...plan.root, children: [...plan.root.children.filter(node => node.id !== 'spline-connector-guides' && node.id !== 'spline-connector-socket-overlays'), { id: layerId, kind: 'group',
                laneId: renderLane.laneId, laneOrder: renderLane.laneOrder, children: [] },
            { id: socketLayerId, kind: 'group', laneId: renderLane.laneId,
                laneOrder: renderLane.laneOrder, children: [] }] } },
            apply(resolveNode) {
                const socketLayer = resolveNode(socketLayerId);
                if (socketLayer) {
                    populateFoxholeSplineConnectorSocketOverlay(socketLayer, { sockets,
                        settings: { showAllSockets: settings[FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.allSockets] === true,
                            showPowerSockets: settings[FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.powerSockets] === true,
                            showPipeSockets: settings[FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.pipeSockets] === true,
                            showSocketLabels: settings[FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.socketLabels] === true },
                        foxholeKey: state.foxholeKey, nodeRotation: typeof transform?.rotation === 'number' ? transform.rotation : 0,
                        isOccupied: socket => occupied.has(socket.name) || (socket.endpoint !== 'side'
                            && typeof spline[`${socket.endpoint}AttachmentNodeId`] === 'string'
                            && typeof spline[`${socket.endpoint}AttachmentSocketName`] === 'string') });
                }
                const layer = resolveNode(layerId);
                if (!layer) {
                    return;
                }
                path = new Graphics();
                handles = new Graphics();
                path.eventMode = handles.eventMode = 'none';
                redraw();
                layer.addChild(path, handles);
            },
        };
    }
    const transform = entity.components.find(component => component.ownerId === 'nixie.core'
        && component.componentId === 'transform' && component.version === 1 && component.definitionAvailable)?.data;
    const tacticalLine = componentData(entity, 'tactical-line');
    if (tacticalLine) {
        const state = applyFoxholeTacticalLinePreset({ ...tacticalLine, ...transform } as Partial<FoxholeTacticalLineState>,
            typeof tacticalLine.presetId === 'string' ? tacticalLine.presetId : undefined);
        let graphics: Graphics | null = null;
        let displayedScale: number | null = null;
        const redraw = (scale = displayedScale ?? renderScale) => {
            if (graphics && !graphics.destroyed && displayedScale !== scale) {
                renderFoxholeTacticalLineGraphics(graphics, state, scale);
                displayedScale = scale;
            }
        };
        return {
            plan: { ...plan, root: { ...plan.root, children: plan.root.children
                .filter(node => node.id !== 'tactical-line-decorators' && node.id !== 'tactical-line-caps')
                .map(node => node.id === 'tactical-line-stroke' && node.kind === 'graphics' ? { ...node, commands: [] } : node) } },
            refresh: redraw,
            apply(resolveNode) {
                const node = resolveNode('tactical-line-stroke');
                graphics = node instanceof Graphics ? node : null;
                redraw();
            },
        };
    }
    const range = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'range' && component.version === 1 && component.definitionAvailable);
    const labelLayer = plan.root.children.find(node => node.id === 'range-label-layer' && node.kind === 'group');
    if (!range || !labelLayer) {
        return prepareStructurePresentation(entity, plan, renderScale, settings, toolColors);
    }
    const state = resolveFoxholeRangeState({ ...range.data, ...transform } as Partial<FoxholeRangeState>);
    let graphics: Graphics | null = null;
    let labels: Container | null = null;
    let displayedScale: number | null = null;
    const redraw = (scale = displayedScale ?? renderScale) => {
        if (graphics && labels && !graphics.destroyed && !labels.destroyed && displayedScale !== scale) {
            renderFoxholeRangeVisuals(graphics, labels, state, scale);
            displayedScale = scale;
        }
    };
    return {
        refresh: redraw,
        plan: { ...plan,
            // Native drawing replaces these SDK text nodes; its trusted geometry
            // adapter already owns the measured Range selection bounds.
            ...(plan.experimentalSelectionGeometry
                ? { experimentalSelectionGeometry: {
                    ...plan.experimentalSelectionGeometry, measuredTextBounds: [],
                } }
                : {}),
            root: { ...plan.root, children: plan.root.children.map(node => {
            // V1 draws a range body and its labels together in the default lane.
                if (node === labelLayer) {
                    return { ...node, laneId: NIXIE_DEFAULT_RENDER_LANE.laneId, laneOrder: NIXIE_DEFAULT_RENDER_LANE.laneOrder, children: [] };
                }
                return node.id === 'range-graphics' && node.kind === 'graphics'
                    ? { ...node, laneId: NIXIE_DEFAULT_RENDER_LANE.laneId, laneOrder: NIXIE_DEFAULT_RENDER_LANE.laneOrder, commands: [] }
                    : node;
            }) } },
        async apply(resolveNode) {
            const body = resolveNode('range-graphics');
            labels = resolveNode('range-label-layer');
            graphics = body instanceof Graphics ? body : null;
            if (!graphics || !labels) {
                return;
            }
            await prepareBoardTextFonts(getFoxholeRangeLabelTextStyle(state));
            // Reuse Native geometry, measured labels and the current full-world scale.
            redraw();
        },
    };
};
