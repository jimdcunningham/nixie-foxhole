import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import type { FoxholeStructureCatalog } from '../nixie/catalog.ts';
import { resolveFoxholeEffectiveBuildSockets, resolveFoxholeBuildSocketPosition, normalizeFoxholeBuildSocketName } from '../nixie/structure-socket-resolution.ts';
import { resolveConnectorPathStyle, resolveConnectorSpanCrossHalfWidth } from '../nixie/pipe-connector-path.ts';
import { resolveFoxholeSplinePathConstraints } from '../nixie/spline-connector-guides.ts';
import { resolveFoxholeSplineConnectorSockets } from '../nixie/spline-connector-sockets.ts';
import { resolveFoxholeSplineConnectorRenderLayers } from '../nixie/spline-connector-upgrade-layers.ts';
import { normalizeAngleRadians } from '../nixie/structure-socket-snapping.ts';
import { FOXHOLE_BOARD_SPRITE_SCALE, FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE, resolveEffectiveConnectorPathStyle } from '../nixie/spline-connector.ts';
import type { FoxholeSplineConnectorState } from '../nixie/spline-connector.ts';
import type { FoxholeStructureState } from '../nixie/types.ts';
import type { LegacySocketAttachmentFinding, LegacySocketLink } from './plan-socket-mapper.ts';

type WorldSocket = { x: number; y: number; rotation: number; endpoint?: 'start' | 'end'; };
type PositionedNode = { snapshot: BoardNodeSnapshot; legacyId: number; };

const MAX_SOCKET_GAP_PX = 1;
const MAX_SOCKET_FACING_ERROR_RADIANS = 5 * Math.PI / 180;
const LARGE_STRUCTURE_AREA_PX2 = 50_000;
const RECONCILED_SPLINE_KEYS = new Set(['facilitypipe', 'facilitypipeunderground', 'facilitypipeoverhead', 'powerline']);

function isReconciledSpline(node: PositionedNode | undefined): boolean {
    return node?.snapshot.type === FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE
        && RECONCILED_SPLINE_KEYS.has((node.snapshot.state as FoxholeSplineConnectorState).foxholeKey);
}

function toWorld(state: { x: number; y: number; rotation: number; scaleX?: number; scaleY?: number; },
    local: { x: number; y: number; }): { x: number; y: number; } {
    const cos = Math.cos(state.rotation ?? 0);
    const sin = Math.sin(state.rotation ?? 0);
    const x = local.x * (state.scaleX ?? 1);
    const y = local.y * (state.scaleY ?? 1);
    return { x: state.x + x * cos - y * sin, y: state.y + x * sin + y * cos };
}

/** Resolve the same socket geometry the placed Nixie node will render. */
function resolveSocket(node: PositionedNode | undefined, socketName: string,
    catalog: FoxholeStructureCatalog): WorldSocket | null {
    if (!node) {
        return null;
    }
    const snapshot = node.snapshot;
    if (snapshot.type === FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE) {
        const state = snapshot.state as FoxholeSplineConnectorState;
        const structure = catalog.structureByKey[state.foxholeKey];
        if (!structure) {
            return null;
        }
        const asset = catalog.assetByKey[state.foxholeKey];
        const pathStyle = resolveEffectiveConnectorPathStyle(resolveConnectorPathStyle(structure.connector), state.foxholeKey);
        const layers = asset
            ? resolveFoxholeSplineConnectorRenderLayers({ asset, modificationVariantIds: state.modificationVariantIds })
            : [];
        const span = layers.find(layer => layer.id.toLowerCase() === 'span')
            ?? layers.find(layer => layer.id.toLowerCase() === 'underlay');
        const socket = resolveFoxholeSplineConnectorSockets({
            structure,
            state,
            pathStyle,
            constraints: resolveFoxholeSplinePathConstraints(state, pathStyle,
                structure.connector?.maxBufferCm ?? structure.connector?.minLengthCm ?? 0),
            lateralOffset: resolveConnectorSpanCrossHalfWidth(span, FOXHOLE_BOARD_SPRITE_SCALE),
        }).find(candidate => candidate.name === socketName);
        if (!socket) {
            return null;
        }
        return { ...toWorld(state, { x: socket.localX, y: socket.localY }),
            rotation: normalizeAngleRadians((state.rotation ?? 0) + socket.rotationRadians),
            ...(socket.endpoint === 'start' || socket.endpoint === 'end' ? { endpoint: socket.endpoint } : {}) };
    }

    const state = snapshot.state as FoxholeStructureState;
    const structure = catalog.structureByKey[state.foxholeKey];
    if (!structure) {
        return null;
    }
    const variants = Object.entries(state.modificationVariantIds ?? {}).flatMap(([slotName, variantId]) => {
        const variant = structure.modificationSlots?.find(slot => slot.name === slotName)?.variants?.[variantId];
        return variant ? [variant] : [];
    });
    const socket = resolveFoxholeEffectiveBuildSockets(structure.buildSockets, variants, structure.railCouplers)
        .find(candidate => normalizeFoxholeBuildSocketName(candidate.name) === socketName);
    const position = socket && resolveFoxholeBuildSocketPosition(socket);
    if (!position) {
        return null;
    }
    return { ...toWorld(state, { x: position.x * 0.32, y: position.y * 0.32 }),
        rotation: normalizeAngleRadians((state.rotation ?? 0) + Number(socket.rotation ?? 0) * Math.PI / 180) };
}

