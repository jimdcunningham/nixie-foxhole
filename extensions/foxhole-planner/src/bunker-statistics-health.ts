import { isFoxholeBunkerSocketUnbreachable, isFoxholeBreachIndicatorSocket } from './breach-indicators.ts';
import { deduplicateFoxholeBuildSockets, normalizeFoxholeBuildSocketName } from './bunker-statistics-sockets.ts';
import type { FoxholeBunkerStatisticsSocket as FoxholeManifestBuildSocket, FoxholeBunkerStatisticsAttachmentMap as FoxholeStructureSocketAttachmentMap } from './bunker-statistics-sockets.ts';

export type FoxholeBunkerStructuralIntegrityClass = 'high' | 'medium' | 'low' | 'critical';

export interface FoxholeBunkerHealthPiece {
    nodeId: string;
    maxHealth?: number | null;
    repairCost?: number | null;
    structuralIntegrity?: number | null;
    breachable?: boolean | null;
    structuralGarrison?: boolean | null;
    buildSockets?: readonly FoxholeManifestBuildSocket[];
    socketAttachments?: FoxholeStructureSocketAttachmentMap;
}

export interface FoxholeBunkerSocketBreachCounts {
    unbreachableSockets: number;
    breachableSockets: number;
}

export interface FoxholeBunkerHealthSummary {
    pieceCount: number;
    rawMaxHealth: number;
    repairCost: number;
    /** Product of piece SI before compactness bonus. */
    structuralIntegrityProduct: number;
    structuralIntegrity: number;
    structuralIntegrityClass: FoxholeBunkerStructuralIntegrityClass;
    effectiveHealth: number;
    breachableHealth: number;
    breachableHealthPercent: number;
    structuralIntegrityPercent: number;
    repairRate: number;
    socketCounts: FoxholeBunkerSocketBreachCounts;
    usedCompactnessBonus: boolean;
}

function coerceNonNegative(value: number | null | undefined): number {
    const normalized = Number(value ?? NaN);
    return Number.isFinite(normalized) && normalized >= 0 ? normalized : 0;
}

/** Missing SI is treated as 1.0 (FoxWatch strips SI === 1). */
export function resolveFoxholePieceStructuralIntegrity(value: number | null | undefined): number {
    const normalized = Number(value ?? NaN);
    if (!Number.isFinite(normalized) || normalized <= 0) {
        return 1;
    }

    return normalized;
}

export function resolveFoxholeBunkerStructuralIntegrityClass(
    structuralIntegrity: number,
): FoxholeBunkerStructuralIntegrityClass {
    if (structuralIntegrity >= 0.75) {
        return 'high';
    }

    if (structuralIntegrity >= 0.5) {
        return 'medium';
    }

    if (structuralIntegrity >= 0.25) {
        return 'low';
    }

    return 'critical';
}

function resolveSocketAttachment(
    attachments: FoxholeStructureSocketAttachmentMap,
    socketName: string,
): FoxholeStructureSocketAttachmentMap[string] | null {
    const normalized = String(socketName ?? '').trim();
    if (!normalized) {
        return null;
    }

    if (attachments[normalized]) {
        return attachments[normalized]!;
    }

    const shortName = normalized.includes(':')
        ? normalized.slice(normalized.lastIndexOf(':') + 1).trim()
        : normalized;
    if (shortName && attachments[shortName]) {
        return attachments[shortName]!;
    }

    for (const [key, attachment] of Object.entries(attachments)) {
        if (key === shortName || key.endsWith(`:${shortName}`) || shortName.endsWith(`:${key}`)) {
            return attachment;
        }
    }

    return null;
}

/** Resolve an attachment for a socket name, including FortCommon:Name ↔ Name aliases. */
export function resolveFoxholeStructureSocketAttachment(
    attachments: FoxholeStructureSocketAttachmentMap | null | undefined,
    socketName: string,
): FoxholeStructureSocketAttachmentMap[string] | null {
    return resolveSocketAttachment(attachments ?? {}, socketName);
}

/**
 * Classify one connected fort face for the SI socket bonus.
 * Safe (unbreachable) when exactly one connection to another breachable piece and
 * structuralGarrison flags do not both match as same-garrison faces.
 */
/**
 * Compactness is based on unique bunker edges, not only wall meshes that can
 * visually breach. Directional fort sockets model exterior edges even when a
 * piece has no breachable wall or compatible connection on that side.
 */
export function isFoxholeBunkerIntegrityEdgeSocket(
    structure: {
        breachable?: boolean | null;
        isDestroyed?: boolean | null;
        isBreached?: boolean | null;
    },
    socket: Pick<FoxholeManifestBuildSocket, 'name' | 'socketTags' | 'integrityBonus' | 'breachFace'>,
): boolean {
    if (isFoxholeBreachIndicatorSocket(structure, socket)) {
        return true;
    }

    if (
        structure.breachable !== true
        || structure.isDestroyed === true
        || structure.isBreached === true
        || socket.integrityBonus === false
    ) {
        return false;
    }

    const socketName = normalizeFoxholeBuildSocketName(socket.name).toLowerCase();
    return [
        'anglefortsocket',
        'backfortsocket',
        'frontfortsocket',
        'leftfortsocket',
        'rightfortsocket',
    ].includes(socketName);
}

/**
 * Count breachable vs unbreachable fort sockets across union members.
 * Empty wall faces count as breachable (legacy). Each undirected sealed connection
 * is counted once. FoxWatch-authored physical breach faces and contributing
 * directional fort edges are included.
 */
