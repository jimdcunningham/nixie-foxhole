/**
 * Stable conversion-entry recipe ID matching (mirrors game-kitchen update.js).
 *
 * Match order per new recipe:
 * 1. Exact I/O (+ duration when both present)
 * 2. Output-only
 * 3. Else allocate nextId++
 */

const LIQUID_CAN_TO_BASE = {
    oilcan: 'oil',
    watercan: 'water',
    facilityoil1can: 'facilityoil1',
    facilityoil2can: 'facilityoil2',
};

const LIQUID_BASE_TO_CAN = Object.fromEntries(
    Object.entries(LIQUID_CAN_TO_BASE).map(([can, base]) => [base, can]),
);

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function readRecipeQuantity(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const quantity = value.quantity ?? value.q;
        if (typeof quantity === 'number' && Number.isFinite(quantity)) {
            return quantity;
        }
    }
    return null;
}

/**
 * @param {unknown} key
 * @returns {string}
 */
export function normalizeResourceKey(key) {
    const raw = String(key ?? '').trim().toLowerCase();
    if (!raw) {
        return '';
    }
    if (raw.startsWith('crate:')) {
        return `crate:${raw.slice('crate:'.length)}`;
    }
    return LIQUID_CAN_TO_BASE[raw] ?? raw;
}

/**
 * Flatten item/crate/liquid maps (or legacy flat input/output) into a comparable resource map.
 * Crate resources are keyed as `crate:<id>`. Liquid *can aliases collapse to the base id.
 *
 * @param {Record<string, unknown> | null | undefined} flatOrItem
 * @param {Record<string, unknown> | null | undefined} crate
 * @param {Record<string, unknown> | null | undefined} liquid
 * @returns {Record<string, number>}
 */
export function flattenResourceMaps(flatOrItem, crate, liquid) {
    /** @type {Record<string, number>} */
    const out = {};

    const add = (key, value, { forceCrate = false, forceLiquid = false } = {}) => {
        const quantity = readRecipeQuantity(value);
        if (quantity == null) {
            return;
        }
        let normalized = normalizeResourceKey(key);
        if (!normalized) {
            return;
        }
        if (forceCrate && !normalized.startsWith('crate:')) {
            normalized = `crate:${normalized}`;
        }
        if (forceLiquid) {
            normalized = LIQUID_CAN_TO_BASE[normalized] ?? normalized;
        }
        out[normalized] = quantity;
    };

    if (flatOrItem && typeof flatOrItem === 'object') {
        for (const [key, value] of Object.entries(flatOrItem)) {
            add(key, value);
        }
    }
    if (crate && typeof crate === 'object') {
        for (const [key, value] of Object.entries(crate)) {
            add(key, value, { forceCrate: true });
        }
    }
    if (liquid && typeof liquid === 'object') {
        for (const [key, value] of Object.entries(liquid)) {
            add(key, value, { forceLiquid: true });
        }
    }

    return out;
}

/**
 * @param {Record<string, unknown> | null | undefined} entry Compact or hydrated conversion entry
 */
export function fingerprintManifestConversionEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return { input: {}, output: {}, duration: null, id: null };
    }
    const idRaw = entry.id;
    const id = typeof idRaw === 'number' && Number.isFinite(idRaw) ? idRaw : null;
    const durationRaw = entry.duration ?? entry.d;
    const duration = typeof durationRaw === 'number' && Number.isFinite(durationRaw) ? durationRaw : null;
    return {
        id,
        duration,
        input: flattenResourceMaps(
            entry.itemInput ?? entry.ii,
            entry.crateInput ?? entry.ci,
            entry.liquidInput ?? entry.li,
        ),
        output: flattenResourceMaps(
            entry.itemOutput ?? entry.io,
            entry.crateOutput ?? entry.co,
            entry.liquidOutput ?? entry.lo,
        ),
    };
}

/**
 * @param {Record<string, unknown> | null | undefined} recipe Legacy data.js production recipe
 */
export function fingerprintLegacyProductionRecipe(recipe) {
    if (!recipe || typeof recipe !== 'object') {
        return { input: {}, output: {}, duration: null, id: null };
    }
    const idRaw = recipe.id;
    const id = typeof idRaw === 'number' && Number.isFinite(idRaw) ? idRaw : null;
    const durationRaw = recipe.time ?? recipe.duration;
    const duration = typeof durationRaw === 'number' && Number.isFinite(durationRaw) ? durationRaw : null;

    /** @type {Record<string, unknown>} */
    const itemInput = {};
    /** @type {Record<string, unknown>} */
    const crateInput = {};
    /** @type {Record<string, unknown>} */
    const liquidInput = {};
    /** @type {Record<string, unknown>} */
    const itemOutput = {};
    /** @type {Record<string, unknown>} */
    const crateOutput = {};
    /** @type {Record<string, unknown>} */
    const liquidOutput = {};

    const splitFlat = (flat, itemMap, crateMap, liquidMap) => {
        if (!flat || typeof flat !== 'object') {
            return;
        }
        for (const [key, value] of Object.entries(flat)) {
            const raw = String(key).trim().toLowerCase();
            if (!raw) {
                continue;
            }
            if (raw.startsWith('crate:')) {
                crateMap[raw.slice('crate:'.length)] = value;
                continue;
            }
            const base = LIQUID_CAN_TO_BASE[raw] ?? raw;
            if (LIQUID_BASE_TO_CAN[base] || LIQUID_CAN_TO_BASE[raw]) {
                liquidMap[base] = value;
                continue;
            }
            // Ambiguous liquids stored without *can (e.g. diesel on power plants).
            // Keep in item map; matching also compares a channel-agnostic flatten.
            itemMap[raw] = value;
        }
    };

    splitFlat(recipe.input, itemInput, crateInput, liquidInput);
    splitFlat(recipe.output, itemOutput, crateOutput, liquidOutput);

    return {
        id,
        duration,
        input: flattenResourceMaps(itemInput, crateInput, liquidInput),
        output: flattenResourceMaps(itemOutput, crateOutput, liquidOutput),
    };
}

