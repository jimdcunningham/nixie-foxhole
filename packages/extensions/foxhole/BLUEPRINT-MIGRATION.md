# Legacy Blueprint Migration Design

## Decision

Move legacy Foxhole blueprints into Nixie Discover through an owner-controlled,
asynchronous migration flow. A user explicitly chooses every blueprint they want
to keep, reviews its visibility and publishing agreement, and submits it for
conversion. The migration never silently publishes a blueprint, changes its
visibility, or creates an editable workspace project.

`presetMap` is excluded. It represents an obsolete curated preset set rather
than user-owned blueprints and is not part of this migration.

## Goals

- Preserve the owner, title, description, author credit, and `public` or
  `unlisted` visibility of each accepted legacy blueprint.
- Let users migrate one blueprint or a reviewed batch without being repeatedly
  prompted elsewhere in the product.
- Keep the legacy editor usable during the transition: new or updated legacy
  uploads appear as migration candidates on a later visit.
- Make retries safe. A legacy blueprint ID and version can produce at most one
  Nixie migration result.
- Validate legacy archives and run moderation before publishing any Discover
  listing.
- Preserve legacy links after migration.
- Avoid creating a workspace project for every historical upload.

## Non-goals

- Bulk-publish all historical blueprints without owner review.
- Migrate or productize `presetMap`.
- Make a Nixie project a live mirror of a legacy blueprint.
- Automatically delete, alter, or hide the legacy source blueprint.
- Require a user to select a workspace until they choose to edit or adopt a
  migrated blueprint.

## User Experience

### Discover entry point

When a signed-in user has eligible legacy blueprints, `/discover` displays a
private callout such as **Migrate Your Blueprints**. It is not shown to other
users and is dismissible; it should not become a recurring product-wide nag.

The callout opens a private migration area, proposed as `/discover/migrate`.
It lists only the current user's legacy blueprints, with their existing title,
description, author credit, update date, current visibility, and migration
state.

### Review and submission

Users select one or more candidates and review each selected blueprint before
submission. Per blueprint, they can:

- keep or edit the title, description, and author credit;
- keep the original `public` or `unlisted` visibility, or choose the other
  supported Discover visibility;
- review and accept the publishing terms for that upload;
- skip the blueprint without affecting the legacy copy.

Batch controls offer **Apply To All Selected** for metadata defaults,
visibility, and terms acknowledgement. A batch does not bypass the explicit
agreement: the user accepts it for every submitted entry, even when the UI
collects the acknowledgement in one batch action.

Submitting queues work and returns immediately to a progress view. The view
shows queued, downloading, validating, moderating, converting, publishing,
completed, skipped, and failed entries. One failure must not block other work.

### Resulting Discover entry

Each successful source blueprint becomes an immutable, self-contained Discover
release. It preserves the selected visibility:

- `public`: indexed and visible in Discover search;
- `unlisted`: direct-link only, matching legacy behavior.

The Discover page shows that it was migrated from Foxhole Planner and can offer
**Open a Copy**. That action creates an editable Nixie project only then and
asks the user which eligible workspace should own it. Migration itself consumes
no workspace-project quota.

## Data Model

Add a dedicated source/migration record rather than overloading mutable Nixie
projects. The exact table names may change, but the model must retain these
concepts.

### `legacy_blueprint_sources`

One row per legacy blueprint ID.

- `legacy_blueprint_id` (unique)
- `legacy_owner_user_id` (legacy auth identity)
- source metadata: title, description, authors, privacy, current version,
  created/updated timestamps, deleted state
- source storage reference and optional source checksum
- last catalog-sync timestamp

This is an inventory/provenance record, not a publish authorization.

### `legacy_blueprint_migrations`

One row per source-version migration attempt, with a uniqueness constraint on
`(legacy_blueprint_id, legacy_version)`.

- `source_id`, `legacy_blueprint_id`, `legacy_version`
- requesting/owning Nixie user ID
- reviewed metadata and selected visibility
- terms acknowledgement timestamp and terms revision
- status, retry count, progress detail, structured error, timestamps
- archive checksum and conversion-report summary
- linked Discover listing/release IDs when successful

Statuses should be explicit and terminal states immutable: `draft`, `queued`,
`processing`, `completed`, `failed`, `skipped`, `cancelled`, and `blocked`.

