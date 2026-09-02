import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    buildRenderIdComputation,
    buildSharedModificationIdComputation,
    normalizeStandaloneModificationKeyComponent,
} from './shared-modification-id.mjs';

describe('shared-modification-id renderId parity', () => {
    const goldenVectors = [
        {
            variantId: 'bunkbed',
            dataClassPath: 'War/Content/Blueprints/Structures/FortModData',
            variant: {
                templateActorPath: 'War/Content/Blueprints/Props/BunkBed/BP_BunkBed',
            },
        },
        {
            variantId: 'stairs',
            dataClassPath: '',
            variant: {
                templateMeshPath: 'War/Content/Meshes/Structures/Stairs/SM_Stairs',
            },
        },
        {
            variantId: 'pipe',
            dataClassPath: 'War/Content/Blueprints/Structures/PipeModData',
            variant: {
                previewMeshPath: 'War/Content/Meshes/Props/Pipe/SM_Pipe',
            },
        },
    ];

    for (const vector of goldenVectors) {
        it(`computes stable renderId for ${vector.variantId}`, () => {
            const result = buildRenderIdComputation(vector.variantId, vector.dataClassPath, vector.variant);
            const recomputed = `${normalizeStandaloneModificationKeyComponent(vector.variantId)}-${createHash('sha256')
                .update(result.identity)
                .digest('hex')
                .slice(0, 12)}`;
            assert.equal(result.renderId, recomputed);
            assert.match(result.renderId, /^[a-z0-9-]+-[a-f0-9]{12}$/);
        });
    }

    it('ignores dataClassPath when template path exists', () => {
        const withoutDataClass = buildRenderIdComputation('bunkbed', '', {
            templateActorPath: 'War/Content/Blueprints/Props/BunkBed/BP_BunkBed',
        });
        const withDataClass = buildRenderIdComputation('bunkbed', 'War/Content/Blueprints/Structures/FortModData', {
            templateActorPath: 'War/Content/Blueprints/Props/BunkBed/BP_BunkBed',
        });
        assert.equal(withoutDataClass.renderId, withDataClass.renderId);
    });

    it('ignores dataClassPath when template path is missing', () => {
        const pipeA = buildRenderIdComputation('pipe', 'War/Content/Blueprints/Structures/PipeModDataA', {});
        const pipeB = buildRenderIdComputation('pipe', 'War/Content/Blueprints/Structures/PipeModDataB', {});
        assert.equal(pipeA.renderId, pipeB.renderId);
        assert.equal(pipeA.identity, 'pipe|');
    });

    it('shares renderId across directional fort slots with same template', () => {
        const template = { templateActorPath: 'War/Content/Blueprints/Props/Radio/BP_Radio' };
        const front = buildRenderIdComputation('radiostation', 'War/.../FrontInfraModSlot', template);
        const back = buildRenderIdComputation('radiostation', 'War/.../BackInfraModSlot', template);
        assert.equal(front.renderId, back.renderId);
    });

    it('shares renderId for pipe insulation hosts with different dataClassPath', () => {
        const template = {
            templateActorPath: 'War/Content/Blueprints/Structures/Facilities/Modifications/BPFacilityPipeInsulated.uasset',
        };
        const pipe = buildRenderIdComputation('insulation', 'War/.../BPFacilityPipe_UpgradeSlotComponent', template);
        const underground = buildRenderIdComputation('insulation', 'War/.../BPFacilityPipeUnderground_UpgradeSlotComponent', template);
        assert.equal(pipe.renderId, underground.renderId);
    });

    it('buildSharedModificationIdComputation delegates to renderId without dataClassPath', () => {
        const legacy = buildSharedModificationIdComputation('bunkbed', {
            templateActorPath: 'War/Content/Blueprints/Props/BunkBed/BP_BunkBed',
        });
        const renderId = buildRenderIdComputation('bunkbed', '', {
            templateActorPath: 'War/Content/Blueprints/Props/BunkBed/BP_BunkBed',
        });
        assert.equal(legacy.generatedSharedModificationId, renderId.renderId);
    });
});
