function normalizeId(value) {
    return String(value ?? '').trim().toLowerCase();
}

export function isDestroyedOrBreachedModificationConsumer(structureId) {
    const normalized = normalizeId(structureId);
    return normalized.includes('destroyed') || normalized.includes('breached');
}

function isUpgradeModificationSlot(slot) {
    const componentType = String(slot?.componentType ?? '').toLowerCase();
    const slotName = String(slot?.name ?? '').toLowerCase();
    return componentType.includes('upgradeslotcomponent')
        || slotName.includes('upgradeslot');
}

export function isUpgradeModificationVariant(slot, variantId, variant, sourceModification = null) {
    return variant?.isUpgrade === true
        || sourceModification?.isUpgrade === true
        || (isUpgradeModificationSlot(slot) && normalizeId(variantId) !== 'default');
}

export function canShareModificationVariant(slot, variantId, variant, sourceModification = null) {
    return !isUpgradeModificationVariant(slot, variantId, variant, sourceModification);
}

/**
 * Render-scene index entries are shared only when dedupe collapsed them under structureId "mods".
 * Host-local modification scenes still have consumers; that alone must not mark them shared.
 */
export function isSharedModificationRenderSceneEntry(entry) {
    return normalizeId(entry?.structureId) === 'mods';
}

export function hasStandaloneModificationContentHashSuffix(value) {
    return /-[a-f0-9]{12}(?:-\d+)?$/.test(normalizeId(value));
}

/**
 * Host-local published folders use plain variantId. Hashed directory names are stale leftovers
 * from older publishes and must not be synced or preferred over variantId paths.
 */
export function isHashedHostLocalModificationDirectoryName(directoryName) {
    return hasStandaloneModificationContentHashSuffix(directoryName);
}

/**
 * Prefer plain variantId before hashed renderId so stale hashed sibling folders lose.
 */
export function buildHostLocalModificationRenderLookupKeys({
    variantId,
    variant = null,
    extraKeys = [],
} = {}) {
    const keys = [];
    const seen = new Set();
    for (const candidate of [
        variantId,
        variant?.id,
        variant?.appliedModificationId,
        variant?.modificationId,
        ...extraKeys,
        variant?.sharedModificationId,
        variant?.renderId,
    ]) {
        const normalized = normalizeId(candidate);
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        keys.push(normalized);
    }
    return keys;
}

export function resolveAssetScopedModificationRenderEntry(
    assetScopedEntries,
    modificationEntriesByKey,
    options = {},
) {
    const lookupKeys = buildHostLocalModificationRenderLookupKeys(options);
    const assetHit = lookupKeys
        .map(lookupKey => assetScopedEntries?.[lookupKey])
        .find(Boolean);
    if (assetHit) {
        return assetHit;
    }

    for (const lookupKey of [
        normalizeId(options.variant?.sharedModificationId),
        normalizeId(options.variant?.renderId),
        normalizeId(options.variantId),
        ...(options.extraKeys ?? []).map(normalizeId),
    ].filter(Boolean)) {
        const sharedHit = modificationEntriesByKey?.[lookupKey];
        if (sharedHit) {
            return sharedHit;
        }
    }

    return null;
}

export function assertUniqueHostModificationVariantRenderIds(modificationRenderIndexDocument) {
    const renderIdsByHostVariant = new Map();
    for (const entry of Object.values(modificationRenderIndexDocument?.entries ?? {})) {
        const renderId = normalizeId(entry?.renderId);
        if (!renderId) {
            continue;
        }

        for (const consumer of entry?.consumers ?? []) {
            const structureId = normalizeId(consumer?.structureId);
            const variantId = normalizeId(consumer?.variantId);
            if (!structureId || !variantId || variantId === 'default'
                || isDestroyedOrBreachedModificationConsumer(structureId)) {
                continue;
            }

            const key = `${structureId}|${variantId}`;
            if (!renderIdsByHostVariant.has(key)) {
                renderIdsByHostVariant.set(key, new Set());
            }
            renderIdsByHostVariant.get(key).add(renderId);
        }
    }

    const collisions = [...renderIdsByHostVariant.entries()]
        .map(([key, renderIds]) => [key, [...renderIds].sort()])
        .filter(([, renderIds]) => renderIds.length > 1)
        .sort(([left], [right]) => left.localeCompare(right));
    if (collisions.length === 0) {
        return;
    }

    const details = collisions
        .map(([key, renderIds]) => `${key} => ${renderIds.join(', ')}`)
        .join('; ');
    throw new Error(
        `Modification render identity collision: each host variant must resolve to exactly one renderId. ${details}`,
    );
}