function moveSplineEndpoint(node: PositionedNode, endpoint: 'start' | 'end',
    from: WorldSocket, target: WorldSocket): void {
    const state = node.snapshot.state as FoxholeSplineConnectorState;
    const cos = Math.cos(state.rotation ?? 0);
    const sin = Math.sin(state.rotation ?? 0);
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    state[endpoint] = {
        ...state[endpoint],
        x: state[endpoint].x + (dx * cos + dy * sin) / (state.scaleX ?? 1),
        y: state[endpoint].y + (-dx * sin + dy * cos) / (state.scaleY ?? 1),
        rotation: normalizeAngleRadians(state[endpoint].rotation + normalizeAngleRadians(target.rotation - from.rotation - Math.PI)),
    };
}

function moveStructureSocket(node: PositionedNode, from: WorldSocket, target: WorldSocket): void {
    const state = node.snapshot.state as FoxholeStructureState;
    const rotationDelta = normalizeAngleRadians(target.rotation - from.rotation - Math.PI);
    const cos = Math.cos(rotationDelta);
    const sin = Math.sin(rotationDelta);
    const offsetX = from.x - state.x;
    const offsetY = from.y - state.y;
    state.rotation = normalizeAngleRadians(state.rotation + rotationDelta);
    state.x += target.x - (state.x + offsetX * cos - offsetY * sin);
    state.y += target.y - (state.y + offsetX * sin + offsetY * cos);
}

function disconnect(node: PositionedNode | undefined, socketName: string): void {
    if (!node) {
        return;
    }
    const state = node.snapshot.state as FoxholeSplineConnectorState & FoxholeStructureState;
    if (state.socketAttachments) {
        state.socketAttachments = Object.fromEntries(
            Object.entries(state.socketAttachments).filter(([name]) => name !== socketName),
        );
    }
    if (node.snapshot.type === FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE) {
        if (state.startSocketName === socketName) {
            state.startAttachment = undefined;
        }
        if (state.endSocketName === socketName) {
            state.endAttachment = undefined;
        }
    }
}

function structureArea(node: PositionedNode, catalog: FoxholeStructureCatalog): number {
    if (node.snapshot.type === FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE) {
        return 0;
    }
    const key = (node.snapshot.state as FoxholeStructureState).foxholeKey;
    const sprite = catalog.structureByKey[key]?.sprite;
    return Math.max(0, Number(sprite?.width ?? 0) * Number(sprite?.height ?? 0));
}

