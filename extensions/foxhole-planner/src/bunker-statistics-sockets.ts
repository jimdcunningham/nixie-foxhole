export interface FoxholeBunkerStatisticsSocket {
    name: string; x?: number | null; y?: number | null; z?: number | null; rotation?: number | null;
    componentType?: string | null; pipeType?: string | null; integrityBonus?: boolean | null; breachFace?: boolean | null;
    socketTags: Array<{ mask: number; category: number; tag?: string; }>;
}
export type FoxholeBunkerStatisticsAttachmentMap = Record<string, { nodeId: string; socketName: string; }>;
type FoxholeManifestBuildSocket = FoxholeBunkerStatisticsSocket;

export interface FoxholeResolvedBuildSocketPosition {
    x: number;
    y: number;
}

export function resolveFoxholeBuildSocketPosition(
    socket: Pick<FoxholeManifestBuildSocket, 'x' | 'y'>,
): FoxholeResolvedBuildSocketPosition | null {
    const hasX = socket.x !== undefined && socket.x !== null;
    const hasY = socket.y !== undefined && socket.y !== null;
    const x = Number(hasX ? socket.x : 0);
    const y = Number(hasY ? socket.y : 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
    }

    return { x, y };
}

export function normalizeFoxholeBuildSocketName(name: unknown): string {
    let normalized = String(name ?? '').trim();
    if (!normalized) {
        return '';
    }

    normalized = normalized.replace(/_GEN_VARIABLE$/i, '');
    return normalized.includes(':')
        ? normalized.slice(normalized.lastIndexOf(':') + 1).trim()
        : normalized;
}

function scoreBuildSocketCandidate(socket: FoxholeManifestBuildSocket): number {
    let score = 0;
    const name = String(socket.name ?? '').trim();
    if (!/_GEN_VARIABLE$/i.test(name)) {
        score += 8;
    }

    if (!name.includes(':')) {
        score += 8;
    }

    if (Array.isArray(socket.socketTags) && socket.socketTags.length > 0) {
        score += 4;
    }

    if (String(socket.pipeType ?? '').trim()) {
        score += 2;
    }

    if (String(socket.componentType ?? '').includes('BuildSocketComponent')) {
        score += 1;
    }

    return score;
}

function isSpuriousConnectorSideSocket(socket: FoxholeManifestBuildSocket): boolean {
    const name = String(socket.name ?? '').trim();
    if (name !== 'LeftSocket' && name !== 'RightSocket') {
        return false;
    }

    const position = resolveFoxholeBuildSocketPosition(socket);
    const x = Number(position?.x ?? 0);
    const y = Number(position?.y ?? 0);
    if (Math.abs(y) > 5000 || Math.abs(x) > 5000) {
        return true;
    }

    const hasTags = Array.isArray(socket.socketTags) && socket.socketTags.length > 0;
    if (hasTags || String(socket.pipeType ?? '').trim()) {
        return false;
    }

    return Math.abs(x) < 0.01 && Math.abs(y) < 0.01;
}

function isLandscapeCheckSocket(socket: FoxholeManifestBuildSocket): boolean {
    return /^LandscapeCheck(?:Socket)?\d*$/i.test(String(socket.name ?? '').trim());
}

function areNearDuplicateBuildSockets(
    left: FoxholeManifestBuildSocket,
    right: FoxholeManifestBuildSocket,
): boolean {
    if (normalizeFoxholeBuildSocketName(left.name).toLowerCase() !== normalizeFoxholeBuildSocketName(right.name).toLowerCase()) {
        return false;
    }

    const leftNearOrigin = isNearOriginBuildSocket(left);
    const rightNearOrigin = isNearOriginBuildSocket(right);

    // Blueprints can leak "same socket, default transform" duplicates from CDO scope.
    // When we see an origin socket with no tags/pipe data, collapse it into the
    // positioned socket (even if far outside the < 1 unit tolerance).
    if (leftNearOrigin !== rightNearOrigin) {
        const originSocket = leftNearOrigin ? left : right;
        const originIsPlain = originSocket.socketTags.length === 0
            && !String(originSocket.pipeType ?? '').trim();

        return originIsPlain;
    }

    const leftPosition = resolveFoxholeBuildSocketPosition(left);
    const rightPosition = resolveFoxholeBuildSocketPosition(right);
    const leftX = Number(leftPosition?.x ?? 0);
    const leftY = Number(leftPosition?.y ?? 0);
    const rightX = Number(rightPosition?.x ?? 0);
    const rightY = Number(rightPosition?.y ?? 0);
    const leftZ = Number(left.z ?? 0);
    const rightZ = Number(right.z ?? 0);

    return Math.abs(leftX - rightX) < 1
        && Math.abs(leftY - rightY) < 1
        && Math.abs(leftZ - rightZ) < 1;
}

export function deduplicateFoxholeBuildSockets(
    buildSockets: readonly FoxholeManifestBuildSocket[] | null | undefined,
): FoxholeManifestBuildSocket[] {
    const filtered = (buildSockets ?? []).filter(socket => !isLandscapeCheckSocket(socket) && !isSpuriousConnectorSideSocket(socket));
    const collapsed: FoxholeManifestBuildSocket[] = [];

    for (const socket of filtered) {
        const duplicateIndex = collapsed.findIndex(existing => areNearDuplicateBuildSockets(existing, socket));
        if (duplicateIndex < 0) {
            collapsed.push(socket);
            continue;
        }

        const existing = collapsed[duplicateIndex]!;
        const newScore = scoreBuildSocketCandidate(socket);
        const existingScore = scoreBuildSocketCandidate(existing);

        let preferred = existing;
        if (newScore > existingScore) {
            preferred = socket;
        } else if (newScore === existingScore) {
            // If one candidate is an origin leak, prefer the positioned socket.
            const newNearOrigin = isNearOriginBuildSocket(socket);
            const existingNearOrigin = isNearOriginBuildSocket(existing);

            if (existingNearOrigin && !newNearOrigin) {
                preferred = socket;
            }
        }

        collapsed[duplicateIndex] = {
            ...preferred,
            integrityBonus: existing.integrityBonus === false || socket.integrityBonus === false
                ? false
                : preferred.integrityBonus,
            breachFace: existing.breachFace === true || socket.breachFace === true
                ? true
                : preferred.breachFace,
        };
    }

    return collapsed;
}

function isNearOriginBuildSocket(socket: FoxholeManifestBuildSocket): boolean {
    const position = resolveFoxholeBuildSocketPosition(socket);
    const x = Number(position?.x ?? 0);
    const y = Number(position?.y ?? 0);
    const z = Number(socket.z ?? 0);

    return Math.abs(x) < 0.01
        && Math.abs(y) < 0.01
        && Math.abs(z) < 0.01;
}
