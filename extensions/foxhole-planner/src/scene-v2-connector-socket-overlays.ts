import type { NixieExtensionRenderNodeV1, NixieExperimentalSpatialMarkerV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import type { FoxholeSceneV2SplineConnectorData } from './scene-v2-spline-connectors.ts';
import { resolveConnectorBehavior, requiresStraightConnectorSocketAlignment } from './connector-behavior.ts';
import { resolveFacilityPipeSideSocketsFromPath } from './connector-side-sockets.ts';
import { sampleFoxholeSceneV2Connector } from './scene-v2-connector-path.ts';
import { renderFoxholeSocketIndicatorGroups, resolveFoxholeSocketDisplayKind, resolveFoxholeSocketDisplayFlow, FOXHOLE_SOCKET_DISPLAY_SETTING_IDS,
    FOXHOLE_POWER_SOCKET_COLOR, FOXHOLE_PIPE_SOCKET_COLORS } from './scene-v2-socket-overlays.ts';
import { FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE, foxholeRenderLane } from './render-lanes.ts';

function normalizedAngle(value: number): number {
    let angle = value % (Math.PI * 2);
    if (angle > Math.PI) {
        angle -= Math.PI * 2;
    }
    if (angle < -Math.PI) {
        angle += Math.PI * 2;
    }
    return angle;
}

export function resolveFoxholeConnectorDisplaySockets(data: FoxholeSceneV2SplineConnectorData, asset: FoxholeSceneV2AssetMetadata) {
    const templates = asset.overlaySockets ?? [];
    const named = new Map<string, (typeof templates)[number]>();
    for (const socket of templates) {
        if (socket.name && !named.has(socket.name)) {
            named.set(socket.name, socket);
        }
    }
    const fallback = (preferred: string | undefined) => named.get(preferred ?? '') ?? templates.find(socket => resolveFoxholeSocketDisplayKind(socket) === 'power') ?? templates[0];
    const source = (role: 'start' | 'end') => {
        const name = (role === 'start' ? data.startSocketName : data.endSocketName)
            || (role === 'start' ? asset.connector?.backSocketName : asset.connector?.frontSocketName);
        return name ? { ...(named.get(name) ?? fallback(role === 'start' ? data.endSocketName : data.startSocketName)), name } : null;
    };
    const behavior = resolveConnectorBehavior(data.foxholeKey, asset.connector);
    const socketFacing = data.foxholeKey.toLowerCase().includes('pipe') && !behavior.undergroundPipe;
    const chord = Math.atan2(data.endY - data.startY, data.endX - data.startX);
    const resolved = (['start', 'end'] as const).flatMap(role => {
        const socket = source(role);
        if (!socket?.socketTags) {
            return [];
        }
        const storedRotation = role === 'start' ? data.startRotation : data.endRotation;
        const visual = behavior.powerline || requiresStraightConnectorSocketAlignment(data.foxholeKey)
            ? chord + (role === 'end' && socketFacing && !behavior.powerline ? Math.PI : 0)
            : storedRotation;
        const rotation = normalizedAngle(visual + (role === 'start' || socketFacing ? Math.PI : 0));
        return [{ socket, endpoint: role as 'start' | 'end' | 'side', kind: resolveFoxholeSocketDisplayKind(socket), flow: resolveFoxholeSocketDisplayFlow(socket),
            x: role === 'start' ? data.startX : data.endX, y: role === 'start' ? data.startY : data.endY, rotation }];
    });
    const template = source('start') ?? source('end');
    if (data.foxholeKey.toLowerCase() === 'facilitypipe' && template?.socketTags) {
        const span = asset.renderLayers.span ?? asset.renderLayers.underlay;
        const offset = Math.max(2, (span?.height ?? 8) * 0.5);
        resolved.push(...resolveFacilityPipeSideSocketsFromPath(sampleFoxholeSceneV2Connector(data, asset), offset).map(point => ({
            socket: { ...template, name: point.name }, endpoint: 'side' as const, kind: resolveFoxholeSocketDisplayKind(template), flow: resolveFoxholeSocketDisplayFlow(template),
            x: point.x, y: point.y, rotation: point.rotation,
        })));
    }
    return resolved;
}

function visibleConnectorSockets(data: FoxholeSceneV2SplineConnectorData, asset: FoxholeSceneV2AssetMetadata | undefined,
    attachments: unknown, settings: Readonly<Record<string, boolean>>) {
    if (!asset) {
        return [];
    }
    const occupied = new Set(Array.isArray(attachments)
        ? attachments.flatMap(value => value && typeof value === 'object' && !Array.isArray(value)
            && typeof value.localSocketName === 'string'
            ? [value.localSocketName]
            : [])
        : []);
    return resolveFoxholeConnectorDisplaySockets(data, asset).flatMap<ReturnType<typeof resolveFoxholeConnectorDisplaySockets>[number] & { kind: 'power' | 'pipe'; }>(entry => {
        if (occupied.has(entry.socket.name) || (entry.endpoint !== 'side' && typeof data[`${entry.endpoint}AttachmentNodeId`] === 'string'
            && typeof data[`${entry.endpoint}AttachmentSocketName`] === 'string')) {
            return [];
        }
        if (entry.kind === 'power' && settings[FOXHOLE_SOCKET_DISPLAY_SETTING_IDS[0]] === true) {
            return [{ ...entry, kind: 'power' as const }];
        }
        if (entry.kind === 'pipe' && settings[FOXHOLE_SOCKET_DISPLAY_SETTING_IDS[1]] === true) {
            return [{ ...entry, kind: 'pipe' as const }];
        }
        return [];
    });
}

export function renderFoxholeConnectorSpatialMarkers(data: FoxholeSceneV2SplineConnectorData & { startZ?: number; endZ?: number; },
    asset: FoxholeSceneV2AssetMetadata | undefined, attachments: unknown, settings: Readonly<Record<string, boolean>>): NixieExperimentalSpatialMarkerV1[] {
    return visibleConnectorSockets(data, asset, attachments, settings).slice(0, 128).map((entry, index) => ({
        id: `connector-socket-${index}`, point: [entry.x, entry.y, entry.endpoint === 'start' ? data.startZ ?? 0
            : entry.endpoint === 'end' ? data.endZ ?? 0 : ((data.startZ ?? 0) + (data.endZ ?? 0)) / 2],
        color: entry.kind === 'power' ? FOXHOLE_POWER_SOCKET_COLOR : FOXHOLE_PIPE_SOCKET_COLORS[entry.flow], label: entry.socket.name.slice(0, 128),
    }));
}

export function renderFoxholeConnectorSocketOverlays(data: FoxholeSceneV2SplineConnectorData, asset: FoxholeSceneV2AssetMetadata | undefined,
    attachments: unknown, settings: Readonly<Record<string, boolean>>): NixieExtensionRenderNodeV1[] {
    const sockets = visibleConnectorSockets(data, asset, attachments, settings);
    if (!sockets.length) {
        return [];
    }
    return [{ id: 'spline-connector-socket-overlays', kind: 'group', ...foxholeRenderLane(FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE),
        experimentalPresentation: { contractVersion: 1, excludeFromBounds: true },
        children: renderFoxholeSocketIndicatorGroups(sockets, settings[FOXHOLE_SOCKET_DISPLAY_SETTING_IDS[2]] === true, 'spline-socket', true) }];
}