function chooseNetworkAnchors(nodes: Map<number, PositionedNode>, links: readonly LegacySocketLink[],
    catalog: FoxholeStructureCatalog, movableStructures: ReadonlySet<number>): { structures: Set<number>; splines: Set<number>; } {
    const neighbors = new Map<number, Set<number>>();
    for (const link of links) {
        if (!nodes.has(link.fromLegacyId) || !nodes.has(link.toLegacyId)) {
            continue;
        }
        if (!neighbors.has(link.fromLegacyId)) {
            neighbors.set(link.fromLegacyId, new Set());
        }
        if (!neighbors.has(link.toLegacyId)) {
            neighbors.set(link.toLegacyId, new Set());
        }
        neighbors.get(link.fromLegacyId)!.add(link.toLegacyId);
        neighbors.get(link.toLegacyId)!.add(link.fromLegacyId);
    }
    const structures = new Set<number>();
    const splines = new Set<number>();
    const visited = new Set<number>();
    for (const startId of neighbors.keys()) {
        if (visited.has(startId)) {
            continue;
        }
        const component: number[] = [];
        const queue = [startId];
        visited.add(startId);
        for (let index = 0; index < queue.length; index += 1) {
            const id = queue[index]!;
            component.push(id);
            for (const neighbor of neighbors.get(id) ?? []) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push(neighbor);
                }
            }
        }
        const rigid = component.filter(id => structureArea(nodes.get(id)!, catalog) > 0)
            .sort((a, b) => structureArea(nodes.get(b)!, catalog) - structureArea(nodes.get(a)!, catalog) || a - b);
        const large = rigid.filter(id => structureArea(nodes.get(id)!, catalog) >= LARGE_STRUCTURE_AREA_PX2);
        if (large.length > 0) {
            rigid.filter(id => large.includes(id) || !movableStructures.has(id)).forEach(id => structures.add(id));
        } else if (rigid.length > 0) {
            const fixed = rigid.filter(id => !movableStructures.has(id));
            (fixed.length ? fixed : rigid.slice(0, 1)).forEach(id => structures.add(id));
        } else {
            splines.add(component.reduce((lowest, id) => Math.min(lowest, id), Infinity));
        }
    }
    return { structures, splines };
}

function collectReconciliationLinks(nodes: Map<number, PositionedNode>, allLinks: readonly LegacySocketLink[],
    catalog: FoxholeStructureCatalog): { links: LegacySocketLink[]; movableStructures: Set<number>; } {
    const links = allLinks.filter(link => isReconciledSpline(nodes.get(link.fromLegacyId))
        || isReconciledSpline(nodes.get(link.toLegacyId)));
    const movableStructures = new Set<number>();
    for (const link of links) {
        const fromNode = nodes.get(link.fromLegacyId);
        const toNode = nodes.get(link.toLegacyId);
        const fromSocket = isReconciledSpline(fromNode) ? resolveSocket(fromNode, link.fromSocketName, catalog) : null;
        const toSocket = isReconciledSpline(toNode) ? resolveSocket(toNode, link.toSocketName, catalog) : null;
        if (fromSocket && !fromSocket.endpoint && toNode?.snapshot.type !== FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE
            && structureArea(toNode, catalog) < LARGE_STRUCTURE_AREA_PX2) {
            movableStructures.add(link.toLegacyId);
        }
        if (toSocket && !toSocket.endpoint && fromNode?.snapshot.type !== FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE
            && structureArea(fromNode, catalog) < LARGE_STRUCTURE_AREA_PX2) {
            movableStructures.add(link.fromLegacyId);
        }
    }

    // Follow structural attachments outward from a displaced side attachment,
    // stopping at large structures instead of dragging whole facilities along.
    const included = new Set(links);
    const structuralLinks = new Map<number, LegacySocketLink[]>();
    for (const link of allLinks) {
        const fromNode = nodes.get(link.fromLegacyId);
        const toNode = nodes.get(link.toLegacyId);
        if (!fromNode || !toNode || fromNode.snapshot.type === FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE
            || toNode.snapshot.type === FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE) {
            continue;
        }
        for (const id of [link.fromLegacyId, link.toLegacyId]) {
            const entries = structuralLinks.get(id) ?? [];
            entries.push(link);
            structuralLinks.set(id, entries);
        }
    }
    const queue = [...movableStructures];
    for (let index = 0; index < queue.length; index += 1) {
        for (const link of structuralLinks.get(queue[index]!) ?? []) {
            if (included.has(link)) {
                continue;
            }
            links.push(link);
            included.add(link);
            const otherId = link.fromLegacyId === queue[index] ? link.toLegacyId : link.fromLegacyId;
            if (!movableStructures.has(otherId) && structureArea(nodes.get(otherId)!, catalog) < LARGE_STRUCTURE_AREA_PX2) {
                movableStructures.add(otherId);
                queue.push(otherId);
            }
        }
    }
    return { links, movableStructures };
}

