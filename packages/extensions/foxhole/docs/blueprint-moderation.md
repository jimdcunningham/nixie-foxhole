# Blueprint moderation

Nixie processes the legacy Game Kitchen blueprint queue using the existing OpenAI moderation configuration. Checks cover project text and uploaded images. There is no layout analysis or paid vision call. OpenAI documents the moderation endpoint as free: <https://developers.openai.com/api/docs/guides/moderation>.

The default worker reviews up to **3 uploads every 10 minutes**, ordered by the current version's publication date, oldest first. Public and unlisted uploads are included; private and deleted projects are excluded. Existing manual approvals and rejections are preserved until their content changes.

Set `NUXT_NIXIE_BLUEPRINT_MODERATION_ORDER=newest` on the Nixie server to prioritize recent uploads during the initial backlog pass. The default is `oldest`; remove the override or set it to `oldest` after the backlog is cleared. Restart the server after changing its environment. Each batch log includes the active `order`. Existing leases, retries, and decisions are preserved when the order changes.

## Decisions

- Blank archives and default titles are rejected without API requests. Game Kitchen blocks these in its publishing flow; the database also guards titles. Nixie blocks default titles and empty native archives before storing a release. A small valid scene, document, or populated spreadsheet is sufficient.
- The worker checks titles, descriptions, credits, tags, version notes, project text (including hidden labels), all archive image assets, embedded images, and the published icon.
- Clear results approve automatically. Flagged content goes to **Admin → Blueprint Moderation** in Nixie. Ordinary combat and nonviolent illicit classifications do not trigger review; graphic violence, sexual content, hate, threats, self-harm, and other flags do.
- The API's image categories do not detect hate symbols or hateful text printed inside an image. Layout checks and image OCR are outside this version's scope.
- Missing files retry with backoff. Invalid archives, external image references, animated/unsupported images, and old `project.lzma` archives require manual attention. Unsupported archives need a compatible export before Nixie can preview and approve them.
- A missing published icon is optional: the ZIP and all archive images are still reviewed, and the admin preview shows a warning. Missing ZIPs and other icon download failures still block review. Existing manual rejections remain available in the Rejected queue for reassessment.
- Missing credentials, malformed results, provider failures, and limits never count as approval. Persistent failures move to manual attention after eight attempts.

## Durability and limits

Queue claims use service-only database functions, expiring leases, and row locks. Approval compares the current version, text, tags, and storage revision in the same transaction as the decision. Upload owners cannot directly write the approval column. Changes to a current ZIP, icon, version notes, tags, or listing text revoke approval.

Each run stops starting work after 50 seconds, makes at most 12 moderation requests, and waits one second before each request. Image expansion and processing also have size and time limits. Results are cached for 90 days by content hash, model, and policy version. A large upload resumes from cached checks in a later run; hitting the batch budget does not count as a failure. Actual failures use exponential backoff, capped at one day. Leases expire after ten minutes if the worker stops.

Nixie's Discovery catalogue, detail, thumbnail, and archive delivery honour `blueprints.approved`. Applying the migration therefore removes pending legacy entries from Discovery until they pass. The legacy public storage bucket is unchanged: people with raw storage URLs can still access its objects.

## Rollout

The implementation is disabled by default. Nothing runs against production merely by opening this repository.

1. Release the Game Kitchen publishing guards, which also await both storage uploads before publishing the version pointer.
2. Release Nixie's worker and admin page, keeping background processing disabled during setup.
3. Apply Nixie's pending Supabase migrations to the shared database. These include the original `20261003073620_blueprint_text_image_moderation.sql`, the ordering follow-up `20261003095616_blueprint_moderation_oldest_first.sql`, and `20261003110444_blueprint_moderation_queue_order.sql`, which lets the worker choose either order. Apply the queue order migration before running the updated worker. Do not apply duplicate migrations from Game Kitchen.
4. Enable `NUXT_NIXIE_BLUEPRINT_MODERATION_ENABLED=true` on the Nixie server. It reuses `NUXT_NIXIE_CHAT_MODERATION_API_KEY`, base URL, model, and timeout; use an image-capable omni moderation model. The worker verifies that all required categories were evaluated for the supplied input type.
5. The main deployment already builds Nitro schedules with `NIXIE_BUILD_SCHEDULED_TASKS=true`. Other deployments need that build flag to run the schedule. Optional `NUXT_NIXIE_BLUEPRINT_MODERATION_BATCH_SIZE` defaults to 3 and is capped at 5. Set `NUXT_NIXIE_BLUEPRINT_MODERATION_ORDER=newest` before starting the updated worker to continue reviewing the backlog from newest to oldest; omitted, blank, or unrecognized values use `oldest`.
6. Check the first `nixie:blueprints:moderate` task result and `/admin/blueprint-moderation`. Only after these checks should the backlog be left running unattended. Disable the runtime flag to stop future batches; active leases recover on resume.

Production migration and deployment require separate authorization. The migration installs triggers on the shared legacy tables and Storage metadata, so verify a real upload and replacement after deployment.

## Verification

Focused Nixie tests cover empty/default submissions, document/spreadsheet compatibility, archive/image boundaries, category coverage, duplicate checks, resumable batches, provider errors, stale decisions, and approval-gated delivery. Game Kitchen's `tests/blueprint-publication.test.mjs` verifies that failed or unfinished uploads never publish a version pointer.

`tools/verify-blueprint-moderation.mjs` executes the migration against an entirely in-memory Postgres database with a minimal fixture schema. Pass the path to an installed `@electric-sql/pglite/dist/index.js` module. It checks ordering, role restrictions, single-use and expired leases, stale worker/reviewer decisions, retries, and storage/text/tag invalidation. It never connects to Supabase.
