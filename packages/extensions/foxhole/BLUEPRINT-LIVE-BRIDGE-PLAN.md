# Foxhole Planner Blueprints: live Discovery bridge

Initial plan prepared 2026-09-30 from direct Windows source inspection. The proposal and investigation below are historical context. **The local implementation status and preview instructions at the end supersede proposed gates and incomplete slices.** No deployment or live database migration has been performed.

## Recommended outcome

Surface the existing public Foxhole Blueprint catalogue in Nixie Discovery now, while `foxholeplanner.com` remains the authoring/publishing system and its database/storage remain authoritative. New legacy uploads and edits continue to appear. A Blueprint is a published reusable design; following it never joins a workspace or grants access to a collaborative project. Opening a copy creates an independent database-backed Nixie project; inserting adds a pinned snapshot to the current board. Neither copy silently follows later source edits.

Use a dedicated **legacy Blueprint source adapter**, initially alongside native registry projects, instead of forcing legacy sources through the current native-project publisher. Keep SDK conversion, owner claiming, new publishing flows, notifications, and full archive backfill out of the first launch dependency chain. Start with approved public sources; hide everything else from public discovery. Do not infer an open license from public visibility.

This plan is a coexistence alternative to `BLUEPRINT-MIGRATION.md`, which remains intact. Its owner-reviewed adoption flow can remain a later optional feature, but its per-version submission gate cannot govern this automatic bridge. Keep `presetMap` excluded as a separate curated seed mechanism; a real Blueprint row is eligible on its own merits even if an old preset map happens to reference its ID.

## Local evidence and scope

All three repositories had empty `git status --short` before inspection and after focused tests. No fetch/reset/checkout/stage/commit was performed.

| Checkout | Inspected HEAD | Role |
| --- | --- | --- |
| `C:\Code\nixie` | `fa0f1e3e8274832b705b84b690baccfbb8316c5c` | Current platform, built-in Foxhole extension, registry prototype, schema and converter |
| `C:\Code\game-kitchen` | `8e73e0e3b226ac2d56c2d5fd27a7abcec2b4707e` | Maintained legacy Planner `/app`, Hub and Blueprint client |
| `C:\Code\nixie-foxhole` | `5734f846bb750871687048c81e9beaa4244aec55` | FoxWatch asset tooling; README describes extension extraction as future work |

Read both repository `AGENTS.md` files, Nixie's `.agents/skills/nixie-extension-development/SKILL.md`, `docs/developer-kit/extension-api.md`, existing Blueprint migration/parity plans, and `docs/platform-registry/10-public-project-registry-implementation-plan.md`. No `AGENTS.md`/`SKILL.md` was found in nixie-foxhole with the file search. Read relevant entries in `C:\Users\james\.codex\memories\memory_summary.md` and `MEMORY.md` (Foxhole migration task group). Memory is historical context, not evidence of current deployed state.

Source references below are relative to the checkout named in each row. Local migrations describe intended schema, **not verified production state**. No secret-bearing env files were printed or live database accessed. A follow-up comparison read only the Supabase URL configuration internally from game-kitchen/.env and nixie/apps/nixie-studio/.env and emitted booleans: both configured and local origins match. No URL/key/secret was output. Shared production database/auth identity and active schedules still need read-only confirmation during implementation.

## Verified comparison

| Surface | Legacy code | Current Nixie code and implication |
| --- | --- | --- |
| Browse | game-kitchen `app/components/menu/hub/Blueprints.vue:416`: game filter, public visibility, approved-only default; optional unmoderated lane admits `approved IS NULL`, excludes false; name/authors search and pagination | nixie `packages/nixie/server/utils/nixie-registry-projects.ts:313`: published public native projects, substring title/description/slug search, newest order, max 48, no cursor. Bridge needs explicit type/filter/pagination and source attribution |
| Detail/link | Legacy `?hub=blueprints&page=view/<UUID>` reads Blueprint by ID and version history | `packages/nixie/app/pages/discover/[listingId].vue`: native listing and Open a Copy. Preserve legacy links; do not redirect legacy users away during coexistence |
| Source identity | `blueprints.id` stable UUID; `blueprints.version` points to **bp_versions.id UUID**, not bp_versions.version display label | Registry release version requires semver, and `source_project_id` is NOT NULL on releases. Never put legacy UUID/display version into native semver or invent a project to satisfy FK |
| Publish/update | game-kitchen `app/plugins/libs/project.js:53`: upsert Blueprint, insert version, update current pointer, then start ZIP/icon uploads asynchronously | Catalogue can point to a missing ZIP temporarily. Metadata-only and tag edits also matter. A worker must not mark conversion ready just because the row changed |
| Library | `app/plugins/libs/game.js:1521` reads current user's bp_subscriptions then latest Blueprint rows; `:1112` supplies current-version URLs to asset browser | No registry follow API/UI/table implementation found in searched local registry paths; follows and a follower library are planned in registry docs, not implemented here |
| Insertion | `Blueprints.vue:562` Open uses createObject with `isSelection=false`; Import uses selection placement. `app/plugins/libs/app.js:4119` fetches preset bytes and imports them | Current registry action downloads an archive and invokes **new-project** import; it has no insert-in-current-board action |
| Pins | `app/components/menu/construction/BrowserAssets.vue:340` and `:373` save versioned Blueprint ZIP URLs in shortcuts | A library subscription follows current source; existing shortcut URLs are pinned. Preserve the distinction rather than pretending all legacy shortcuts auto-update |
| Persistence | Legacy published content uses `blueprints`, `bp_versions`, `bp_tags`, bp_subscriptions and the blueprints storage bucket | `project-create.ts:84` calls `/api/nixie/projects`; server `nixie-projects.ts` uses nixie_projects. `plan-import-ui.ts` writes a cloud `/yjs-snapshot`. Archives are import transport; collaborative Nixie projects remain database/document backed |
| Gates | Legacy Blueprint UI is maintained in game-kitchen | `server/utils/nixie-registry-availability.ts` is development-only. Discovery parent, index and detail pages each redirect production to `/workspaces`. All must be addressed for launch; do not globally enable native publish as a side effect |
| Extension | nixie-foxhole README has tooling, not legacy Blueprint hosting | `packages/extensions/foxhole/app/plugins/nixie-foxhole-contributions.client.ts` registers current built-in ID **foxhole**. SDK example ID nixie.foxhole-planner is not the current host ID |

