import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyFoxholeBunkerCompactnessBonus,
    buildFoxholeBunkerHealthSummary,
    countFoxholeBunkerSocketBreaches,
    isFoxholeBreachIndicatorSocket,
    isFoxholeBunkerIntegrityEdgeSocket,
    isFoxholeBunkerSocketUnbreachable,
    resolveFoxholeBunkerStructuralIntegrityClass,
} from '../app/plugins/foxhole/nixie/bunker-health.ts';
import { buildFoxholeBunkerDestructionSummary } from '../app/plugins/foxhole/nixie/bunker-destruction.ts';
import { LegacyPlanImporter } from '../app/plugins/foxhole/legacy/index.ts';
import { buildFoxholeItemCatalog, buildFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';

test('isFoxholeBreachIndicatorSocket follows authored wall faces without requiring snap tags', () => {
    assert.equal(isFoxholeBreachIndicatorSocket(
        { breachable: true },
        { socketTags: [{ category: 4, mask: 4 }], breachFace: true },
    ), true);
    assert.equal(isFoxholeBreachIndicatorSocket(
        { breachable: true },
        { socketTags: [{ category: 4, mask: 4 }], integrityBonus: false, breachFace: true },
    ), false);
    assert.equal(isFoxholeBreachIndicatorSocket(
        { breachable: false },
        { socketTags: [{ category: 4, mask: 4 }], breachFace: true },
    ), false);
    assert.equal(isFoxholeBreachIndicatorSocket(
        { breachable: true },
        { socketTags: [], breachFace: true },
    ), true);
    assert.equal(isFoxholeBreachIndicatorSocket(
        { breachable: true },
        { socketTags: [{ category: 4, mask: 4 }] },
    ), false);
});

test('build site connections remain exposed breach faces', () => {
    const baseConnection = {
        selfBreachable: true,
        selfStructuralGarrison: false,
        neighborBreachable: true,
        neighborStructuralGarrison: false,
        connectionCount: 1,
    };

    assert.equal(isFoxholeBunkerSocketUnbreachable(baseConnection), true);
    assert.equal(isFoxholeBunkerSocketUnbreachable({ ...baseConnection, selfExposed: true }), false);
    assert.equal(isFoxholeBunkerSocketUnbreachable({ ...baseConnection, neighborExposed: true }), false);
});

test('single piece bunker health uses SI 1 and floors health', () => {
    const summary = buildFoxholeBunkerHealthSummary([{
        nodeId: 'a',
        maxHealth: 650.9,
        repairCost: 50,
        structuralIntegrity: 0.97,
    }]);

    assert.ok(summary);
    assert.equal(summary.pieceCount, 1);
    assert.equal(summary.structuralIntegrity, 1);
    assert.equal(summary.effectiveHealth, 650);
    assert.equal(summary.structuralIntegrityClass, 'high');
    assert.equal(summary.usedCompactnessBonus, false);
});

test('multi-piece bunker health multiplies SI and floors effective health', () => {
    const summary = buildFoxholeBunkerHealthSummary([
        { nodeId: 'a', maxHealth: 1000, repairCost: 40, structuralIntegrity: 0.97 },
        { nodeId: 'b', maxHealth: 1000, repairCost: 40, structuralIntegrity: 0.97 },
    ], { applyCompactnessBonus: false });

    assert.ok(summary);
    assert.equal(summary.structuralIntegrityProduct, 0.97 * 0.97);
    assert.equal(summary.structuralIntegrity, 0.97 * 0.97);
    assert.equal(summary.effectiveHealth, Math.floor(2000 * 0.97 * 0.97));
    assert.equal(summary.repairRate, summary.effectiveHealth / 80);
    assert.equal(resolveFoxholeBunkerStructuralIntegrityClass(summary.structuralIntegrity), 'high');
});

test('compactness bonus raises SI toward 1 from unbreachable socket ratio', () => {
    const product = 0.8;
    const withBonus = applyFoxholeBunkerCompactnessBonus(product, {
        unbreachableSockets: 2,
        breachableSockets: 0,
    });
    assert.equal(withBonus, Math.min(1, 0.8 + 0.15));
});

test('countFoxholeBunkerSocketBreaches classifies fort faces and skips integrityBonus false', () => {
    const counts = countFoxholeBunkerSocketBreaches([
        {
            nodeId: 'a',
            breachable: true,
            structuralGarrison: false,
            buildSockets: [
                { name: 'RightFortSocket', socketTags: [{ category: 4, mask: 4 }], breachFace: true },
                { name: 'LeftFortSocket', socketTags: [{ category: 4, mask: 4 }], breachFace: true },
                { name: 'InternalSocket', socketTags: [{ category: 4, mask: 4 }], integrityBonus: false, breachFace: true },
            ],
            socketAttachments: {
                RightFortSocket: { nodeId: 'b', socketName: 'LeftFortSocket' },
            },
        },
        {
            nodeId: 'b',
            breachable: true,
            structuralGarrison: false,
            buildSockets: [
                { name: 'LeftFortSocket', socketTags: [{ category: 4, mask: 4 }], breachFace: true },
                { name: 'RightFortSocket', socketTags: [{ category: 4, mask: 4 }], breachFace: true },
            ],
            socketAttachments: {
                LeftFortSocket: { nodeId: 'a', socketName: 'RightFortSocket' },
            },
        },
    ]);

    // 1 sealed face + 1 empty face on A + 1 empty face on B
    assert.equal(counts.unbreachableSockets, 1);
    assert.equal(counts.breachableSockets, 2);
});

test('four fortt1 pieces do not stay at 100% SI when open faces exist', () => {
    const wall = (name: string) => ({ name, socketTags: [{ category: 4, mask: 4 }], breachFace: true });
    const piece = (
        nodeId: string,
        attachments: Record<string, { nodeId: string; socketName: string; }>,
    ) => ({
        nodeId,
        maxHealth: 750,
        repairCost: 50,
        structuralIntegrity: 0.97,
        breachable: true as const,
        buildSockets: [wall('FrontFortSocket'), wall('BackFortSocket'), wall('LeftFortSocket'), wall('RightFortSocket')],
        socketAttachments: attachments,
    });

    // 2x2: each piece has 2 sealed + 2 open faces
    const summary = buildFoxholeBunkerHealthSummary([
        piece('a', {
            RightFortSocket: { nodeId: 'b', socketName: 'LeftFortSocket' },
            BackFortSocket: { nodeId: 'c', socketName: 'FrontFortSocket' },
        }),
        piece('b', {
            LeftFortSocket: { nodeId: 'a', socketName: 'RightFortSocket' },
            BackFortSocket: { nodeId: 'd', socketName: 'FrontFortSocket' },
        }),
        piece('c', {
            FrontFortSocket: { nodeId: 'a', socketName: 'BackFortSocket' },
            RightFortSocket: { nodeId: 'd', socketName: 'LeftFortSocket' },
        }),
        piece('d', {
            FrontFortSocket: { nodeId: 'b', socketName: 'BackFortSocket' },
            LeftFortSocket: { nodeId: 'c', socketName: 'RightFortSocket' },
        }),
    ]);

    assert.ok(summary);
    assert.equal(summary.pieceCount, 4);
    assert.ok(summary.structuralIntegrity < 1);
    assert.ok(summary.breachableHealthPercent > 0);
    assert.ok(summary.structuralIntegrityPercent < 100);
});

test('buildFoxholeBunkerHealthSummary applies compactness when breach metadata exists', () => {
    const summary = buildFoxholeBunkerHealthSummary([
        {
            nodeId: 'a',
            maxHealth: 1000,
            repairCost: 10,
            structuralIntegrity: 0.9,
            breachable: true,
            buildSockets: [{ name: 'RightFortSocket', socketTags: [{ category: 4, mask: 4 }], breachFace: true }],
            socketAttachments: { RightFortSocket: { nodeId: 'b', socketName: 'LeftFortSocket' } },
        },
        {
            nodeId: 'b',
            maxHealth: 1000,
            repairCost: 10,
            structuralIntegrity: 0.9,
            breachable: true,
            buildSockets: [{ name: 'LeftFortSocket', socketTags: [{ category: 4, mask: 4 }], breachFace: true }],
            socketAttachments: { LeftFortSocket: { nodeId: 'a', socketName: 'RightFortSocket' } },
        },
    ]);

    assert.ok(summary);
    assert.equal(summary.usedCompactnessBonus, true);
    assert.ok(summary.structuralIntegrity > summary.structuralIntegrityProduct);
});

test('directional fort sockets are integrity edges without becoming breachable wall faces', () => {
    const entrance = {
        name: 'FortCommon:FrontFortSocket',
        socketTags: [{ category: 4, mask: 4 }],
    };

    assert.equal(isFoxholeBreachIndicatorSocket(
        { breachable: true },
        entrance,
    ), false);
    assert.equal(isFoxholeBunkerIntegrityEdgeSocket(
        { breachable: true },
        entrance,
    ), true);
    assert.equal(isFoxholeBunkerIntegrityEdgeSocket(
        { breachable: true },
        { name: 'RightFortSocket', socketTags: [] },
    ), true);
    assert.equal(isFoxholeBunkerIntegrityEdgeSocket(
        { breachable: true },
        { name: 'FrontLeftInternalSocket', socketTags: [], integrityBonus: false },
    ), false);
});

test('legacy bowtie counts FoxWatch wall faces plus the ramp integrity edge', async () => {
    const manifest = getFoxholeManifest('/foxhole/assets/');
    const structureCatalog = buildFoxholeStructureCatalog(manifest);
    const importer = new LegacyPlanImporter({
        structureCatalog,
        itemCatalog: buildFoxholeItemCatalog(manifest),
    });
    const result = await importer.importSave({
        version: '1.0.5',
        entities: [
            { id: 7, key: 'fortt3_artilleryait3', x: 8189, y: 6507, rotation: -44.977, layer: 0, sortOffset: 4, connections: { 2: { 5: 0 } } },
            { id: 5, key: 'fortcornert3', x: 8302, y: 6620, rotation: -44.977, layer: 0, sortOffset: 2, connections: { 0: { 7: 2 }, 3: { 6: 2 }, 6: { 0: 3 } } },
            { id: 1, key: 'fortt3_fortrampt3', x: 8423, y: 6460, rotation: 180.023, layer: 0, sortOffset: 0, connections: { 0: { 0: 0 } } },
            { id: 2, key: 'fortcornert3', x: 8543, y: 6620, rotation: 134.989, layer: 0, sortOffset: 1, connections: { 0: { 4: 2 }, 3: { 3: 2 }, 6: { 0: 1 } } },
            { id: 0, key: 'fortbaset3', x: 8422.545, y: 6620.364, rotation: 0, layer: 0, sortOffset: 0, baseUpgrades: { base: 'large_garrison' }, connections: { 0: { 1: 0 }, 1: { 2: 6 }, 3: { 5: 6 } } },
            { id: 6, key: 'fortt3_artilleryait3', x: 8189, y: 6733, rotation: -134.989, layer: 0, sortOffset: 3, connections: { 2: { 5: 3 } } },
            { id: 3, key: 'fortt3_artilleryait3', x: 8656, y: 6507, rotation: 44.977, layer: 0, sortOffset: 1, connections: { 2: { 2: 3 } } },
            { id: 4, key: 'fortt3_artilleryait3', x: 8656, y: 6733, rotation: 134.989, layer: 0, sortOffset: 5, connections: { 2: { 2: 0 } } },
        ],
    });

    const pieces = result.boardSnapshots.map(snapshot => {
        const foxholeKey = String(snapshot.state.foxholeKey ?? '').trim();
        const structure = structureCatalog.structureByKey[foxholeKey];
        assert.ok(structure, `missing structure ${foxholeKey}`);
        return {
            nodeId: snapshot.id,
            maxHealth: structure.maxHealth,
            repairCost: structure.repairCost,
            structuralIntegrity: structure.structuralIntegrity,
            breachable: structure.breachable,
            structuralGarrison: structure.structuralGarrison,
            buildSockets: structure.buildSockets,
            socketAttachments: snapshot.state.socketAttachments,
        };
    });
    const summary = buildFoxholeBunkerHealthSummary(pieces);

    assert.ok(summary);
    assert.deepEqual(summary.socketCounts, {
        unbreachableSockets: 7,
        breachableSockets: 17,
    });
    assert.equal(summary.rawMaxHealth, 28_550);
    assert.equal(summary.repairCost, 1_040);
    assert.equal(summary.effectiveHealth, 8_000);
    assert.equal(summary.breachableHealth, 5_758);
    assert.equal(summary.structuralIntegrityPercent, 28);
});

test('bunker destruction accepts precomputed effective health', () => {
    const summary = buildFoxholeBunkerDestructionSummary({
        maxHealth: 2000,
        effectiveHealth: 1500,
        intervalSeconds: 86400,
        weapons: {
            hegrenade: {
                id: 'hegrenade',
                damage: 240,
                damageType: {
                    profiles: { t1: 0.75, t2: 0.65, t3: 0.25 },
                },
            },
        },
    });

    assert.ok(summary);
    assert.equal(summary.effectiveHealth, 1500);
    assert.equal(summary.weapons[0]!.shots.t1, Math.ceil(1500 / (240 * 0.75)));
});
