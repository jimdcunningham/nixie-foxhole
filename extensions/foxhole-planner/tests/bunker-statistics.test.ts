import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFoxholeBunkerHealthSummary } from '../src/bunker-statistics-health.ts';
import { buildFoxholeBunkerDestructionSummary } from '../src/bunker-statistics-destruction.ts';
import { deduplicateFoxholeBuildSockets } from '../src/bunker-statistics-sockets.ts';
import { isFoxholeEcsBunkerMember } from '../src/bunker-statistics.ts';

test('bunker health preserves single-piece integrity and connected-piece compactness math', () => {
    const socket = { name: 'FrontFortSocket', x: 100, y: 0, breachFace: true, socketTags: [{ mask: 2, category: 4 }] };
    const piece = { nodeId: 'one', maxHealth: 1000, repairCost: 100, structuralIntegrity: 0.8, breachable: true, buildSockets: [socket] };
    assert.equal(buildFoxholeBunkerHealthSummary([piece])!.effectiveHealth, 1000);
    const connected = ['one', 'two'].map(nodeId => ({ ...piece, nodeId,
        socketAttachments: { FrontFortSocket: { nodeId: nodeId === 'one' ? 'two' : 'one', socketName: 'FrontFortSocket' } } }));
    const result = buildFoxholeBunkerHealthSummary(connected)!;
    assert.equal(result.usedCompactnessBonus, true);
    assert.ok(Math.abs(result.structuralIntegrity - 0.79) < 1e-12);
    assert.equal(result.effectiveHealth, 1580);
    assert.equal(result.socketCounts.unbreachableSockets, 1);
});

test('bunker membership and sockets exclude destroyed/trench/foundation data and collapse origin aliases', () => {
    assert.equal(isFoxholeEcsBunkerMember('fort', { codeName: 'FortTest', profileType: 'Fort', sockets: [] }), true);
    assert.equal(isFoxholeEcsBunkerMember('fort', { codeName: 'FortTest', profileType: 'Fort', isDestroyed: true, sockets: [] }), false);
    assert.equal(isFoxholeEcsBunkerMember('trench', { codeName: 'TrenchTest', profileType: 'Trench', sockets: [] }), false);
    const sockets = deduplicateFoxholeBuildSockets([{ name: 'FortCommon:FrontFortSocket_GEN_VARIABLE', x: 0, y: 0, socketTags: [] },
        { name: 'FrontFortSocket', x: 100, y: 0, breachFace: true, socketTags: [{ mask: 2, category: 4 }] }]);
    assert.equal(sockets.length, 1);
    assert.equal(sockets[0]!.name, 'FrontFortSocket');
});

test('destruction tables preserve wet concrete interval behavior and authored weapon order', () => {
    const weapons = { other: { id: 'other', name: 'Other', damage: 100, damageType: { profiles: { t1: 1, t2: 0.5, t3: 0.25 } } },
        hegrenade: { id: 'hegrenade', name: 'HE', damage: 100, damageType: { profiles: { t1: 1, t2: 0.5, t3: 0.25 } } } };
    const wet = buildFoxholeBunkerDestructionSummary({ maxHealth: 1000, weapons, intervalSeconds: 3600 })!;
    assert.equal(wet.weapons[0]!.id, 'hegrenade');
    assert.equal(wet.weapons[0]!.shots.t3wet, 4);
    assert.equal(wet.weapons[0]!.shots.t3, 40);
    assert.equal(buildFoxholeBunkerDestructionSummary({ maxHealth: 1000, weapons, intervalSeconds: 86400 })!.weapons[0]!.shots.t3wet, null);
});
