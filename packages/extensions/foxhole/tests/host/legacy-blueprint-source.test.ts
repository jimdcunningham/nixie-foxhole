import assert from 'node:assert/strict';
import test from 'node:test';
import { isEligibleLegacyBlueprint, foxholeLegacyBlueprintCursor, foxholeLegacyBlueprintSearchText, toLegacyBlueprintListing, toOwnedLegacyBlueprintListing } from '../../server/utils/legacy-blueprint-source.ts';
import { legacyBlueprintSourceId, legacyBlueprintFlag } from '../../../../nixie/app/utils/legacy-blueprints.ts';

const id = '00000000-0000-0000-0000-000000000001';
const versionId = '00000000-0000-0000-0000-000000000002';
const row = { id, version: versionId, name: 'Plan', description: '<script>x</script>', authors: 'Author\u0000', game: 'foxhole', privacy: 'public', approved: true, deleted_at: null, updated_at: '2026-09-30', discord_id: 'secret', user_id: 'unverified' };
test('legacy eligibility rejects every unavailable state', () => {
    assert.ok(isEligibleLegacyBlueprint(row));
    assert.equal(isEligibleLegacyBlueprint({ ...row, approved: null }), false);
    assert.equal(isEligibleLegacyBlueprint({ ...row, approved: false }), false);
    for (const patch of [{ privacy: 'unlisted' }, { privacy: 'private' }, { deleted_at: 'today' }, { game: 'other' }, { version: null }, { version: '1.0' }]) {
        assert.equal(isEligibleLegacyBlueprint({ ...row, ...patch }), false);
    }
    assert.equal(isEligibleLegacyBlueprint(null), false);
});
test('DTO keeps credits and UUID version without inventing license or publisher', () => {
    const dto = toLegacyBlueprintListing(row, { id: versionId, blueprint_id: id, version: 'Old display label' });
    assert.equal(dto.credits, 'Author');
    assert.equal(dto.version.id, versionId);
    assert.equal(dto.version.label, 'Old display label');
    assert.deepEqual(dto.requiredExtensionIds, ['foxhole']);
    assert.equal(legacyBlueprintSourceId(dto.id), id);
    for (const forbidden of ['discord_id', 'user_id', 'terms', 'publisher', 'source_project_id']) {
        assert.ok(!(forbidden in dto));
    }
    assert.throws(() => toLegacyBlueprintListing(row, { id: versionId, blueprint_id: versionId, version: 'x' }));
});
test('cursor and search reject filter injection; production flags fail closed', () => {
    assert.equal(foxholeLegacyBlueprintCursor(id), id);
    assert.throws(() => foxholeLegacyBlueprintCursor('x),privacy.eq.unlisted'));
    assert.equal(foxholeLegacyBlueprintSearchText('x),privacy.eq.unlisted%'), 'x  privacy eq unlisted');
    assert.equal(legacyBlueprintFlag('false'), false);
    assert.equal(legacyBlueprintFlag(undefined), false);
    assert.equal(legacyBlueprintFlag('true'), true);
});


test('owner metadata includes pending uploads without making them public', () => {
    const pending = { ...row, privacy: 'private', approved: null, version: null };
    const dto = toOwnedLegacyBlueprintListing(pending, null);
    assert.equal(dto.title, 'Plan');
    assert.equal(dto.thumbnailUrl, '');
    assert.equal(dto.version.id, '');
    assert.deepEqual(dto.upload, { status: 'Pending Review', visibility: 'private', canView: false, sourceUrl: dto.sourceUrl });
    assert.equal(isEligibleLegacyBlueprint(pending), false);
    assert.throws(() => toLegacyBlueprintListing(pending, { id: versionId, blueprint_id: id, version: '1' }));
});
