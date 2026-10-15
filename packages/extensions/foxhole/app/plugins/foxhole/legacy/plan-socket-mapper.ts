import { resolveLegacyPlanSocketName } from './plan-socket-id-map.ts';
import { isLegacyIgnoredSocket } from './plan-legacy-ignored-sockets.ts';
import type { FoxholeStructureSocketAttachmentMap } from '../nixie/types.ts';

export type LegacySocketAttachmentFinding = {
    entityId: number;
    foxholeKey: string;
    legacyKey?: string;
    legacySocketId: string;
    peerEntityId?: string;
    peerSocketId?: string;
    reason: string;
};

export type LegacySocketLink = {
    fromLegacyId: number;
    fromSocketName: string;
    toLegacyId: number;
    toSocketName: string;
};

/**
 * Converts legacy numeric socket connections into named attachment links.
 */
export class LegacyPlanSocketMapper {
    mapConnections(options: {
        entities: Array<{
            legacyId: number;
            foxholeKey: string | null;
            legacyKey?: string | null;
            connections?: Record<string, Record<string, number | string>> | null;
        }>;
    }): {
        links: LegacySocketLink[];
        findings: LegacySocketAttachmentFinding[];
    } {
        const links: LegacySocketLink[] = [];
        const findings: LegacySocketAttachmentFinding[] = [];
        const seen = new Set<string>();

        for (const entity of options.entities) {
            if (!entity.foxholeKey || !entity.connections) {
                continue;
            }
            for (const [localSocketId, peers] of Object.entries(entity.connections)) {
                if (isLegacyIgnoredSocket(entity.legacyKey ?? entity.foxholeKey, localSocketId, {
                    legacyKey: entity.legacyKey,
                    foxholeKey: entity.foxholeKey,
                })) {
                    continue;
                }
                const localName = resolveLegacyPlanSocketName(entity.legacyKey ?? entity.foxholeKey, localSocketId, {
                    legacyKey: entity.legacyKey,
                    foxholeKey: entity.foxholeKey,
                });
                if (!localName) {
                    findings.push({
                        entityId: entity.legacyId,
                        foxholeKey: entity.foxholeKey,
                        legacyKey: entity.legacyKey ?? undefined,
                        legacySocketId: String(localSocketId),
                        reason: 'unresolved_local_socket',
                    });
                    continue;
                }
                if (!peers || typeof peers !== 'object') {
                    continue;
                }
                for (const [peerEntityId, peerSocketId] of Object.entries(peers)) {
                    const peerLegacyId = Number(peerEntityId);
                    const peer = options.entities.find(entry => entry.legacyId === peerLegacyId);
                    if (!peer?.foxholeKey) {
                        findings.push({
                            entityId: entity.legacyId,
                            foxholeKey: entity.foxholeKey,
                            legacyKey: entity.legacyKey ?? undefined,
                            legacySocketId: String(localSocketId),
                            peerEntityId: String(peerEntityId),
                            peerSocketId: String(peerSocketId),
                            reason: 'missing_peer_entity',
                        });
                        continue;
                    }
                    if (isLegacyIgnoredSocket(peer.legacyKey ?? peer.foxholeKey, peerSocketId, {
                        legacyKey: peer.legacyKey,
                        foxholeKey: peer.foxholeKey,
                    })) {
                        continue;
                    }
                    const peerName = resolveLegacyPlanSocketName(peer.legacyKey ?? peer.foxholeKey, peerSocketId, {
                        legacyKey: peer.legacyKey,
                        foxholeKey: peer.foxholeKey,
                    });
                    if (!peerName) {
                        findings.push({
                            entityId: entity.legacyId,
                            foxholeKey: entity.foxholeKey,
                            legacyKey: entity.legacyKey ?? undefined,
                            legacySocketId: String(localSocketId),
                            peerEntityId: String(peerEntityId),
                            peerSocketId: String(peerSocketId),
                            reason: 'unresolved_peer_socket',
                        });
                        continue;
                    }

                    const key = [
                        Math.min(entity.legacyId, peerLegacyId),
                        Math.max(entity.legacyId, peerLegacyId),
                        localName < peerName ? localName : peerName,
                        localName < peerName ? peerName : localName,
                    ].join('|');
                    if (seen.has(key)) {
                        continue;
                    }
                    seen.add(key);
                    links.push({
                        fromLegacyId: entity.legacyId,
                        fromSocketName: localName,
                        toLegacyId: peerLegacyId,
                        toSocketName: peerName,
                    });
                }
            }
        }

        return { links, findings };
    }

    buildAttachmentMaps(options: {
        links: readonly LegacySocketLink[];
        nodeIdByLegacyId: ReadonlyMap<number, string>;
    }): Map<number, FoxholeStructureSocketAttachmentMap> {
        const maps = new Map<number, FoxholeStructureSocketAttachmentMap>();
        const ensure = (legacyId: number) => {
            let map = maps.get(legacyId);
            if (!map) {
                map = {};
                maps.set(legacyId, map);
            }
            return map;
        };

        for (const link of options.links) {
            const fromNodeId = options.nodeIdByLegacyId.get(link.fromLegacyId);
            const toNodeId = options.nodeIdByLegacyId.get(link.toLegacyId);
            if (!fromNodeId || !toNodeId) {
                continue;
            }
            ensure(link.fromLegacyId)[link.fromSocketName] = {
                nodeId: toNodeId,
                socketName: link.toSocketName,
            };
            ensure(link.toLegacyId)[link.toSocketName] = {
                nodeId: fromNodeId,
                socketName: link.fromSocketName,
            };
        }

        return maps;
    }
}
