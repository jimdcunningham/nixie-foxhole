import { Container, Graphics } from 'pixi.js';
import { resolveFoxholeConnectorEndpointSockets } from './connector.ts';
import { resolveFacilityPipeSideSocketPlacements } from './pipe-connector-path.ts';
import { resolveConnectorSocketSnapStemRotation, resolveConnectorEndpointVisualRotation, resolveConnectorAttachmentStatusVisualRotation } from './spline-connector.ts';
import type { FoxholeSplineConnectorState } from './spline-connector.ts';
import { createFoxholePipeSocketVisual, createFoxholePowerSocketVisual, resolveFoxholeSocketKind } from './structure-socket-visuals.ts';
import type { FoxholeSocketTagBitfield } from './structure-socket-snapping.ts';

export interface FoxholeSplineConnectorResolvedSocket {
    name: string;
    endpoint: 'start' | 'end' | 'side';
    componentType?: string;
    pipeType?: string | null;
    socketTags: FoxholeSocketTagBitfield[];
    localX: number;
    localY: number;
    rotationRadians: number;
}

export interface FoxholeSplineConnectorSocketOverlaySettings {
    showAllSockets: boolean;
    showPowerSockets: boolean;
    showPipeSockets: boolean;
    showSocketLabels: boolean;
}

export function resolveFoxholePointConnectorSockets(structure: Parameters<typeof resolveFoxholeConnectorEndpointSockets>[0],
    state: { points: readonly number[]; startSocketName?: string; endSocketName?: string; }): Array<Omit<FoxholeSplineConnectorResolvedSocket, 'endpoint'> & { endpoint: 'start' | 'end'; }> {
    const points = state.points;
    if (points.length < 4 || points.length % 2 !== 0 || points.some(value => !Number.isFinite(value))) {
        return [];
    }
    const endpoints = resolveFoxholeConnectorEndpointSockets(structure, state);
    return (['start', 'end'] as const).flatMap(role => {
        const socket = endpoints[role];
        if (!socket) {
            return [];
        }
        const index = role === 'start' ? 0 : points.length - 2;
        const neighbor = role === 'start' ? 2 : index - 2;
        const rotation = role === 'start'
            ? Math.atan2(points[neighbor + 1]! - points[index + 1]!, points[neighbor]! - points[index]!) + Math.PI
            : Math.atan2(points[index + 1]! - points[neighbor + 1]!, points[index]! - points[neighbor]!);
        return [{ name: socket.name, endpoint: role, componentType: socket.componentType, pipeType: socket.pipeType,
            socketTags: socket.socketTags, localX: points[index]!, localY: points[index + 1]!, rotationRadians: rotation }];
    });
}

export function resolveFoxholeSplineConnectorSockets(options: {
    structure: Parameters<typeof resolveFoxholeConnectorEndpointSockets>[0];
    state: Pick<FoxholeSplineConnectorState, 'start' | 'end' | 'startSocketName' | 'endSocketName' | 'foxholeKey'>;
    constraints: Parameters<typeof resolveFacilityPipeSideSocketPlacements>[2];
    pathStyle?: string;
    lateralOffset: number;
    visualRotations?: boolean;
}): FoxholeSplineConnectorResolvedSocket[] {
    const { state } = options;
    const endpoints = resolveFoxholeConnectorEndpointSockets(options.structure, state);
    const sockets: FoxholeSplineConnectorResolvedSocket[] = [];
    for (const role of ['start', 'end'] as const) {
        const socket = endpoints[role];
        if (!socket) {
            continue;
        }
        const endpoint = state[role];
        const rotation = options.visualRotations
            ? resolveConnectorEndpointVisualRotation(role, state.start, state.end, state.foxholeKey)
            : endpoint.rotation;
        sockets.push({ name: socket.name, endpoint: role, componentType: socket.componentType,
            pipeType: socket.pipeType, socketTags: socket.socketTags, localX: endpoint.x, localY: endpoint.y,
            rotationRadians: resolveConnectorSocketSnapStemRotation(role, rotation, 0, state.foxholeKey) });
    }
    const template = endpoints.start ?? endpoints.end;
    if (template) {
        for (const socket of resolveFacilityPipeSideSocketPlacements(state.start, state.end, options.constraints,
            options.pathStyle, state.foxholeKey, { lateralOffset: options.lateralOffset })) {
            sockets.push({ name: socket.name, endpoint: 'side', componentType: template.componentType,
                pipeType: template.pipeType, socketTags: template.socketTags, localX: socket.x, localY: socket.y,
                rotationRadians: socket.rotation });
        }
    }
    return sockets;
}

export function populateFoxholeSplineConnectorSocketOverlay(layer: Container, options: {
    sockets: readonly FoxholeSplineConnectorResolvedSocket[];
    settings: FoxholeSplineConnectorSocketOverlaySettings;
    foxholeKey: string;
    nodeRotation: number;
    isOccupied: (socket: FoxholeSplineConnectorResolvedSocket) => boolean;
    previewAlpha?: number;
}): void {
    layer.removeChildren().forEach(child => child.destroy({ children: true }));
    const { settings } = options;
    for (const socket of options.sockets) {
        const occupied = options.isOccupied(socket);
        if (settings.showAllSockets) {
            const visual = new Container();
            visual.label = `${socket.endpoint}:${socket.name}`;
            visual.eventMode = 'none';
            visual.position.set(socket.localX, socket.localY);
            visual.rotation = resolveConnectorAttachmentStatusVisualRotation(options.nodeRotation, options.foxholeKey);
            const graphics = new Graphics();
            graphics.eventMode = 'none';
            graphics.rect(-4.5, -4.5, 9, 9).fill({ color: occupied ? 0x53D769 : 0xFF4D4D, alpha: 0.95 })
                .stroke({ color: 0x081018, alpha: 0.95, width: 1 });
            visual.addChild(graphics);
            layer.addChild(visual);
            continue;
        }
        if (occupied) {
            continue;
        }
        const kind = resolveFoxholeSocketKind(socket);
        if ((kind !== 'power' || !settings.showPowerSockets) && (kind !== 'pipe' || !settings.showPipeSockets)) {
            continue;
        }
        const placement = { localX: socket.localX, localY: socket.localY, rotationRadians: socket.rotationRadians,
            ancestorRotationRadians: options.nodeRotation, label: settings.showSocketLabels ? socket.name : undefined };
        layer.addChild(kind === 'pipe' ? createFoxholePipeSocketVisual(placement, socket.pipeType) : createFoxholePowerSocketVisual(placement));
    }
    layer.visible = layer.children.length > 0;
    layer.alpha = layer.visible ? options.previewAlpha ?? 1 : 1;
}
