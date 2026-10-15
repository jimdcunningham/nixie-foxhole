/**
 * Bunker destruction shot counts for statistics (legacy BrowserStatistics formula).
 * Prefer passing union `effectiveHealth` from bunker-health; `maxHealth` alone
 * still floors as SI≡1 for single-piece callers.
 */

export interface FoxholeBunkerDestructionWeaponInput {
    id: string;
    name?: string | null;
    codeName?: string | null;
    damage?: number | null;
    damageType?: {
        multipliers?: Record<string, number> | null;
        profiles?: Record<string, number> | null;
    } | null;
}

export interface FoxholeBunkerDestructionShotProfile {
    t1: number;
    t2: number;
    t3: number;
    t3wet: number | null;
}

export interface FoxholeBunkerDestructionWeaponRow {
    id: string;
    name: string;
    codeName: string;
    shots: FoxholeBunkerDestructionShotProfile;
}

export interface FoxholeBunkerDestructionSummary {
    maxHealth: number;
    effectiveHealth: number;
    weapons: FoxholeBunkerDestructionWeaponRow[];
}

/**
 * The legacy planner authored this table in gameplay progression order rather
 * than alphabetically. Keep that familiar order even though FoxWatch publishes
 * the weapon record with deterministic (alphabetical) keys.
 */
const LEGACY_BUNKER_DESTRUCTION_WEAPON_ORDER = [
    'hegrenade',
    'helaunchedgrenade',
    'minitankammo',
    'rpgammo',
    'lighttankammo',
    'battletankammo',
    'atammo',
    'atlargeammo',
    'mortarammo',
    'lightartilleryammo',
    'heavyartilleryammo',
    'herocketammo',
    'firerocketammo',
    'demolitionrocketammo',
    'explosivelightc',
    'bomberammo',
    'mortartankammo',
    'lrartilleryammo',
    'satchelchargew',
    'satchelcharget',
] as const;

const LEGACY_BUNKER_DESTRUCTION_WEAPON_RANK = new Map<string, number>(
    LEGACY_BUNKER_DESTRUCTION_WEAPON_ORDER.map((weaponId, index) => [weaponId, index]),
);

function coercePositiveNumber(value: number | null | undefined): number {
    const normalized = Number(value ?? NaN);
    return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
}

function resolveProfileMultiplier(
    multipliers: Record<string, number> | null | undefined,
    tierKey: string,
): number {
    const value = Number(multipliers?.[tierKey] ?? NaN);
    return Number.isFinite(value) && value > 0 ? value : 1;
}

function resolveShotsToDestroy(
    effectiveHealth: number,
    weaponDamage: number,
    profileDamage: number,
    multiplier: number,
): number {
    if (!(effectiveHealth > 0) || !(weaponDamage > 0) || !(profileDamage > 0) || !(multiplier > 0)) {
        return 0;
    }

    return Math.ceil(effectiveHealth / (weaponDamage * profileDamage * multiplier));
}

/** Legacy drying multiplier for wet concrete T3 while the interval is under 24 hours. */
export function resolveFoxholeBunkerDryingMultiplier(intervalSeconds: number): number {
    if (!(intervalSeconds > 0) || intervalSeconds >= 86400) {
        return 1;
    }

    if (intervalSeconds < 8640) {
        return 10;
    }

    return 86400 / intervalSeconds;
}

export function resolveFoxholeSingleBunkerEffectiveHealth(maxHealth: number | null | undefined): number {
    return Math.floor(coercePositiveNumber(maxHealth));
}

export function buildFoxholeBunkerDestructionSummary(options: {
    maxHealth?: number | null | undefined;
    /** When set, used directly (union SI already applied). */
    effectiveHealth?: number | null | undefined;
    weapons: Record<string, FoxholeBunkerDestructionWeaponInput> | null | undefined;
    intervalSeconds?: number | null;
}): FoxholeBunkerDestructionSummary | null {
    const maxHealth = coercePositiveNumber(options.maxHealth);
    const explicitEffectiveHealth = coercePositiveNumber(options.effectiveHealth);
    const effectiveHealth = explicitEffectiveHealth > 0
        ? Math.floor(explicitEffectiveHealth)
        : resolveFoxholeSingleBunkerEffectiveHealth(maxHealth);
    if (!(effectiveHealth > 0)) {
        return null;
    }

    const intervalSeconds = Number(options.intervalSeconds ?? 3600);
    const includeWet = Number.isFinite(intervalSeconds) && intervalSeconds > 0 && intervalSeconds < 86400;
    const dryingMultiplier = includeWet ? resolveFoxholeBunkerDryingMultiplier(intervalSeconds) : 1;
    const weapons: FoxholeBunkerDestructionWeaponRow[] = [];

    for (const [weaponId, weapon] of Object.entries(options.weapons ?? {})) {
        const damage = coercePositiveNumber(weapon.damage);
        const profiles = weapon.damageType?.profiles ?? {};
        const multipliers = weapon.damageType?.multipliers ?? {};
        const t1Profile = coercePositiveNumber(profiles.t1);
        const t2Profile = coercePositiveNumber(profiles.t2);
        const t3Profile = coercePositiveNumber(profiles.t3);
        if (!(damage > 0) || (!(t1Profile > 0) && !(t2Profile > 0) && !(t3Profile > 0))) {
            continue;
        }

        const codeName = String(weapon.codeName ?? weaponId).trim() || weaponId;
        const name = String(weapon.name ?? codeName).trim() || codeName;
        weapons.push({
            id: weaponId,
            name,
            codeName,
            shots: {
                t1: resolveShotsToDestroy(effectiveHealth, damage, t1Profile, resolveProfileMultiplier(multipliers, 't1')),
                t2: resolveShotsToDestroy(effectiveHealth, damage, t2Profile, resolveProfileMultiplier(multipliers, 't2')),
                t3: resolveShotsToDestroy(effectiveHealth, damage, t3Profile, resolveProfileMultiplier(multipliers, 't3')),
                t3wet: includeWet && t3Profile > 0
                    ? resolveShotsToDestroy(
                        effectiveHealth,
                        damage,
                        t3Profile,
                        resolveProfileMultiplier(multipliers, 't3') * dryingMultiplier,
                    )
                    : null,
            },
        });
    }

    weapons.sort((left, right) => {
        const leftRank = LEGACY_BUNKER_DESTRUCTION_WEAPON_RANK.get(left.id.toLowerCase());
        const rightRank = LEGACY_BUNKER_DESTRUCTION_WEAPON_RANK.get(right.id.toLowerCase());
        if (leftRank != null || rightRank != null) {
            return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER);
        }

        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    });

    return {
        maxHealth: maxHealth > 0 ? maxHealth : effectiveHealth,
        effectiveHealth,
        weapons,
    };
}
