import type { NixieExperimentalComponentEntitySnapshotV1, NixieExperimentalComponentJsonObjectV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import { buildFoxholeBunkerHealthSummary } from './bunker-statistics-health.ts';
import { buildFoxholeBunkerDestructionSummary } from './bunker-statistics-destruction.ts';
import type { FoxholeBunkerDestructionWeaponInput } from './bunker-statistics-destruction.ts';
import { deduplicateFoxholeBuildSockets, normalizeFoxholeBuildSocketName } from './bunker-statistics-sockets.ts';
import type { FoxholeBunkerStatisticsSocket, FoxholeBunkerStatisticsAttachmentMap } from './bunker-statistics-sockets.ts';

export interface FoxholeBunkerStatisticsMetadata {
    codeName: string;
    profileType?: string;
    isDestroyed?: boolean;
    isBreached?: boolean;
    breachable?: boolean;
    structuralGarrison?: boolean;
    maxHealth?: number | null;
    repairCost?: number | null;
    structuralIntegrity?: number | null;
    sockets: FoxholeBunkerStatisticsSocket[];
}

export function isFoxholeEcsBunkerMember(id: string, asset: FoxholeBunkerStatisticsMetadata): boolean {
    if (asset.isDestroyed || asset.isBreached) {
        return false;
    }
    const key = (asset.codeName || id).trim().toLowerCase();
    const profile = (asset.profileType ?? '').trim().toLowerCase();
    if (!key || /destroyed|breached|buildsite/.test(key) || profile === 'destroyedfort' || profile === 'trench') {
        return false;
    }
    if (profile.startsWith('fort') || /^(rifle|mg|atgun|artillery)ait[123]$/.test(key) || /^fort/.test(key)) {
        return true;
    }
    return typeof asset.structuralIntegrity === 'number' && asset.structuralIntegrity > 0 && asset.structuralIntegrity < 1;
}

const fortSocket = (socket: FoxholeBunkerStatisticsSocket) => socket.socketTags.some(tag => Number.isFinite(tag.category) && Math.trunc(tag.category) === 4
    && Number.isFinite(tag.mask) && tag.mask >= 0 && (BigInt(Math.trunc(tag.mask)) & ~8n) !== 0n);

export function resolveFoxholeEcsBunkerStatistics(entities: readonly NixieExperimentalComponentEntitySnapshotV1[], scopeIds: readonly string[],
    assets: Readonly<Record<string, { bunker?: FoxholeBunkerStatisticsMetadata; }>>, weapons: Readonly<Record<string, FoxholeBunkerDestructionWeaponInput>>, intervalSeconds: number) {
    const members = new Map<string, { asset: FoxholeBunkerStatisticsMetadata; attachments: FoxholeBunkerStatisticsAttachmentMap; }>();
    for (const entity of entities) {
        const data = (id: string) => entity.components.find(component => component.ownerId === 'nixie.foxhole-planner' && component.componentId === id && component.definitionAvailable)?.data;
        const assetId = data('asset')?.assetId;
        const asset = typeof assetId === 'string' ? assets[assetId]?.bunker : null;
        if (!asset || !isFoxholeEcsBunkerMember(String(assetId), asset)) {
            continue;
        }
        const raw = data('socket-attachments')?.attachments;
        const rows = Array.isArray(raw) ? raw.filter((value): value is NixieExperimentalComponentJsonObjectV1 => value !== null && typeof value === 'object' && !Array.isArray(value)) : [];
        const attachments = Object.fromEntries(rows.flatMap(row => typeof row.localSocketName === 'string' && typeof row.targetEntityId === 'string' && typeof row.targetSocketName === 'string'
            ? [[row.localSocketName, { nodeId: row.targetEntityId, socketName: row.targetSocketName }]]
            : []));
        members.set(entity.entityId, { asset: { ...asset, sockets: deduplicateFoxholeBuildSockets(asset.sockets) }, attachments });
    }
    const visited = new Set<string>();
    const unions: string[][] = [];
    for (const id of members.keys()) {
        if (visited.has(id)) {
            continue;
        }
        const queue = [id];
        const union: string[] = [];
        while (queue.length) {
            const currentId = queue.shift()!;
            if (visited.has(currentId)) {
                continue;
            }
            visited.add(currentId);
            union.push(currentId);
            const current = members.get(currentId)!;
            for (const [name, attachment] of Object.entries(current.attachments)) {
                const socket = current.asset.sockets.find(candidate => normalizeFoxholeBuildSocketName(candidate.name).toLowerCase() === normalizeFoxholeBuildSocketName(name).toLowerCase());
                if (socket && fortSocket(socket) && members.has(attachment.nodeId) && !visited.has(attachment.nodeId)) {
                    queue.push(attachment.nodeId);
                }
            }
        }
        unions.push(union.sort((a, b) => a.localeCompare(b)));
    }
    const scope = new Set(scopeIds);
    const matching = unions.filter(union => union.some(id => scope.has(id)));
    if (matching.length !== 1) {
        return null;
    }
    const pieces = matching[0]!.map(nodeId => {
        const member = members.get(nodeId)!;
        return { nodeId, maxHealth: member.asset.maxHealth, repairCost: member.asset.repairCost, structuralIntegrity: member.asset.structuralIntegrity,
            breachable: member.asset.breachable, structuralGarrison: member.asset.structuralGarrison,
            buildSockets: deduplicateFoxholeBuildSockets(member.asset.sockets), socketAttachments: member.attachments };
    });
    const health = buildFoxholeBunkerHealthSummary(pieces);
    return health
        ? { memberIds: matching[0]!, health, destruction: buildFoxholeBunkerDestructionSummary({ maxHealth: health.rawMaxHealth,
            effectiveHealth: health.effectiveHealth, weapons: { ...weapons }, intervalSeconds }) }
        : null;
}