### Registry provenance

Registry listings and releases need to support a legacy-backed source. A
migrated release must not require an editable `nixie_projects` row. Store the
legacy source/migration IDs in release provenance and make either a Nixie
project source or a legacy migration source valid.

The converted archive is copied into Nixie registry storage. Discover must
never depend on the legacy storage object remaining available.

## Server Flow

1. Inventory the authenticated user's non-deleted Foxhole blueprint rows from
   the legacy source of truth. Do not expose legacy storage credentials to the
   browser.
2. Compare each current legacy ID/version to the source and migration records.
   Newly uploaded or changed blueprints automatically appear as candidates;
   nothing is migrated automatically.
3. Validate that each submitted entry belongs to the current user and that its
   version is still current. Persist a reviewed migration record and queue it.
4. A bounded-concurrency worker downloads the archive server-side, applies
   archive size/type limits, parses it with the legacy importer, and records an
   import report.
5. Run text and asset moderation before publication. A moderation failure is a
   private `blocked` or `failed` result with a user-safe explanation.
6. Convert the save to the normalized Nixie archive format and upload that
   archive to registry storage.
7. Create or update the legacy-backed Discover listing/release using the
   reviewed metadata, selected visibility, and accepted terms. Mark the job
   completed only after the release and default listing reference are durable.

All steps must be restartable. A worker retry must reuse the migration record,
deduplicate storage by checksum where practical, and never create duplicate
Discover listings/releases for the same source version.

## Continued Legacy Uploads

During coexistence, use pull-based reconciliation rather than permanent
dual-write.

- A login-time inventory refresh finds the user's new/updated blueprints.
- A scheduled, rate-limited catalog sync refreshes source records for legacy
  blueprints that can still be listed by the server.
- A user can manually refresh the migration list.
- Existing completed migration rows remain history. A changed legacy version is
  a new candidate and requires a new explicit review and agreement.

This avoids silently publishing later edits and keeps the legacy editor
independent until it can be retired.

## Legacy URL Compatibility

Legacy blueprint links use the blueprint UUID. Keep the legacy route alive
while game-kitchen is online:

1. Resolve the legacy blueprint ID through `legacy_blueprint_migrations`.
2. If a completed migration has a Discover listing, redirect to
   `/discover/<listing-public-id>`.
3. If no migration exists, retain the current legacy behavior.

The redirect belongs in game-kitchen during coexistence. Later, preserve the
same lookup behind a stable Nixie redirect endpoint before the legacy site is
retired.

## Security and Moderation

- Authorization is server-side and requires the legacy blueprint owner to
  submit a candidate.
- Never treat source metadata as trusted; normalize bounds and HTML/text before
  display or publication.
- Archive download, decompression, parse, and conversion have strict byte,
  entry-count, and time limits.
- Run moderation on reviewed metadata and any relevant extracted content before
  a public or unlisted release is created.
- Keep raw moderation/provider detail out of public pages and old-link
  redirects.
- Preserve an audit trail for agreement, source version, conversion result, and
  publishing actor.

## Rollout

1. Add source, migration, and registry-provenance schema with idempotency
   constraints.
2. Build server-side inventory and a private migration API; test with fixture
   archives and synthetic legacy rows.
3. Build the Discover migration dashboard and background job progress UI.
4. Deploy with a small internal/user allowlist and conservative worker
   concurrency.
5. Enable the Discover callout for eligible users; monitor conversion,
   moderation, retries, and failed archive categories.
6. Enable the legacy URL resolver only after successful migrations exist.
7. Keep reconciliation active until the legacy editor is retired, then freeze
   the legacy source and retain redirect/mapping data.

## Acceptance Criteria

- A user sees only their own eligible blueprints and can migrate one or a
  batch.
- No migration occurs until explicit submission and agreement.
- Selected `public`/`unlisted` visibility is reflected in Discover exactly.
- Repeating a submission or worker retry creates no duplicate listing/release.
- A new legacy upload appears as a candidate without dual-writing data.
- A migrated legacy URL redirects to the matching Discover listing; an
  unmigrated URL continues to work in game-kitchen.
- Moderation or conversion failure is isolated, recoverable, and does not block
  unrelated jobs.
- Migrating 100 legacy blueprints creates zero editable workspace projects;
  adopting one creates exactly one project in a user-selected workspace.