/** Reconcile imported links once, before the snapshots are inserted into a scene. */
export function reconcileLegacyPlanConnectionPositions(options: {
    snapshots: BoardNodeSnapshot[];
    links: readonly LegacySocketLink[];
    catalog: FoxholeStructureCatalog;
}): LegacySocketAttachmentFinding[] {
    const nodes = new Map(options.snapshots.flatMap(snapshot => {
        const match = /^legacy-(\d+)$/.exec(snapshot.id);
        return match ? [[Number(match[1]), { snapshot, legacyId: Number(match[1]) } as PositionedNode] as const] : [];
    }));
    const { links, movableStructures } = collectReconciliationLinks(nodes, options.links, options.catalog);
    const gap = (a: WorldSocket, b: WorldSocket) => Math.hypot(a.x - b.x, a.y - b.y);
    const anchors = chooseNetworkAnchors(nodes, links, options.catalog, movableStructures);
    const hardEndpoints = new Set<string>();
    const endpointKey = (id: number, role: 'start' | 'end') => `${id}:${role}`;

    // Each round grows outward from large structures. Resolve endpoints on
    // settled structures first, then connected spline endpoints, then the
    // smaller structures and branches attached at spline midpoints.
    // Bound work for malformed or contradictory networks; unresolved links are
    // disconnected below instead of making a large import loop indefinitely.
    for (let pass = 0; pass < Math.min(64, Math.max(1, links.length * 2)); pass += 1) {
        let changed = false;
        for (const phase of ['structure-endpoint', 'endpoint-endpoint', 'side-structure', 'side-endpoint', 'structure-structure'] as const) {
            for (const link of links) {
                const fromNode = nodes.get(link.fromLegacyId);
                const toNode = nodes.get(link.toLegacyId);
                const from = resolveSocket(fromNode, link.fromSocketName, options.catalog);
                const to = resolveSocket(toNode, link.toSocketName, options.catalog);
                if (!fromNode || !toNode || !from || !to) {
                    continue;
                }
                const fromSpline = fromNode.snapshot.type === FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE;
                const toSpline = toNode.snapshot.type === FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE;
                let move: { node: PositionedNode; endpoint?: 'start' | 'end'; from: WorldSocket; target: WorldSocket; } | null = null;
                if (phase === 'structure-endpoint') {
                    if (from.endpoint && !toSpline && anchors.structures.has(link.toLegacyId)) {
                        move = { node: fromNode, endpoint: from.endpoint, from, target: to };
                        anchors.splines.add(link.fromLegacyId);
                        hardEndpoints.add(endpointKey(link.fromLegacyId, from.endpoint));
                    } else if (to.endpoint && !fromSpline && anchors.structures.has(link.fromLegacyId)) {
                        move = { node: toNode, endpoint: to.endpoint, from: to, target: from };
                        anchors.splines.add(link.toLegacyId);
                        hardEndpoints.add(endpointKey(link.toLegacyId, to.endpoint));
                    }
                } else if (phase === 'endpoint-endpoint' && from.endpoint && to.endpoint) {
                    const fromHard = hardEndpoints.has(endpointKey(link.fromLegacyId, from.endpoint));
                    const toHard = hardEndpoints.has(endpointKey(link.toLegacyId, to.endpoint));
                    if (fromHard && !toHard) {
                        move = { node: toNode, endpoint: to.endpoint, from: to, target: from };
                        anchors.splines.add(link.toLegacyId);
                    } else if (toHard && !fromHard) {
                        move = { node: fromNode, endpoint: from.endpoint, from, target: to };
                        anchors.splines.add(link.fromLegacyId);
                    } else if (!fromHard && !toHard && anchors.splines.has(link.fromLegacyId)) {
                        move = { node: toNode, endpoint: to.endpoint, from: to, target: from };
                        anchors.splines.add(link.toLegacyId);
                    } else if (!fromHard && !toHard && anchors.splines.has(link.toLegacyId)) {
                        move = { node: fromNode, endpoint: from.endpoint, from, target: to };
                        anchors.splines.add(link.fromLegacyId);
                    }
                } else if (phase === 'side-structure') {
                    if (fromSpline && !from.endpoint && !toSpline && anchors.splines.has(link.fromLegacyId)
                        && !anchors.structures.has(link.toLegacyId)) {
                        move = { node: toNode, from: to, target: from };
                        anchors.structures.add(link.toLegacyId);
                    } else if (toSpline && !to.endpoint && !fromSpline && anchors.splines.has(link.toLegacyId)
                        && !anchors.structures.has(link.fromLegacyId)) {
                        move = { node: fromNode, from, target: to };
                        anchors.structures.add(link.fromLegacyId);
                    }
                } else if (phase === 'side-endpoint') {
                    if (fromSpline && !from.endpoint && to.endpoint && anchors.splines.has(link.fromLegacyId)
                        && !hardEndpoints.has(endpointKey(link.toLegacyId, to.endpoint))) {
                        move = { node: toNode, endpoint: to.endpoint, from: to, target: from };
                        anchors.splines.add(link.toLegacyId);
                    } else if (toSpline && !to.endpoint && from.endpoint && anchors.splines.has(link.toLegacyId)
                        && !hardEndpoints.has(endpointKey(link.fromLegacyId, from.endpoint))) {
                        move = { node: fromNode, endpoint: from.endpoint, from, target: to };
                        anchors.splines.add(link.fromLegacyId);
                    }
                } else if (phase === 'structure-structure' && !fromSpline && !toSpline) {
                    if (anchors.structures.has(link.fromLegacyId) && !anchors.structures.has(link.toLegacyId)) {
                        move = { node: toNode, from: to, target: from };
                        anchors.structures.add(link.toLegacyId);
                    } else if (anchors.structures.has(link.toLegacyId) && !anchors.structures.has(link.fromLegacyId)) {
                        move = { node: fromNode, from, target: to };
                        anchors.structures.add(link.fromLegacyId);
                    }
                }
                if (!move) {
                    continue;
                }
                const rotationDelta = normalizeAngleRadians(move.target.rotation - move.from.rotation - Math.PI);
                if (gap(move.from, move.target) > MAX_SOCKET_GAP_PX
                    || Math.abs(rotationDelta) > 1e-4) {
                    if (move.endpoint) {
                        moveSplineEndpoint(move.node, move.endpoint, move.from, move.target);
                    } else {
                        moveStructureSocket(move.node, move.from, move.target);
                    }
                    changed = true;
                }
            }
        }
        if (!changed) {
            break;
        }
    }

    const findings: LegacySocketAttachmentFinding[] = [];
    for (const link of links) {
        const fromNode = nodes.get(link.fromLegacyId);
        const toNode = nodes.get(link.toLegacyId);
        const from = resolveSocket(fromNode, link.fromSocketName, options.catalog);
        const to = resolveSocket(toNode, link.toSocketName, options.catalog);
        if (from && to && gap(from, to) <= MAX_SOCKET_GAP_PX
            && Math.abs(normalizeAngleRadians(from.rotation - to.rotation - Math.PI)) <= MAX_SOCKET_FACING_ERROR_RADIANS) {
            continue;
        }
        disconnect(fromNode, link.fromSocketName);
        disconnect(toNode, link.toSocketName);
        findings.push({ entityId: link.fromLegacyId,
            foxholeKey: String((fromNode?.snapshot.state as FoxholeStructureState | undefined)?.foxholeKey ?? ''),
            legacySocketId: link.fromSocketName,
            peerEntityId: String(link.toLegacyId), peerSocketId: link.toSocketName,
            reason: 'misaligned_after_import' });
    }
    return findings;
}