Schema sources in nixie `packages/nixie/supabase/migrations/`:

- `20260821142444_remote_schema.sql:330`, `:883`, `:899`, `:1140`, `:1182`: legacy/current registry tables. Legacy privacy enum only public/unlisted; deleted_at and nullable user_id exist. Registry publisher_user_id/published_by require users; native release source_project_id requires a project.
- `20260821170038_nixie_split_public_blueprint_read_policy.sql`: anonymous reads admit public **and unlisted**; authenticated policy retains owner/admin handling. Do not use RLS visibility alone as a public catalogue filter.
- Baseline registry SELECT policies also admit unlisted rows. A production bridge must prevent unlisted enumeration at REST/RPC/search as well as UI layers. Existing native policy exposure must be hardened or kept gated before enabling that surface.
- `20260830170600_unified_workspace_authorization.sql:2931`: native publication RPC assumes project authority. Do not bypass it by assigning legacy content to an arbitrary publisher.
- `20260827200256_remove_legacy_discord_webhooks.sql`: removes legacy Blueprint logging trigger; it is not an active ingestion outbox.
- `20260920044752_remove_redundant_legacy_unique_constraints.sql` and `20260925082628_index_active_blueprint_foreign_keys.sql`: legacy relations remain maintained. Baseline includes pg_cron/pg_net, but an active bridge job has not been verified.

## Source adapter and data contract (proposal)

Return a discriminated Discovery DTO: `sourceKind: legacy-foxhole-blueprint`, stable listing key, source UUID, name/description/credits, thumbnail, source link, source updated time, source version UUID/display label, availability/moderation state and compatibility. Render **Foxhole Planner Only** on every card/detail/library item and required-extension information before either import action.

Use built-in `requiredExtensionIds: ['foxhole']`, a legacy format discriminator and a versioned converter/asset-manifest identity. Do not advertise general Scene V2 or standalone SDK compatibility. Host verifies availability and enables the built-in extension deliberately for a new copy; current-board insert requires an editable compatible board and an enabled Foxhole extension. Missing host support gets a clear link to a supported Planner host, not unknown-node destruction.

Persist a small service-owned projection with these conceptual records (names proposed):

- `legacy_blueprint_sources`: unique `(source_system, legacy_blueprint_id)`, stable Discovery public ID, nullable source owner UUID, source version UUID, metadata/tag hash, source privacy/approval/deleted state, desired revision, last successful observation, reconciliation run ID and tombstone. Ownership/claim state is separate from attribution. This table must not expose unlisted inventory to anon/authenticated SELECT.
- `legacy_blueprint_artifacts`: unique `(source_id, legacy_version_uuid, source_sha256, converter_revision, asset_manifest_revision)`; format, validated checksum/size, conversion report, state, retry/lease info and optional private-cache path. Display version is not an idempotency key. If bytes change at the same source version, record a new digest and quarantine/validate it; never replace previously delivered immutable bytes silently.
- `legacy_blueprint_imports`: pinned source/version/hash/converter, importing actor, target project/board, copied or inserted roots, timestamp and attribution/terms acknowledgement. Never require an original owner account as the copying actor. Native registry_project_sources currently requires a native release/publisher: use this dedicated provenance rather than fake FKs.

No source row creates a workspace project or consumes a workspace-project quota. Server-owned records are not claimable by a client-supplied authors string, Discord ID, name, email or source link. Use server-only writes and narrowly exposed sanitized read DTOs. Keep raw private metadata, storage keys and errors out of public responses.

For today's minimal slice, resolve catalogue metadata live from legacy rows behind the adapter and derive a stable namespaced key from the Blueprint UUID. This is ingestion on read, not an export; a refresh sees new uploads without a backfill job. Add the durable projection/cache as the next stage for stable indexing, operational progress and bounded conversions. Both paths use the same DTO and source rules. No need to retrofit native registry publisher/release schema to ship the adapter.

