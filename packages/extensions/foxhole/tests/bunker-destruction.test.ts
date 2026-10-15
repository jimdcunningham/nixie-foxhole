import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildFoxholeBunkerDestructionSummary,
    resolveFoxholeBunkerDryingMultiplier,
    resolveFoxholeSingleBunkerEffectiveHealth,
} from '../app/plugins/foxhole/nixie/bunker-destruction.ts';

test('resolveFoxholeSingleBunkerEffectiveHealth floors positive health', () => {
    assert.equal(resolveFoxholeSingleBunkerEffectiveHealth(650.9), 650);
    assert.equal(resolveFoxholeSingleBunkerEffectiveHealth(0), 0);
});

test('resolveFoxholeBunkerDryingMultiplier matches legacy wet concrete scaling', () => {
    assert.equal(resolveFoxholeBunkerDryingMultiplier(3600), 10);
    assert.equal(resolveFoxholeBunkerDryingMultiplier(43200), 2);
    assert.equal(resolveFoxholeBunkerDryingMultiplier(86400), 1);
});

test('buildFoxholeBunkerDestructionSummary computes shot counts for a single piece', () => {
    const summary = buildFoxholeBunkerDestructionSummary({
        maxHealth: 650,
        intervalSeconds: 3600,
        weapons: {
            hegrenade: {
                id: 'hegrenade',
                name: 'HE Grenade',
                codeName: 'HEGrenade',
                damage: 240,
                damageType: {
                    multipliers: { t2: 0.95, t3: 0.95 },
                    profiles: { t1: 0.75, t2: 0.65, t3: 0.25 },
                },
            },
        },
    });

    assert.ok(summary);
    assert.equal(summary.effectiveHealth, 650);
    assert.equal(summary.weapons.length, 1);
    assert.equal(summary.weapons[0]!.shots.t1, Math.ceil(650 / (240 * 0.75 * 1)));
    assert.equal(summary.weapons[0]!.shots.t2, Math.ceil(650 / (240 * 0.65 * 0.95)));
    assert.equal(summary.weapons[0]!.shots.t3, Math.ceil(650 / (240 * 0.25 * 0.95)));
    assert.equal(summary.weapons[0]!.shots.t3wet, Math.ceil(650 / (240 * 0.25 * 0.95 * 10)));
});

test('buildFoxholeBunkerDestructionSummary omits wet column at 24 hours', () => {
    const summary = buildFoxholeBunkerDestructionSummary({
        maxHealth: 650,
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

    assert.equal(summary?.weapons[0]?.shots.t3wet, null);
});

test('buildFoxholeBunkerDestructionSummary preserves the legacy weapon row order', () => {
    const weapon = (id: string, name: string) => ({
        id,
        name,
        damage: 100,
        damageType: { profiles: { t1: 1, t2: 1, t3: 1 } },
    });
    const summary = buildFoxholeBunkerDestructionSummary({
        maxHealth: 1000,
        weapons: {
            satchelcharget: weapon('satchelcharget', 'Havoc'),
            atammo: weapon('atammo', '68mm'),
            hegrenade: weapon('hegrenade', 'HE Grenade'),
            minitankammo: weapon('minitankammo', '30mm'),
            unknown: weapon('unknown', 'Future Weapon'),
        },
    });

    assert.deepEqual(
        summary?.weapons.map(row => row.id),
        ['hegrenade', 'minitankammo', 'atammo', 'satchelcharget', 'unknown'],
    );
});
