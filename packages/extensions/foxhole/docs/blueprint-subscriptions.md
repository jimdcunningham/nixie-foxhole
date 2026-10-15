# Shared Blueprint subscriptions

Legacy Blueprint subscriptions use `public.bp_subscriptions` directly. Nixie never
copies them into a new follow table or writes subscriptions with a service client.
The authenticated Supabase UUID is the same account key used by Foxhole Planner.
The existing SELECT/INSERT/DELETE grants and actor-only RLS remain unchanged.
Native project subscriptions use the separate `public.nixie_registry_subscriptions`
table. Its foreign key and public-ID constraint accept only native registry listings.
Both source types appear in My Discovery Library, in separate sections labelled
Legacy Blueprints and Native Nixie Projects. These are follows, not collaborations.

Native subscription APIs retain the existing development-only registry gate and
require `nativeDiscoverySubscriptionsEnabled`. Apply the local native subscription
migration before enabling this flag in an authorized isolated environment. This
slice does not enable native publishing or subscriptions in production.

## Enablement prerequisites

1. Both apps use the same configured Supabase Auth/database and account UUIDs;
   no separate account mapping setting is required. Each request validates the
   authenticated user client against the server-resolved actor UUID.
2. Read-only inspect deployed `bp_subscriptions` grants, RLS, and pair duplicates.
   The baseline schema has actor-only SELECT/INSERT/DELETE policies, column INSERT
   grants, user/source foreign keys, and no unique user/source pair. Apply
   `20260930073355_shared_blueprint_subscriptions.sql` in an authorized deployment
   only after duplicate review. It adds pair uniqueness and deliberately fails if
   duplicates exist, rather than deleting historical rows automatically.
3. Enable Discovery and Library flags together. Subscriptions are authenticated;
   copy and insertion keep their separate flags. No game-kitchen release is needed.

Public deployed HTML was compared read-only on 2026-09-30: foxholeplanner.com and
nixiejs.com each advertised one Supabase origin, and those origins matched. This
does not prove deployed grants/indexes or replace authenticated account verification.
No live subscription or content was mutated during that comparison.

## Behavior and acceptance

Subscribe is idempotent `ON CONFLICT DO NOTHING`, requiring the unique pair index
and existing INSERT grants only. Unsubscribe deletes only the actor/source pair,
including withdrawn sources. Library reads only the actor's paginated pairs and
resolves current eligibility/version at refresh. Definite withdrawals show a private
metadata-free placeholder; eligibility outages reject the refresh. No archived title,
credits, thumbnail or version is exposed for unavailable sources.

Following never grants project/workspace membership. Copied or inserted content is
pinned independently. Existing versioned legacy shortcuts retain their original pins.

Before enabling, verify against an isolated database: two accounts cannot read or
change each other's pairs; concurrent subscribes create one row; Planner-created
subscriptions appear in Nixie; Nixie-created subscriptions appear in Planner; removal
in either app is reflected on refresh; latest source versions follow on refresh;
unlisted/deleted/unapproved sources are never enumerated or delivered.

The repository's isolated PGlite workflow exercised actual PostgreSQL policies and
grants with controlled actor fixtures: pair uniqueness, idempotence, cross-account
isolation, native public eligibility and anonymous-role rejection passed 18 assertions.
It loaded the baseline table/policy definitions and both new migrations into an
in-memory database. It does not verify Supabase Auth, HTTP APIs, deployed schema,
cross-app sessions or browser rendering. Docker startup still blocks that local
acceptance environment. No migration was applied to a persistent or live database.