## Lifecycle and visibility (proposal)

Public discovery predicate: game=foxhole, privacy=public, deleted_at IS NULL, approved=true and usable version. Default reject unknown privacy, null version, suspended/removed moderation state and source lookup failures. Null-approved content stays out until an explicitly chosen moderation lane exists. Approved source status does not replace archive validation or safe text/image handling.

On metadata edits, update title/description/credits/tags independently of conversion. On a new version, queue/resolve its bytes, verify source relationship and digest, then promote availability with compare-and-swap against desired source revision. Re-read source before delivery and promotion; an older job cannot revert new metadata or resurrect deletion. While upload/conversion is pending, say so. If offering the prior validated version, label its version and avoid claiming it is current.

Public to unlisted immediately removes search, featured slots, suggestions and public author indexes. For first launch, unlisted stays entirely out of the bridge. Later direct-link support requires known-ID resolution, no list/search enumeration, same legacy reachability and authorization, and no automatic public promotion. Unknown/private or owner-only content requires proven owner authorization; it must never pass through a service-role catalogue query to public DTOs. Cached thumbnail and archive routes must enforce the current source state too.

Soft delete, hard delete, approval false, or an explicit unpublish suppresses the listing and source downloads. Existing independent user copies/insertions remain; they do not become live source mirrors. Keep a minimal tombstone to prevent resurrection and preserve provenance. Do not delete source objects or redirect legacy routes. Hard deletion is found by point lookup/full reconciliation; absence in an incomplete or failed scan is not deletion. A public-only scan cannot distinguish deletion from unlisting, so use authenticated service inventory with explicit rules, or verify missing known IDs before tombstoning. Fail closed for public serving when eligibility cannot be established; do not serve indefinitely from stale visibility caches.

Revocation cannot erase bytes already downloaded or independent copies. Avoid exposing public cache object URLs that keep serving revoked content; use checked endpoints and short-lived delivery, with strict cache invalidation for catalogue/detail/thumbnail. Legacy public bucket exposure is a pre-existing limitation, not permission to reproduce it in Nixie.

## Attribution, adoption and collaboration (proposal)

Display legacy authors as **Credits** and source owner separately only when verified. A missing profile/owner is allowed for the bridge; it is not a reason to create an account or name Nixie as the author. Preserve source links and timestamps, escape/sanitize text, and do not expose discord_id/email. Do not map legacy content to a newly invented open license or native `terms_kind=open`.

**Reuse evidence and corrected scope:** game-kitchen `app/components/menu/hub/Project.vue:224-225` asks "Publish your project to the community blueprints?" and says submissions are subject to review; `:457` describes publishing a shareable link. `Blueprints.vue:844-851` visibly provides Open, Import and Download, with `:562-566` invoking the importer for opening versus selection insertion. These are explicit product affordances for other users to reuse published Blueprints, not just view metadata. `app/pages/terms.vue:45-50` says creators keep ownership and grants the app permission to store, transmit, process and display content for service operation; it does not specify a new open-content license or ownership transfer. Thus ordinary public Blueprint copy/import parity in the same Planner successor is supported by existing product intent. **No fresh per-owner consent requirement or blanket reuse blocker was found.** Preserving attribution and existing use context is the default; checking applicable deployment/publishing policy is prudent release verification, not a demand to obtain new author consent before implementing the bridge. Optional native republication with new licensing, ownership transfer, or broader visibility remains a separate explicit review flow. This is a code/product finding, not a determination of legal rights for every upload.

Copy means the requester owns/manages a new destination under normal workspace rules and retains source provenance. It does not transfer original Blueprint ownership. Native adoption/publishing later requires verified account linkage to legacy owner UUID, explicit terms/visibility review and a separate Nixie source/listing. If both apps demonstrably share the same auth project, an authenticated UUID match can prove linkage; otherwise require an explicit account-linking proof. Never match by display credit. Claiming must not disable legacy sync unless the verified owner explicitly elects an independent native fork. Resolve races/audit transfers server-side.

**Follow Blueprint** stores a source subscription and means latest published design on library refresh. **Join Project** uses existing workspace/project invitation and access policy for a live database-backed project. Following, opening and inserting do not grant project membership. Live collaboration stays in the project/Yjs/access system, with no general ZIP-sharing workflow.

## Archives and import implementation (proposal grounded in existing seams)

`packages/extensions/foxhole/app/plugins/foxhole/legacy/plan-archive.ts` reads ZIP project.json/project.lzma and bare JSON. `plan-importer.ts` upgrades, maps entities, outputs boardSnapshots/pendingImages/report; it is runnable under the existing Node import registration. `plan-import-ui.ts` materializes images, maps identity/map settings, writes a project document and navigates. SDK protocol v1 has no general editor writes; keep this work in the existing host/built-in extension instead of inventing SDK APIs or production-enabling Scene V2.

Required before enabling Open a Copy: repair the legacy UI wrapper to use the current `creation.target` contract. It currently reads surface/workspaceId and calls createProjectRecord without the required target; current project-create.ts requires target and sends it to the server. Native project-archive-import.ts already uses target. Static inspection identifies this mismatch; no browser reproduction was performed. Preserve target/permission/quota errors and cleanup only the newly created failed project.

