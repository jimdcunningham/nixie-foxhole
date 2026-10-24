# Packaged Product Catalogs

The Planner uses a FoxWatch-generated catalog packaged inside its
`.nxext`. This is local preparation of the new experimental contract; publication
and Studio deployment are separate actions.

FoxWatch owns extraction interpretation, product metadata, model-layer metadata,
browser atlases, and delivery receipts. Planner's ordinary build validates and
copies `catalog.v1.json`; it must not generate another catalog or remote alias
index. Generated catalogs/media stay out of the public source repository.

## Prepare a Release

Use the existing ignored `tools/foxwatch/local/asset-publication.json` for the
generated assets directory, output directory, and R2 target. Preparation does
not read upload credentials or send requests:

```powershell
node tools/foxwatch/run-foxwatch.mjs catalog-prepare --release 2026-10-24.1 --output C:\path\to\new-snapshot
```

Choose a new readable release ID. The output must be a new directory outside
the generated input tree. The command holds FoxWatch's refresh lock, interprets
existing generated extraction data, and produces:

- `catalog.v1.json`, the single document to package with Planner.
- `payload/`, a frozen set of media and metadata ready for upload.
- `plan.json`, consumed by the existing immutable publication/retry machinery.
- `extension-pin.json`, the catalog and completion-document digests/URLs for a
  future extension release. Preparation does not install this pin into source.

Example delivery keys under the configured `foxhole-planner` prefix:

```text
foxhole-planner/releases/2026-10-24.1/catalog.v1.json
foxhole-planner/releases/2026-10-24.1/types/structures/hospital/hospital.icon.default.webp
foxhole-planner/releases/2026-10-24.1/types/structures/hospital/hospital.model.base.glb
foxhole-planner/releases/2026-10-24.1/shared/icons/browser-0.webp
foxhole-planner/releases/2026-10-24.1/shared/models/part-0001.glb
foxhole-planner/releases/2026-10-24.1/release.json
```

Hashes verify bytes; filenames stay readable. Catalog receipts describe
HTTP-decoded bytes. GLBs retain Brotli transport compression with encoded
receipts in the upload plan. Resource IDs remain stable, including shared model
IDs; their public filenames do not need to expose their internal identities.

The catalog uses shared path templates for ordinary product resources and
records shared/exceptional resources once. The client derives its lookup from
that catalog. It never needs a second remote asset index to interpret products.
Atlas frames, model dependencies, variants, localization, and recipes are still
explicit generated data where naming conventions cannot express them.

The prepared release also retains eight original extraction JSON inputs under
`source/` for source/geometry regression tests. Their receipts are in the
completion document's `buildInputs`. This is a CI fixture inventory, not another
client asset lookup. Ordinary builds consume only the catalog; source tests can
retrieve the fixtures and resolve their model inputs through that catalog.

## Publication Order

Only after approving remote publication, submit the prepared plan through the
existing `assets-publish --plan <plan.json> --upload` command. It verifies the
whole snapshot before writing, creates media first, then the catalog, then
`release.json`. Identical objects are reused on retry; conflicting bytes/headers
are rejected. The completion document does not use the private world's stable
channel and does not change its publication pin.

After completion verifies, adopt the generated catalog pin and publish a new
extension package. R2 retains a copy of the exact catalog for public CI build
inputs. Supabase retains the extension archive containing that same catalog.
Installed clients use the package's catalog and fetch only needed media from R2.

Studio's private Foxhole server/map integration retains its existing source and
world publication pins. Its region indexes are independent of this portable
product catalog. Do not delete or rewrite them while migrating Planner.

## Local Checks

```powershell
node --test tools/foxwatch/catalog/prepare-catalog.test.mjs
```

The producer test uses an in-memory publication transport to verify readable
paths, receipts, shared model dependencies, interruption/resume, and refused
overwrites. It does not contact R2. Real delivery rehearsal additionally requires
SDK validation, standalone Planner build/package verification, browser loading,
and private integration smoke checks before remote cutover.

## Local Migration Rehearsal

The October 24, 2026 local candidate is Planner `0.4.0`, using SDK
`0.1.0-preview.2` and CLI `0.1.0-preview.3`. None of those candidates or their
new asset snapshot was published during this migration. The checked-in pin
names future release URLs; use `NIXIE_FOXHOLE_CATALOG_FILE` for local builds until
the complete snapshot has been published and verified.

The prepared snapshot has 831 products and 4,718 resource records. An independent
consumer passed typechecking, 1,099 tests, build, packing, and publication-package
validation with one 7,343,090-byte catalog and no game media or remote alias
index. The resulting five-file archive is 8,052,274 bytes. Source/model regression
fixtures were verified independently and stay outside the package.

A local browser loaded the actual SDK runtime, decoded Hospital's atlas icon,
texture, model and shared part, produced a render plan, and restored a saved
component snapshot after reload using the verified media cache. It requested
readable release paths without a remote index. This isolated harness did not
exercise the full editor's placement or Undo UI. Studio also passed a fresh
production build and read-only API/published-loader smoke check with its
unchanged private integration pin; that smoke resolved existing Planner `0.3.1`.

Remote HTTPS/CORS/content-encoding checks and a fresh extension-browser install
remain part of the explicitly authorized cutover. Publishing the prepared SDK/CLI
and deploying the catalog-aware host/broker must precede the new Planner release.
Keep private world data/indexes and source pins intact throughout that cutover.