export function countFoxholeBunkerSocketBreaches(
    pieces: readonly FoxholeBunkerHealthPiece[],
): FoxholeBunkerSocketBreachCounts {
    const piecesById = new Map(
        pieces.map(piece => [String(piece.nodeId ?? '').trim(), piece] as const)
            .filter(([nodeId]) => Boolean(nodeId)),
    );

    let unbreachableSockets = 0;
    let breachableSockets = 0;
    const checkedPairs = new Set<string>();

    for (const piece of piecesById.values()) {
        if (piece.breachable !== true) {
            continue;
        }

        const attachments = piece.socketAttachments ?? {};
        const buildSockets = deduplicateFoxholeBuildSockets(piece.buildSockets);

        for (const localSocket of buildSockets) {
            if (!isFoxholeBunkerIntegrityEdgeSocket(piece, localSocket)) {
                continue;
            }

            const localSocketName = String(localSocket.name ?? '').trim();
            const attachment = resolveSocketAttachment(attachments, localSocketName);
            if (!attachment) {
                breachableSockets += 1;
                continue;
            }

            const neighborId = String(attachment.nodeId ?? '').trim();
            const neighbor = piecesById.get(neighborId);
            if (!neighbor || neighbor.breachable !== true) {
                breachableSockets += 1;
                continue;
            }

            const reciprocalSocketName = String(attachment.socketName ?? '').trim();
            const pairKey = `${[piece.nodeId, neighborId].map(String).sort().join('::')
            }::${[localSocketName, reciprocalSocketName].map(normalizeFoxholeBuildSocketName).sort().join('|')}`;
            if (checkedPairs.has(pairKey)) {
                continue;
            }

            checkedPairs.add(pairKey);

            const unbreachable = isFoxholeBunkerSocketUnbreachable({
                selfBreachable: piece.breachable === true,
                selfStructuralGarrison: piece.structuralGarrison === true,
                neighborBreachable: neighbor.breachable === true,
                neighborStructuralGarrison: neighbor.structuralGarrison === true,
                connectionCount: 1,
            });

            if (unbreachable) {
                unbreachableSockets += 1;
            } else {
                breachableSockets += 1;
            }
        }
    }

    return { unbreachableSockets, breachableSockets };
}

export function applyFoxholeBunkerCompactnessBonus(
    structuralIntegrityProduct: number,
    socketCounts: FoxholeBunkerSocketBreachCounts,
): number {
    const totalSockets = socketCounts.unbreachableSockets + socketCounts.breachableSockets;
    if (!(totalSockets > 0)) {
        return Math.min(1, structuralIntegrityProduct);
    }

    const breachableBonus = (socketCounts.unbreachableSockets / totalSockets) * 0.15;
    const cappedBonus = Math.max(0, Math.min(breachableBonus, 1 - structuralIntegrityProduct));
    return Math.min(1, structuralIntegrityProduct + cappedBonus);
}

export function buildFoxholeBunkerHealthSummary(
    pieces: readonly FoxholeBunkerHealthPiece[],
    options?: {
        /** When false, skip socket bonus even if breach fields exist. Default true. */
        applyCompactnessBonus?: boolean;
    },
): FoxholeBunkerHealthSummary | null {
    const normalizedPieces = pieces.filter(piece => String(piece.nodeId ?? '').trim());
    if (normalizedPieces.length === 0) {
        return null;
    }

    let rawMaxHealth = 0;
    let repairCost = 0;
    let structuralIntegrityProduct = 1;

    for (const piece of normalizedPieces) {
        rawMaxHealth += coerceNonNegative(piece.maxHealth);
        repairCost += coerceNonNegative(piece.repairCost);
        structuralIntegrityProduct *= resolveFoxholePieceStructuralIntegrity(piece.structuralIntegrity);
    }

    if (!(rawMaxHealth > 0)) {
        return null;
    }

    const pieceCount = normalizedPieces.length;
    const hasBreachMetadata = normalizedPieces.some(piece => piece.breachable === true);
    const socketCounts = hasBreachMetadata
        ? countFoxholeBunkerSocketBreaches(normalizedPieces)
        : { unbreachableSockets: 0, breachableSockets: 0 };

    const applyBonus = options?.applyCompactnessBonus !== false
        && pieceCount > 1
        && hasBreachMetadata;

    let structuralIntegrity = pieceCount === 1
        ? 1
        : Math.min(1, structuralIntegrityProduct);

    if (applyBonus) {
        structuralIntegrity = applyFoxholeBunkerCompactnessBonus(structuralIntegrityProduct, socketCounts);
    }

    const effectiveHealth = Math.floor(rawMaxHealth * structuralIntegrity);
    const breachableHealth = Math.floor(effectiveHealth * (1 - structuralIntegrity));
    const repairRate = repairCost > 0 ? effectiveHealth / repairCost : 0;

    return {
        pieceCount,
        rawMaxHealth,
        repairCost,
        structuralIntegrityProduct: pieceCount === 1 ? 1 : structuralIntegrityProduct,
        structuralIntegrity,
        structuralIntegrityClass: resolveFoxholeBunkerStructuralIntegrityClass(structuralIntegrity),
        effectiveHealth,
        breachableHealth,
        breachableHealthPercent: Math.floor((1 - structuralIntegrity) * 100),
        structuralIntegrityPercent: Math.floor(structuralIntegrity * 100),
        repairRate,
        socketCounts,
        usedCompactnessBonus: applyBonus,
    };
}