Provide a host import entry point that accepts a validated source/version token and conversion result. Apply explicit compressed/uncompressed byte, entry, entity, image and elapsed-time limits **before** expensive JSZip/LZMA allocation; current reader is compatibility code, not a complete hostile-archive sandbox. Use fixed trusted storage origin and UUID-derived path, not arbitrary URLs from user metadata. Reject traversal, external asset fetches, unsupported media, corrupt/empty imports and critical unresolved entities; preserve bounded conversion reports for acceptable omissions. Verify version belongs to its Blueprint. Retry 404 from upload races and 429/5xx with bounded exponential backoff; permanent failure stays isolated.

First conversion can happen on demand using the current built-in importer after a bounded server resolver returns checked legacy bytes. This removes the need to normalize every archive before catalogue launch. For throughput, later bounded Node/Nitro jobs can build private immutable normalized archives without creating real workspace projects. Server-safe image/archive normalization is additional work, not a proven existing export method. Do not pass raw legacy project.json to the native archive importer: both formats can use that filename but have different contracts.

Existing PARITY-AUDIT.md reports a historical 1,282-plan corpus with zero hard errors and bounded gaps. Those historical counts were not rerun here. Keep reportable losses visible: undercarriages/drivable trains, crop, socket visual certification, custom icon and ignored road connections; do not let unrelated parity/SDK rewrites block compatible ordinary bunker/facility plans.

## Library and insertion loop (proposal)

Browse -> detail -> Follow Blueprint -> My Blueprint Library -> Open a Copy or Insert Into Board. Opening/inserting does not require following. Search includes source title/description/credits/tags, public eligibility and cursor pagination; do not merge source UUIDs and native IDs without sourceKind.

If read-only config verification proves shared database/auth, reuse bp_subscriptions through the authorized user client/checked server operation so legacy and Nixie stay consistent. Read only current actor's subscriptions; library refresh resolves current permitted source versions. Check source eligibility before subscribing. Inspect existing uniqueness and deduplicate any historical pairs before depending on upsert; the pair uniqueness must be verified rather than assumed. If auth/database are separate, use a Nixie-owned `(user_id, source_id)` follow table and explicit optional account linking later; do not import every user's subscriptions with service credentials. Followers of withdrawn sources get a private unavailable item or removal, never leaked cached content.

For Insert Into Board, reuse/refactor host selection insertion at `packages/nixie/app/plugins/nixie/contributions/actions/selection.contrib.ts:818`. It checks canEdit, clones with fresh IDs/remapped references, resolves active-layer parent, executes a batch with inverse operations, selects and optionally places at cursor. Its helper is currently private; expose a narrow host helper, not a public SDK mutation primitive. Do not overwrite the entire target yjs-snapshot or inherit source project settings/name/map automatically.

Materialize image assets into the destination with proper asset-ID/URL remapping. Remap socket/spline/group and all declared node references; preserve relative transforms; repeated insertion must not cross-link to previous inserts. Commit board changes as one undoable operation; failed asset/conversion work must not partially place roots. Undo removes the inserted roots and redo restores them; orphan assets need bounded cleanup. Attribute each insertion on the target, not just the whole project's original source. Legacy versioned shortcut imports remain pinned; new library shortcuts default to follows-current with an explicit Pin Version option later. No automatic modification of already placed content.

## Backfill and ongoing sync options

Preferred first: live catalogue/read resolver in Nitro plus optional durable cache; refresh finds new uploads today without changes in game-kitchen. Point lookups recheck access. Load metadata, not every archive, at catalogue start.

Preferred next: bounded Nitro task with durable database work records/leases, no in-memory-only queue. Repository evidence: Nixie nuxt.config.ts registers scheduled chat delivery behind NIXIE_BUILD_SCHEDULED_TASKS; Foxhole has a similarly gated purge task. `.github/workflows/deploy-nixie.yml:118` sets both build flags for main. This supports adding a task, but current deployed scheduling reliability is not verified. Prevent duplicate execution across replicas with leases/locks and expiration. A manual server-side CLI dry-run/backfill can use the same reconciliation module, rate limits and cursor. Resume after each committed batch; counts are eligible/queued/ready/blocked, not fabricated migrated-user totals.

Use overlapping `(updated_at,id)` watermark scans plus periodic full ID reconciliation. Tag/moderation/metadata changes may not advance updated_at reliably; periodically hash full metadata/relations or add narrowly scoped source revision triggers later. Do not depend solely on version changes. No initial historical-version archive backfill: current versions first. pg_cron/pg_net are schema-supported alternatives requiring runtime/secret/job verification, not assumed active services. A future source transaction outbox can improve prompt updates/deletes, but must wait for storage readiness and retain periodic reconciliation. Cloudflare Queues/Workers are not required or verified existing Blueprint infrastructure.

`tools/legacy-plans/download-presets.mjs` is fixture tooling, not a production sync job. Its default privacy=all and historical all-source fixture inventory can include unlisted content. Never bulk-publish fixtures or run its defaults as a public bridge backfill. It also writes fixture files; not run in this investigation.

