import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    assertUniqueHostModificationVariantRenderIds,
    buildHostLocalModificationRenderLookupKeys,
    canShareModificationVariant,
    extractCanonicalGlobalModificationRoots,
    hasStandaloneModificationContentHashSuffix,
    isHashedHostLocalModificationDirectoryName,
    isSharedModificationRenderSceneEntry,
    isUpgradeModificationVariant,
    planModificationStorageForRenderIdGroup,
    resolveAssetScopedModificationRenderEntry,
    summarizeModificationStoragePlan,
} from './modification-storage-policy.mjs';

describe('modification storage policy', () => {
    it('keeps explicitly marked upgrades host-local', () => {
        assert.equal(isUpgradeModificationVariant({}, 'insulation', { isUpgrade: true }), true);
        assert.equal(canShareModificationVariant({}, 'insulation', { isUpgrade: true }), false);
    });

    it('keeps source modifications marked as upgrades host-local', () => {
        assert.equal(canShareModificationVariant(
            {},
            'coalliquefier',
            {},
            { isUpgrade: true },
        ), false);
    });

    it('treats non-default upgrade-slot variants as upgrades', () => {
        const slot = {
            name: 'UpgradeSlotComponent',
            componentType: 'ModificationSlotComponent',
        };

        assert.equal(canShareModificationVariant(slot, 'cokefurnace', {}), false);
        assert.equal(canShareModificationVariant(slot, 'default', {}), true);
    });

    it('allows ordinary modification variants to use shared storage', () => {
        const slot = {
            name: 'FrontInfraModSlot',
            componentType: 'ModificationSlotComponent',
        };

        assert.equal(canShareModificationVariant(slot, 'sandbags', {}), true);
    });

    it('treats only mods structureId render scenes as shared', () => {
        assert.equal(isSharedModificationRenderSceneEntry({
            structureId: 'mods',
            consumers: [{ structureId: 'fortt3', variantId: 'sandbags' }],
        }), true);

        assert.equal(isSharedModificationRenderSceneEntry({
            structureId: 'facilityrefinerycoal',
            outputPath: 'facilityrefinerycoal/modifications/cokefurnace-5fe486b069ed.scene.json',
            consumers: [{ structureId: 'facilityrefinerycoal', variantId: 'cokefurnace' }],
        }), false);
    });

    it('never shares upgrade renderId groups even when fingerprints match across hosts', () => {
        const plan = planModificationStorageForRenderIdGroup([
            { structureId: 'facilitypipe', isUpgrade: true, fingerprint: 'same' },
            { structureId: 'facilitypipevalve', isUpgrade: true, fingerprint: 'same' },
            { structureId: 'facilitysilooil', isUpgrade: true, fingerprint: 'same' },
        ], { renderId: 'insulation-24d1abd82849' });

        const summary = summarizeModificationStoragePlan(plan);
        assert.equal(summary.sharedCount, 0);
        assert.equal(summary.hostCount, 3);
        assert.deepEqual(new Set(plan.map(entry => entry.reason)), new Set(['upgrade-never-shared']));
    });

    it('extracts a global mod subtree without host and slot ancestors', () => {
        const roots = [{
            id: 'rifleait3:root',
            children: [{
                id: 'rifleait3:fortcommonmods-frontinframodslot',
                unrealLocationCentimeters: [250, 0, -160],
                children: [{
                    id: 'rifleait3:upgrade:desk:root',
                    children: [{ id: 'rifleait3:upgrade:desk:staticmesh' }],
                }],
            }],
        }];

        assert.deepEqual(
            extractCanonicalGlobalModificationRoots(roots, 'desk'),
            [{
                id: 'rifleait3:upgrade:desk:root',
                children: [{ id: 'rifleait3:upgrade:desk:staticmesh' }],
            }],
        );
    });

    it('extracts trench CommonMods without host and defense-slot ancestors', () => {
        const roots = [{
            id: 'trencht2:root',
            children: [{
                id: 'trencht2:trenchcommonmods-leftbackdefensemodslot',
                unrealLocationCentimeters: [120, -80, 0],
                unrealRotationDegrees: [0, 45, 0],
                children: [{
                    id: 'trencht2:upgrade:sandbags:root',
                    children: [{ id: 'trencht2:upgrade:sandbags:staticmesh' }],
                }],
            }],
        }];

        assert.deepEqual(
            extractCanonicalGlobalModificationRoots(roots, 'sandbags'),
            [{
                id: 'trencht2:upgrade:sandbags:root',
                children: [{ id: 'trencht2:upgrade:sandbags:staticmesh' }],
            }],
        );
    });

    it('shares canonical fort infra mods across hosts', () => {
        const plan = planModificationStorageForRenderIdGroup([
            ...Array.from({ length: 20 }, (_, index) => ({
                structureId: `rifleait${(index % 3) + 1}`,
                isUpgrade: false,
                fingerprint: 'canonical-desk',
            })),
            { structureId: 'fortcornert1', isUpgrade: false, fingerprint: 'canonical-desk' },
            { structureId: 'fortcornert2', isUpgrade: false, fingerprint: 'canonical-desk' },
            { structureId: 'fortcornert3', isUpgrade: false, fingerprint: 'canonical-desk' },
        ], { renderId: 'desk-a7a2ff0d194a' });

        assert.equal(plan.length, 1);
        assert.equal(plan[0].storage, 'shared');
        assert.equal(plan[0].structureId, 'mods');
        assert.equal(plan[0].fingerprint, 'canonical-desk');
        assert.equal(plan[0].consumerStructureIds.length, 6);
        assert.equal(plan[0].reason, 'non-upgrade-multi-host-shared');
    });

    it('shares canonical trench defense mods across hosts', () => {
        const plan = planModificationStorageForRenderIdGroup([
            { structureId: 'trencht2', isUpgrade: false, fingerprint: 'canonical-sandbags' },
            { structureId: 'trencht3', isUpgrade: false, fingerprint: 'canonical-sandbags' },
            { structureId: 'trenchconnectort2', isUpgrade: false, fingerprint: 'canonical-sandbags' },
            { structureId: 'trenchconnectort3', isUpgrade: false, fingerprint: 'canonical-sandbags' },
            { structureId: 'trenchempt2', isUpgrade: false, fingerprint: 'canonical-sandbags' },
        ], { renderId: 'sandbags-649ba37bd152' });

        assert.equal(plan.length, 1);
        assert.equal(plan[0].storage, 'shared');
        assert.equal(plan[0].structureId, 'mods');
        assert.equal(plan[0].reason, 'non-upgrade-multi-host-shared');
        assert.equal(plan[0].consumerStructureIds.length, 5);
    });

    it('rejects genuinely divergent canonical global assets', () => {
        const plan = planModificationStorageForRenderIdGroup([
            { structureId: 'fortt3', isUpgrade: false, fingerprint: 'visual-a' },
            { structureId: 'rifleait3', isUpgrade: false, fingerprint: 'visual-b' },
        ], { renderId: 'custom-aaaaaaaaaaaa' });

        assert.equal(plan.length, 2);
        assert.ok(plan.every(entry => entry.storage === 'host'));
        assert.ok(plan.every(entry => entry.reason === 'canonical-fingerprint-divergence'));
    });

    it('keeps single-host non-upgrade modifications host-local', () => {
        const plan = planModificationStorageForRenderIdGroup([
            { structureId: 'fortt3', isUpgrade: false, fingerprint: 'alone' },
        ], { renderId: 'custom-aaaaaaaaaaaa' });

        assert.equal(plan.length, 1);
        assert.equal(plan[0].storage, 'host');
        assert.equal(plan[0].reason, 'single-host');
    });

    it('does not preserve stale shared storage for one indexed host', () => {
        const plan = planModificationStorageForRenderIdGroup([
            { structureId: 'trenchintt1', isUpgrade: false, fingerprint: 'barbedwire-t1-intersection' },
        ], {
            renderId: 'barbedwire-29a553e8b45d',
            indexStorage: 'shared',
            indexConsumerStructureIds: ['trenchintt1', 'trenchintt1'],
        });

        assert.equal(plan.length, 1);
        assert.equal(plan[0].storage, 'host');
        assert.equal(plan[0].reason, 'single-host');
    });

    it('preserves shared storage during a scoped refresh of indexed multi-host mods', () => {
        const plan = planModificationStorageForRenderIdGroup([
            { structureId: 'trencht2', isUpgrade: false, fingerprint: 'barbedwire-t2' },
        ], {
            renderId: 'barbedwire-4ba3702b0c45',
            indexStorage: 'shared',
            indexConsumerStructureIds: ['trencht2', 'trenchconnectort2', 'trenchempt2'],
        });

        assert.equal(plan.length, 1);
        assert.equal(plan[0].storage, 'shared');
        assert.equal(plan[0].structureId, 'mods');
    });

    it('allows one renderId for a host variant across multiple slots', () => {
        assert.doesNotThrow(() => assertUniqueHostModificationVariantRenderIds({
            entries: {
                'barbedwire-aaaaaaaaaaaa': {
                    renderId: 'barbedwire-aaaaaaaaaaaa',
                    consumers: [
                        { structureId: 'trencht1', slotName: 'FrontDefenseModSlot', variantId: 'barbedwire' },
                        { structureId: 'trencht1', slotName: 'BackDefenseModSlot', variantId: 'barbedwire' },
                    ],
                },
            },
        }));
    });

    it('rejects multiple renderIds for the same host variant', () => {
        assert.throws(
            () => assertUniqueHostModificationVariantRenderIds({
                entries: {
                    'barbedwire-aaaaaaaaaaaa': {
                        renderId: 'barbedwire-aaaaaaaaaaaa',
                        consumers: [
                            { structureId: 'trencht1', slotName: 'FrontDefenseModSlot', variantId: 'barbedwire' },
                        ],
                    },
                    'barbedwire-bbbbbbbbbbbb': {
                        renderId: 'barbedwire-bbbbbbbbbbbb',
                        consumers: [
                            { structureId: 'trencht1', slotName: 'BackDefenseModSlot', variantId: 'barbedwire' },
                        ],
                    },
                },
            }),
            /trencht1\|barbedwire.*barbedwire-aaaaaaaaaaaa, barbedwire-bbbbbbbbbbbb/,
        );
    });

    it('ignores destroyed hosts when deciding shared storage', () => {
        const plan = planModificationStorageForRenderIdGroup([
            { structureId: 'trencht2', isUpgrade: false, fingerprint: 'oneway-t2' },
        ], {
            renderId: 'oneway-c7306e084058',
            indexStorage: 'shared',
            indexConsumerStructureIds: ['trencht2', 'trenchintdestroyedt2'],
        });

        assert.equal(plan.length, 1);
        assert.equal(plan[0].storage, 'host');
        assert.equal(plan[0].reason, 'single-host');
    });
});

