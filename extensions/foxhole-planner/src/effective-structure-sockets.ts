import { filterFoxholeSameWallInfrastructureSelections } from './modification-wall-conflicts.ts';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import { deduplicateFoxholeBuildSockets, normalizeFoxholeBuildSocketName, resolveFoxholeBuildSocketPosition } from './bunker-statistics-sockets.ts';
import type { FoxholeBunkerStatisticsSocket } from './bunker-statistics-sockets.ts';
import type { FoxholeSceneV2AssetMetadata, FoxholeSceneV2BuildSocketMetadata, FoxholeSceneV2ModificationVariantMetadata } from './scene-v2-asset-metadata.ts';

/** Native's source precedence and alias cleanup, kept in domain-owned raw centimeters/degrees. */
export function resolveFoxholeEffectiveStructureSocketSources(asset: FoxholeSceneV2AssetMetadata,
    variants: readonly FoxholeSceneV2ModificationVariantMetadata[]): FoxholeBunkerStatisticsSocket[] {
    const resolved: FoxholeBunkerStatisticsSocket[] = [];
    const seen = new Set<string>();
    const append = (sockets: readonly FoxholeBunkerStatisticsSocket[]) => {
        for (const socket of deduplicateFoxholeBuildSockets(sockets)) {
            const position = resolveFoxholeBuildSocketPosition(socket);
            const key = [normalizeFoxholeBuildSocketName(socket.name), String(socket.componentType ?? '').trim(), String(socket.pipeType ?? '').trim(),
                Number(position?.x ?? NaN), Number(position?.y ?? NaN), Number(socket.z ?? NaN), Number(socket.rotation ?? NaN)].join('|');
            if (!seen.has(key)) {
                seen.add(key);
                resolved.push(socket);
            }
        }
    };
    append(asset.overlaySockets ?? []);
    for (const variant of variants) {
        append(variant.overlaySockets ?? []);
    }
    const couplerNames = new Set<string>();
    append((asset.overlayRailCouplers ?? []).filter(socket => {
        if (couplerNames.has(socket.name)) {
            return false;
        }
        couplerNames.add(socket.name);
        return true;
    }));
    return deduplicateFoxholeBuildSockets(resolved);
}

export function resolveFoxholeSelectedSocketVariants(entity: NixieExperimentalComponentEntitySnapshotV1,
    asset: FoxholeSceneV2AssetMetadata): FoxholeSceneV2ModificationVariantMetadata[] {
    const selections = entity.components.find(component => component.ownerId === 'nixie.foxhole-planner'
        && component.componentId === 'modification' && component.version === 1 && component.definitionAvailable)?.data.selections;
    return Array.isArray(selections)
        ? filterFoxholeSameWallInfrastructureSelections(asset.modifications, selections.flatMap(value => {
            if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.slotId !== 'string' || typeof value.variantId !== 'string') {
                return [];
            }
            const variant = asset.modifications[value.slotId]?.variants[value.variantId];
            return variant ? [{ slotId: value.slotId, variantId: value.variantId, variant }] : [];
        })).map(selection => selection.variant)
        : [];
}

/** Same effective sockets as display, projected into the attachment/snapping coordinate basis. */
export function resolveFoxholeEntityStructureSockets(entity: NixieExperimentalComponentEntitySnapshotV1,
    asset: FoxholeSceneV2AssetMetadata | null | undefined): FoxholeSceneV2BuildSocketMetadata[] {
    if (!asset) {
        return [];
    }
    if (!asset.overlaySockets) {
        return [...asset.buildSockets];
    }
    return resolveFoxholeEffectiveStructureSocketSources(asset, resolveFoxholeSelectedSocketVariants(entity, asset)).flatMap(socket => {
        const x = Number(socket.x ?? 0) / 100 * 32;
        const y = Number(socket.y ?? 0) / 100 * 32;
        const rotation = Number(socket.rotation ?? 0) * Math.PI / 180;
        if (!socket.name || ![x, y, rotation].every(Number.isFinite)) {
            return [];
        }
        return [{ name: socket.name, x, y, ...(socket.z === undefined ? {} : { z: Number(socket.z) * 0.32 }), rotation, componentType: String(socket.componentType ?? ''),
            breachFace: socket.breachFace === true, integrityBonus: socket.integrityBonus !== false,
            socketTags: socket.socketTags.filter(tag => Number.isSafeInteger(tag.mask) && tag.mask > 0 && Number.isSafeInteger(tag.category) && tag.category > 0) }];
    });
}