## Smallest safe delivery sequence

1. **Slice A, content visible:** add legacy source DTO/query/detail adapter to Discovery and scoped production read gates. Approved public rows only; current metadata/source links; Foxhole Planner Only badge; no synthetic publisher account, native release or project. Legacy site stays usable. Add cursor pagination and sanitized attribution. This is a useful partial launch, not loop parity. Do not hold copy behind speculative author-consent work; its real gates are the engineering checks in B.
2. **Slice B, usable Nixie copies:** fix destination target mismatch; bounded resolver + on-demand built-in importer; explicitly enable foxhole; persist database-backed copy and pinned provenance. Test failure cleanup/reload and two-account permissions. This is the first shippable in-Nixie reuse slice; prerequisites are correct visibility/attribution and fixture/browser validation, not owner onboarding, a new license, or SDK conversion.
3. **Slice C, complete requested loop:** subscription/library endpoints and UI, current-board import helper with reference/asset remapping and undo/redo. Can follow directly after B in the same implementation session if tests pass. Do not report parity until this ships.
4. **Slice D, durable operations:** service-only source/artifact tables, reconciliation task/backfill dry-run, immutable cache and failure dashboard. Retain read-time eligibility checks. Build owner-reviewed optional native adoption later using the existing migration design with explicitly separate listing/source authority.

Production flags proposed: `legacyBlueprintDiscoveryEnabled`, `legacyBlueprintCopyEnabled`, `legacyBlueprintLibraryEnabled`, `legacyBlueprintInsertEnabled`, `legacyBlueprintSyncEnabled`; exact runtimeConfig/env names to follow repository conventions. Gate server routes and client navigation consistently. Start allowlisted for copy/insert; public catalogue only after visibility tests. Do not replace isNixieProjectRegistryEnabled() with unconditional true: leave native publishing gated and extend shared Discovery read composition deliberately. Define disabled behavior for cached requests and desktop hosts.

## Validation and rollback

Required implementation tests: source DTO sanitization; UUID identity/display-version separation; duplicate retries/concurrent leases; changed bytes at same version; tag-only edits; stale worker promotion; delayed/missing ZIP; public to unlisted/deleted/approval false before delivery; failed/incomplete scans; private inventory and REST/RPC enumeration denial; server secret isolation; malformed ZIP/LZMA and decompression bounds; image/asset references and conversion losses.

Library/copy/insert tests: actor-only subscriptions and proven account mapping; follows advance while copies/placements/pins do not; repeated insert creates fresh internal links; active-layer/locked-layer/read-only authorization; undo/redo; current project's settings remain intact; failed copy removes only its newly created record; correct personal/team target and foxhole enablement; reload rehydrates durable content; project membership never changes due to follow.

Browser acceptance with existing authorized test accounts (coordinate separately, no new accounts assumed): browse a known approved public source, copy to selected destination, reload; subscribe and refresh after a synthetic source revision in a local/test DB; insert twice with sockets and images, undo/redo, and verify another collaborator observes normal document changes. Test non-Foxhole hosts and disabled extension, archived sources and anonymous listing access. Compare representative old/new renders; test train/crop limitations rather than asserting full fidelity.

Deploy/production checks belong to the next authorized phase: confirm database/auth origin equivalence and migrations read-only, current source rights/terms, route gates and deployed asset revision; dry-run backfill first; compare public eligible/source counts without leaking unlisted metadata; monitor sync lag, unavailable current-version objects, conversion warnings, failures and retry volume. Never claim schema applied or content surfaced from source inspection alone.

Rollback: disable copy/insert/sync separately, then legacy Discovery reads if needed; cancel/expire leases and reject promotions. Preserve legacy source/storage, legacy URLs, user subscriptions and already created database projects. Keep additive mapping/provenance/tombstones for retry and audit; no destructive down migration or mass deletion of user copies. Remove orphan derived caches only after reference checks and retention window. Native registry remains gated throughout.

## Genuine decisions and blockers

- **Reuse terms are a prudent check, not a demonstrated blocker:** community publication and explicit Open/Import/Download actions establish product intent for reuse. Preserve that behavior and attribution; do not invent licensing/ownership. No extra per-author approval is required by the inspected code for the requested bridge. Native republication/claiming with changed rights remains separate.
- **Database/auth alignment is an engineering verification, not a user choice:** both local app .env configurations resolve to the same Supabase origin (boolean-only comparison). The combined schema also contains both domains. Deployed environment equivalence remains unverified; confirm the two runtime origins/auth issuer project and required grants read-only before reusing bp_subscriptions or treating an authenticated UUID as legacy ownership proof. If they match, reuse actor-scoped subscriptions and UUID identity with no new onboarding. If they differ, ship public browsing/copy plus independent Nixie follows; defer account linking rather than ask James to design identity migration. Only a demonstrated contrary deployment/policy constraint needs escalation. No user decision is needed now beyond authorizing the next implementation phase.
- **Current target contract mismatch:** code repair plus focused and browser integration validation required for legacy Open a Copy. This is engineering work, not a product decision.
- **Visibility and production gates:** enable only the bridge after server enforcement and unlisted-enumeration tests; existing permissive native registry policies cannot simply be exposed.

