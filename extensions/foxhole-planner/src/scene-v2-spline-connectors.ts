import { FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE, foxholeRenderLane, resolveFoxholeConnectorRenderLane } from './render-lanes.ts';
import type {
    NixieExtensionGraphicsCommandV1,
    NixieExtensionRenderGraphicsV1,
    NixieExtensionRenderMeshV1,
    NixieExtensionRenderNodeV1,
    NixieExtensionRenderSpriteV1,
} from '@nixie/extension-sdk/experimental/scene-v2';
import { resolveSplineControlPoints, isSplinePathViable, SPLINE_PATH_INVALID_TINT } from '@nixie/extension-sdk/experimental/scene-v2';
import { resolveIntervalMarkerSamples, resolveMeshConfigIntervalMarkerSamples, resolveCenteredMeshConfigIntervalBoundarySamples, resolveMineSplineMarkerSample } from './interval-connector-path.ts';
import { isExtensionPipeGeometryViable } from './pipe-extension-path.ts';
import type { FoxholeSceneV2AssetMetadata, FoxholeSceneV2VisualMetadata } from './scene-v2-asset-metadata.ts';
import { resolveConnectorBehavior } from './connector-behavior.ts';
import { resolveIntervalMarkerVariantIds } from './interval-marker-variants.ts';
import { isBarbedWireFence, resolveBarbedWireFencePosts } from './barbed-wire-fence.ts';
import { isWaterWallSpline, resolveWaterWallBuoys, resolveWaterWallNetInsets } from './water-wall-spline.ts';
import { isFoxholePowerlineOverLength, resolveFoxholePowerlineStroke } from './powerline-stroke.ts';
import { buildSplineRibbonMeshData, resolveConnectorSplineTextureSlicing, resolveSpanTrimSocketInset, resolveTrimSocketAnchor } from './spline-ribbon-mesh.ts';
import { foxholeSceneV2ConnectorConstraints, foxholeSceneV2ConnectorEndpoints, foxholeSceneV2GeometryLayer, sampleFoxholeSceneV2Connector } from './scene-v2-connector-path.ts';
import { destroyedTrenchConnectorPieces } from './destroyed-trench-connector.ts';
import { trenchConnectorTier } from './trench-connector.ts';

export interface FoxholeSceneV2SplineConnectorData {
    foxholeKey: string;
    startX: number;
    startY: number;
    startRotation: number;
    startHandleLength?: number;
    endX: number;
    endY: number;
    endRotation: number;
    endHandleLength?: number;
    minLength: number;
    maxLength: number;
    minRadius: number;
    maxRadius: number;
    maxBuffer: number;
    curveT: number;
    maxTargetAngleDeg?: number;
    maxArcAngleDeg?: number;
    startSocketName?: string;
    endSocketName?: string;
    startAttachmentNodeId?: string;
    endAttachmentNodeId?: string;
    startAttachmentSocketName?: string;
    endAttachmentSocketName?: string;
    socketAttachments?: Record<string, unknown>;
    /** Derived render-only placement state; never persisted. */
    powerlineObstructed?: boolean;
    blueprint: boolean;
    tint?: number;
    brightness?: number;
}