describe('host-local modification publish path helpers', () => {
    it('detects hashed host-local directory names', () => {
        assert.equal(hasStandaloneModificationContentHashSuffix('heavyammo-f9ffd44230dc'), true);
        assert.equal(isHashedHostLocalModificationDirectoryName('heavyammo-f9ffd44230dc'), true);
        assert.equal(isHashedHostLocalModificationDirectoryName('heavyammo'), false);
    });

    it('prefers variantId over renderId when resolving host-local render entries', () => {
        const plain = {
            textureUrl: '/foxhole/assets/types/structures/facilityfactorysmallarms/modifications/heavyammo/heavyammo.texture.webp',
        };
        const hashed = {
            textureUrl: '/foxhole/assets/types/structures/facilityfactorysmallarms/modifications/heavyammo-f9ffd44230dc/heavyammo-f9ffd44230dc.texture.webp',
        };
        const entry = resolveAssetScopedModificationRenderEntry(
            {
                heavyammo: plain,
                'heavyammo-f9ffd44230dc': hashed,
            },
            {},
            {
                variantId: 'heavyammo',
                variant: { renderId: 'heavyammo-f9ffd44230dc' },
            },
        );

        assert.equal(entry, plain);
        assert.deepEqual(
            buildHostLocalModificationRenderLookupKeys({
                variantId: 'heavyammo',
                variant: { renderId: 'heavyammo-f9ffd44230dc' },
            }),
            ['heavyammo', 'heavyammo-f9ffd44230dc'],
        );
    });

    it('falls back to renderId when only a hashed host-local entry exists', () => {
        const hashed = {
            textureUrl: '/foxhole/assets/types/structures/facilityfactorysmallarms/modifications/heavyammo-f9ffd44230dc/heavyammo-f9ffd44230dc.texture.webp',
        };
        const entry = resolveAssetScopedModificationRenderEntry(
            { 'heavyammo-f9ffd44230dc': hashed },
            {},
            {
                variantId: 'heavyammo',
                variant: { renderId: 'heavyammo-f9ffd44230dc' },
            },
        );

        assert.equal(entry, hashed);
    });
});