Defaults reduce decision burden: approved public only, no historical archive sweep, built-in foxhole adapter, live reads first, immutable copy/insert provenance, no automatic native ownership adoption, no SDK rewrite, no legacy redirect. No caregiving-dependent synchronous owner review/onboarding cycle required for the bridge.

## Checks actually performed

Node v24.6.0. Ran from `C:\Code\nixie\packages\extensions\foxhole`:

```powershell
node --import ./tools/legacy-plans/register-nixie-imports.mjs --test --test-isolation=none ./tests/legacy/plan-archive.test.ts ./tests/legacy/plan-identity-settings.test.ts ./tests/legacy/plan-image-import.test.ts
```

**13 passed, 0 failed/skipped.** Covers ZIP JSON/LZMA, bare JSON/format detection, identity/map settings and image mapping/pending-image collection. Node emitted the existing module-type warning. No full corpus rerun, full suite/typecheck, browser, deployed route, live DB, or production archive/runtime verification. These tests validate existing converter seams, not the proposed bridge or the destination wrapper.


## Implemented locally — 2026-09-30

The legacy Planner remains the authoring and publishing source of truth. Nixie reads approved public Foxhole Blueprints live, so new uploads and source edits become visible on refresh without a catalogue backfill. Legacy subscriptions use the account's existing `bp_subscriptions`; native project subscriptions use the separate `nixie_registry_subscriptions`. Following changes neither project membership nor already imported content.

Local implementation commits:

- `80a2fc96`: legacy catalogue/detail adapter.
- `28e9ed0a`: shared legacy subscriptions and library.
- `fbd8ce6c`: checked archives and independent cloud copies.
- `02a9e78c`: native subscriptions and combined library.
- `478843fc`: checked native copies and legacy/native insertion into an existing board.
- `b0cb2b55`: enable supported Discovery flows in release builds.

### Consumption and UI

Discovery navigation, native public browse/detail, owner-authorized native project publication, both subscription sources, copy, and insertion no longer require a development build. Defaults enable the supported flows. Actual sign-in, workspace ownership, project edit permissions, current source eligibility, archive checks and licensing requirements remain in force. Legacy upload/edit/publish remains in the old Planner; no management UI or SDK conversion was added.

The existing Discovery library cards now expose **Open a Copy**. In an editable scene, **File → Discovery Library** opens the same cards in the existing modal components. **My Library** shows both subscription sources; **Browse Projects** searches the public catalogue without requiring a subscription. Cards distinguish **Legacy Blueprint · Foxhole Planner Only** and **Native Nixie Project · Nixie Only**. **Insert Into Board** uses the current unlocked active layer. Native projects with multiple scenes offer the existing select/modal styling to choose a scene. No board settings, map, project name, or existing catalogue entries are overwritten.

Each placement receives fresh node IDs and remapped declared node references. Source layers become groups retaining their transforms and visibility. Image URLs and asset IDs point to the destination. Nodes, image catalogue additions, and pinned root provenance enter the Yjs document through one simulated-then-applied update, sharing undo/redo. Permission, project, scene, layer and required-extension checks run again after asynchronous work. No fallback layer is created. Native insertion rejects documents, spreadsheets and unavailable node types; use Open a Copy for supported projects containing documents/spreadsheets. Scene V2 Discovery publication/import is explicitly unsupported; ordinary local archive compatibility remains intact.

Native copies preserve the archive's enabled extensions and pinned listing/release/hash provenance. Additional native scene images are exported as portable archive assets and rewritten on import. Failure before document persistence removes only the newly created project; icon/navigation errors after persistence preserve the copy. Cleanup failures identify the new project for manual removal. Failed insertion may leave successfully uploaded image records in the destination's asset storage/catalog service; it does not insert roots or delete possibly reused/user assets. Those records can be reviewed using the existing asset browser. No automatic deletion on undo: redo must retain the image bytes.

### Preview routes and prerequisites

From `C:/Code/nixie`, start the Studio development server against an explicitly chosen local/test backend:

```powershell
$env:NODE_OPTIONS = '--max-old-space-size=8192'
npm run dev --workspace @nixiejs/studio -- --host 127.0.0.1 --port 3100
```

Visit `http://127.0.0.1:3100/discover`, `/discover/library`, `/discover/foxhole-blueprint-<source-UUID>` or `/discover/<native-public-ID>`. Open an editable project scene and choose **File → Discovery Library** for insertion. Native publication uses the existing **Publish Project** section in project management and still requires the current workspace owner and the existing public profile/use terms. Both source copies require a cloud destination.

Discovery ships enabled by default. Optional operational rollback environment switches (set a value to `false` to disable it):