export function extractCanonicalGlobalModificationRoots(roots, variantId) {
    const normalizedVariantId = normalizeId(variantId);
    if (!normalizedVariantId) {
        return [];
    }

    const marker = `:upgrade:${normalizedVariantId}:`;
    function find(nodes) {
        for (const node of nodes ?? []) {
            if (normalizeId(node?.id).includes(marker)) {
                return [structuredClone(node)];
            }
            const childMatch = find(node?.children);
            if (childMatch.length > 0) {
                return childMatch;
            }
        }
        return [];
    }

    return find(roots);
}

/**
 * Decide shared vs host-local storage for one renderId group of standalone modification scenes.
 *
 * Rules:
 * - Any upgrade in the group => every document stays host-local (never shared/modifications).
 * - Non-upgrade multi-host (or index-confirmed multi-host) with one canonical fingerprint =>
 *   one shared mods/ representative.
 * - Fingerprint divergence after canonical extraction means the global assets genuinely differ.
 * - Single-host non-upgrade stays host-local. A stale shared storage flag cannot override that.
 */
export function planModificationStorageForRenderIdGroup(documents, options = {}) {
    const list = Array.isArray(documents) ? documents.filter(Boolean) : [];
    if (list.length === 0) {
        return [];
    }

    const renderId = normalizeId(options.renderId) || normalizeId(list[0]?.renderId);
    const indexStorageIsShared = normalizeId(options.indexStorage) === 'shared';
    const indexedConsumerStructureIds = new Set(
        (options.indexConsumerStructureIds ?? [])
            .map(normalizeId)
            .filter(structureId => structureId && !isDestroyedOrBreachedModificationConsumer(structureId)),
    );
    const indexSupportsSharedStorage = indexStorageIsShared
        && indexedConsumerStructureIds.size > 1;
    const hasUpgrade = list.some(document => document.isUpgrade === true);

    if (hasUpgrade) {
        return list.map(document => ({
            storage: 'host',
            renderId,
            variantId: document.variantId ?? null,
            structureId: document.structureId,
            fingerprint: document.fingerprint ?? null,
            reason: 'upgrade-never-shared',
        }));
    }

    const distinctDocumentStructureIds = new Set(
        list
            .map(document => normalizeId(document.structureId))
            .filter(structureId => structureId
                && structureId !== 'mods'
                && !isDestroyedOrBreachedModificationConsumer(structureId)),
    );
    const canShare = distinctDocumentStructureIds.size > 1 || indexSupportsSharedStorage;
    if (!canShare) {
        return list.map(document => ({
            storage: 'host',
            renderId,
            variantId: document.variantId ?? null,
            structureId: document.structureId,
            fingerprint: document.fingerprint ?? null,
            reason: 'single-host',
        }));
    }

    const byFingerprint = new Map();
    for (const document of list) {
        const fingerprint = String(document.fingerprint ?? '');
        if (!byFingerprint.has(fingerprint)) {
            byFingerprint.set(fingerprint, []);
        }
        byFingerprint.get(fingerprint).push(document);
    }

    if (byFingerprint.size !== 1) {
        return list.map(document => ({
            storage: 'host',
            renderId,
            variantId: document.variantId ?? null,
            structureId: document.structureId,
            fingerprint: document.fingerprint ?? null,
            reason: 'canonical-fingerprint-divergence',
        }));
    }

    const [[representativeFingerprint, representativeDocuments]] = byFingerprint;
    const representative = [...representativeDocuments].sort((left, right) => (
        String(left.structureId ?? '').localeCompare(String(right.structureId ?? ''))
    ))[0];

    return [
        {
            storage: 'shared',
            renderId,
            structureId: 'mods',
            fingerprint: representative?.fingerprint ?? representativeFingerprint ?? null,
            representativeStructureId: representative?.structureId ?? null,
            consumerStructureIds: [...new Set([
                ...list
                    .map(document => normalizeId(document.structureId))
                    .filter(structureId => structureId && structureId !== 'mods'),
                ...indexedConsumerStructureIds,
            ])],
            reason: 'non-upgrade-multi-host-shared',
        },
    ];
}

export function summarizeModificationStoragePlan(groups) {
    const shared = [];
    const host = [];
    for (const entry of groups ?? []) {
        if (entry.storage === 'shared') {
            shared.push(entry);
        } else {
            host.push(entry);
        }
    }
    return {
        sharedCount: shared.length,
        hostCount: host.length,
        sharedRenderIds: shared.map(entry => entry.renderId),
        hostStructureIds: host.map(entry => entry.structureId),
    };
}
