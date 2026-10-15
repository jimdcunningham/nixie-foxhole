import assert from 'node:assert/strict';
import test from 'node:test';
import assets, { bunkerDestructionWeapons } from '../../../../../extensions/foxhole-planner/src/scene-v2-assets-node.ts';
import { resolveFoxholeEcsBunkerStatistics, isFoxholeEcsBunkerMember } from '../../../../../extensions/foxhole-planner/src/bunker-statistics.ts';
import type { FoxholeBunkerStatisticsMetadata } from '../../../../../extensions/foxhole-planner/src/bunker-statistics.ts';
import { deduplicateFoxholeBuildSockets as sdkSockets } from '../../../../../extensions/foxhole-planner/src/bunker-statistics-sockets.ts';
import { getFoxholeStructureCatalog } from '../../app/plugins/foxhole/nixie/catalog.ts';
import { isFoxholeBunkerUnionMember } from '../../app/plugins/foxhole/nixie/structure-socket-networks.ts';
import { buildFoxholeBunkerHealthSummary } from '../../app/plugins/foxhole/nixie/bunker-health.ts';
import { buildFoxholeBunkerDestructionSummary } from '../../app/plugins/foxhole/nixie/bunker-destruction.ts';
import { deduplicateFoxholeBuildSockets as nativeSockets } from '../../app/plugins/foxhole/nixie/structure-socket-resolution.ts';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixie/extension-sdk';

const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
const entity = (entityId: string, assetId: string, attachments: Array<{ localSocketName: string; targetEntityId: string; targetSocketName: string; }> = []): NixieExperimentalComponentEntitySnapshotV1 => ({ entityId, revision: 1,
    components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true, data: { assetId } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'socket-attachments', version: 1, definitionAvailable: true, data: { attachments } }] });

test('ECS bunker membership, socket normalization, single-piece health and weapon tables match the complete bundled catalog', () => {
    assert.deepEqual(bunkerDestructionWeapons, catalog.bunkerDestructionWeapons);
    let comparedHealth = 0;
    for (const asset of catalog.assets) {
        const structure = catalog.structureByKey[asset.foxholeKey]!;
        const metadata = assets[asset.foxholeKey]!.bunker!;
        const member = isFoxholeBunkerUnionMember({ foxholeKey: asset.foxholeKey, codeName: structure.codeName, profileType: structure.profileType,
            structuralIntegrity: structure.structuralIntegrity, isDestroyed: structure.isDestroyed, isBreached: structure.isBreached });
        assert.equal(isFoxholeEcsBunkerMember(asset.foxholeKey, metadata), member, asset.foxholeKey);
        assert.deepEqual(sdkSockets(metadata.sockets).map(socket => ({ name: socket.name, integrityBonus: socket.integrityBonus, breachFace: socket.breachFace })),
            nativeSockets(structure.buildSockets).map(socket => ({ name: socket.name, integrityBonus: socket.integrityBonus, breachFace: socket.breachFace })), asset.foxholeKey);
        if (!member) {
            continue;
        }
        const expected = buildFoxholeBunkerHealthSummary([{ nodeId: 'one', maxHealth: structure.maxHealth, repairCost: structure.repairCost,
            structuralIntegrity: structure.structuralIntegrity, breachable: structure.breachable, structuralGarrison: structure.structuralGarrison,
            buildSockets: nativeSockets(structure.buildSockets), socketAttachments: {} }]);
        const actual = resolveFoxholeEcsBunkerStatistics([entity('one', asset.foxholeKey)], ['one'], assets, bunkerDestructionWeapons, 3600);
        assert.deepEqual(actual?.health ?? null, expected, asset.foxholeKey);
        if (actual && expected) {
            comparedHealth += 1;
            for (const interval of [900, 10800, 86400, 259200]) {
                assert.deepEqual(resolveFoxholeEcsBunkerStatistics([entity('one', asset.foxholeKey)], ['one'], assets, bunkerDestructionWeapons, interval)!.destruction,
                    buildFoxholeBunkerDestructionSummary({ maxHealth: expected.rawMaxHealth, effectiveHealth: expected.effectiveHealth,
                        weapons: catalog.bunkerDestructionWeapons, intervalSeconds: interval }), `${asset.foxholeKey}/${interval}`);
            }
        }
    }
    assert.ok(comparedHealth > 0);
});

test('selected bunker pieces use their full connected union and multiple independent unions stay unresolved', () => {
    const socket = { name: 'FortCommon:FrontFortSocket', x: 100, y: 0, socketTags: [{ mask: 2, category: 4 }], breachFace: true, integrityBonus: true };
    const metadata: FoxholeBunkerStatisticsMetadata = { codeName: 'FortTest', profileType: 'Fort', breachable: true, structuralGarrison: false,
        maxHealth: 1000, repairCost: 100, structuralIntegrity: 0.8, sockets: [socket] };
    const local = { fort: { bunker: metadata } };
    const entities = [entity('a', 'fort', [{ localSocketName: 'FrontFortSocket', targetEntityId: 'b', targetSocketName: 'FrontFortSocket' }]),
        entity('b', 'fort', [{ localSocketName: 'FrontFortSocket', targetEntityId: 'a', targetSocketName: 'FrontFortSocket' }]), entity('c', 'fort')];
    const before = structuredClone(entities);
    const expected = buildFoxholeBunkerHealthSummary(['a', 'b'].map(nodeId => ({ nodeId, ...metadata, buildSockets: [socket],
        socketAttachments: { FrontFortSocket: { nodeId: nodeId === 'a' ? 'b' : 'a', socketName: 'FrontFortSocket' } } })));
    const actual = resolveFoxholeEcsBunkerStatistics(entities, ['a'], local, bunkerDestructionWeapons, 3600)!;
    assert.deepEqual(actual.memberIds, ['a', 'b']);
    assert.deepEqual(actual.health, expected);
    assert.equal(resolveFoxholeEcsBunkerStatistics(entities, ['a', 'c'], local, bunkerDestructionWeapons, 3600), null);
    assert.deepEqual(entities, before);
});