- `NUXT_PUBLIC_NATIVE_DISCOVERY_ENABLED`
- `NUXT_PUBLIC_NATIVE_DISCOVERY_SUBSCRIPTIONS_ENABLED`
- `NUXT_PUBLIC_LEGACY_BLUEPRINT_DISCOVERY_ENABLED`
- `NUXT_PUBLIC_LEGACY_BLUEPRINT_COPY_ENABLED`
- `NUXT_PUBLIC_LEGACY_BLUEPRINT_LIBRARY_ENABLED`
- `NUXT_PUBLIC_LEGACY_BLUEPRINT_INSERT_ENABLED`

The old per-account reuse allowlist has been removed. Shared legacy subscriptions still require `NUXT_LEGACY_BLUEPRINT_VERIFIED_SUPABASE_URL` to equal the configured Supabase origin after a read-only check proves that Nixie and the Planner use the same database/Auth project. This is an identity correctness prerequisite, not a development feature gate. Local `.env` origin comparison previously matched; actual Auth/API behavior and deployed environment mapping remain unverified.

Apply migrations only to an authorized local/test database before hands-on testing:

- `packages/nixie/supabase/migrations/20260930073355_shared_blueprint_subscriptions.sql`: the unique actor/Blueprint subscription pair; fails if historical duplicates require review.
- `packages/nixie/supabase/migrations/20260930081023_native_registry_subscriptions.sql`: independent native subscriptions and actor-scoped policies.

Verify existing legacy grants/RLS, native registry/storage and publication RPC migrations, and the normal local/test Yjs gateway configuration. No migration was applied to a live database. The previously established isolated PostgreSQL test harness passed 18 assertions for subscription isolation; full local Supabase was unavailable because Docker startup failed. Docker was not repaired, restarted or reset.

Before deploying, James should exercise both source flows, reload copies, insert twice with sockets/images, undo/redo, verify the latest source revision changes library results while placements stay pinned, and inspect representative visual fidelity against the old Planner. Check withdrawal/unlisted handling and a second authorized test account. Deployment, push, version bump, release notes and SDK work are outside this local change.

### Verification evidence and remaining limits

- 66 focused host tests passed with per-file isolation and concurrency 2, covering source eligibility, subscription auth/isolation/current versions, native release size/hash/revision/revocation, copy failure lifecycle, reference remapping, atomic insertion, images, undo/redo and encoded-state reload, plus existing Scene V2/local-archive compatibility and publication authority.
- 13 legacy archive/identity/settings/image tests passed. The historical full-plan corpus and rendered visual comparisons were not rerun.
- After ungating, 33 focused subscription/delivery/copy/insertion/release tests passed; the final combined host run also passed all 66 tests.
- Final focused lint completed with no errors and one unused test-fixture warning. Full touched-file lint retains existing parser `no-control-regex` and Yjs-session lint errors. Final generated app/server TypeScript checks report 988/1047 diagnostics, compared with the earlier 982/1047 baseline. No errors occur in the new insertion, copy, dialogs or archive-bound helpers. Existing archive/import diagnostics remain; stronger generated Supabase types also expose four diagnostics on unchanged native registry statements (nullable terms/release IDs and manifest JSON), in addition to its two prior client-type diagnostics. These checks are not a clean repository typecheck; Vue scripts are compiled by the build rather than covered by the ordinary TypeScript invocation.
- Full Studio build passed with a process-scoped 8 GB Node heap. Logs are under `C:/Users/james/AppData/Local/Temp/blueprint-bridge-build-final.log`, `blueprint-bridge-tests-final.log`, and `blueprint-bridge-types-*-final.log`.
- Real Supabase Auth/API, cross-app account subscriptions, browser interactions, collaboration delivery and screenshot/visual certification remain unverified. No screenshot or end-to-end success is claimed. Operational projection/cache/sync jobs remain deferred; current catalogue resolution is live on read.


## Follow-up verification and failed-insertion mitigation

`769d6c66` adds image preflight and failure handling. Native insertion resolves every selected-scene image before uploading anything and uploads only that scene's unique referenced images. Legacy insertion already preflights missing image data; it now supplies the current destination catalogue for deduplication and computes provenance before image uploads. Both flows recheck the destination between uploads, stop further uploads when editability changes, and explain retained images in the failure message. The board commit remains one atomic Yjs update.

Automatic asset deletion is deliberately unavailable with the current contract, for concrete reasons:

- `runSharedNixieProjectImageContentHashUpload` returns the same result object to concurrent callers. Both callers can see `reused: false`; that flag cannot establish exclusive ownership. A regression test demonstrates this exact case.
- `deleteNixieProjectAssetFromDocument` clears project references, marks the asset deleted and queues blob garbage collection. It has no conditional task-owner token or atomic unused-reference predicate. A collaborator can begin using the asset while the insertion is awaiting uploads; a local snapshot check cannot exclude that race.
- An upload can create its asset record and then reject before returning its ID. The insertion caller has no rollback handle for that partial outcome. Adding an exclusive staged-upload lease and server-side conditional abandonment would change the shared upload protocol and is beyond this narrow feature fix.

Consequently the safe mitigation preserves possibly shared/reused/user assets, minimizes uploads before validation, stops on destination changes and supports content-hash reuse on retry. After completed uploads, the failure message includes an Assets/retry hint; no content or reference deletion is attempted. A failed first upload without a returned result retains the existing upload error and existing upload-service lifecycle.

