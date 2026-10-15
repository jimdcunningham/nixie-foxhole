import { Container, Graphics } from 'pixi.js';
import type { FoxholeManifestBuildSocket } from './manifest.ts';
import { resolveFoxholeBuildSocketPosition } from './structure-socket-resolution.ts';
import { normalizeFoxholeSocketTags } from './structure-socket-snapping.ts';
import type { FoxholeSocketTagBitfield } from './structure-socket-snapping.ts';
import { createFoxholeSocketLabel, resolveFoxholeSocketKindFromBuildSocket } from './structure-socket-visuals.ts';
import type { FoxholeStructureSocketKind } from './structure-socket-visuals.ts';
import { formatFoxholeComponentDebugLabel } from './structure-range-visual.ts';
import { resolveLegacyPlanSocketId } from '../legacy/plan-socket-id-map.ts';

export interface FoxholeResolvedStructureSocket {
    id: string;
    name?: string;
    kind: FoxholeStructureSocketKind;
    socketTags: FoxholeSocketTagBitfield[];
    localX: number;
    localY: number;
    rotationRadians: number;
    socket: FoxholeManifestBuildSocket;
}

export function resolveFoxholeStructureOverlaySockets(buildSockets: readonly FoxholeManifestBuildSocket[],
    origin: { x: number; y: number; }, nodeId: string): FoxholeResolvedStructureSocket[] {
    return buildSockets.flatMap((socket, index) => {
        const position = resolveFoxholeBuildSocketPosition(socket);
        return position
            ? [{ id: `${nodeId}:socket:${index}`, name: String(socket.name ?? '').trim() || undefined,
                kind: resolveFoxholeSocketKindFromBuildSocket(socket), socketTags: normalizeFoxholeSocketTags(socket.socketTags),
                localX: (position.x / 100 - origin.x) * 32, localY: (position.y / 100 - origin.y) * 32,
                rotationRadians: Number(socket.rotation ?? 0) * Math.PI / 180, socket }]
            : [];
    });
}

export function getFoxholeSocketDebugLabel(socket: FoxholeResolvedStructureSocket): string {
    const value = String(socket.name ?? '').trim() || String(socket.socket.componentType ?? '').trim();
    return value ? formatFoxholeComponentDebugLabel(value) : socket.kind;
}

export function getFoxholeSocketLabelPositionKey(socket: FoxholeResolvedStructureSocket): string {
    return `${socket.localX.toFixed(3)}:${socket.localY.toFixed(3)}`;
}

export function drawFoxholeSocketAttachmentDirectionTick(graphics: Graphics, socket: FoxholeResolvedStructureSocket): void {
    graphics.moveTo(0, 0).lineTo(Math.cos(socket.rotationRadians) * 4.5, Math.sin(socket.rotationRadians) * 4.5)
        .stroke({ color: 0xFFFFFF, alpha: 0.95, width: 2, cap: 'round' });
}

export function createFoxholeSocketAttachmentStatusVisual(socket: FoxholeResolvedStructureSocket, color: number): Container {
    const container = new Container();
    container.label = socket.id;
    container.eventMode = 'none';
    container.position.set(socket.localX, socket.localY);
    const graphics = new Graphics();
    graphics.eventMode = 'none';
    graphics.rect(-6, -6, 12, 12).fill({ color, alpha: 0.95 }).stroke({ color: 0x081018, alpha: 0.95, width: 2 });
    drawFoxholeSocketAttachmentDirectionTick(graphics, socket);
    container.addChild(graphics);
    return container;
}

export function createFoxholeAllSocketsLabel(sockets: readonly FoxholeResolvedStructureSocket[], foxholeKey: string,
    resolveStatusColor: (socket: FoxholeResolvedStructureSocket) => number): Container {
    const container = new Container();
    container.eventMode = 'none';
    const first = sockets[0];
    if (!first) {
        return container;
    }
    const offset = (sockets.length - 1) / 2;
    for (const [index, socket] of sockets.entries()) {
        const name = String(socket.name ?? '').trim();
        const display = name.replace(/FortSocket$/, '');
        const legacyId = name ? resolveLegacyPlanSocketId(foxholeKey, name) : null;
        const text = legacyId ? `${legacyId} — ${display}` : display || getFoxholeSocketDebugLabel(socket);
        const visual = createFoxholeSocketLabel(text, resolveStatusColor(socket), first.rotationRadians);
        visual.rotation = 0;
        visual.y += (index - offset) * 16;
        container.addChild(visual);
    }
    return container;
}