/**
 * @param {Record<string, number> | null | undefined} left
 * @param {Record<string, number> | null | undefined} right
 */
export function compareResourceMaps(left, right) {
    const leftMap = left && typeof left === 'object' ? left : {};
    const rightMap = right && typeof right === 'object' ? right : {};
    const leftKeys = Object.keys(leftMap);
    const rightKeys = Object.keys(rightMap);
    if (leftKeys.length !== rightKeys.length) {
        return false;
    }
    for (const key of leftKeys) {
        if (leftMap[key] !== rightMap[key]) {
            return false;
        }
    }
    return true;
}

/**
 * @param {{ input: Record<string, number>; output: Record<string, number>; duration: number | null }} left
 * @param {{ input: Record<string, number>; output: Record<string, number>; duration: number | null }} right
 */
export function compareRecipeExact(left, right) {
    if (!compareResourceMaps(left.input, right.input) || !compareResourceMaps(left.output, right.output)) {
        return false;
    }
    if (left.duration != null && right.duration != null && left.duration !== right.duration) {
        return false;
    }
    return true;
}

/**
 * @param {{ output: Record<string, number> }} left
 * @param {{ output: Record<string, number> }} right
 */
export function compareRecipeOutput(left, right) {
    return compareResourceMaps(left.output, right.output);
}

/**
 * @param {Array<{ id: number | null; input: Record<string, number>; output: Record<string, number>; duration: number | null }>} oldRecipes
 * @param {{ input: Record<string, number>; output: Record<string, number>; duration: number | null }} newRecipe
 * @param {Set<number>} usedIds
 * @returns {number | undefined}
 */
export function findReusableRecipeId(oldRecipes, newRecipe, usedIds) {
    if (!oldRecipes?.length) {
        return undefined;
    }

    const exactMatch = oldRecipes.find(oldRecipe => (
        oldRecipe.id != null
        && !usedIds.has(oldRecipe.id)
        && compareRecipeExact(oldRecipe, newRecipe)
    ));
    if (exactMatch?.id != null) {
        return exactMatch.id;
    }

    const outputMatch = oldRecipes.find(oldRecipe => (
        oldRecipe.id != null
        && !usedIds.has(oldRecipe.id)
        && compareRecipeOutput(oldRecipe, newRecipe)
    ));
    return outputMatch?.id ?? undefined;
}

/**
 * Assign stable ids onto `newEntries` using previous fingerprints.
 *
 * @param {Array<ReturnType<typeof fingerprintManifestConversionEntry>>} previousFingerprints
 * @param {Array<Record<string, unknown>>} newEntries Mutated in place; `id` written
 * @param {number} [nextIdStart]
 * @returns {{ nextId: number; exact: number; output: number; allocated: number; preserved: number }}
 */
export function assignRecipeIdsToConversionEntries(previousFingerprints, newEntries, nextIdStart = 0) {
    const usedIds = new Set();
    let nextId = Number.isFinite(nextIdStart) ? Math.max(0, Math.floor(nextIdStart)) : 0;
    for (const previous of previousFingerprints) {
        if (previous.id != null) {
            nextId = Math.max(nextId, previous.id + 1);
        }
    }

    let exact = 0;
    let output = 0;
    let allocated = 0;
    let preserved = 0;

    for (const entry of newEntries) {
        const fingerprint = fingerprintManifestConversionEntry(entry);
        if (fingerprint.id != null && !usedIds.has(fingerprint.id)) {
            usedIds.add(fingerprint.id);
            nextId = Math.max(nextId, fingerprint.id + 1);
            preserved += 1;
            continue;
        }

        const reused = findReusableRecipeId(previousFingerprints, fingerprint, usedIds);
        if (typeof reused === 'number') {
            const previous = previousFingerprints.find(candidate => candidate.id === reused);
            const matchKind = previous && compareRecipeExact(previous, fingerprint) ? 'exact' : 'output';
            if (matchKind === 'exact') {
                exact += 1;
            } else {
                output += 1;
            }
            entry.id = reused;
            usedIds.add(reused);
            nextId = Math.max(nextId, reused + 1);
            continue;
        }

        entry.id = nextId++;
        usedIds.add(entry.id);
        allocated += 1;
    }

    return { nextId, exact, output, allocated, preserved };
}

/**
 * @param {number | null | undefined} productionLength
 * @param {Iterable<number | null | undefined>} ids
 */
export function resolveNextRecipeId(productionLength, ids) {
    let nextId = typeof productionLength === 'number' && Number.isFinite(productionLength)
        ? Math.max(0, Math.floor(productionLength))
        : 0;
    for (const id of ids) {
        if (typeof id === 'number' && Number.isFinite(id)) {
            nextId = Math.max(nextId, Math.floor(id) + 1);
        }
    }
    return nextId;
}