### Exact app typecheck comparison

The earlier 982 diagnostic log and the final 988 log differ by these six path/code entries; all four files are unchanged from `02a9e78c`:

| File | Lines | Code | Exact issue |
| --- | --- | --- | --- |
| `packages/extensions/runtime-demo/app/plugins/runtime-demo/pong/presentation.ts` | 69, 83 | TS2769 (two) | Numeric font weight is incompatible with Pixi Text overloads. |
| `packages/extensions/ttrpg/app/plugins/nixie/contributions/ttrpg/fog-reveal.contrib.ts` | 861 | TS2322 | `FogToolOptions` lacks the index signature required by the tool instance default-options type. |
| `packages/extensions/ttrpg/app/plugins/ttrpg/fog/viewport-plugin.ts` | 224 | TS2551 | `Renderer` has no `destroyed` property. |
| `packages/nixie/desktop-extensions/contribution-adapter.ts` | 67, 70 | TS7006 (two) | The callback `context` parameters have implicit `any` types. |

A controlled comparison used the same installed TypeScript compiler and `apps/nixie-studio/.nuxt/tsconfig.app.json` for both runs. A custom in-memory CompilerHost replayed original source files from `git show 02a9e78c:<path>` for every changed source file and excluded files added since that commit. It did not check out, overwrite or reset any repository file. Current source and original source each produced **988 diagnostics**, with **zero additions and zero removals** when comparing file, diagnostic code and complete flattened message (ignoring line movement). This establishes that the six are present in the original source under the current generated configuration. The original generated configuration was not preserved, so its precise generation difference cannot be reconstructed; the earlier 982 result is not a reproducible current baseline. No unrelated baseline source fix was made.

Evidence artifacts: `C:/Users/james/AppData/Local/Temp/blueprint-bridge-compare-types.cjs`, `blueprint-bridge-controlled-baseline.json`, and `blueprint-bridge-controlled-current.json`. Repeated the comparison after the follow-up build using a 35-file original-source overlay. The 74-test host suite includes eight added image-preparation tests, including legacy materializer preflight/current-catalog behavior and concurrent upload ownership. Focused lint passes for all four files changed by this fix; the 13 legacy tests and full Studio build also passed again. Follow-up logs: `blueprint-bridge-tests-retention.log`, `blueprint-bridge-legacy-tests-retention.log`, `blueprint-bridge-lint-retention.log`, and `blueprint-bridge-build-retention.log` in that same Temp directory.

### Local review without production changes

No live schema change is needed to run the app against an isolated local/test backend. The app does not apply migrations on startup. Full supported follow/copy/publish/insert testing requires the existing native registry, storage, publication RPC and Yjs schema plus the two subscription migrations **in that test backend**. Public browsing does not need the new subscription tables, but a populated approved/public source catalogue and the pre-existing source/registry schema are still required. A shell-only preview with an unreachable local backend cannot validate cards, source data or consumption behavior.

Use a dedicated PowerShell session with explicit local/test Supabase URL and keys so an existing `.env` cannot silently direct mutations to production. The repository's installed Supabase module gives the following `NUXT_*` values precedence over `SUPABASE_*` fallbacks:

```powershell
$env:NODE_OPTIONS = '--max-old-space-size=8192'
$env:NUXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
$env:NUXT_PUBLIC_SUPABASE_KEY = '<anon key from the chosen local/test backend>'
$env:NUXT_SUPABASE_SERVICE_KEY = '<service-role key from that same backend>'
$env:NUXT_SUPABASE_SECRET_KEY = $env:NUXT_SUPABASE_SERVICE_KEY
$env:NUXT_LEGACY_BLUEPRINT_VERIFIED_SUPABASE_URL = $env:NUXT_PUBLIC_SUPABASE_URL
$env:NUXT_NIXIE_GATEWAY_ORIGIN = 'ws://127.0.0.1:3100'
$env:NUXT_NIXIE_WORKSPACE_GATEWAY_ORIGINS = 'http://127.0.0.1:3100'
$env:NUXT_PUBLIC_NIXIE_CLOUD_ORIGIN = 'http://127.0.0.1:3100'
$env:NUXT_NIXIE_REALTIME_SIGNING_SECRET = '<random secret for this local gateway>'
$env:NIXIE_BUILD_SCHEDULED_TASKS = 'false'
$env:FOXHOLE_BUILD_SCHEDULED_TASKS = 'false'
npm run dev --workspace @nixiejs/studio -- --host 127.0.0.1 --port 3100
```

Replace placeholders using only the selected test backend's configuration. Set the verified legacy origin only after both Planner and Nixie target that same test database/Auth project. Existing billing/image-moderation policy still applies; no policy bypass was added. The normal gateway ticket flow uses the local signing secret. Use authorized test accounts, a ready test image-storage bucket and moderation configuration, and approved public fixtures. If testing a remote isolated backend, replace its URL and keys explicitly while retaining the local gateway settings.

The Docker startup failure still blocks a full local Supabase preview on this PC; Docker was not retried or repaired. An already working authorized test backend is an alternative. No hands-on browser or visual acceptance is claimed.