interface Point {
    x: number;
    y: number;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function resolveControlPoints(data: FoxholeSceneV2SplineConnectorData, asset?: FoxholeSceneV2AssetMetadata): [Point, Point, Point, Point] {
    const { start, end } = foxholeSceneV2ConnectorEndpoints(data);
    const points = resolveSplineControlPoints(start, end, foxholeSceneV2ConnectorConstraints(data, asset));
    return [points.p0, points.p1, points.p2, points.p3];
}

function resolveStrokeColor(data: FoxholeSceneV2SplineConnectorData): number {
    if (data.tint !== undefined) {
        return data.tint;
    }
    const key = data.foxholeKey.toLowerCase();
    if (key.includes('rail')) {
        return 0xAAB3BE;
    }
    if (key.includes('pipe')) {
        return 0x52C7E8;
    }
    return 0xD9F6FF;
}

function curveCommands(
    data: FoxholeSceneV2SplineConnectorData,
    points: [Point, Point, Point, Point],
    textured: boolean,
): NixieExtensionGraphicsCommandV1[] {
    const [start, control1, control2, end] = points;
    const color = resolveStrokeColor(data);
    const brightness = clamp(data.brightness ?? 1, 0, 4);
    const outline: NixieExtensionGraphicsCommandV1[] = [
        { op: 'move-to', x: start.x, y: start.y },
        {
            op: 'bezier-curve-to',
            control1X: control1.x,
            control1Y: control1.y,
            control2X: control2.x,
            control2Y: control2.y,
            x: end.x,
            y: end.y,
        },
        {
            op: 'stroke',
            color: 0x071014,
            width: 10,
            alpha: data.blueprint ? 0.45 : 0.8,
            cap: 'round',
            join: 'round',
        },
    ];
    if (textured) {
        return outline;
    }
    return [
        ...outline,
        { op: 'move-to', x: start.x, y: start.y },
        {
            op: 'bezier-curve-to',
            control1X: control1.x,
            control1Y: control1.y,
            control2X: control2.x,
            control2Y: control2.y,
            x: end.x,
            y: end.y,
        },
        {
            op: 'stroke',
            color,
            width: data.blueprint ? 4 : 6,
            alpha: clamp((data.blueprint ? 0.65 : 1) * brightness, 0, 1),
            cap: 'round',
            join: 'round',
        },
    ];
}

function buildSplineRibbon(
    data: FoxholeSceneV2SplineConnectorData,
    asset: FoxholeSceneV2AssetMetadata | undefined,
    visual: FoxholeSceneV2VisualMetadata | undefined = asset?.renderLayers.span,
    id = 'spline-connector-span',
): NixieExtensionRenderMeshV1 | null {
    const behavior = resolveConnectorBehavior(data.foxholeKey, asset?.connector);
    const style = asset?.connector?.pathStyle;
    const sandbag = /^sandbag(?:half|full)spline$/iu.test(data.foxholeKey);
    if (!visual || visual.width <= 0 || visual.height <= 0 || (style === 'interval' && !sandbag) || style === 'endpoints-only' || behavior.undergroundPipe) {
        return null;
    }
    const rawLayer = foxholeSceneV2GeometryLayer(visual);
    const back = asset?.renderLayers.backtrim;
    const front = asset?.renderLayers.fronttrim;
    const layeredWall = /^wallsplinet[123]$/iu.test(data.foxholeKey);
    const primaryConfig = asset?.connector?.meshConfigs.find(config => config.mode.includes('spline')) ?? asset?.connector?.meshConfigs[0];
    const repeatLength = style === 'straight-telescoping' && !layeredWall && (primaryConfig?.interval ?? 0) > 0
        ? primaryConfig!.interval
        : visual.width;
    // The wire reaches the handle centers; centered posts paint over its ends.
    const insets = isWaterWallSpline(data.foxholeKey)
        ? resolveWaterWallNetInsets({ x: data.startX, y: data.startY }, { x: data.endX, y: data.endY }, rawMeshConfig(asset?.connector?.meshConfigs[1]))
        : id !== 'spline-connector-span' || behavior.fieldConnectorSpan || layeredWall
        || data.foxholeKey === 'barbedwirespline' || isBarbedWireFence(data.foxholeKey)
        ? { startInset: 0, endInset: 0 }
        : style === 'straight-telescoping'
            ? { startInset: primaryConfig?.startOffset ?? 0, endInset: primaryConfig?.endOffset ?? 0 }
            : resolveSpanTrimSocketInset(back && foxholeSceneV2GeometryLayer(back), front && foxholeSceneV2GeometryLayer(front));
    const { start, end } = foxholeSceneV2ConnectorEndpoints(data);
    const geometry = buildSplineRibbonMeshData({ spanLayer: rawLayer, pathSample: sampleFoxholeSceneV2Connector(data, asset),
        textureMapping: { repeatLength }, textureMaterialScale: primaryConfig?.materialScale, ...insets,
        ...(layeredWall ? { perpendicularOffset: 0, centerTextureRepeats: true } : {}),
        ...(id === 'spline-connector-span' ? { textureSlicing: resolveConnectorSplineTextureSlicing(data.foxholeKey, rawLayer, primaryConfig?.materialScale) } : {}) }, start, end,
    foxholeSceneV2ConnectorConstraints(data, asset));
    if (!geometry) {
        return null;
    }
    return { id, kind: 'mesh', ...foxholeRenderLane(FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE), resourceId: visual.resourceId,
        positions: [...geometry.positions], uvs: [...geometry.uvs], indices: [...geometry.indices],
        textureAddressMode: resolveConnectorSplineTextureSlicing(data.foxholeKey, rawLayer, primaryConfig?.materialScale) ? 'clamp-to-edge' : 'repeat', textureScaleMode: 'linear',
        ...(data.tint === undefined && !data.blueprint ? {} : { tint: data.tint ?? 0x335CFF }),
        ...(data.blueprint ? { brightness: 2.15 } : data.brightness === undefined || data.brightness === 1 ? {} : { brightness: clamp(data.brightness, 0, 4) }) };
}

function rawMeshConfig(config: import('./scene-v2-asset-metadata.ts').FoxholeSceneV2ConnectorMeshMetadata | undefined) {
    return config && { ...config, interval: config.interval / 0.32, startOffset: config.startOffset / 0.32, endOffset: config.endOffset / 0.32 };
}

function buildIntervalMarkers(data: FoxholeSceneV2SplineConnectorData, asset: FoxholeSceneV2AssetMetadata | undefined): NixieExtensionRenderSpriteV1[] {
    if (/^sandbag(?:half|full)spline$/iu.test(data.foxholeKey)) {
        return [];
    }
    const connector = asset?.connector;
    if (!connector) {
        return [];
    }
    const path = sampleFoxholeSceneV2Connector(data, asset);
    const behavior = resolveConnectorBehavior(data.foxholeKey, connector);
    const layers = resolveIntervalMarkerVariantIds(Object.keys(asset?.renderLayers ?? {}), behavior.tankStop)
        .map(id => asset!.renderLayers[id]!);
    const raw = { meshConfigs: connector.meshConfigs.map(rawMeshConfig).filter(config => config !== undefined) };
    const nodes: NixieExtensionRenderSpriteV1[] = [];
    const append = (sample: { x: number; y: number; rotation: number; }, visual: FoxholeSceneV2VisualMetadata | undefined, prefix: string) => {
        if (!visual) {
            return;
        }
        nodes.push({ id: `spline-connector-${prefix}-${nodes.length + 1}`, kind: 'sprite', ...foxholeRenderLane(FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE), resourceId: visual.resourceId,
            x: sample.x, y: sample.y, rotation: sample.rotation, anchorX: 0.5, anchorY: 0.5,
            scaleX: 0.5, scaleY: 0.5, alpha: 1,
            ...(data.tint === undefined && !data.blueprint ? {} : { tint: data.tint ?? 0x335CFF }),
            ...(data.blueprint ? { brightness: 2.15 } : data.brightness === undefined || data.brightness === 1 ? {} : { brightness: clamp(data.brightness, 0, 4) }) });
    };
    if (connector.pathStyle === 'interval' && behavior.mineSpline) {
        for (let index = layers.length - 1; index >= 0; index--) {
            const config = raw.meshConfigs[index] ?? raw.meshConfigs[0];
            for (const [markerIndex, sample] of resolveMeshConfigIntervalMarkerSamples(path, config).entries()) {
                append(resolveMineSplineMarkerSample(sample, config, markerIndex), layers[index], 'interval');
            }
        }
    } else if (connector.pathStyle === 'interval') {
        for (const sample of resolveIntervalMarkerSamples(path, raw, connector.pathStyle, layers.length)) {
            append(sample, layers[sample.meshIndex], 'interval');
        }
    }
    if (/^wallsplinet[123]$/iu.test(data.foxholeKey)) {
        for (const sample of resolveCenteredMeshConfigIntervalBoundarySamples(path, raw.meshConfigs[2])) {
            append(sample, asset?.renderLayers.middlepillars, 'middle-pillar');
        }
    }
    if (isWaterWallSpline(data.foxholeKey)) {
        for (const sample of resolveWaterWallBuoys(
            { x: data.startX, y: data.startY }, { x: data.endX, y: data.endY }, raw.meshConfigs[1],
        )) {
            append(sample, sample.role === 'front' ? asset?.renderLayers.fronttrim : asset?.renderLayers.backtrim, 'buoy');
        }
    }
    if (isBarbedWireFence(data.foxholeKey)) {
        for (const sample of resolveBarbedWireFencePosts(path, raw.meshConfigs[2])) {
            append(sample, sample.bend ? asset?.renderLayers.backtrim : asset?.renderLayers.middlepillars, 'fence-post');
        }
    }
    return nodes;
}

function resolveVisualData(data: FoxholeSceneV2SplineConnectorData, asset?: FoxholeSceneV2AssetMetadata): FoxholeSceneV2SplineConnectorData {
    const key = data.foxholeKey.toLowerCase();
    const referenceRoad = ['dirtroad', 'gravelroad', 'greatmarchroad', 'packeddirtroad', 'snowdirtroad', 'snowgravelroad', 'snowpackeddirtroad'].includes(key);
    const { start, end } = foxholeSceneV2ConnectorEndpoints(data);
    const constraints = foxholeSceneV2ConnectorConstraints(data, asset);
    const behavior = resolveConnectorBehavior(data.foxholeKey, asset?.connector);
    const style = behavior.undergroundPipe ? 'spline' : asset?.connector?.pathStyle;
    const viable = behavior.undergroundPipe || ((!(style === 'spline' && behavior.pipeExtension) || isExtensionPipeGeometryViable(start, end, constraints))
        && isSplinePathViable(start, end, constraints, sampleFoxholeSceneV2Connector(data, asset),
            { enforceLengthLimits: false, enforceMinRadius: asset?.connector?.enforceSplineModeCornerRadius === true,
                socketFacingEndRotation: key.includes('pipe') && !behavior.undergroundPipe }));
    const blueprint = data.blueprint && asset?.canBlueprint === true;
    return { ...data, blueprint, ...(!referenceRoad && !viable ? { tint: SPLINE_PATH_INVALID_TINT } : blueprint ? { tint: 0x335CFF } : {}) };
}

function buildSplineTrim(
    id: string,
    visual: FoxholeSceneV2AssetMetadata['renderLayers'][string] | undefined,
    point: Point,
    tangent: Point,
    data: FoxholeSceneV2SplineConnectorData,
): NixieExtensionRenderSpriteV1 | null {
    if (!visual || visual.width <= 0 || visual.height <= 0) {
        return null;
    }
    const role = id.includes('-back-') ? 'back' : 'front';
    const behavior = resolveConnectorBehavior(data.foxholeKey);
    const anchor = id.endsWith('-ramp')
        ? { x: role === 'back' ? 1 : 0, y: visual.anchorY }
        : behavior.trimSpan
            ? { x: 0.5, y: 0.5 }
            : resolveTrimSocketAnchor(foxholeSceneV2GeometryLayer(visual), role);
    return {
        id,
        kind: 'sprite',
        ...foxholeRenderLane(FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE),
        resourceId: visual.resourceId,
        x: point.x,
        y: point.y,
        rotation: Math.atan2(tangent.y, tangent.x),
        anchorX: anchor.x,
        anchorY: anchor.y,
        scaleX: 0.5,
        scaleY: 0.5,
        alpha: 1,
        ...(data.tint === undefined && !data.blueprint
            ? {}
            : { tint: data.tint ?? 0x335CFF }),
        ...(data.blueprint
            ? { brightness: 2.15 }
            : data.brightness === undefined || data.brightness === 1
                ? {}
                : { brightness: clamp(data.brightness, 0, 4) }),
    };
}

export function renderFoxholeSceneV2SplineConnector(
    data: FoxholeSceneV2SplineConnectorData,
    asset?: FoxholeSceneV2AssetMetadata,
    destroyedAsset?: FoxholeSceneV2AssetMetadata,
): NixieExtensionRenderNodeV1[] {
    const destroyedTier = trenchConnectorTier(data.foxholeKey);
    if (destroyedTier && destroyedAsset) {
        const frames = Object.entries(destroyedAsset.renderLayers).map(([id, visual]) => ({
            ...foxholeSceneV2GeometryLayer(visual), id, textureUrl: visual.resourceId, offsetX: visual.offsetX * 2,
        }));
        const { start, end } = foxholeSceneV2ConnectorEndpoints(data);
        return destroyedTrenchConnectorPieces(destroyedTier, frames, start, end,
            Boolean(data.startAttachmentNodeId || (data.startSocketName && data.socketAttachments?.[data.startSocketName])),
            Boolean(data.endAttachmentNodeId || (data.endSocketName && data.socketAttachments?.[data.endSocketName])))
            .map(piece => ({
                id: `destroyed-trench-${piece.id}`, kind: 'mesh' as const,
                ...foxholeRenderLane(FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE),
                resourceId: piece.textureUrl, positions: piece.positions, uvs: piece.uvs,
                indices: Array.from({ length: piece.positions.length / 2 - 2 }, (_, i) => [0, i + 1, i + 2]).flat(),
                alpha: 1,
                ...(data.tint === undefined && !data.blueprint ? {} : { tint: data.tint ?? 0x335CFF }),
                ...(data.blueprint
                    ? { brightness: 2.15 }
                    : data.brightness === undefined || data.brightness === 1
                        ? {}
                        : { brightness: clamp(data.brightness, 0, 4) }),
            }));
    }
    const behavior = resolveConnectorBehavior(data.foxholeKey, asset?.connector);
    if (behavior.powerline) {
        const invalid = data.powerlineObstructed === true || isFoxholePowerlineOverLength(
            { x: data.startX, y: data.startY },
            { x: data.endX, y: data.endY },
            data.maxLength,
        );
        return [{ id: 'spline-connector-path', kind: 'graphics',
            ...foxholeRenderLane(resolveFoxholeConnectorRenderLane(data.foxholeKey, FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE)),
            commands: [{ op: 'move-to', x: data.startX, y: data.startY }, { op: 'line-to', x: data.endX, y: data.endY },
                { op: 'stroke', ...resolveFoxholePowerlineStroke(1, invalid) }] }];
    }
    data = resolveVisualData(data, asset);
    const controlPoints = resolveControlPoints(data, asset);
    const ribbon = buildSplineRibbon(data, asset);
    const underlay = asset?.renderLayers.underlay ? buildSplineRibbon(data, asset, asset.renderLayers.underlay, 'spline-connector-underlay') : null;
    const straight = ['straight-telescoping', 'endpoints-only'].includes(asset?.connector?.pathStyle ?? '');
    const chordAngle = Math.atan2(data.endY - data.startY, data.endX - data.startX);
    const startAngle = straight ? chordAngle : data.startRotation;
    const endAngle = straight ? chordAngle : data.endRotation + (data.foxholeKey.includes('pipe') && !behavior.undergroundPipe ? Math.PI : 0);
    const intervalMarkers = buildIntervalMarkers(data, asset);
    const barbedWire = /^wallsplinet[123]$/iu.test(data.foxholeKey) && asset?.renderLayers.barbedwire
        ? buildSplineRibbon(data, asset, asset.renderLayers.barbedwire, 'spline-connector-barbed-wire')
        : null;
    const netOverBuoys = isWaterWallSpline(data.foxholeKey);
    const backTrim = buildSplineTrim(
        'spline-connector-back-trim',
        behavior.renderEndCaps && !netOverBuoys ? asset?.renderLayers.backtrim ?? asset?.renderLayers.backswitch : undefined,
        controlPoints[0],
        { x: Math.cos(startAngle), y: Math.sin(startAngle) },
        data,
    );
    const frontTrim = buildSplineTrim(
        'spline-connector-front-trim',
        behavior.renderEndCaps && !netOverBuoys ? asset?.renderLayers.fronttrim ?? asset?.renderLayers.frontswitch : undefined,
        controlPoints[3],
        { x: Math.cos(endAngle), y: Math.sin(endAngle) },
        data,
    );
    const path: NixieExtensionRenderGraphicsV1 = {
        id: 'spline-connector-path',
        kind: 'graphics',
        ...foxholeRenderLane(FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE),
        commands: curveCommands(data, controlPoints, ribbon !== null),
    };
    const ramps = [
        buildSplineTrim('spline-connector-back-ramp', data.startAttachmentNodeId || (data.startSocketName && data.socketAttachments?.[data.startSocketName]) ? undefined : asset?.renderLayers.backramp, controlPoints[0], { x: Math.cos(startAngle), y: Math.sin(startAngle) }, data),
        buildSplineTrim('spline-connector-front-ramp', data.endAttachmentNodeId || (data.endSocketName && data.socketAttachments?.[data.endSocketName]) ? undefined : asset?.renderLayers.frontramp, controlPoints[3], { x: Math.cos(endAngle), y: Math.sin(endAngle) }, data),
    ].filter(node => node !== null);
    return [
        ...(!ribbon && !backTrim && !frontTrim && !intervalMarkers.length ? [path] : []),
        ...[underlay, netOverBuoys ? null : ribbon].filter(node => node !== null),
        ...intervalMarkers,
        ...(barbedWire ? [barbedWire] : []),
        ...ramps,
        ...[backTrim, frontTrim].filter(node => node !== null),
        ...(netOverBuoys && ribbon ? [ribbon] : []),
    ];
}
